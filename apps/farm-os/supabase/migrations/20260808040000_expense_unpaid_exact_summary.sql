-- Extend the exact expense-register summary with all-ledger unpaid obligations.
--
-- /custody previously summed an unbounded PostgREST result and /finance/dashboard summed only its
-- first 12 rows. Both could therefore understate money owed. These additive JSON fields are exact
-- across the active organization and preserve the existing finance.read drawing confidentiality.
-- A null total is counted separately and never coerced into an undisclosed zero.
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
  v_unpaid_operating_count bigint;
  v_unpaid_operating_total numeric;
  v_unpaid_operating_unknown_count bigint;
  v_unpaid_capex_count bigint;
  v_unpaid_capex_total numeric;
  v_unpaid_capex_unknown_count bigint;
  v_unpaid_drawing_count bigint;
  v_unpaid_drawing_total numeric;
  v_unpaid_drawing_unknown_count bigint;
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
    ),
    count(*) filter (where e.payment_status = 'post_paid_unpaid' and e.kind = 'operating'),
    coalesce(sum(e.total) filter (where e.payment_status = 'post_paid_unpaid' and e.kind = 'operating'), 0),
    count(*) filter (
      where e.payment_status = 'post_paid_unpaid' and e.kind = 'operating' and e.total is null
    ),
    count(*) filter (where e.payment_status = 'post_paid_unpaid' and e.kind = 'capex'),
    coalesce(sum(e.total) filter (where e.payment_status = 'post_paid_unpaid' and e.kind = 'capex'), 0),
    count(*) filter (
      where e.payment_status = 'post_paid_unpaid' and e.kind = 'capex' and e.total is null
    ),
    count(*) filter (where e.payment_status = 'post_paid_unpaid' and e.kind = 'drawing'),
    coalesce(sum(e.total) filter (where e.payment_status = 'post_paid_unpaid' and e.kind = 'drawing'), 0),
    count(*) filter (
      where e.payment_status = 'post_paid_unpaid' and e.kind = 'drawing' and e.total is null
    )
    into
      v_expense_count, v_month_count, v_operating_count, v_drawing_count,
      v_unrouted_count, v_unclassified_count, v_uncentered_count,
      v_month_non_drawing_total, v_month_non_drawing_unknown_count,
      v_month_drawing_total, v_month_drawing_unknown_count,
      v_unpaid_operating_count, v_unpaid_operating_total, v_unpaid_operating_unknown_count,
      v_unpaid_capex_count, v_unpaid_capex_total, v_unpaid_capex_unknown_count,
      v_unpaid_drawing_count, v_unpaid_drawing_total, v_unpaid_drawing_unknown_count
    from public.expenses e
   where e.org_id = p_org;

  return jsonb_build_object(
    'org_id', p_org,
    'expense_count', v_expense_count::text,
    'month_count', v_month_count::text,
    'operating_count', v_operating_count::text,
    'drawing_count', case when v_can_see_drawings then v_drawing_count::text else null end,
    'unrouted_count', v_unrouted_count::text,
    'unclassified_count', v_unclassified_count::text,
    'uncentered_count', v_uncentered_count::text,
    'month_non_drawing_total', v_month_non_drawing_total::text,
    'month_non_drawing_unknown_count', v_month_non_drawing_unknown_count::text,
    'month_drawing_total', case when v_can_see_drawings then v_month_drawing_total::text else null end,
    'month_drawing_unknown_count', case when v_can_see_drawings then v_month_drawing_unknown_count::text else null end,
    'unpaid_operating_count', v_unpaid_operating_count::text,
    'unpaid_operating_total', v_unpaid_operating_total::text,
    'unpaid_operating_unknown_count', v_unpaid_operating_unknown_count::text,
    'unpaid_capex_count', v_unpaid_capex_count::text,
    'unpaid_capex_total', v_unpaid_capex_total::text,
    'unpaid_capex_unknown_count', v_unpaid_capex_unknown_count::text,
    'unpaid_drawing_count', case when v_can_see_drawings then v_unpaid_drawing_count::text else null end,
    'unpaid_drawing_total', case when v_can_see_drawings then v_unpaid_drawing_total::text else null end,
    'unpaid_drawing_unknown_count', case when v_can_see_drawings then v_unpaid_drawing_unknown_count::text else null end
  );
end;
$$;

revoke execute on function public.fn_expense_register_summary(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.fn_expense_register_summary(uuid, date, date)
  to authenticated;

commit;
