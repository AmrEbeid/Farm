-- 20260705140000 — fn_pnl_timeseries: GL-backed P&L time series (SPEC-0029 Phase 0, the insight foundation).
--
-- PURPOSE: the money surfaces have NO trend/YoY/cumulative view (only finance/reports has a by-year line);
--   IS/BS/P&L/accounting are single-period snapshots. This RPC returns a per-period (month|year) P&L strip
--   over the double-entry ledger so the revamp's trend charts, verdict engine, templated narrator, J-curve,
--   and cost-watch thesis all read from ONE trustworthy source (SPEC-0029 §2).
--
-- CORRECTNESS: identical trust model to fn_accounting_income_statement (20260705120000) — posted entries
--   only (je.status='posted'), signed by account_type (expense = debit−credit, revenue = credit−debit),
--   revenue/expense accounts only, so OWNER DRAWINGS (equity) are excluded by construction (#6). Each period
--   bucket = date_trunc(grain, entry_date); the series is generated over the whole [from,to] range so empty
--   periods appear as honest zeros (a period with no posting genuinely nets to zero — the income statement
--   makes the same choice). cumulative_net_income is a running window sum for the J-curve / breakeven view.
--   Entries are counted within the actual [from,to] range (a partial first/last bucket counts only in-range
--   postings). Honest-null (#1): no fabricated figure — every number is a real SUM of posted lines.
--
-- SECURITY: SECURITY DEFINER, set search_path='', STABLE; org-null / period / grain validation; cross-org
--   (user_org_ids) + authorize('finance.read') guards (RLS is bypassed under definer, so both are explicit);
--   EXECUTE revoked from public/anon/authenticated then granted to authenticated. Read-only.
--
-- Rollback: drop function public.fn_pnl_timeseries(uuid, text, date, date).

create or replace function public.fn_pnl_timeseries(
  p_org uuid,
  p_grain text,
  p_from date,
  p_to date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_step interval;
  v_to date := coalesce(p_to, current_date);
begin
  if p_org is null then raise exception 'org required' using errcode = '23502'; end if;
  if p_from is null then raise exception 'period start required' using errcode = '23502'; end if;
  if p_grain not in ('month', 'year') then
    raise exception 'grain must be month or year' using errcode = '22023'; end if;
  if v_to < p_from then
    raise exception 'period end before start' using errcode = '22023'; end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org P&L timeseries' using errcode = '42501'; end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501'; end if;

  v_step := case p_grain when 'year' then interval '1 year' else interval '1 month' end;

  with buckets as (
    select gs::date as period_start
      from generate_series(
             date_trunc(p_grain, p_from::timestamp),
             date_trunc(p_grain, v_to::timestamp),
             v_step
           ) gs
  ),
  posted as (
    select date_trunc(p_grain, je.entry_date)::date as period_start,
           a.account_type,
           a.kind,
           case when a.account_type = 'expense'
                then coalesce(jl.debit, 0) - coalesce(jl.credit, 0)
                else coalesce(jl.credit, 0) - coalesce(jl.debit, 0)
           end as amount
      from public.journal_lines jl
      join public.journal_entries je on je.id = jl.journal_entry_id
      join public.accounts a on a.id = jl.account_id
     where jl.org_id = p_org and je.org_id = p_org and a.org_id = p_org
       and je.status = 'posted'
       and je.entry_date >= p_from
       and je.entry_date <= v_to
       and a.account_type in ('revenue', 'expense')
  ),
  per_period as (
    select b.period_start,
           coalesce(sum(pp.amount) filter (where pp.account_type = 'revenue'), 0) as revenue,
           coalesce(sum(pp.amount) filter (where pp.account_type = 'expense'), 0) as expenses,
           coalesce(sum(pp.amount) filter (where pp.account_type = 'expense' and pp.kind = 'operating'), 0) as operating_expenses
      from buckets b
      left join posted pp on pp.period_start = b.period_start
     group by b.period_start
  ),
  with_net as (
    select period_start, revenue, expenses, operating_expenses,
           revenue - expenses as net_income,
           sum(revenue - expenses) over (order by period_start
             rows between unbounded preceding and current row) as cumulative_net_income
      from per_period
  )
  select jsonb_build_object(
    'grain', p_grain,
    'period_start', p_from,
    'period_end', v_to,
    'periods', coalesce(jsonb_agg(jsonb_build_object(
        'period', to_char(period_start, case p_grain when 'year' then 'YYYY' else 'YYYY-MM' end),
        'revenue', revenue,
        'expenses', expenses,
        'operating_expenses', operating_expenses,
        'net_income', net_income,
        'cumulative_net_income', cumulative_net_income
      ) order by period_start), '[]'::jsonb)
  )
  into v_result
  from with_net;

  return v_result;
end;
$$;
revoke execute on function public.fn_pnl_timeseries(uuid, text, date, date) from public, anon, authenticated;
grant execute on function public.fn_pnl_timeseries(uuid, text, date, date) to authenticated;
