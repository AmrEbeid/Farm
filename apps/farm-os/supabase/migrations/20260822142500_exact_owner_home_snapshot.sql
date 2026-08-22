-- SPEC-0033 R3: one exact, bounded, owner-only home snapshot.
-- Exact totals are independent from capped driver rows; money and quantities leave PostgreSQL as text.

begin;

create or replace function public.fn_owner_home_snapshot(
  p_org uuid,
  p_as_of date,
  p_detail_limit integer default 8
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_active_org uuid;
  v_result jsonb;
begin
  if p_org is null or p_as_of is null then
    raise exception 'organization and as-of date are required' using errcode = '23502';
  end if;
  if p_detail_limit is null or p_detail_limit < 1 or p_detail_limit > 20 then
    raise exception 'detail limit must be between 1 and 20' using errcode = '22023';
  end if;
  if p_as_of <> (pg_catalog.now() at time zone 'Africa/Cairo')::date then
    raise exception 'owner home as-of must equal the current Cairo business date' using errcode = '22007';
  end if;

  begin
    v_active_org := nullif(
      nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'active_org_id',
      ''
    )::uuid;
  exception when others then
    raise exception 'forbidden: invalid active organization claim' using errcode = '42501';
  end;

  if v_uid is null or v_active_org is null or v_active_org is distinct from p_org then
    raise exception 'forbidden: owner home requires the active organization' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.organization_member m
     where m.user_id = v_uid
       and m.org_id = p_org
       and m.role = 'owner'
  ) then
    raise exception 'forbidden: owner membership is required' using errcode = '42501';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: organization is outside the active scope' using errcode = '42501';
  end if;

  -- Fail closed rather than turn a corrupt cross-org reference into a blended dashboard.
  if exists (
    select 1 from public.budget_lines l
    left join public.budgets b on b.id = l.budget_id and b.org_id = p_org
    where l.org_id = p_org and b.id is null
  ) or exists (
    select 1 from public.inventory_bin b
    left join public.inventory_items i on i.id = b.item_id and i.org_id = p_org
    where b.org_id = p_org and i.id is null
  ) or exists (
    select 1 from public.plan_operations o
    left join public.plans p on p.id = o.plan_id and p.org_id = p_org
    where o.org_id = p_org and p.id is null
  ) or exists (
    select 1 from public.plan_checks c
    left join public.plans p on p.id = c.plan_id and p.org_id = p_org
    where c.org_id = p_org and p.id is null
  ) or exists (
    select 1 from public.plan_operation_assignees a
    left join public.plan_operations o on o.id = a.plan_op_id and o.org_id = p_org
    left join public.people pe on pe.id = a.person_id and pe.org_id = p_org
    where a.org_id = p_org and (o.id is null or pe.id is null)
  ) or exists (
    select 1 from public.plan_operations o
    left join public.people pe
      on pe.id = o.responsible_person_id and pe.org_id = p_org
    where o.org_id = p_org
      and o.responsible_person_id is not null
      and pe.id is null
  ) then
    raise exception 'owner home organization relationship mismatch' using errcode = '23514';
  end if;

  with
  budget_summary as (
    select count(*)::bigint as line_count,
           coalesce(sum(l.approved), 0) as approved,
           coalesce(sum(l.committed), 0) as committed,
           coalesce(sum(l.actual), 0) as actual
      from public.budget_lines l
     where l.org_id = p_org
  ),
  budget_rows as materialized (
    select l.id, l.category, l.approved, l.committed, l.actual,
           l.approved - l.committed - l.actual as available
      from public.budget_lines l
     where l.org_id = p_org
     order by (l.approved - l.committed - l.actual), l.id
     limit p_detail_limit
  ),
  purchase_summary as (
    select count(*)::bigint as total_count,
           count(*) filter (
             where pr.status = 'submitted' and pr.requested_by is distinct from v_uid
           )::bigint as pending_approval_count,
           count(*) filter (
             where pr.status in ('approved', 'partially_received')
               and pr.needed_by < p_as_of
           )::bigint as overdue_count
      from public.purchase_requests pr
     where pr.org_id = p_org
  ),
  purchase_rows as materialized (
    select pr.id, pr.code, pr.status, pr.reason, pr.needed_by
      from public.purchase_requests pr
     where pr.org_id = p_org
       and (
         (pr.status = 'submitted' and pr.requested_by is distinct from v_uid)
         or (pr.status in ('approved', 'partially_received') and pr.needed_by < p_as_of)
       )
     order by
       case when pr.status in ('approved', 'partially_received') and pr.needed_by < p_as_of then 0 else 1 end,
       pr.needed_by asc nulls last,
       pr.id
     limit p_detail_limit
  ),
  item_stock as materialized (
    select i.id, i.name, i.unit,
           coalesce(sum(b.on_hand), 0) - coalesce(sum(b.reserved), 0) as available,
           coalesce(i.reorder_point, i.min_stock, 0) as threshold
      from public.inventory_items i
      left join public.inventory_bin b on b.item_id = i.id and b.org_id = i.org_id
     where i.org_id = p_org
     group by i.id, i.name, i.unit, i.reorder_point, i.min_stock
  ),
  inventory_summary as (
    select count(*)::bigint as item_count,
           count(*) filter (where threshold > 0 and available < threshold)::bigint as reorder_count,
           count(*) filter (where threshold > 0 and available <= 0)::bigint as out_of_stock_count
      from item_stock
  ),
  inventory_rows as materialized (
    select id, name, unit, available, threshold
      from item_stock
     where threshold > 0 and available < threshold
     order by available - threshold, id
     limit p_detail_limit
  ),
  active_plans as materialized (
    select p.id from public.plans p
     where p.org_id = p_org and p.status in ('active', 'approved')
  ),
  active_ops as materialized (
    select o.id, o.plan_id, o.subtype, o.status, o.planned_at, o.responsible_person_id,
           count(a.id)::bigint as assignee_count
      from public.plan_operations o
      join active_plans p on p.id = o.plan_id
      left join public.plan_operation_assignees a
        on a.plan_op_id = o.id and a.org_id = p_org
     where o.org_id = p_org
     group by o.id, o.plan_id, o.subtype, o.status, o.planned_at, o.responsible_person_id
  ),
  operation_summary as (
    select count(*)::bigint as active_count,
           count(*) filter (where status = 'done')::bigint as done_count,
           count(*) filter (
             where status in ('planned', 'approved', 'reserved', 'ready', 'in_progress')
               and planned_at <= p_as_of + 7
           )::bigint as due_week_count,
           count(*) filter (
             where status in ('planned', 'approved', 'reserved', 'ready', 'in_progress')
               and responsible_person_id is null and assignee_count = 0
           )::bigint as unassigned_count
      from active_ops
  ),
  operation_rows as materialized (
    select id, plan_id, subtype, status, planned_at,
           responsible_person_id is not null or assignee_count > 0 as assigned
      from active_ops
     where status in ('planned', 'approved', 'reserved', 'ready', 'in_progress')
       and planned_at <= p_as_of + 7
     order by planned_at asc nulls last, id
     limit p_detail_limit
  ),
  check_summary as (
    select count(*) filter (where c.result = 'block')::bigint as blocked_count
      from public.plan_checks c
      join active_plans p on p.id = c.plan_id
     where c.org_id = p_org
  ),
  palm_summary as (
    select count(*)::bigint as palm_count,
           count(*) filter (where a.status in ('watch', 'sick', 'dead'))::bigint as attention_count,
           count(*) filter (where a.status = 'active')::bigint as active_count,
           count(*) filter (where a.status = 'watch')::bigint as watch_count,
           count(*) filter (where a.status = 'sick')::bigint as sick_count,
           count(*) filter (where a.status = 'dead')::bigint as dead_count
      from public.assets a
     where a.org_id = p_org and a.type = 'palm' and not a.archived
  ),
  hawsha_summary as (
    select count(*)::bigint as hawsha_count,
           coalesce(sum(h.palm_count_barhi), 0)::bigint as barhi_count
      from public.hawshat h
     where h.org_id = p_org and not h.archived
  ),
  people_summary as (
    select count(*) filter (where pe.active)::bigint as active_count
      from public.people pe where pe.org_id = p_org
  ),
  sales_summary as (
    select count(*) filter (where s.price_status = 'pending')::bigint as pending_price_count
      from public.sales s
     where s.org_id = p_org
       and s.payment_status not in ('historical_treasury', 'historical_reversed')
  ),
  payment_approval_summary as (
    select count(*) filter (
             where r.status in ('submitted', 'approved_operational')
           )::bigint as pending_count
      from public.payment_requests r
     where r.org_id = p_org
  ),
  agronomy_signoff_summary as (
    select count(*) filter (
             where o.signed_off_at is null
               and o.subtype in ('fertilization', 'spraying')
               and o.status not in ('done', 'blocked', 'abandoned', 'skipped')
           )::bigint as pending_count
      from public.plan_operations o
     where o.org_id = p_org
  ),
  expense_summary as (
    select count(*) filter (
             where e.payment_status = 'post_paid_unpaid' and e.kind <> 'drawing'
           )::bigint as unpaid_non_drawing_count,
           coalesce(sum(e.total) filter (
             where e.payment_status = 'post_paid_unpaid' and e.kind <> 'drawing'
           ), 0) as unpaid_non_drawing_total,
           count(*) filter (
             where e.payment_status = 'post_paid_unpaid' and e.kind <> 'drawing' and e.total is null
           )::bigint as unpaid_non_drawing_unknown_count,
           count(*) filter (
             where e.payment_status = 'post_paid_unpaid' and e.kind = 'drawing'
           )::bigint as unpaid_drawing_count,
           coalesce(sum(e.total) filter (
             where e.payment_status = 'post_paid_unpaid' and e.kind = 'drawing'
           ), 0) as unpaid_drawing_total,
           count(*) filter (
             where e.payment_status = 'post_paid_unpaid' and e.kind = 'drawing' and e.total is null
           )::bigint as unpaid_drawing_unknown_count
      from public.expenses e where e.org_id = p_org
  ),
  offshoot_summary as (
    select coalesce(sum(m.qty) filter (where m.movement_type = 'produce'), 0) as produced,
           coalesce(sum(m.qty) filter (where m.movement_type in ('plant', 'sell', 'replant')), 0) as used
      from public.offshoot_movements m where m.org_id = p_org
  ),
  cost_center_summary as (
    select count(*) filter (where r.debit <> 0 or r.credit <> 0)::bigint as posted_center_count,
           coalesce(sum(r.debit) filter (where r.code = 'CC-UNALLOC'), 0) as unallocated_cost
      from public.v_cost_center_rollup r where r.org_id = p_org
  ),
  cost_center_rows as materialized (
    select r.cost_center_id, r.code, r.name_ar, r.debit, r.credit, r.net
      from public.v_cost_center_rollup r
     where r.org_id = p_org and (r.debit <> 0 or r.credit <> 0)
     order by r.debit desc, r.cost_center_id
     limit p_detail_limit
  ),
  cost_center_flags as (
    select count(*)::bigint as flag_count
      from public.v_cost_center_reconciliation_flags f where f.org_id = p_org
  ),
  authority as (
    select jsonb_object_agg(d.domain, d.status) as statuses
      from public.data_authority_status d where d.org_id = p_org
  )
  select jsonb_build_object(
    'version', 'farm-os.owner-home.v1',
    'org_id', p_org,
    'as_of', p_as_of::text,
    'detail_limit', p_detail_limit,
    'authority', coalesce((select statuses from authority), '{}'::jsonb),
    'attention', jsonb_build_object(
      'pending_payment_approvals', (select pending_count::text from payment_approval_summary),
      'pending_agronomy_signoffs', (select pending_count::text from agronomy_signoff_summary),
      'pending_price_sales', (select pending_price_count::text from sales_summary),
      'unpaid_non_drawing_expenses', (select unpaid_non_drawing_count::text from expense_summary),
      'pending_purchase_approvals', (select pending_approval_count::text from purchase_summary),
      'overdue_purchase_requests', (select overdue_count::text from purchase_summary),
      'reorder_items', (select reorder_count::text from inventory_summary),
      'blocked_plan_checks', (select blocked_count::text from check_summary),
      'palms_needing_attention', (select attention_count::text from palm_summary),
      'unassigned_operations', (select unassigned_count::text from operation_summary)
    ),
    'state', jsonb_build_object(
      'budget', (select jsonb_build_object(
        'line_count', line_count::text,
        'approved', approved::text,
        'committed', committed::text,
        'actual', actual::text,
        'available', (approved - committed - actual)::text
      ) from budget_summary),
      'inventory', (select jsonb_build_object(
        'item_count', item_count::text, 'reorder_count', reorder_count::text,
        'out_of_stock_count', out_of_stock_count::text
      ) from inventory_summary),
      'operations', (select jsonb_build_object(
        'active_count', active_count::text, 'done_count', done_count::text,
        'due_week_count', due_week_count::text, 'unassigned_count', unassigned_count::text
      ) from operation_summary),
      'palms', (select jsonb_build_object(
        'palm_count', palm_count::text, 'attention_count', attention_count::text,
        'active', active_count::text, 'watch', watch_count::text,
        'sick', sick_count::text, 'dead', dead_count::text
      ) from palm_summary),
      'farm_registry', (select jsonb_build_object(
        'hawsha_count', hawsha_count::text, 'barhi_count', barhi_count::text
      ) from hawsha_summary),
      'active_people', (select active_count::text from people_summary),
      'offshoots', (select jsonb_build_object(
        'produced', produced::text, 'used', used::text,
        'available', (produced - used)::text,
        'low_per_unit', case when v.low_per_unit is null then null else v.low_per_unit::text end,
        'high_per_unit', case when v.high_per_unit is null then null else v.high_per_unit::text end
      ) from offshoot_summary o left join public.offshoot_valuation v on v.org_id = p_org),
      'cost_centers', (select jsonb_build_object(
        'posted_center_count', posted_center_count::text,
        'unallocated_cost', unallocated_cost::text,
        'flag_count', (select flag_count::text from cost_center_flags)
      ) from cost_center_summary),
      'expense_follow_up', (select jsonb_build_object(
        'non_drawing_count', unpaid_non_drawing_count::text,
        'non_drawing_total', unpaid_non_drawing_total::text,
        'non_drawing_unknown_count', unpaid_non_drawing_unknown_count::text,
        'owner_drawing_count', unpaid_drawing_count::text,
        'owner_drawing_total', unpaid_drawing_total::text,
        'owner_drawing_unknown_count', unpaid_drawing_unknown_count::text
      ) from expense_summary),
      'purchase_request_count', (select total_count::text from purchase_summary)
    ),
    'drivers', jsonb_build_object(
      'purchase_requests', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'code', code, 'status', status, 'reason', reason,
        'needed_by', case when needed_by is null then null else needed_by::text end
      ) order by case when status in ('approved', 'partially_received') and needed_by < p_as_of then 0 else 1 end,
                 needed_by asc nulls last, id) from purchase_rows), '[]'::jsonb),
      'budget_pressure', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'category', category, 'approved', approved::text,
        'committed', committed::text, 'actual', actual::text, 'available', available::text
      ) order by available, id) from budget_rows), '[]'::jsonb),
      'stock_shortages', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'unit', unit,
        'available', available::text, 'threshold', threshold::text
      ) order by available - threshold, id) from inventory_rows), '[]'::jsonb),
      'due_operations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'plan_id', plan_id, 'subtype', subtype, 'status', status,
        'planned_at', case when planned_at is null then null else planned_at::text end,
        'assigned', assigned
      ) order by planned_at asc nulls last, id) from operation_rows), '[]'::jsonb),
      'cost_centers', coalesce((select jsonb_agg(jsonb_build_object(
        'id', cost_center_id, 'code', code, 'name', name_ar,
        'debit', debit::text, 'credit', credit::text, 'net', net::text
      ) order by debit desc, cost_center_id) from cost_center_rows), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.fn_owner_home_snapshot(uuid, date, integer)
  from public, anon, authenticated;
grant execute on function public.fn_owner_home_snapshot(uuid, date, integer)
  to authenticated;

comment on function public.fn_owner_home_snapshot(uuid, date, integer) is
  'Owner-only active-org exact home snapshot with capped evidence rows; owner drawings remain separate.';

commit;
