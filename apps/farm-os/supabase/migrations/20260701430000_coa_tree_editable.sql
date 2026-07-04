-- SPEC-0024 S-1 — editable chart-of-accounts tree + expense→account link (A.5)
--
-- Extends the LIVE flat `accounts` kernel (migration 20260701220000) into an editable tree:
--   • parent_id (cycle-guarded, depth ≤ 4), kind (expense-branch only), is_system, sort_order;
--   • gated RPCs fn_save_account / fn_archive_account / fn_merge_accounts (budget.write);
--   • v_account_rollup recursive view (computed subtree net balances; security_invoker so the
--     caller's finance.read RLS on accounts/journal_lines still applies);
--   • A.5: expenses.account_id + fn_set_expense_account with a kind-consistency guard, the
--     account made REQUIRED to route an expense to payment (fn_set_expense_payment_status) or
--     into a payment request (fn_add_expense_to_request), and the two journal posting sites
--     swapped to the specific leaf account (falling back to the kind bucket for legacy NULLs).
--
-- Reuses budget.write (owner/accountant) — NO change to authorize(). All writes stay RPC-only,
-- SECURITY DEFINER, search_path='', EXECUTE locked to authenticated, and audited by the existing
-- accounts/expenses audit triggers. Non-authoritative until Owner applies (migrate-first) + merges.
begin;

-- ── 1) Grow `accounts` into a tree ───────────────────────────────────────────────────────────────
alter table public.accounts add column if not exists parent_id  uuid references public.accounts(id);
alter table public.accounts add column if not exists kind       text;
alter table public.accounts add column if not exists is_system  boolean not null default false;
alter table public.accounts add column if not exists sort_order int;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'accounts_kind_chk') then
    alter table public.accounts add constraint accounts_kind_chk
      check (kind is null or kind in ('operating','drawing','capex'));
  end if;
end $$;

-- FK covering index (INV, tests/96) + tenant-scoped tree traversal.
create index if not exists accounts_parent_idx on public.accounts(parent_id);

-- Mark the lazily-created kernel codes as system (rename-allowed, re-parent/archive-forbidden).
update public.accounts
   set is_system = true
 where code in ('1000','1500','3000','3100','5000') and is_system = false;

-- ── 2) fn_ensure_account: stamp is_system on the kernel codes it lazily creates ───────────────────
-- (re-emitted from 20260701220000 — the ONLY change is the is_system column on insert/on-conflict.)
create or replace function public.fn_ensure_account(
  p_org uuid,
  p_code text,
  p_name_ar text,
  p_account_type text,
  p_normal_balance text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_system boolean;
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_code is null or trim(p_code) = '' then raise exception 'account code required' using errcode = '23502'; end if;
  if p_account_type not in ('asset','liability','equity','revenue','expense') then
    raise exception 'invalid account_type: %', p_account_type using errcode = '22023';
  end if;
  if p_normal_balance not in ('debit','credit') then
    raise exception 'invalid normal_balance: %', p_normal_balance using errcode = '22023';
  end if;

  v_system := trim(p_code) in ('1000','1500','3000','3100','5000');

  insert into public.accounts(org_id, code, name_ar, account_type, normal_balance, is_system)
  values (p_org, trim(p_code), trim(p_name_ar), p_account_type, p_normal_balance, v_system)
  on conflict (org_id, code) do update
     set name_ar = excluded.name_ar,
         account_type = excluded.account_type,
         normal_balance = excluded.normal_balance,
         active = true,
         is_system = public.accounts.is_system or excluded.is_system
  returning id into v_id;

  return v_id;
end;
$$;
revoke execute on function public.fn_ensure_account(uuid, text, text, text, text) from public, anon, authenticated;

-- ── 3) Tree-editing RPCs (budget.write; owner/accountant) ─────────────────────────────────────────
-- fn_save_account — create or rename/re-parent an account. Cycle-guarded, depth ≤ 4.
create or replace function public.fn_save_account(
  p_id uuid,
  p_org uuid,
  p_code text,
  p_name_ar text,
  p_account_type text,
  p_normal_balance text,
  p_parent_id uuid default null,
  p_kind text default null,
  p_sort_order int default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_existing_system boolean;
  v_existing_parent uuid;
  v_id uuid;
  v_depth int;
  v_walk uuid;
begin
  -- Resolve org: existing account (edit) → parent account (create child) → explicit p_org (create root).
  if p_id is not null then
    select org_id, is_system, parent_id into v_org, v_existing_system, v_existing_parent
      from public.accounts where id = p_id;
    if v_org is null then raise exception 'account % not found', p_id using errcode = 'P0002'; end if;
  elsif p_parent_id is not null then
    select org_id into v_org from public.accounts where id = p_parent_id;
    if v_org is null then raise exception 'parent account % not found', p_parent_id using errcode = 'P0002'; end if;
  else
    v_org := p_org;
  end if;
  if v_org is null then raise exception 'org required to create a root account' using errcode = '23502'; end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org account' using errcode = '42501'; end if;
  if not public.authorize('budget.write', v_org) then
    raise exception 'forbidden: budget.write is required (owner/accountant)' using errcode = '42501'; end if;

  if p_account_type not in ('asset','liability','equity','revenue','expense') then
    raise exception 'invalid account_type: %', p_account_type using errcode = '22023'; end if;
  if p_normal_balance not in ('debit','credit') then
    raise exception 'invalid normal_balance: %', p_normal_balance using errcode = '22023'; end if;
  if p_kind is not null then
    if p_kind not in ('operating','drawing','capex') then
      raise exception 'invalid kind: %', p_kind using errcode = '22023'; end if;
    if p_account_type <> 'expense' then
      raise exception 'kind is only valid on an expense account' using errcode = '22023'; end if;
  end if;
  if p_code is null or trim(p_code) = '' then
    raise exception 'account code required' using errcode = '23502'; end if;

  -- Parent must be in the same org; guard cycles and depth (≤ 4 levels).
  if p_parent_id is not null then
    if p_parent_id = p_id then
      raise exception 'an account cannot be its own parent' using errcode = '22023'; end if;
    if (select org_id from public.accounts where id = p_parent_id) is distinct from v_org then
      raise exception 'forbidden: cross-org parent' using errcode = '42501'; end if;
    -- Walk up from the proposed parent: if we reach p_id, this edge closes a cycle. Also count depth.
    v_walk := p_parent_id; v_depth := 1;
    while v_walk is not null loop
      if v_walk = p_id then
        raise exception 'cycle: % is a descendant of the account being re-parented', p_parent_id using errcode = '22023'; end if;
      select parent_id into v_walk from public.accounts where id = v_walk;
      v_depth := v_depth + 1;
      if v_depth > 4 then
        raise exception 'account tree depth cap (4) exceeded' using errcode = '22023'; end if;
    end loop;
  end if;

  if p_id is null then
    insert into public.accounts(org_id, code, name_ar, account_type, normal_balance, parent_id, kind, sort_order)
    values (v_org, trim(p_code), trim(p_name_ar), p_account_type, p_normal_balance, p_parent_id, p_kind, p_sort_order)
    returning id into v_id;
  else
    -- System accounts: rename + sort only; re-parent/type/archive-of-shape forbidden.
    if v_existing_system and p_parent_id is distinct from v_existing_parent then
      raise exception 'system account cannot be re-parented' using errcode = '22023'; end if;
    update public.accounts
       set code = trim(p_code),
           name_ar = trim(p_name_ar),
           account_type = case when v_existing_system then account_type else p_account_type end,
           normal_balance = case when v_existing_system then normal_balance else p_normal_balance end,
           parent_id = case when v_existing_system then parent_id else p_parent_id end,
           kind = p_kind,
           sort_order = p_sort_order
     where id = p_id
    returning id into v_id;
  end if;

  return jsonb_build_object('id', v_id);
end;
$$;
revoke execute on function public.fn_save_account(uuid, uuid, text, text, text, text, uuid, text, int) from public, anon, authenticated;
grant  execute on function public.fn_save_account(uuid, uuid, text, text, text, text, uuid, text, int) to authenticated;

-- fn_archive_account — soft-delete (active=false). Never a hard DELETE (journal history is immutable).
create or replace function public.fn_archive_account(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_system boolean;
begin
  select org_id, is_system into v_org, v_system from public.accounts where id = p_id;
  if v_org is null then raise exception 'account % not found', p_id using errcode = 'P0002'; end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org account' using errcode = '42501'; end if;
  if not public.authorize('budget.write', v_org) then
    raise exception 'forbidden: budget.write is required (owner/accountant)' using errcode = '42501'; end if;
  if v_system then
    raise exception 'system account cannot be archived' using errcode = '22023'; end if;
  if exists (select 1 from public.accounts where parent_id = p_id and active) then
    raise exception 'archive or move the child accounts first' using errcode = '22023'; end if;

  update public.accounts set active = false where id = p_id;
  return jsonb_build_object('id', p_id, 'active', false);
end;
$$;
revoke execute on function public.fn_archive_account(uuid) from public, anon, authenticated;
grant  execute on function public.fn_archive_account(uuid) to authenticated;

-- fn_merge_accounts — repoint all references src→dst, then archive src. Leaves only; same type.
create or replace function public.fn_merge_accounts(p_src uuid, p_dst uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_src_org uuid; v_src_system boolean; v_src_type text;
  v_dst_org uuid; v_dst_type text;
begin
  if p_src = p_dst then raise exception 'cannot merge an account into itself' using errcode = '22023'; end if;
  select org_id, is_system, account_type into v_src_org, v_src_system, v_src_type from public.accounts where id = p_src;
  select org_id, account_type into v_dst_org, v_dst_type from public.accounts where id = p_dst;
  if v_src_org is null or v_dst_org is null then raise exception 'account not found' using errcode = 'P0002'; end if;
  if v_src_org <> v_dst_org then raise exception 'forbidden: cross-org merge' using errcode = '42501'; end if;
  if v_src_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org account' using errcode = '42501'; end if;
  if not public.authorize('budget.write', v_src_org) then
    raise exception 'forbidden: budget.write is required (owner/accountant)' using errcode = '42501'; end if;
  if v_src_system then raise exception 'system account cannot be merged away' using errcode = '22023'; end if;
  if v_src_type <> v_dst_type then
    raise exception 'accounts must share account_type to merge (% vs %)', v_src_type, v_dst_type using errcode = '22023'; end if;
  if exists (select 1 from public.accounts where parent_id = p_src) then
    raise exception 'move the child accounts before merging' using errcode = '22023'; end if;

  update public.journal_lines set account_id = p_dst where account_id = p_src;
  update public.journal_lines set custody_account_id = p_dst where custody_account_id = p_src;
  update public.expenses set account_id = p_dst where account_id = p_src;
  update public.accounts set active = false where id = p_src;
  return jsonb_build_object('src', p_src, 'dst', p_dst, 'merged', true);
end;
$$;
revoke execute on function public.fn_merge_accounts(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.fn_merge_accounts(uuid, uuid) to authenticated;

-- ── 4) v_account_rollup — subtree net balance per account (computed, never stored) ────────────────
-- security_invoker: the base-table finance.read RLS is what gates this view, so no separate grant
-- can leak balances to a non-finance role.
create or replace view public.v_account_rollup
with (security_invoker = true) as
with recursive descendants as (
  -- (root, self) then walk down: (root, each descendant)
  select id as root_id, id as node_id, org_id from public.accounts
  union all
  select d.root_id, c.id, c.org_id
    from public.accounts c
    join descendants d on c.parent_id = d.node_id
),
line_balance as (
  select account_id, sum(debit) - sum(credit) as net from public.journal_lines group by account_id
)
select
  a.id,
  a.org_id,
  a.code,
  a.name_ar,
  a.account_type,
  a.parent_id,
  a.active,
  coalesce((select lb.net from line_balance lb where lb.account_id = a.id), 0)              as own_balance,
  coalesce((select sum(lb.net)
              from descendants d
              join line_balance lb on lb.account_id = d.node_id
             where d.root_id = a.id), 0)                                                    as rollup_balance
from public.accounts a;
grant select on public.v_account_rollup to authenticated;

-- ── 5) A.5 — expenses.account_id + classification RPC + kind-consistency guard ────────────────────
alter table public.expenses add column if not exists account_id uuid references public.accounts(id);
create index if not exists expenses_account_idx on public.expenses(account_id);

-- fn_set_expense_account — classify an expense to a specific leaf expense account (mirrors
-- fn_set_expense_kind). Guards: same org, active, expense-type, leaf-only, and kind-consistency
-- (a drawings expense may not post to a non-drawings account — #6 made structural at the leaf).
create or replace function public.fn_set_expense_account(p_id uuid, p_account uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_kind text;
  v_acct_org uuid;
  v_acct_type text;
  v_acct_kind text;
  v_acct_active boolean;
begin
  select org_id, kind into v_org, v_kind from public.expenses where id = p_id;
  if v_org is null then raise exception 'expense % not found', p_id using errcode = 'P0002'; end if;
  if not public.authorize('budget.write', v_org) then
    raise exception 'forbidden: budget.write is required (owner/accountant)' using errcode = '42501'; end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org expense change' using errcode = '42501'; end if;

  if p_account is not null then
    select org_id, account_type, kind, active
      into v_acct_org, v_acct_type, v_acct_kind, v_acct_active
      from public.accounts where id = p_account;
    if v_acct_org is null then raise exception 'account % not found', p_account using errcode = 'P0002'; end if;
    if v_acct_org <> v_org then raise exception 'forbidden: cross-org account' using errcode = '42501'; end if;
    if not v_acct_active then raise exception 'account is archived' using errcode = '22023'; end if;
    if v_acct_type <> 'expense' then
      raise exception 'an expense can only be classified to an expense account' using errcode = '22023'; end if;
    if exists (select 1 from public.accounts where parent_id = p_account and active) then
      raise exception 'choose a leaf account (this one has sub-accounts)' using errcode = '22023'; end if;
    -- #6: the account's kind (when set) must match the expense's kind — drawings never posts to opex.
    if v_acct_kind is not null and v_acct_kind is distinct from coalesce(v_kind, 'operating') then
      raise exception 'account kind (%) does not match expense kind (%)', v_acct_kind, coalesce(v_kind,'operating') using errcode = '22023'; end if;
  end if;

  update public.expenses set account_id = p_account where id = p_id;
  return jsonb_build_object('id', p_id, 'account_id', p_account);
end;
$$;
revoke execute on function public.fn_set_expense_account(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.fn_set_expense_account(uuid, uuid) to authenticated;

-- ── 6) Enforce classification at the payment seams + post to the leaf account ─────────────────────
-- fn_record_custody_movement — re-emitted from 20260701220000. Changes: (a) fetch expenses.account_id;
-- (b) require it before a cash out-movement; (c) post the debit to the leaf account (fallback = kind bucket).
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
  v_exp_account uuid;
  v_debit_account uuid;
  v_credit_account uuid;
  v_journal uuid;
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
    select org_id, total, kind, payment_status, account_id
      into v_exp_org, v_exp_total, v_exp_kind, v_exp_payment_status, v_exp_account
      from public.expenses
     where id = p_expense_id;
    if v_exp_org is null then
      raise exception 'expense % not found', p_expense_id using errcode = 'P0002';
    end if;
    if v_exp_org is distinct from v_org then
      raise exception 'forbidden: cross-org expense link' using errcode = '42501';
    end if;
    if coalesce(p_amount_out,0) > 0 then
      if coalesce(v_exp_kind, 'operating') not in ('operating','drawing','capex') then
        raise exception 'invalid expense kind for custody cash out-movement (kind=%)', v_exp_kind using errcode = '22023';
      end if;
      if coalesce(v_exp_payment_status, '') <> 'paid_from_custody' then
        raise exception 'set expense payment_status to paid_from_custody through fn_set_expense_payment_status before linking a cash out-movement'
          using errcode = '22023';
      end if;
      if v_exp_account is null then
        raise exception 'classify the expense to an account (fn_set_expense_account) before a cash out-movement' using errcode = '22023';
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

  if p_expense_id is null
     and coalesce(p_amount_in,0) > 0
     and p_movement_type = 'استلام عهدة من المالك' then
    v_debit_account := public.fn_ensure_account(v_org, '1000', 'عهدة نقدية', 'asset', 'debit');
    v_credit_account := public.fn_ensure_account(v_org, '3000', 'تمويل المالك', 'equity', 'credit');
    v_journal := public.fn_post_two_line_journal(
      v_org,
      coalesce(p_occurred_at, current_date),
      'custody_owner_funding',
      v_id,
      'استلام عهدة من المالك',
      v_debit_account,
      v_credit_account,
      coalesce(p_amount_in,0),
      'استلام نقدية عهدة من المالك',
      'تمويل المالك للعهدة',
      p_account,
      v_id,
      null,
      null);
    update public.custody_movements set journal_entry_id = v_journal where id = v_id;
  end if;

  if p_expense_id is not null and coalesce(p_amount_out,0) > 0 then
    -- Post to the classified leaf account; fall back to the kind bucket for legacy NULL rows.
    v_debit_account := coalesce(v_exp_account, public.fn_account_for_expense_kind(v_org, v_exp_kind));
    v_credit_account := public.fn_ensure_account(v_org, '1000', 'عهدة نقدية', 'asset', 'debit');
    v_journal := public.fn_post_two_line_journal(
      v_org,
      coalesce(p_occurred_at, current_date),
      'expense_payment',
      p_expense_id,
      'سداد مصروف من العهدة',
      v_debit_account,
      v_credit_account,
      coalesce(p_amount_out,0),
      'إثبات مصروف/مسحوبات/رأسمالي عند السداد النقدي',
      'خروج نقدية من العهدة',
      p_account,
      v_id,
      p_expense_id,
      null);
    update public.custody_movements set journal_entry_id = v_journal where id = v_id;
  end if;

  return v_id;
end;
$$;
revoke execute on function public.fn_record_custody_movement(uuid, text, numeric, numeric, date, uuid, text) from public, anon, authenticated;
grant  execute on function public.fn_record_custody_movement(uuid, text, numeric, numeric, date, uuid, text) to authenticated;

-- fn_set_expense_payment_status — re-emitted from 20260701220000. Changes: (a) fetch account_id;
-- (b) require it when routing to custody/request; (c) post the backfill journal to the leaf account.
create or replace function public.fn_set_expense_payment_status(
  p_expense uuid, p_status text, p_custody_account uuid default null, p_paid_by text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_total numeric;
  v_kind text;
  v_account uuid;
  v_payment_status text;
  v_existing int;
  v_existing_movement uuid;
  v_has_request_line boolean := false;
  v_journal uuid;
begin
  select org_id, total, kind, payment_status, account_id
    into v_org, v_total, v_kind, v_payment_status, v_account
    from public.expenses
   where id = p_expense
   for update;
  if v_org is null then raise exception 'expense % not found', p_expense using errcode = 'P0002'; end if;
  if v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org expense' using errcode = '42501'; end if;
  if not public.authorize('budget.write', v_org) then
    raise exception 'forbidden: budget.write is required' using errcode = '42501'; end if;
  if p_status not in ('paid_from_custody','post_paid_unpaid','paid_by_owner','cancelled') then
    raise exception 'invalid payment_status: %', p_status using errcode = '22023'; end if;
  if p_status in ('paid_from_custody','post_paid_unpaid') and coalesce(v_kind, 'operating') not in ('operating','drawing','capex') then
    raise exception 'invalid expense kind for custody/request routing (kind=%)', v_kind using errcode = '22023';
  end if;
  -- A.5: an expense may not be routed to payment until it is classified to an account.
  if p_status in ('paid_from_custody','post_paid_unpaid') and v_account is null then
    raise exception 'classify the expense to an account (fn_set_expense_account) before routing it to payment' using errcode = '22023';
  end if;

  select count(*), (array_agg(id order by created_at))[1]
    into v_existing, v_existing_movement
    from public.custody_movements
   where expense_id = p_expense and amount_out > 0;

  if p_status <> 'paid_from_custody' and v_existing > 0 then
    raise exception 'expense already has a custody cash out-movement; post a reversal before rerouting payment_status' using errcode = '22023';
  end if;

  select exists (
    select 1
      from public.payment_request_lines l
     where l.expense_id = p_expense
       and l.paid_at is null)
    into v_has_request_line;
  if v_has_request_line and p_status is distinct from v_payment_status then
    raise exception 'expense is already included in an unpaid payment request line; confirm payment through the request workflow'
      using errcode = '22023';
  end if;

  update public.expenses
     set payment_status = p_status,
         paid_by = p_paid_by
   where id = p_expense;

  if p_status = 'paid_from_custody' then
    if p_custody_account is null and v_existing = 0 then
      raise exception 'custody account required for paid_from_custody' using errcode = '22023';
    end if;
    if p_custody_account is not null and (select org_id from public.custody_accounts where id = p_custody_account) is distinct from v_org then
      raise exception 'forbidden: cross-org custody account' using errcode = '42501';
    end if;
    if v_existing = 0 and coalesce(v_total,0) > 0 then
      v_existing_movement := public.fn_record_custody_movement(
        p_custody_account, 'صرف نقدي', 0, v_total, current_date, p_expense,
        'صرف نقدي للمصروف ' || left(p_expense::text, 8));
    elsif v_existing_movement is not null then
      select journal_entry_id into v_journal from public.custody_movements where id = v_existing_movement;
      if v_journal is null then
        v_journal := public.fn_post_two_line_journal(
          v_org,
          current_date,
          'expense_payment',
          p_expense,
          'سداد مصروف من العهدة',
          coalesce(v_account, public.fn_account_for_expense_kind(v_org, v_kind)),
          public.fn_ensure_account(v_org, '1000', 'عهدة نقدية', 'asset', 'debit'),
          coalesce(v_total,0),
          'إثبات مصروف/مسحوبات/رأسمالي عند السداد النقدي',
          'خروج نقدية من العهدة',
          (select custody_account_id from public.custody_movements where id = v_existing_movement),
          v_existing_movement,
          p_expense,
          null);
        update public.custody_movements set journal_entry_id = v_journal where id = v_existing_movement;
      end if;
    end if;
  end if;
end;
$$;
revoke execute on function public.fn_set_expense_payment_status(uuid, text, uuid, text) from public, anon, authenticated;
grant  execute on function public.fn_set_expense_payment_status(uuid, text, uuid, text) to authenticated;

-- fn_add_expense_to_request — re-emitted from 20260701220000. Change: require account_id (A.5) so a
-- payment request can never carry an unclassified expense.
create or replace function public.fn_add_expense_to_request(p_request uuid, p_expense uuid)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_status text;
  v_exp_org uuid;
  v_exp_kind text;
  v_exp_payment_status text;
  v_exp_account uuid;
  v_paid_by text;
  v_id uuid;
  v_existing_movement uuid;
  v_existing_account uuid;
  v_existing_journal uuid;
begin
  select org_id, status into v_org, v_status from public.payment_requests where id = p_request;
  if v_org is null then raise exception 'request % not found', p_request using errcode='P0002'; end if;
  if v_org not in (select public.user_org_ids()) then raise exception 'forbidden: cross-org' using errcode='42501'; end if;
  if not public.authorize('request.prepare', v_org) then
    raise exception 'forbidden: request.prepare is required' using errcode='42501'; end if;
  if v_status <> 'draft' then raise exception 'request is not draft (%)', v_status using errcode='22023'; end if;

  select org_id, kind, payment_status, paid_by, account_id
    into v_exp_org, v_exp_kind, v_exp_payment_status, v_paid_by, v_exp_account
    from public.expenses
   where id = p_expense
   for update;
  if v_exp_org is distinct from v_org then raise exception 'forbidden: cross-org expense' using errcode='42501'; end if;
  if coalesce(v_exp_kind, 'operating') not in ('operating','drawing','capex') then
    raise exception 'invalid expense kind for a payment request (kind=%)', v_exp_kind using errcode='22023'; end if;
  if coalesce(v_exp_payment_status, '') not in ('post_paid_unpaid','paid_from_custody') then
    raise exception 'only post_paid_unpaid or paid_from_custody expenses can be added to a payment request (payment_status=%)', v_exp_payment_status using errcode='22023'; end if;
  -- A.5: block an unclassified expense from entering a payment request.
  if v_exp_account is null then
    raise exception 'classify the expense to an account (fn_set_expense_account) before adding it to a payment request' using errcode='22023'; end if;
  if exists (
       select 1 from public.payment_request_lines l
        where l.expense_id = p_expense
          and l.payment_request_id <> p_request) then
    raise exception 'expense is already included in another payment request' using errcode='22023';
  end if;

  if v_exp_payment_status = 'paid_from_custody' then
    select m.id, m.custody_account_id, m.journal_entry_id
      into v_existing_movement, v_existing_account, v_existing_journal
      from public.custody_movements m
     where m.expense_id = p_expense and m.amount_out > 0
     order by m.created_at
     limit 1;
    if v_existing_movement is null then
      raise exception 'paid_from_custody expense has no custody cash out-movement' using errcode='22023';
    end if;
  end if;

  insert into public.payment_request_lines(
    org_id, payment_request_id, expense_id, paid_at, paid_by, paid_from_custody_account_id, custody_movement_id, journal_entry_id)
  values (
    v_org,
    p_request,
    p_expense,
    case when v_exp_payment_status = 'paid_from_custody' then now() else null end,
    case when v_exp_payment_status = 'paid_from_custody' then v_paid_by else null end,
    v_existing_account,
    v_existing_movement,
    v_existing_journal)
  on conflict (payment_request_id, expense_id) do nothing
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.fn_add_expense_to_request(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.fn_add_expense_to_request(uuid, uuid) to authenticated;

commit;
