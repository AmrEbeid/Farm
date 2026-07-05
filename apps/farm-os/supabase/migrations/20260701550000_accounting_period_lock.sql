-- 20260701550000 — Accounting period close/lock (SPEC-0004 §7.3 "lightweight period lock"; ROADMAP Slice A item 3).
--
-- Problem: journal entries can be posted (or back-dated) into any period, so once an accountant "closes" a
--   month/season there is nothing stopping a later posting from silently changing a reported period's totals —
--   which would break the P&L / balance-sheet / dual-run reconciliation the accounting stage is gating on.
--
-- Intent (deliberately lightweight per SPEC-0004 §7.3 — one open/locked flag + owner unlock, NOT a multi-stage
--   close): a per-org `accounting_periods` table of closed date ranges, and a single lock check inside the one
--   RPC every journal posting funnels through — `fn_post_two_line_journal`. Custody settlement, expense payment,
--   sale finalize, and sale collection all post via that RPC, so guarding it there guards every posting path by
--   construction (no per-caller change; no re-emit of the four business RPCs).
--
-- Security implications: close is owner/accountant, reopen (unlock) is OWNER-ONLY — enforced by a direct role
--   check inside each SECURITY DEFINER RPC (the fn_update_org_settings 0086 pattern), so this adds NO new
--   `authorize()` permission and does not re-emit `authorize()` (avoids the permission-union footgun). The lock
--   check itself is a pure state check (no role). `fn_period_locked` is INTERNAL (no client EXECUTE). Idempotent
--   re-posts (existing source key) are unaffected — only genuinely NEW entries into a locked period are rejected.
--   Reject code 55000 (object_not_in_prerequisite_state) with an Arabic message (non-negotiable #2, no English leak).
--   accounting_periods is finance.read role-restricted + audited, so its audit entity is gated in audit_read too
--   (the 56 audit-leak invariant). fn_post_two_line_journal is re-emitted from its CURRENT (0460) body — which
--   carries cost_center_id — plus one lock block, so the cost-center dimension is preserved (re-emit footgun).
--
-- Rollback: drop fn_reopen_accounting_period, fn_close_accounting_period, fn_period_locked, table
--   accounting_periods; restore fn_post_two_line_journal + the audit_read policy from migration 20260701460000
--   / 20260701500000 respectively.

-- ── 1) The closed-period register ────────────────────────────────────────────────────────────────────────────
create table if not exists public.accounting_periods (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organization(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  status       text not null default 'locked' check (status in ('open','locked')),
  note         text,
  locked_by    uuid default auth.uid(),
  locked_at    timestamptz not null default now(),
  reopened_by  uuid,
  reopened_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint accounting_period_range check (period_end >= period_start)
);
create index if not exists accounting_periods_org_range_idx
  on public.accounting_periods(org_id, period_start, period_end);

alter table public.accounting_periods enable row level security;
alter table public.accounting_periods force row level security;
drop policy if exists tenant_read on public.accounting_periods;
create policy tenant_read on public.accounting_periods for select to authenticated
  using (org_id in (select public.user_org_ids()) and public.authorize('finance.read', org_id));
grant select on public.accounting_periods to authenticated;
revoke insert, update, delete on public.accounting_periods from authenticated, anon;
drop trigger if exists audit_accounting_period on public.accounting_periods;
create trigger audit_accounting_period after insert or update or delete on public.accounting_periods
  for each row execute function public.fn_audit('accounting_period');

-- ── 2) Internal lock check — is p_date inside a LOCKED period for this org? ───────────────────────────────────
create or replace function public.fn_period_locked(p_org uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.accounting_periods
     where org_id = p_org
       and status = 'locked'
       and p_date between period_start and period_end
  )
$$;
revoke execute on function public.fn_period_locked(uuid, date) from public, anon, authenticated;

-- ── 3) Close a period (owner or accountant) ─────────────────────────────────────────────────────────────────
create or replace function public.fn_close_accounting_period(
  p_org uuid,
  p_period_start date,
  p_period_end date,
  p_note text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_period_start is null or p_period_end is null then
    raise exception 'period bounds required' using errcode = '23502'; end if;
  if p_period_end < p_period_start then
    raise exception 'period end before start' using errcode = '22023'; end if;

  -- owner or accountant of THIS org (definer bypasses RLS, so the org+role scope is checked explicitly)
  if not exists (
    select 1 from public.organization_member
     where user_id = (select auth.uid()) and org_id = p_org and role in ('owner', 'accountant')
  ) then
    raise exception 'forbidden: only the owner or accountant may close a period' using errcode = '42501';
  end if;

  -- a date can belong to at most one locked period: reject an overlap with an existing locked range
  if exists (
    select 1 from public.accounting_periods
     where org_id = p_org and status = 'locked'
       and daterange(period_start, period_end, '[]') && daterange(p_period_start, p_period_end, '[]')
  ) then
    raise exception 'period overlaps an existing locked period' using errcode = '23505';
  end if;

  insert into public.accounting_periods(org_id, period_start, period_end, status, note)
  values (p_org, p_period_start, p_period_end, 'locked', p_note)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.fn_close_accounting_period(uuid, date, date, text) from public, anon;
grant execute on function public.fn_close_accounting_period(uuid, date, date, text) to authenticated;

-- ── 4) Reopen (unlock) a period — OWNER ONLY (SPEC-0004 §7.3) ─────────────────────────────────────────────────
create or replace function public.fn_reopen_accounting_period(p_org uuid, p_period_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_org is null or p_period_id is null then
    raise exception 'org and period id required' using errcode = '23502'; end if;

  if not exists (
    select 1 from public.organization_member
     where user_id = (select auth.uid()) and org_id = p_org and role = 'owner'
  ) then
    raise exception 'forbidden: only the owner may reopen a period' using errcode = '42501';
  end if;

  update public.accounting_periods
     set status = 'open', reopened_by = (select auth.uid()), reopened_at = now()
   where id = p_period_id and org_id = p_org and status = 'locked';
  if not found then
    raise exception 'no locked period % to reopen in this org', p_period_id using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.fn_reopen_accounting_period(uuid, uuid) from public, anon;
grant execute on function public.fn_reopen_accounting_period(uuid, uuid) to authenticated;

-- ── 5) Re-emit the single posting choke point with the lock guard ────────────────────────────────────────────
-- VERBATIM from the CURRENT definition (migration 20260701460000_cost_centers — carries the cost_center_id
-- dimension) + ONE added lock block (marked ▼▼/▲▲). Every journal-posting RPC funnels through this, so the guard
-- covers custody settlement, expense payment, sale finalize, and sale collection at once.
create or replace function public.fn_post_two_line_journal(
  p_org uuid,
  p_entry_date date,
  p_source_type text,
  p_source_id uuid,
  p_description text,
  p_debit_account uuid,
  p_credit_account uuid,
  p_amount numeric,
  p_debit_description text default null,
  p_credit_description text default null,
  p_custody_account uuid default null,
  p_custody_movement uuid default null,
  p_expense uuid default null,
  p_payment_request uuid default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_entry uuid;
  v_debit_org uuid;
  v_credit_org uuid;
  v_exp_org uuid;
  v_exp_cost_center uuid;
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_source_type is null or trim(p_source_type) = '' then raise exception 'source_type required' using errcode = '23502'; end if;
  if p_source_id is null then raise exception 'source_id required' using errcode = '23502'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'journal amount must be positive' using errcode = '22023'; end if;

  select id into v_existing
    from public.journal_entries
   where org_id = p_org and source_type = p_source_type and source_id = p_source_id;
  if v_existing is not null then
    return v_existing;
  end if;

  -- ▼▼ period lock (20260701550000) — reject a NEW posting whose date falls in a locked period. Placed after the
  --    idempotency return so re-posting an already-recorded entry stays a harmless no-op. ▼▼
  if public.fn_period_locked(p_org, coalesce(p_entry_date, current_date)) then
    raise exception 'الفترة المحاسبية مقفلة — لا يمكن ترحيل قيد بتاريخ %', coalesce(p_entry_date, current_date)
      using errcode = '55000';
  end if;
  -- ▲▲ end period lock ▲▲

  select org_id into v_debit_org from public.accounts where id = p_debit_account;
  select org_id into v_credit_org from public.accounts where id = p_credit_account;
  if v_debit_org is distinct from p_org or v_credit_org is distinct from p_org then
    raise exception 'journal accounts must belong to the entry org' using errcode = '42501';
  end if;

  if p_expense is not null then
    select org_id, cost_center_id into v_exp_org, v_exp_cost_center
      from public.expenses
     where id = p_expense;
    if v_exp_org is null then
      raise exception 'expense % not found', p_expense using errcode = 'P0002';
    end if;
    if v_exp_org is distinct from p_org then
      raise exception 'journal expense must belong to the entry org' using errcode = '42501';
    end if;
  end if;

  insert into public.journal_entries(org_id, entry_date, source_type, source_id, description)
  values (p_org, coalesce(p_entry_date, current_date), trim(p_source_type), p_source_id, p_description)
  returning id into v_entry;

  insert into public.journal_lines(
    org_id, journal_entry_id, account_id, debit, credit, description,
    custody_account_id, custody_movement_id, expense_id, payment_request_id, cost_center_id)
  values
    (p_org, v_entry, p_debit_account, p_amount, 0, p_debit_description,
     p_custody_account, p_custody_movement, p_expense, p_payment_request, v_exp_cost_center),
    (p_org, v_entry, p_credit_account, 0, p_amount, p_credit_description,
     p_custody_account, p_custody_movement, p_expense, p_payment_request, null);

  return v_entry;
end;
$$;
revoke execute on function public.fn_post_two_line_journal(uuid, date, text, uuid, text, uuid, uuid, numeric, text, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- ── 6) Gate the accounting_periods audit entity in audit_read (56 audit-leak invariant) ──────────────────────
-- Re-emit of the CURRENT audit_read policy (migration 20260701500000_revenue_sales) with 'accounting_period' added
-- to BOTH the open-branch exclusion AND the finance.read-gated branch, so period-close audit rows are visible only
-- to owner/accountant (finance.read) and never leak to a plain org member.
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select to authenticated
  using (
    org_id in (select public.user_org_ids())
    and (
      (
        entity_type is distinct from 'people_compensation'
        and entity_type not in (
          'sale','expense','custody_account','custody_movement','payment_request','payment_request_line',
          'account','journal_entry','journal_line','payment_request_funding','cost_center','offshoot_valuation',
          'buyer','sale_collection','accounting_period'
        )
      )
      or (entity_type = 'people_compensation' and public.authorize('payroll.read', org_id))
      or (entity_type in ('sale','expense') and public.authorize('budget.write', org_id))
      or (
        entity_type in (
          'custody_account','custody_movement','payment_request','payment_request_line',
          'account','journal_entry','journal_line','payment_request_funding','cost_center','offshoot_valuation',
          'buyer','sale_collection','accounting_period'
        )
        and public.authorize('finance.read', org_id)
      )
    )
  );
