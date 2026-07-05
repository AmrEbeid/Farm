-- 20260705130000 — Budget vs actual, read-only (SPEC-0004 / ROADMAP Slice A; closes Decision-0157's
-- "actuals are frozen seed numbers" gap on the READ side only).
--
-- Problem: `budget_lines.planned` is real but `.actual` is a frozen seed value written by no code. Managers can't
-- see live spend against plan.
--
-- Intent: a read-only report that makes ACTUALS LIVE from the posted GL. It rolls posted expense journal lines up
-- by `expenses.category` (via `journal_lines.expense_id`) — the SAME free-text category dimension `budget_lines`
-- uses — and full-outer-joins to `SUM(budget_lines.planned)` per category. Categories present on only one side are
-- surfaced honestly: a budget line with no spend shows actual=0; posted spend with no budget line is flagged
-- `unbudgeted` (rather than silently dropped). Actual = POSTED (paid) GL expense (cash-method, invoice-at-real-cost
-- basis). This is a REPORT only — it enforces nothing.
--
-- What this does NOT do (deliberately, Decision-0157 remains the Owner's): it does not decide a canonical
-- category→account mapping table, and it does not add any budget-cap ENFORCEMENT (hard-block vs warn on approval) —
-- that changes approval behavior and is an Owner policy call. Read-only, finance.read-gated, reversible.
--
-- Rollback: drop function public.fn_budget_vs_actual(uuid, date, date).

create or replace function public.fn_budget_vs_actual(
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
    raise exception 'forbidden: cross-org budget-vs-actual' using errcode = '42501'; end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501'; end if;

  with budget as (
    select bl.category, sum(bl.planned) as planned
      from public.budget_lines bl
     where bl.org_id = p_org and bl.category is not null
     group by bl.category
  ),
  actual as (
    -- posted-only, in-period, expense-account debit rolled up by the expense's category
    select e.category, sum(jl.debit) as actual
      from public.journal_lines jl
      join public.journal_entries je on je.id = jl.journal_entry_id
      join public.expenses e on e.id = jl.expense_id
      join public.accounts a on a.id = jl.account_id
     where jl.org_id = p_org and je.org_id = p_org
       and je.status = 'posted'
       and je.entry_date >= p_from
       and je.entry_date <= coalesce(p_to, current_date)
       and a.account_type = 'expense'
       and e.category is not null
     group by e.category
  ),
  merged as (
    select coalesce(b.category, a.category) as category,
           coalesce(b.planned, 0) as planned,
           coalesce(a.actual, 0)  as actual,
           (b.category is not null) as in_budget
      from budget b
      full outer join actual a on a.category = b.category
  )
  select jsonb_build_object(
    'period_start', p_from,
    'period_end',   coalesce(p_to, current_date),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category',   category,
        'planned',    planned,
        'actual',     actual,
        'variance',   planned - actual,           -- positive = under budget, negative = over
        'over_budget', (planned > 0 and actual > planned),
        'unbudgeted', not in_budget               -- posted spend with no budget line
      ) order by category)
      from merged), '[]'::jsonb),
    'planned_total',  coalesce((select sum(planned) from merged), 0),
    'actual_total',   coalesce((select sum(actual) from merged), 0),
    'variance_total', coalesce((select sum(planned) - sum(actual) from merged), 0)
  )
  into v_result;

  return v_result;
end;
$$;
revoke execute on function public.fn_budget_vs_actual(uuid, date, date) from public, anon, authenticated;
grant execute on function public.fn_budget_vs_actual(uuid, date, date) to authenticated;
