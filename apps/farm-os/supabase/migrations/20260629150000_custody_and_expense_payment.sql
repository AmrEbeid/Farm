-- Farm OS — SPEC-0018 «العهدة وطلبات الصرف» slice 1: custody ledger + expense payment-status.
--
-- PROBLEM: the paper «إذن صرف» tracks a permanent custody float (≈30k) held by the Farm Manager →
-- Accountant, with cash-paid expenses deducting from it and post-paid (labor/tasmeed) requested from the
-- Owner. Today it is hand-totaled with the top-up scribbled in the margin. This slice adds the LIVE custody
-- ledger and links each expense to how it was paid, so the balance and the owner-request are always derived.
--
-- INTENT (this slice): (1) custody_accounts + custody_movements (cash truth, balance = Σin − Σout, derived);
-- (2) extend the existing public.expenses with payment_status / paid_by / kind (the existing
-- table already carries category + sector/hawsha/plan links + total + budget.write gate, migrations 0007/0044);
-- (3) gated custody/payment RPCs; (4) re-emit authorize() pinning the FULL permission union (forward-compat for the
-- in-flight academy.write/export.write so a later re-emit can't drop them — see DEPLOY-STATUS ordering note).
-- Payment-requests + lifecycle are slice 2; frontend + import descriptors are slice 3.
--
-- SECURITY: RLS + FORCE RLS + deny-by-default; writes ONLY via SECURITY DEFINER RPCs (search_path='',
-- schema-qualified, EXECUTE revoked from public/anon, granted authenticated); finance reads are owner/accountant
-- only; audited via fn_audit (0008).
-- Money rule (#6): a cash-paid expense posts EXACTLY ONE custody out-movement = its total; the expense still
-- hits the P&L once (no double-count). Owner drawings stay separable via expenses.kind and are rejected from
-- custody/request routing in this apply path even if the accounting P&L branch has not landed first.
-- Owner-gated apply (drafts only). Validate with test-shims/run-pgtap-local.sh.

begin;

-- ── 1) authorize(): re-emit pinning the current union + in-flight academy/export + new finance ──
-- Keep this definition in sync with any later authorize() re-emit before prod apply.
-- Including academy.write/export.write here is harmless if their tables aren't present yet (a perm→role map
-- with no backing table is simply never satisfied) and DEFUSES the #366(0091)/#400(0092) drop-trap.
create or replace function public.authorize(perm text, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_member m
    where m.user_id = (select auth.uid())
      and m.org_id = p_org
      and ( (perm = 'pr.approve'             and m.role = 'owner')
         or (perm = 'plan.write'             and m.role in ('owner','farm_manager'))
         or (perm = 'op.execute'             and m.role in ('owner','farm_manager','agri_engineer','supervisor'))
         or (perm = 'inventory.write'        and m.role in ('owner','farm_manager','storekeeper'))
         or (perm = 'budget.write'           and m.role in ('owner','accountant'))
         or (perm = 'payroll.read'           and m.role in ('owner','accountant'))
         or (perm = 'structure.write'        and m.role in ('owner','farm_manager'))
         or (perm = 'academy.write'          and m.role in ('owner','agri_engineer'))   -- in-flight #366 (forward-compat)
         or (perm = 'export.write'           and m.role in ('owner','farm_manager'))     -- in-flight #400 (forward-compat)
         or (perm = 'responsibility.write'   and m.role in ('owner','farm_manager'))     -- in-flight #444 (forward-compat)
         or (perm = 'finance.read'           and m.role in ('owner','accountant'))        -- SPEC-0018 confidential finance reads
         or (perm = 'custody.write'          and m.role in ('owner','accountant'))        -- SPEC-0018 finance-only custody writes
         or (perm = 'request.prepare'        and m.role in ('owner','accountant'))        -- SPEC-0018 finance-only payment prep
         or (perm = 'request.approve.op'     and m.role in ('owner','accountant'))        -- SPEC-0018 finance approval
         or (perm = 'request.approve.final'  and m.role = 'owner') )                     -- SPEC-0018 owner final approval
  )
$$;
revoke execute on function public.authorize(text, uuid) from public, anon, authenticated;
grant  execute on function public.authorize(text, uuid) to anon, authenticated;  -- RLS helper (anon needed for policy eval)

-- ── 2) custody_accounts (one per custodian: Farm Manager / Accountant) ──────────────────────────────────
create table public.custody_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  holder_label text not null,                          -- e.g. 'مدير المزرعة' / 'المحاسب' (or a person name)
  holder_user_id uuid,                                 -- custodian's auth user id (org_member PK is composite → no FK)
  target_float numeric not null default 0 check (target_float >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists custody_accounts_org_idx on public.custody_accounts(org_id);
alter table public.custody_accounts enable row level security;
alter table public.custody_accounts force row level security;
drop policy if exists tenant_read on public.custody_accounts;
create policy tenant_read on public.custody_accounts for select to authenticated
  using (org_id in (select public.user_org_ids()) and public.authorize('finance.read', org_id));
revoke insert, update, delete on public.custody_accounts from authenticated, anon;  -- writes via fn_save_custody_account; soft-delete via active=false
grant  select on public.custody_accounts to authenticated;  -- 0009 blanket grant doesn't inherit; explicit
drop trigger if exists audit_custody_account on public.custody_accounts;
create trigger audit_custody_account after insert or update or delete on public.custody_accounts
  for each row execute function public.fn_audit('custody_account');

-- RPC-only account create/update path. Direct DML stays revoked so frontend writes cannot bypass validation/audit.
create or replace function public.fn_save_custody_account(
  p_id uuid,
  p_org uuid,
  p_holder_label text,
  p_holder_user_id uuid default null,
  p_target_float numeric default 0,
  p_active boolean default true)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
  v_exp_org uuid;
  v_exp_total numeric;
  v_exp_kind text;
  v_exp_payment_status text;
begin
  if p_id is not null then
    select org_id into v_org from public.custody_accounts where id = p_id;
    if v_org is null then raise exception 'custody account % not found', p_id using errcode = 'P0002'; end if;
  else
    v_org := p_org;
    if v_org is null then raise exception 'org required' using errcode = '23502'; end if;
  end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org custody account' using errcode = '42501'; end if;
  if not public.authorize('custody.write', v_org) then
    raise exception 'forbidden: custody.write is required' using errcode = '42501'; end if;
  if p_holder_user_id is not null and not exists (
       select 1 from public.organization_member m
        where m.org_id = v_org and m.user_id = p_holder_user_id) then
    raise exception 'forbidden: holder_user_id must be a member of the custody account org' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_holder_label, '')), '') is null then
    raise exception 'holder_label is required' using errcode = '23502'; end if;
  if coalesce(p_target_float, 0) < 0 then
    raise exception 'target_float must be non-negative' using errcode = '22023'; end if;

  if p_id is null then
    insert into public.custody_accounts(org_id, holder_label, holder_user_id, target_float, active)
    values (v_org, trim(p_holder_label), p_holder_user_id, coalesce(p_target_float, 0), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.custody_accounts
       set holder_label = trim(p_holder_label),
           holder_user_id = p_holder_user_id,
           target_float = coalesce(p_target_float, 0),
           active = coalesce(p_active, true)
     where id = p_id
     returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.fn_save_custody_account(uuid, uuid, text, uuid, numeric, boolean) from public, anon, authenticated;
grant  execute on function public.fn_save_custody_account(uuid, uuid, text, uuid, numeric, boolean) to authenticated;

-- ── 3) custody_movements (cash in/out; running balance is DERIVED, never stored) ────────────────────────
create table public.custody_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organization(id) on delete cascade,
  custody_account_id uuid not null references public.custody_accounts(id) on delete cascade,
  occurred_at date not null default current_date,
  movement_type text not null,                         -- استلام عهدة / تسليم / صرف نقدي / رد / تسوية
  amount_in numeric not null default 0 check (amount_in >= 0),
  amount_out numeric not null default 0 check (amount_out >= 0),
  expense_id uuid references public.expenses(id),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint custody_one_direction check ((amount_in > 0) <> (amount_out > 0))  -- exactly one side > 0
);
-- covering index leading EACH FK column (#229b invariant): org_id, custody_account_id, expense_id
create index if not exists custody_movements_org_idx on public.custody_movements(org_id, occurred_at);
create index if not exists custody_movements_acct_idx on public.custody_movements(custody_account_id, occurred_at);
create index if not exists custody_movements_expense_idx on public.custody_movements(expense_id);
alter table public.custody_movements enable row level security;
alter table public.custody_movements force row level security;
drop policy if exists tenant_read on public.custody_movements;
create policy tenant_read on public.custody_movements for select to authenticated
  using (org_id in (select public.user_org_ids()) and public.authorize('finance.read', org_id));
grant  select on public.custody_movements to authenticated;  -- reads finance-gated via tenant_read; audited table must be readable (no audit-leak)
revoke insert, update, delete on public.custody_movements from authenticated, anon;  -- append-only, RPC-ONLY ledger (writes via fn_record_custody_movement; correct via reversal)
drop trigger if exists audit_custody_movement on public.custody_movements;
create trigger audit_custody_movement after insert or update or delete on public.custody_movements
  for each row execute function public.fn_audit('custody_movement');

-- ── 4) extend expenses with payment routing (cash vs owner-request) ─────────────────────────────────────
alter table public.expenses add column if not exists payment_status text;      -- paid_from_custody|post_paid_unpaid|paid_by_owner|cancelled
alter table public.expenses add column if not exists paid_by text;             -- free label of who paid
alter table public.expenses add column if not exists kind text not null default 'operating'
  check (kind in ('operating','drawing','capex'));
alter table public.expenses drop constraint if exists expenses_payment_status_check;
alter table public.expenses
  add constraint expenses_payment_status_check
  check (payment_status is null or payment_status in ('paid_from_custody','post_paid_unpaid','paid_by_owner','cancelled'));
-- `expenses` remains directly writable for ordinary budget.write expense entry, but the payment-routing
-- fields are RPC-only so `paid_from_custody` cannot bypass the required custody out-movement side effect.
revoke insert, update on public.expenses from authenticated, anon;
grant insert (
  id, org_id, date, farm_id, sector_id, hawsha_id, event_id, plan_id, category, description,
  supplier_id, qty, unit, unit_price, total, payment_method, recorded_by, approved_by, status
) on public.expenses to authenticated;
grant update (
  id, org_id, date, farm_id, sector_id, hawsha_id, event_id, plan_id, category, description,
  supplier_id, qty, unit, unit_price, total, payment_method, recorded_by, approved_by, status
) on public.expenses to authenticated;
-- (the expense→custody link lives on custody_movements.expense_id — avoids a cross-org FK on expenses)

-- Once an expense is routed into custody/request money flow, its amount/classification is immutable. Corrections
-- must use an explicit reversal/new line so the custody ledger and payment request cannot drift from the expense.
create or replace function public.expense_guard_routed_money_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_is_routed boolean; v_has_request_line boolean := false;
begin
  if old.total is not distinct from new.total and old.kind is not distinct from new.kind then
    return new;
  end if;

  if to_regclass('public.payment_request_lines') is not null then
    execute 'select exists (select 1 from public.payment_request_lines l where l.expense_id = $1)'
      into v_has_request_line
      using old.id;
  end if;

  v_is_routed :=
       coalesce(old.payment_status, '') in ('paid_from_custody','post_paid_unpaid')
    or exists (select 1 from public.custody_movements m where m.expense_id = old.id and m.amount_out > 0)
    or v_has_request_line;

  if v_is_routed then
    raise exception 'routed expense amount/kind is immutable; post a reversal or create a new expense'
      using errcode = '22023';
  end if;

  return new;
end;
$$;
revoke execute on function public.expense_guard_routed_money_immutable() from public, anon, authenticated;
drop trigger if exists expense_guard_routed_money_immutable on public.expenses;
create trigger expense_guard_routed_money_immutable
  before update of total, kind on public.expenses
  for each row execute function public.expense_guard_routed_money_immutable();

-- balance helper: current custody = Σin − Σout for an account (derived; SECURITY DEFINER so RLS-safe read).
create or replace function public.fn_custody_balance(p_account uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_org uuid; v_balance numeric;
begin
  select org_id into v_org from public.custody_accounts where id = p_account;
  if v_org is null then raise exception 'custody account % not found', p_account using errcode = 'P0002'; end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org custody account' using errcode = '42501'; end if;
  if not public.authorize('finance.read', v_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501'; end if;

  select coalesce(sum(amount_in),0) - coalesce(sum(amount_out),0)
    into v_balance
    from public.custody_movements m
   where m.custody_account_id = p_account
     and m.org_id = v_org;
  return coalesce(v_balance, 0);
end;
$$;
revoke execute on function public.fn_custody_balance(uuid) from public, anon, authenticated;
grant  execute on function public.fn_custody_balance(uuid) to authenticated;

-- ── 5) fn_record_custody_movement — the ONLY client path to post a custody movement ─────────────────────
create or replace function public.fn_record_custody_movement(
  p_account uuid, p_movement_type text, p_amount_in numeric, p_amount_out numeric,
  p_occurred_at date default current_date, p_expense_id uuid default null, p_note text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
  v_exp_org uuid;
  v_exp_total numeric;
  v_exp_kind text;
  v_exp_payment_status text;
begin
  select org_id into v_org from public.custody_accounts where id = p_account;
  if v_org is null then raise exception 'custody account % not found', p_account using errcode = 'P0002'; end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org custody' using errcode = '42501'; end if;
  if not public.authorize('custody.write', v_org) then
    raise exception 'forbidden: custody.write is required' using errcode = '42501'; end if;
  if coalesce(p_amount_in,0) < 0 or coalesce(p_amount_out,0) < 0 then
    raise exception 'amounts must be non-negative' using errcode = '22023'; end if;
  if (coalesce(p_amount_in,0) > 0) = (coalesce(p_amount_out,0) > 0) then
    raise exception 'exactly one of amount_in / amount_out must be > 0' using errcode = '22023'; end if;
  if p_expense_id is not null then
    select org_id, total, kind, payment_status
      into v_exp_org, v_exp_total, v_exp_kind, v_exp_payment_status
      from public.expenses
     where id = p_expense_id;
    if v_exp_org is null then
      raise exception 'expense % not found', p_expense_id using errcode = 'P0002';
    end if;
    if v_exp_org is distinct from v_org then
      raise exception 'forbidden: cross-org expense link' using errcode = '42501';
    end if;
    if coalesce(p_amount_out,0) > 0 then
      if coalesce(v_exp_kind, 'operating') <> 'operating' then
        raise exception 'only operating expenses can be linked to custody cash out-movements (kind=%)', v_exp_kind
          using errcode = '22023';
      end if;
      if coalesce(v_exp_payment_status, '') <> 'paid_from_custody' then
        raise exception 'set expense payment_status to paid_from_custody through fn_set_expense_payment_status before linking a cash out-movement'
          using errcode = '22023';
      end if;
      if coalesce(p_amount_out,0) <> coalesce(v_exp_total,0) then
        raise exception 'custody cash out-movement must equal the linked expense total (%)', v_exp_total
          using errcode = '22023';
      end if;
      if exists (
         select 1 from public.custody_movements m
          where m.expense_id = p_expense_id and m.amount_out > 0) then
        raise exception 'expense already has a custody cash out-movement; post a reversal before another cash out' using errcode = '22023';
      end if;
    end if;
  end if;
  insert into public.custody_movements(org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out, expense_id, note)
  values (v_org, p_account, coalesce(p_occurred_at, current_date), p_movement_type,
          coalesce(p_amount_in,0), coalesce(p_amount_out,0), p_expense_id, p_note)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.fn_record_custody_movement(uuid, text, numeric, numeric, date, uuid, text) from public, anon, authenticated;
grant  execute on function public.fn_record_custody_movement(uuid, text, numeric, numeric, date, uuid, text) to authenticated;

-- ── 6) fn_set_expense_payment_status — sets routing; paid_from_custody posts ONE linked out-movement ────
create or replace function public.fn_set_expense_payment_status(
  p_expense uuid, p_status text, p_custody_account uuid default null, p_paid_by text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_org uuid; v_total numeric; v_kind text; v_payment_status text; v_existing int; v_has_request_line boolean := false;
begin
  select org_id, total, kind, payment_status
    into v_org, v_total, v_kind, v_payment_status
    from public.expenses
   where id = p_expense
   for update;
  if v_org is null then raise exception 'expense % not found', p_expense using errcode = 'P0002'; end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org expense' using errcode = '42501'; end if;
  if not public.authorize('budget.write', v_org) then           -- expense writes already gate on budget.write (0044)
    raise exception 'forbidden: budget.write is required' using errcode = '42501'; end if;
  if p_status not in ('paid_from_custody','post_paid_unpaid','paid_by_owner','cancelled') then
    raise exception 'invalid payment_status: %', p_status using errcode = '22023'; end if;
  if p_status in ('paid_from_custody','post_paid_unpaid') and coalesce(v_kind, 'operating') <> 'operating' then
    raise exception 'only operating expenses can use custody/request routing (kind=%)', v_kind using errcode = '22023'; end if;
  select count(*) into v_existing from public.custody_movements
    where expense_id = p_expense and amount_out > 0;
  if p_status <> 'paid_from_custody' and v_existing > 0 then
    raise exception 'expense already has a custody cash out-movement; post a reversal before rerouting payment_status' using errcode = '22023';
  end if;
  if to_regclass('public.payment_request_lines') is not null then
    execute 'select exists (select 1 from public.payment_request_lines l where l.expense_id = $1)'
      into v_has_request_line
      using p_expense;
    if v_has_request_line and p_status is distinct from v_payment_status then
      raise exception 'expense is already included in a payment request; remove/correct the request before rerouting payment_status'
        using errcode = '22023';
    end if;
  end if;
  update public.expenses
     set payment_status = p_status,
         paid_by = p_paid_by
   where id = p_expense;
  -- post the cash out-movement exactly once for a custody-paid expense (idempotent: skip if one already exists)
  if p_status = 'paid_from_custody' then
    if p_custody_account is null then
      raise exception 'custody account required for paid_from_custody' using errcode = '22023'; end if;
    if (select org_id from public.custody_accounts where id = p_custody_account) is distinct from v_org then
      raise exception 'forbidden: cross-org custody account' using errcode = '42501'; end if;
    if v_existing = 0 and coalesce(v_total,0) > 0 then
      perform public.fn_record_custody_movement(
        p_custody_account, 'صرف نقدي', 0, v_total, current_date, p_expense,
        'صرف نقدي للمصروف ' || left(p_expense::text, 8));
    end if;
  end if;
end;
$$;
revoke execute on function public.fn_set_expense_payment_status(uuid, text, uuid, text) from public, anon, authenticated;
grant  execute on function public.fn_set_expense_payment_status(uuid, text, uuid, text) to authenticated;

-- Keep the drawings split available in this apply path even when #368 has not landed first.
create or replace function public.fn_set_expense_kind(p_id uuid, p_kind text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.expenses where id = p_id;
  if v_org is null then raise exception 'expense % not found', p_id using errcode = 'P0002'; end if;
  if not public.authorize('budget.write', v_org) then
    raise exception 'forbidden: budget.write is required (owner/accountant)' using errcode = '42501'; end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org expense change' using errcode = '42501'; end if;
  if coalesce(p_kind, '') not in ('operating','drawing','capex') then
    raise exception 'invalid expense kind: %', p_kind using errcode = '22023'; end if;
  update public.expenses set kind = p_kind where id = p_id;
  return jsonb_build_object('id', p_id, 'kind', p_kind);
end $$;
revoke execute on function public.fn_set_expense_kind(uuid, text) from public, anon, authenticated;
grant  execute on function public.fn_set_expense_kind(uuid, text) to authenticated;

commit;
