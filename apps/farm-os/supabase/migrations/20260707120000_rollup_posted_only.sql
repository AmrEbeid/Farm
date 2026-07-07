-- 20260707120000 — v_cost_center_rollup must exclude REVERSED journal entries (issue #863).
--
-- PROBLEM: v_cost_center_rollup (migration 20260701460000) summed journal_lines with NO filter on the parent
--   journal_entries.status — unlike the income-statement / balance-sheet / trial-balance / pnl-timeseries paths,
--   which all `join journal_entries je ... and je.status = 'posted'`. The reversal RPC (20260706081636) marks
--   BOTH the original entry AND its swapped-line mirror `status = 'reversed'`. Posted-only statements exclude
--   both (correct); this rollup saw both. For NET figures the pair nets to 0, but any DEBIT-only consumer
--   (finance-insights totalExpense, the «مصروفات غير موزّعة» KPI, the sector/enterprise scorecards via
--   entity-pnl) would OVER-count the reversed expense's debit once reversals exist (the mirror's credit does
--   not offset a debit-only sum). The masked-shortage analog for the P&L: a reversed cost still showing.
--
-- FIX: re-emit the view with an `exists(... journal_entries where id = l.journal_entry_id and status='posted')`
--   condition on the LEFT JOIN, matching every other statement path. Left-join semantics are preserved (a
--   center with no posted lines still appears with 0s). Output columns are identical.
--
-- IMPACT: currently ZERO — prod has 0 reversed entries (probed 2026-07-07), so the view's output is unchanged
--   today; this only prevents a future over-count. Pure re-emit, no data migration.
--
-- SECURITY: a view inherits the querying role's RLS on the base tables (journal_lines/journal_entries are
--   org-RLS'd); no SECURITY DEFINER, no new grants. Rollback: re-emit the 20260701460000 body (drop the
--   status exists() clause).

create or replace view public.v_cost_center_rollup as
with recursive subtree as (
  select
    c.org_id,
    c.id as ancestor_id,
    c.id as descendant_id
  from public.cost_centers c
  union all
  select
    s.org_id,
    s.ancestor_id,
    child.id as descendant_id
  from subtree s
  join public.cost_centers child
    on child.parent_id = s.descendant_id
   and child.org_id = s.org_id
),
rollup as (
  select
    c.org_id,
    c.id as cost_center_id,
    c.parent_id,
    c.code,
    c.name_ar,
    c.sector_id,
    c.enterprise,
    c.area_feddan,
    c.active,
    c.is_system,
    c.sort_order,
    coalesce(sum(l.debit), 0) as debit,
    coalesce(sum(l.credit), 0) as credit,
    coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0) as net
  from public.cost_centers c
  left join subtree s on s.ancestor_id = c.id and s.org_id = c.org_id
  left join public.journal_lines l
    on l.org_id = c.org_id
   and (
      l.cost_center_id = s.descendant_id
      or (c.code = 'CC-UNALLOC' and l.cost_center_id is null)
   )
   and exists (
      select 1
        from public.accounts a
       where a.id = l.account_id
         and a.org_id = l.org_id
         and a.account_type in ('expense','revenue')
   )
   -- #863: only POSTED entries roll up — a reversed entry (original + mirror, both status='reversed') must not
   -- inflate any figure, exactly as the income-statement / balance-sheet / trial-balance paths already require.
   and exists (
      select 1
        from public.journal_entries je
       where je.id = l.journal_entry_id
         and je.status = 'posted'
   )
  group by
    c.org_id, c.id, c.parent_id, c.code, c.name_ar, c.sector_id, c.enterprise,
    c.area_feddan, c.active, c.is_system, c.sort_order
)
select
  org_id,
  cost_center_id,
  parent_id,
  code,
  name_ar,
  sector_id,
  enterprise,
  area_feddan,
  active,
  is_system,
  sort_order,
  debit,
  credit,
  net,
  case
    when area_feddan is not null and area_feddan > 0 then net / area_feddan
    else null
  end as net_per_feddan
from rollup;
