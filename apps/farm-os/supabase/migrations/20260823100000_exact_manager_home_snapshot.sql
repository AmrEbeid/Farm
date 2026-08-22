-- SPEC-0033 R3c: one exact, bounded, farm-manager-only operational home snapshot.
-- Counts and quantities leave PostgreSQL as text; no finance values are exposed.

begin;

create or replace function public.fn_manager_home_snapshot(
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
    raise exception 'manager home as-of must equal the current Cairo business date' using errcode = '22007';
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
    raise exception 'forbidden: manager home requires the active organization' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_member m
     where m.user_id = v_uid and m.org_id = p_org and m.role = 'farm_manager'
  ) then
    raise exception 'forbidden: farm manager membership is required' using errcode = '42501';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: organization is outside the active scope' using errcode = '42501';
  end if;

  if exists (
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
    left join public.people pe on pe.id = o.responsible_person_id and pe.org_id = p_org
    where o.org_id = p_org and o.responsible_person_id is not null and pe.id is null
  ) or exists (
    select 1 from public.plan_operations o
    left join public.people pe on pe.id = o.signed_off_by and pe.org_id = p_org
    where o.org_id = p_org and o.signed_off_by is not null and pe.id is null
  ) or exists (
    select 1 from public.inventory_bin b
    left join public.inventory_items i on i.id = b.item_id and i.org_id = p_org
    where b.org_id = p_org and i.id is null
  ) then
    raise exception 'manager home organization relationship mismatch' using errcode = '23514';
  end if;

  with
  active_plans as materialized (
    select p.id, p.type, p.period_start
      from public.plans p
     where p.org_id = p_org and p.status = 'active'
  ),
  active_ops as materialized (
    select o.id, o.plan_id, p.type as plan_type, p.period_start, o.subtype,
           o.status, o.planned_at, o.ends_on, o.priority, o.responsible_person_id,
           o.signed_off_by, o.signed_off_at,
           count(a.id)::bigint as assignee_count
      from public.plan_operations o
      join active_plans p on p.id = o.plan_id
      left join public.plan_operation_assignees a
        on a.plan_op_id = o.id and a.org_id = p_org
     where o.org_id = p_org
     group by o.id, o.plan_id, p.type, p.period_start, o.subtype, o.status,
              o.planned_at, o.ends_on, o.priority, o.responsible_person_id,
              o.signed_off_by, o.signed_off_at
  ),
  open_ops as materialized (
    select *,
           (responsible_person_id is not null or assignee_count > 0) as assigned,
           coalesce(ends_on, planned_at) as effective_end
      from active_ops
     where coalesce(status, 'planned') not in ('done', 'blocked', 'abandoned', 'skipped')
  ),
  operation_summary as (
    select count(*)::bigint as open_count,
           count(*) filter (
             where planned_at is not null and planned_at <= p_as_of
               and coalesce(ends_on, planned_at) >= p_as_of
           )::bigint as today_count,
           count(*) filter (
             where planned_at is not null and coalesce(ends_on, planned_at) < p_as_of
           )::bigint as overdue_count,
           count(*) filter (where not assigned)::bigint as unassigned_count,
           count(*) filter (where planned_at is null)::bigint as unscheduled_count
      from open_ops
  ),
  priority_operation_rows as materialized (
    select id, plan_id, plan_type, period_start, subtype, status, planned_at, ends_on, assigned,
           case
             when planned_at is null then 'unscheduled'
             when effective_end < p_as_of then 'overdue'
             else 'today'
           end as urgency
      from open_ops
     where planned_at is null or planned_at <= p_as_of
     order by
       case when effective_end < p_as_of then 0 when planned_at is null then 1 else 2 end,
       effective_end asc nulls first, priority asc nulls last, id
     limit p_detail_limit
  ),
  unassigned_rows as materialized (
    select id, plan_id, plan_type, period_start, subtype, status, planned_at, ends_on
      from open_ops
     where not assigned
     order by planned_at asc nulls first, priority asc nulls last, id
     limit p_detail_limit
  ),
  pending_signoff_summary as (
    select count(*)::bigint as pending_count
      from open_ops
     where subtype in ('fertilization', 'spraying')
       and (signed_off_by is null or signed_off_at is null)
  ),
  pending_signoff_rows as materialized (
    select id, plan_id, plan_type, period_start, subtype, status, planned_at, ends_on
      from open_ops
     where subtype in ('fertilization', 'spraying')
       and (signed_off_by is null or signed_off_at is null)
     order by planned_at asc nulls first, priority asc nulls last, id
     limit p_detail_limit
  ),
  blocked_check_summary as (
    select count(*)::bigint as blocked_count
      from public.plan_checks c
      join active_plans p on p.id = c.plan_id
     where c.org_id = p_org and c.result = 'block' and c.kind in ('stock', 'budget')
  ),
  blocked_check_rows as materialized (
    select c.id, c.plan_id, p.type as plan_type, p.period_start, c.kind
      from public.plan_checks c
      join active_plans p on p.id = c.plan_id
     where c.org_id = p_org and c.result = 'block' and c.kind in ('stock', 'budget')
     order by p.period_start asc nulls first, c.plan_id, c.kind, c.id
     limit p_detail_limit
  ),
  item_stock as materialized (
    select i.id, i.name, i.unit, count(b.item_id)::bigint as bin_count,
           coalesce(sum(b.on_hand), 0) - coalesce(sum(b.reserved), 0) as available,
           coalesce(i.reorder_point, i.min_stock, 0) as threshold
      from public.inventory_items i
      left join public.inventory_bin b on b.item_id = i.id and b.org_id = i.org_id
     where i.org_id = p_org
     group by i.id, i.name, i.unit, i.reorder_point, i.min_stock
  ),
  inventory_summary as (
    select count(*) filter (where bin_count > 0 and threshold > 0 and available < threshold)::bigint as below_threshold_count,
           count(*) filter (where bin_count > 0 and available <= 0)::bigint as out_of_stock_count,
           count(*) filter (where bin_count = 0)::bigint as unknown_stock_count
      from item_stock
  ),
  stock_rows as materialized (
    select id, name, unit, available, threshold
      from item_stock
     where bin_count > 0 and threshold > 0 and available < threshold
     order by available - threshold, id
     limit p_detail_limit
  ),
  authority as (
    select jsonb_object_agg(d.domain, d.status) as statuses
      from public.data_authority_status d
     where d.org_id = p_org and d.domain in ('operations', 'inventory')
  )
  select jsonb_build_object(
    'version', 'farm-os.manager-home.v1',
    'org_id', p_org,
    'as_of', p_as_of::text,
    'detail_limit', p_detail_limit,
    'authority', coalesce((select statuses from authority), '{}'::jsonb),
    'attention', jsonb_build_object(
      'overdue_operations', (select overdue_count::text from operation_summary),
      'blocked_plan_checks', (select blocked_count::text from blocked_check_summary),
      'unassigned_operations', (select unassigned_count::text from operation_summary),
      'unscheduled_operations', (select unscheduled_count::text from operation_summary),
      'pending_agronomy_signoffs', (select pending_count::text from pending_signoff_summary),
      'unknown_stock_items', (select unknown_stock_count::text from inventory_summary),
      'below_reorder_threshold', (select below_threshold_count::text from inventory_summary)
    ),
    'state', jsonb_build_object(
      'operations', jsonb_build_object(
        'open_count', (select open_count::text from operation_summary),
        'today_count', (select today_count::text from operation_summary),
        'overdue_count', (select overdue_count::text from operation_summary),
        'unassigned_count', (select unassigned_count::text from operation_summary),
        'unscheduled_count', (select unscheduled_count::text from operation_summary)
      ),
      'inventory', jsonb_build_object(
        'below_threshold_count', (select below_threshold_count::text from inventory_summary),
        'out_of_stock_count', (select out_of_stock_count::text from inventory_summary),
        'unknown_stock_count', (select unknown_stock_count::text from inventory_summary)
      ),
      'blocked_plan_checks', (select blocked_count::text from blocked_check_summary),
      'pending_agronomy_signoffs', (select pending_count::text from pending_signoff_summary)
    ),
    'drivers', jsonb_build_object(
      'priority_operations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id::text, 'plan_id', plan_id::text, 'plan_type', plan_type,
        'period_start', period_start::text, 'subtype', subtype, 'status', status,
        'planned_at', planned_at::text, 'ends_on', ends_on::text,
        'assigned', assigned, 'urgency', urgency
      ) order by case urgency when 'overdue' then 0 when 'unscheduled' then 1 else 2 end,
                 planned_at asc nulls first, id) from priority_operation_rows), '[]'::jsonb),
      'unassigned_operations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id::text, 'plan_id', plan_id::text, 'plan_type', plan_type,
        'period_start', period_start::text, 'subtype', subtype, 'status', status,
        'planned_at', planned_at::text, 'ends_on', ends_on::text
      ) order by planned_at asc nulls first, id) from unassigned_rows), '[]'::jsonb),
      'pending_signoffs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id::text, 'plan_id', plan_id::text, 'plan_type', plan_type,
        'period_start', period_start::text, 'subtype', subtype, 'status', status,
        'planned_at', planned_at::text, 'ends_on', ends_on::text
      ) order by planned_at asc nulls first, id) from pending_signoff_rows), '[]'::jsonb),
      'blocked_checks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id::text, 'plan_id', plan_id::text, 'plan_type', plan_type,
        'period_start', period_start::text, 'kind', kind
      ) order by period_start asc nulls first, plan_id, kind, id) from blocked_check_rows), '[]'::jsonb),
      'stock_below_threshold', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id::text, 'name', name, 'unit', unit,
        'available', available::text, 'threshold', threshold::text
      ) order by available - threshold, id) from stock_rows), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.fn_manager_home_snapshot(uuid, date, integer) from public;
revoke all on function public.fn_manager_home_snapshot(uuid, date, integer) from anon;
grant execute on function public.fn_manager_home_snapshot(uuid, date, integer) to authenticated;

comment on function public.fn_manager_home_snapshot(uuid, date, integer) is
  'Exact bounded farm-manager home snapshot for the active organization and current Cairo business date.';

commit;
