-- Exact expense-register summary for /expenses.
--
-- THE GAP. The page fetched every row in `expenses` with no `limit()`, then labelled
-- `all.length` "كل المصروفات" and its in-memory month sums as full-ledger totals. PostgREST caps
-- result sets, so once an org's expense register crosses that cap the displayed count and the
-- "هذا الشهر" money both go silently short — a money-truthfulness defect (CLAUDE.md #1) — and
-- loading the whole register on every page view is slow at scale.
--
-- THE FIX. One read-only, STABLE, SECURITY DEFINER RPC computes the chip counts and the exact
-- current-month non-drawing/drawing sums server-side, over the full register, so the app can bound
-- its row fetch to the latest 200 without losing exactness anywhere else. Reuses the existing
-- `public.authorize`/`public.user_org_ids` — neither is re-emitted.
--
-- THE "هذا الشهر" KPI IS NON-DRAWING, NOT OPERATING-ONLY. The page's month KPI has always summed
-- every visible row with `kind <> 'drawing'` (operating AND capex), matching its label "بدون
-- مسحوبات" (without drawings) — never "تشغيلي فقط" (operating only). `month_non_drawing_total`/
-- `month_non_drawing_unknown_count` preserve that exact scope; they deliberately do NOT filter to
-- `kind = 'operating'`, which would silently drop capex money from a KPI that never excluded it.
-- The separate `operating_count` chip stays `kind = 'operating'` only — that chip's own label and
-- history were always operating-only, unlike the month KPI.
--
-- VISIBILITY. Mirrors the current expenses RLS (`tenant_all`, migration 20260706084915): any
-- owner/accountant/farm_manager member (the roles `requireRole` already allows onto the page) sees
-- every non-drawing figure; `kind='drawing'` figures require `authorize('finance.read', p_org)`
-- (owner/accountant only). For a caller without finance.read, every drawing-scoped field is
-- returned as JSON null — never a fabricated zero, which would misreport "no drawings exist" to a
-- role that is not entitled to know either way (non-negotiable #6).
--
-- LIFECYCLE. Row COUNTS (`expense_count`, `month_count`, `operating_count`, `drawing_count`,
-- `unrouted_count`, `unclassified_count`, `uncentered_count`) count every row regardless of
-- `payment_status`, matching the current register/page behavior — no new exclusion there. The MONEY
-- fields (`month_non_drawing_total`/`month_non_drawing_unknown_count`,
-- `month_drawing_total`/`month_drawing_unknown_count`) exclude `payment_status in ('cancelled',
-- 'historical_reversed')` — void/reversed money must not inflate a real cash total or its
-- unknown-amount count — the same rule the merged cost-center exact summary
-- (`fn_cost_center_direct_summary`, migration 20260730130000) already applies. `historical_treasury`
-- is real settled cash and stays included in both the total and the unknown-amount count.
--
-- MONTH BOUNDS. `p_month_start`/`p_month_end` (exclusive) are supplied by the calling page from a
-- real server `Date`, never `current_date` inside this function, so the boundary is deterministic
-- and testable.
begin;

create or replace function public.fn_expense_register_summary(
  p_org uuid,
  p_month_start date,
  p_month_end date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_can_see_drawings boolean;
  v_expense_count bigint;
  v_month_count bigint;
  v_operating_count bigint;
  v_drawing_count bigint;
  v_unrouted_count bigint;
  v_unclassified_count bigint;
  v_uncentered_count bigint;
  v_month_non_drawing_total numeric;
  v_month_non_drawing_unknown_count bigint;
  v_month_drawing_total numeric;
  v_month_drawing_unknown_count bigint;
begin
  if p_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if p_month_start is null or p_month_end is null then
    raise exception 'month bounds required' using errcode = '23502';
  end if;
  if p_month_end <= p_month_start then
    raise exception 'month end must be after month start' using errcode = '22023';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org expense register summary' using errcode = '42501';
  end if;

  select m.role
    into v_role
    from public.organization_member m
   where m.user_id = (select auth.uid())
     and m.org_id = p_org
   limit 1;
  if v_role is null or v_role not in ('owner', 'accountant', 'farm_manager') then
    raise exception 'forbidden: expense register summary requires owner/accountant/farm_manager' using errcode = '42501';
  end if;

  v_can_see_drawings := public.authorize('finance.read', p_org);

  select
    count(*) filter (where e.kind <> 'drawing' or v_can_see_drawings),
    count(*) filter (
      where e.date >= p_month_start and e.date < p_month_end
        and (e.kind <> 'drawing' or v_can_see_drawings)
    ),
    count(*) filter (where e.kind = 'operating'),
    count(*) filter (where e.kind = 'drawing'),
    count(*) filter (where e.payment_status is null and (e.kind <> 'drawing' or v_can_see_drawings)),
    count(*) filter (where e.account_id is null and (e.kind <> 'drawing' or v_can_see_drawings)),
    count(*) filter (where e.cost_center_id is null and (e.kind <> 'drawing' or v_can_see_drawings)),
    coalesce(sum(e.total) filter (
      where e.kind <> 'drawing' and e.date >= p_month_start and e.date < p_month_end
        and coalesce(e.payment_status, '') not in ('cancelled', 'historical_reversed')
    ), 0),
    count(*) filter (
      where e.kind <> 'drawing' and e.date >= p_month_start and e.date < p_month_end and e.total is null
        and coalesce(e.payment_status, '') not in ('cancelled', 'historical_reversed')
    ),
    coalesce(sum(e.total) filter (
      where e.kind = 'drawing' and e.date >= p_month_start and e.date < p_month_end
        and coalesce(e.payment_status, '') not in ('cancelled', 'historical_reversed')
    ), 0),
    count(*) filter (
      where e.kind = 'drawing' and e.date >= p_month_start and e.date < p_month_end and e.total is null
        and coalesce(e.payment_status, '') not in ('cancelled', 'historical_reversed')
    )
    into
      v_expense_count, v_month_count, v_operating_count, v_drawing_count,
      v_unrouted_count, v_unclassified_count, v_uncentered_count,
      v_month_non_drawing_total, v_month_non_drawing_unknown_count,
      v_month_drawing_total, v_month_drawing_unknown_count
    from public.expenses e
   where e.org_id = p_org;

  return jsonb_build_object(
    'org_id', p_org,
    'expense_count', v_expense_count,
    'month_count', v_month_count,
    'operating_count', v_operating_count,
    'drawing_count', case when v_can_see_drawings then v_drawing_count else null end,
    'unrouted_count', v_unrouted_count,
    'unclassified_count', v_unclassified_count,
    'uncentered_count', v_uncentered_count,
    'month_non_drawing_total', v_month_non_drawing_total,
    'month_non_drawing_unknown_count', v_month_non_drawing_unknown_count,
    'month_drawing_total', case when v_can_see_drawings then v_month_drawing_total else null end,
    'month_drawing_unknown_count', case when v_can_see_drawings then v_month_drawing_unknown_count else null end
  );
end;
$$;

revoke execute on function public.fn_expense_register_summary(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.fn_expense_register_summary(uuid, date, date)
  to authenticated;

commit;
