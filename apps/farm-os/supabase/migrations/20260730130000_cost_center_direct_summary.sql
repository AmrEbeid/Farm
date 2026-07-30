-- Exact direct totals for /finance/cost-centers/[id].
-- The page displays at most 200 detail rows, so headline money must be aggregated server-side.
begin;

create or replace function public.fn_cost_center_direct_summary(
  p_org uuid,
  p_cost_center uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cc_org uuid;
  v_expense_total numeric;
  v_direct_expense_count bigint;
  v_unknown_expense_count bigint;
  v_expense_count bigint;
  v_sale_revenue numeric;
  v_finalized_count bigint;
  v_pending_count bigint;
  v_sale_count bigint;
begin
  if p_org is null then
    raise exception 'org required' using errcode = '23502';
  end if;
  if p_cost_center is null then
    raise exception 'cost center required' using errcode = '23502';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org cost-center summary' using errcode = '42501';
  end if;
  if not public.authorize('finance.read', p_org) then
    raise exception 'forbidden: finance.read is required' using errcode = '42501';
  end if;

  select org_id
    into v_cc_org
    from public.cost_centers
   where id = p_cost_center;
  if v_cc_org is null then
    raise exception 'cost center % not found', p_cost_center using errcode = 'P0002';
  end if;
  if v_cc_org is distinct from p_org then
    raise exception 'forbidden: cost center belongs to another org' using errcode = '42501';
  end if;

  select
    coalesce(sum(e.total) filter (
      where coalesce(e.payment_status, '') not in ('cancelled', 'historical_reversed')
    ), 0),
    count(*) filter (
      where coalesce(e.payment_status, '') not in ('cancelled', 'historical_reversed')
    ),
    count(*) filter (
      where coalesce(e.payment_status, '') not in ('cancelled', 'historical_reversed')
        and e.total is null
    ),
    count(*)
    into v_expense_total, v_direct_expense_count, v_unknown_expense_count, v_expense_count
    from public.expenses e
   where e.org_id = p_org
     and e.cost_center_id = p_cost_center;

  select
    coalesce(sum(s.total) filter (
      where s.price_status = 'finalized'
        and exists (
          select 1
            from public.journal_entries je
           where je.org_id = s.org_id
             and je.source_type = 'sale'
             and je.source_id = s.id
             and je.status = 'posted'
        )
    ), 0),
    count(*) filter (
      where s.price_status = 'finalized'
        and exists (
          select 1
            from public.journal_entries je
           where je.org_id = s.org_id
             and je.source_type = 'sale'
             and je.source_id = s.id
             and je.status = 'posted'
        )
    ),
    count(*) filter (where s.price_status = 'pending'),
    count(*)
    into v_sale_revenue, v_finalized_count, v_pending_count, v_sale_count
    from public.sales s
   where s.org_id = p_org
     and s.cost_center_id = p_cost_center
     and s.payment_status <> 'historical_reversed';

  return jsonb_build_object(
    'cost_center_id', p_cost_center,
    'org_id', p_org,
    'direct_expense_total', v_expense_total,
    'direct_expense_count', v_direct_expense_count,
    'unknown_expense_count', v_unknown_expense_count,
    'expense_count', v_expense_count,
    'direct_sale_revenue', v_sale_revenue,
    'finalized_sale_count', v_finalized_count,
    'pending_sale_count', v_pending_count,
    'sale_count', v_sale_count
  );
end;
$$;

revoke execute on function public.fn_cost_center_direct_summary(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_cost_center_direct_summary(uuid, uuid)
  to authenticated;

commit;
