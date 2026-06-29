-- Farm OS — SPEC-0018 «العهدة وطلبات الصرف» slice 1: custody ledger + expense payment-status.
--
-- PROBLEM: the paper «إذن صرف» tracks a permanent custody float (≈30k) held by the Farm Manager →
-- Accountant, with cash-paid expenses deducting from it and post-paid (labor/tasmeed) requested from the
-- Owner. Today it is hand-totaled with the top-up scribbled in the margin. This slice adds the LIVE custody
-- ledger and links each expense to how it was paid, so the balance and the owner-request are always derived.
--
-- INTENT (this slice): (1) custody_accounts + custody_movements (cash truth, balance = Σin − Σout, derived);
-- (2) extend the existing public.expenses with payment_status / custody_account_id / paid_by (the existing
-- table already carries category + sector/hawsha/plan links + total + budget.write gate, migrations 0007/0044);
-- (3) two gated RPCs; (4) re-emit authorize() pinning the FULL permission union (forward-compat for the
-- in-flight academy.write/export.write so a later re-emit can't drop them — see DEPLOY-STATUS ordering note).
-- Payment-requests + lifecycle are slice 2; frontend + import descriptors are slice 3.
--
-- SECURITY: RLS + FORCE RLS + deny-by-default; writes ONLY via SECURITY DEFINER RPCs (search_path='',
-- schema-qualified, EXECUTE revoked from public/anon, granted authenticated); audited via fn_audit (0008).
-- Money rule (#6): a cash-paid expense posts EXACTLY ONE custody out-movement = its total; the expense still
-- hits the P&L once (no double-count). Owner drawings stay separable (category 'مسحوبات المالك'; the richer
-- `kind` column arrives with the gated accounting PR #368/0088 and reconciles then).
-- Owner-gated apply (drafts only). Validate with test-shims/run-pgtap-local.sh.

begin;

-- ── 1) authorize(): re-emit pinning the FULL union (main 0081 set + in-flight academy/export + new finance) ──
-- This migration is intentionally the highest-numbered authorize() re-emit, so it is the FINAL definition.
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
         or (perm = 'custody.write'          and m.role in ('owner','farm_manager','accountant'))   -- SPEC-0018
         or (perm = 'request.prepare'        and m.role in ('owner','farm_manager','accountant'))   -- SPEC-0018
         or (perm = 'request.approve.op'     and m.role in ('owner','farm_manager'))     -- SPEC-0018 operational approval
         or (perm = 'request.approve.final'  and m.role = 'owner') )                     -- SPEC-0018 owner final approval
  )
$$;
revoke all     on function public.authorize(text, uuid) from public;
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
create index custody_accounts_org_idx on public.custody_accounts(org_id);
alter table public.custody_accounts enable row level security;
alter table public.custody_accounts force row level security;
create policy tenant_all on public.custody_accounts for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()) and public.authorize('custody.write', org_id));
revoke delete on public.custody_accounts from authenticated, anon;  -- soft via active=false
grant  select, insert, update on public.custody_accounts to authenticated;  -- 0009 blanket grant doesn't inherit; explicit
create trigger audit_custody_account after insert or update or delete on public.custody_accounts
  for each row execute function public.fn_audit('custody_account');

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
create index custody_movements_org_idx on public.custody_movements(org_id, occurred_at);
create index custody_movements_acct_idx on public.custody_movements(custody_account_id, occurred_at);
create index custody_movements_expense_idx on public.custody_movements(expense_id);
alter table public.custody_movements enable row level security;
alter table public.custody_movements force row level security;
create policy tenant_all on public.custody_movements for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()) and public.authorize('custody.write', org_id));
grant  select on public.custody_movements to authenticated;  -- reads org-scoped via tenant_all; audited table must be readable (no audit-leak)
revoke insert, update, delete on public.custody_movements from authenticated, anon;  -- append-only, RPC-ONLY ledger (writes via fn_record_custody_movement; correct via reversal)
create trigger audit_custody_movement after insert or update or delete on public.custody_movements
  for each row execute function public.fn_audit('custody_movement');

-- ── 4) extend expenses with payment routing (cash vs owner-request) ─────────────────────────────────────
alter table public.expenses add column if not exists payment_status text;      -- paid_from_custody|post_paid_unpaid|paid_by_owner|cancelled
alter table public.expenses add column if not exists paid_by text;             -- free label of who paid
-- (the expense→custody link lives on custody_movements.expense_id — avoids a cross-org FK on expenses)
-- balance helper: current custody = Σin − Σout for an account (derived; SECURITY DEFINER so RLS-safe read).
create or replace function public.fn_custody_balance(p_account uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount_in),0) - coalesce(sum(amount_out),0)
  from public.custody_movements m
  where m.custody_account_id = p_account
    and m.org_id in (select public.user_org_ids());
$$;
revoke all     on function public.fn_custody_balance(uuid) from public;
revoke execute on function public.fn_custody_balance(uuid) from anon;
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
declare v_org uuid; v_id uuid;
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
  if p_expense_id is not null and not exists (
       select 1 from public.expenses e where e.id = p_expense_id and e.org_id = v_org) then
    raise exception 'forbidden: cross-org expense link' using errcode = '42501'; end if;
  insert into public.custody_movements(org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out, expense_id, note)
  values (v_org, p_account, coalesce(p_occurred_at, current_date), p_movement_type,
          coalesce(p_amount_in,0), coalesce(p_amount_out,0), p_expense_id, p_note)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all     on function public.fn_record_custody_movement(uuid, text, numeric, numeric, date, uuid, text) from public;
revoke execute on function public.fn_record_custody_movement(uuid, text, numeric, numeric, date, uuid, text) from anon;
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
declare v_org uuid; v_total numeric; v_existing int;
begin
  select org_id, total into v_org, v_total from public.expenses where id = p_expense;
  if v_org is null then raise exception 'expense % not found', p_expense using errcode = 'P0002'; end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org expense' using errcode = '42501'; end if;
  if not public.authorize('budget.write', v_org) then           -- expense writes already gate on budget.write (0044)
    raise exception 'forbidden: budget.write is required' using errcode = '42501'; end if;
  if p_status not in ('paid_from_custody','post_paid_unpaid','paid_by_owner','cancelled') then
    raise exception 'invalid payment_status: %', p_status using errcode = '22023'; end if;
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
    select count(*) into v_existing from public.custody_movements
      where expense_id = p_expense and amount_out > 0;
    if v_existing = 0 and coalesce(v_total,0) > 0 then
      perform public.fn_record_custody_movement(
        p_custody_account, 'صرف نقدي', 0, v_total, current_date, p_expense,
        'صرف نقدي للمصروف ' || left(p_expense::text, 8));
    end if;
  end if;
end;
$$;
revoke all     on function public.fn_set_expense_payment_status(uuid, text, uuid, text) from public;
revoke execute on function public.fn_set_expense_payment_status(uuid, text, uuid, text) from anon;
grant  execute on function public.fn_set_expense_payment_status(uuid, text, uuid, text) to authenticated;

commit;
