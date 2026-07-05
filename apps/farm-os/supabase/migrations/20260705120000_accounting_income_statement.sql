-- 20260705120000 — Trusted income statement / P&L from the GL (SPEC-0004 / ROADMAP Slice A "P&L/balance-sheet").
--
-- Companion to fn_accounting_balance_sheet (20260705110000): reads journal_lines (posted-only, period-scoped)
-- grouped by revenue and expense accounts. Its net_income TIES to the balance sheet's net_income for the same
-- window (both derive revenue − expense from the same posted GL). Distinct from fn_owner_pnl_summary, which sums
-- the `expenses` table (cash view) — this is the accounting-correct statement over the double-entry ledger.
--
-- #6 (owner drawings ≠ operating expense) holds BY CONSTRUCTION: drawings are account_type='equity' (kind='drawing'),
-- so filtering account_type in ('revenue','expense') excludes them from the P&L automatically. `operating_expenses`
-- is surfaced separately (kind='operating') for budget-vs-actual follow-ups.
--
-- Read-only, finance.read-gated, SECURITY DEFINER, search_path=''. No schema change, no posting, no permission change.
-- Rollback: drop function public.fn_accounting_income_statement(uuid, date, date).

create or replace function public.fn_accounting_income_statement(
  p_org uuid,
  p_from date,
  p_to date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_from is null then raise exception 'period start required' using errcode = '23502'; end if;
  if coalesce(p_to, current_date) < p_from then
    raise exception 'period end before start' using errcode = '22023'; end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org income statement' using errcode = '42501'; end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501'; end if;

  with posted as (
    -- INNER join so ONLY posted, in-range entry lines are summed (whole-entry date filter, no reversed leak).
    select jl.account_id,
           sum(jl.debit)  as debit,
           sum(jl.credit) as credit
      from public.journal_lines jl
      join public.journal_entries je on je.id = jl.journal_entry_id
     where jl.org_id = p_org
       and je.org_id = p_org
       and je.status = 'posted'
       and je.entry_date >= p_from
       and je.entry_date <= coalesce(p_to, current_date)
     group by jl.account_id
  ),
  signed as (
    select a.code, a.name_ar, a.account_type, a.kind,
           case when a.account_type = 'expense'
                then coalesce(p.debit, 0) - coalesce(p.credit, 0)   -- expense: debit-normal
                else coalesce(p.credit, 0) - coalesce(p.debit, 0)   -- revenue: credit-normal
           end as amount
      from public.accounts a
      join posted p on p.account_id = a.id
     where a.org_id = p_org and a.account_type in ('revenue', 'expense')
  ),
  totals as (
    select
      coalesce(sum(amount) filter (where account_type = 'revenue'), 0) as revenue_total,
      coalesce(sum(amount) filter (where account_type = 'expense'), 0) as expenses_total,
      coalesce(sum(amount) filter (where account_type = 'expense' and kind = 'operating'), 0) as operating_expenses
      from signed
  )
  select jsonb_build_object(
    'period_start', p_from,
    'period_end',   coalesce(p_to, current_date),
    'revenue',  coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name_ar', name_ar, 'amount', amount) order by code)
                            from signed where account_type = 'revenue'), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name_ar', name_ar, 'amount', amount, 'kind', kind) order by code)
                            from signed where account_type = 'expense'), '[]'::jsonb),
    'revenue_total',      t.revenue_total,
    'expenses_total',     t.expenses_total,
    'operating_expenses', t.operating_expenses,
    'net_income',         t.revenue_total - t.expenses_total
  )
  into v_result
  from totals t;

  return v_result;
end;
$$;
revoke execute on function public.fn_accounting_income_statement(uuid, date, date) from public, anon, authenticated;
grant execute on function public.fn_accounting_income_statement(uuid, date, date) to authenticated;
