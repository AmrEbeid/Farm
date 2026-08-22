-- SPEC-0033 R3d: one exact, bounded, agronomist-only agronomy home snapshot.
-- Counts and quantities leave PostgreSQL as text; no finance value (including est_cost) is exposed.
--
-- HONESTY CONTRACT (docs/CLAUDE.md #1 and #4). Every number here is an EXACT COUNT OF RECORDED ROWS
-- for the active organisation — never a claim that the farm is fully covered or that nothing else is
-- outstanding. Agronomy content stays an editable TEMPLATE pending a NAMED agronomist sign-off; an
-- `apc_registration_ref` is only the reference that was recorded, never evidence that an Egyptian
-- pesticide registration is current or valid. The snapshot carries no recommendation or prescription.
--
-- Trap follow-up reuses the app-layer thresholds already shipped in `lib/pest-scouting.ts` exactly:
-- overdue check = more than 10 days since max(checked_at), lure age = more than 90 days since
-- lure_changed_at, both falling back to installed_at when the newer date was never recorded, and
-- only for traps whose status is still 'active'.

begin;

create or replace function public.fn_agronomist_home_snapshot(
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
    raise exception 'agronomist home as-of must equal the current Cairo business date' using errcode = '22007';
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
    raise exception 'forbidden: agronomist home requires the active organization' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_member m
     where m.user_id = v_uid and m.org_id = p_org and m.role = 'agri_engineer'
  ) then
    raise exception 'forbidden: agronomist membership is required' using errcode = '42501';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: organization is outside the active scope' using errcode = '42501';
  end if;

  -- Cross-organisation relationship integrity fails CLOSED: a corrupt link must never be silently
  -- summarised into an agronomy count. Covers operation-to-plan, check-to-plan, material-to-operation,
  -- material-to-item, material-to-applicator, sign-off person, trap structural links and catch-to-trap.
  if exists (
    select 1 from public.plan_operations o
    left join public.plans p on p.id = o.plan_id and p.org_id = p_org
    where o.org_id = p_org and p.id is null
  ) or exists (
    select 1 from public.plan_checks c
    left join public.plans p on p.id = c.plan_id and p.org_id = p_org
    where c.org_id = p_org and p.id is null
  ) or exists (
    select 1 from public.plan_material_requirements r
    left join public.plan_operations o on o.id = r.plan_op_id and o.org_id = p_org
    where r.org_id = p_org and o.id is null
  ) or exists (
    select 1 from public.plan_material_requirements r
    left join public.inventory_items i on i.id = r.item_id and i.org_id = p_org
    where r.org_id = p_org and i.id is null
  ) or exists (
    select 1 from public.plan_material_requirements r
    left join public.people pe on pe.id = r.applicator_person_id and pe.org_id = p_org
    where r.org_id = p_org and r.applicator_person_id is not null and pe.id is null
  ) or exists (
    select 1 from public.plan_operations o
    left join public.people pe on pe.id = o.signed_off_by and pe.org_id = p_org
    where o.org_id = p_org and o.signed_off_by is not null and pe.id is null
  ) or exists (
    select 1 from public.pest_traps t
    where t.org_id = p_org and (
      (t.sector_id is not null and not exists (
        select 1 from public.sectors s where s.id = t.sector_id and s.org_id = p_org))
      or (t.hawsha_id is not null and not exists (
        select 1 from public.hawshat h where h.id = t.hawsha_id and h.org_id = p_org))
      or (t.line_id is not null and not exists (
        select 1 from public.lines l where l.id = t.line_id and l.org_id = p_org))
    )
  ) or exists (
    select 1 from public.pest_trap_catches c
    left join public.pest_traps t on t.id = c.trap_id and t.org_id = p_org
    where c.org_id = p_org and t.id is null
  ) then
    raise exception 'agronomist home organization relationship mismatch' using errcode = '23514';
  end if;

  with
  active_plans as materialized (
    select p.id, p.type, p.period_start
      from public.plans p
     where p.org_id = p_org and p.status = 'active'
  ),
  -- Agronomy work only: the operations an agronomist is accountable for. Harvest, pruning and
  -- logistics subtypes belong to the Farm Manager home, not here.
  agronomy_ops as materialized (
    select o.id, o.plan_id, p.type as plan_type, p.period_start, o.subtype, o.status,
           o.planned_at, o.ends_on, o.priority, o.signed_off_by, o.signed_off_at
      from public.plan_operations o
      join active_plans p on p.id = o.plan_id
     where o.org_id = p_org
       and o.subtype in ('fertilization', 'spraying', 'irrigation', 'pollination', 'inspection', 'pest_scouting')
  ),
  open_ops as materialized (
    select *, coalesce(ends_on, planned_at) as effective_end
      from agronomy_ops
     where coalesce(status, 'planned') not in ('done', 'blocked', 'abandoned', 'skipped')
  ),
  -- A dose decision is pending until BOTH halves of the sign-off pair are recorded; either half
  -- missing keeps the operation an advisory template.
  pending_signoff_ops as materialized (
    select *
      from open_ops
     where subtype in ('fertilization', 'spraying')
       and (signed_off_by is null or signed_off_at is null)
  ),
  due_ops as materialized (
    select *,
           case when effective_end < p_as_of then 'overdue' else 'today' end as urgency
      from open_ops
     where planned_at is not null
       and (effective_end < p_as_of or (planned_at <= p_as_of and effective_end >= p_as_of))
  ),
  trap_state as materialized (
    select t.id, t.code, t.label, t.installed_at, t.lure_changed_at,
           (select pg_catalog.max(c.checked_at)
              from public.pest_trap_catches c
             where c.trap_id = t.id and c.org_id = p_org) as last_checked_at
      from public.pest_traps t
     where t.org_id = p_org and t.status = 'active'
  ),
  trap_followups as materialized (
    select id, code, label, installed_at, lure_changed_at, last_checked_at,
           (p_as_of - coalesce(last_checked_at, installed_at)) as days_since_check,
           (p_as_of - coalesce(lure_changed_at, installed_at)) as days_since_lure_change,
           (p_as_of - coalesce(last_checked_at, installed_at)) > 10 as overdue_check,
           (p_as_of - coalesce(lure_changed_at, installed_at)) > 90 as needs_lure_change
      from trap_state
  ),
  recorded_summary as (
    select (select pg_catalog.count(*) from pending_signoff_ops)::bigint as pending_signoff_count,
           (select pg_catalog.count(*) from due_ops where urgency = 'today')::bigint as due_today_count,
           (select pg_catalog.count(*) from due_ops where urgency = 'overdue')::bigint as overdue_count,
           (select pg_catalog.count(*) from trap_followups
             where overdue_check or needs_lure_change)::bigint as trap_followup_count
  ),
  pending_signoff_rows as materialized (
    select id, plan_id, plan_type, period_start, subtype, status, planned_at, ends_on
      from pending_signoff_ops
     order by planned_at asc nulls first, priority asc nulls last, id
     limit p_detail_limit
  ),
  due_operation_rows as materialized (
    select id, plan_id, plan_type, period_start, subtype, status, planned_at, ends_on, urgency
      from due_ops
     order by case when urgency = 'overdue' then 0 else 1 end,
              effective_end asc, priority asc nulls last, id
     limit p_detail_limit
  ),
  trap_followup_rows as materialized (
    select id, code, label, installed_at, lure_changed_at, last_checked_at,
           days_since_check, days_since_lure_change, overdue_check, needs_lure_change
      from trap_followups
     where overdue_check or needs_lure_change
     order by days_since_check desc, days_since_lure_change desc, id
     limit p_detail_limit
  ),
  -- plan_checks carries no timestamp column, so the newest block cannot be identified; every block on
  -- an active plan is surfaced and the UI labels it as the LAST RECORDED check, not a live state.
  blocked_check_rows as materialized (
    select c.id, c.plan_id, p.type as plan_type, p.period_start, c.kind
      from public.plan_checks c
      join active_plans p on p.id = c.plan_id
     where c.org_id = p_org and c.result = 'block'
     order by p.period_start asc nulls first, c.plan_id, c.kind, c.id
     limit p_detail_limit
  ),
  authority as (
    select jsonb_object_agg(d.domain, d.status) as statuses
      from public.data_authority_status d
     where d.org_id = p_org and d.domain = 'operations'
  )
  select jsonb_build_object(
    'version', 'farm-os.agronomist-home.v1',
    'org_id', p_org,
    'as_of', p_as_of::text,
    'detail_limit', p_detail_limit,
    'authority', coalesce((select statuses from authority), '{}'::jsonb),
    -- `recorded` is deliberately named: these are exact counts of rows recorded in this
    -- organisation, not a statement about everything happening on the farm.
    'recorded', jsonb_build_object(
      'pending_signoffs', (select pending_signoff_count::text from recorded_summary),
      'due_today', (select due_today_count::text from recorded_summary),
      'overdue', (select overdue_count::text from recorded_summary),
      'trap_followups', (select trap_followup_count::text from recorded_summary)
    ),
    'drivers', jsonb_build_object(
      'pending_signoffs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id::text, 'plan_id', r.plan_id::text, 'plan_type', r.plan_type,
        'period_start', r.period_start::text, 'subtype', r.subtype, 'status', r.status,
        'planned_at', r.planned_at::text, 'ends_on', r.ends_on::text,
        'material_count', (
          select pg_catalog.count(*)::text
            from public.plan_material_requirements m
           where m.org_id = p_org and m.plan_op_id = r.id
        ),
        'materials', coalesce((
          select jsonb_agg(bounded.entry order by bounded.sort_name, bounded.sort_id)
            from (
              select i.name as sort_name, m.id as sort_id, jsonb_build_object(
                       'id', m.id::text,
                       'item_id', m.item_id::text,
                       'item_name', i.name,
                       'qty', m.qty::text,
                       'unit', m.unit,
                       'target_pest', m.target_pest,
                       'apc_registration_ref', m.apc_registration_ref,
                       'rei_hours', m.rei_hours::text,
                       'phi_days', m.phi_days::text,
                       'target_zone', m.target_zone,
                       'applicator_person_id', m.applicator_person_id::text,
                       'applicator_name', pe.name
                     ) as entry
                from public.plan_material_requirements m
                join public.inventory_items i on i.id = m.item_id and i.org_id = p_org
                left join public.people pe on pe.id = m.applicator_person_id and pe.org_id = p_org
               where m.org_id = p_org and m.plan_op_id = r.id
               order by i.name, m.id
               limit p_detail_limit
            ) bounded
        ), '[]'::jsonb)
      ) order by r.planned_at asc nulls first, r.id) from pending_signoff_rows r), '[]'::jsonb),
      'due_operations', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id::text, 'plan_id', plan_id::text, 'plan_type', plan_type,
        'period_start', period_start::text, 'subtype', subtype, 'status', status,
        'planned_at', planned_at::text, 'ends_on', ends_on::text, 'urgency', urgency
      ) order by case when urgency = 'overdue' then 0 else 1 end, planned_at asc, id)
        from due_operation_rows), '[]'::jsonb),
      'trap_followups', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id::text, 'code', code, 'label', label,
        'installed_at', installed_at::text, 'lure_changed_at', lure_changed_at::text,
        'last_checked_at', last_checked_at::text,
        'days_since_check', days_since_check::text,
        'days_since_lure_change', days_since_lure_change::text,
        'overdue_check', overdue_check, 'needs_lure_change', needs_lure_change
      ) order by days_since_check desc, id) from trap_followup_rows), '[]'::jsonb),
      'blocked_checks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id::text, 'plan_id', plan_id::text, 'plan_type', plan_type,
        'period_start', period_start::text, 'kind', kind
      ) order by period_start asc nulls first, plan_id, kind, id) from blocked_check_rows), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.fn_agronomist_home_snapshot(uuid, date, integer) from public;
revoke all on function public.fn_agronomist_home_snapshot(uuid, date, integer) from anon;
grant execute on function public.fn_agronomist_home_snapshot(uuid, date, integer) to authenticated;

comment on function public.fn_agronomist_home_snapshot(uuid, date, integer) is
  'Exact bounded agronomist home snapshot of RECORDED agronomy workflow for the active organization and current Cairo business date; no finance values, no prescriptions.';

commit;
