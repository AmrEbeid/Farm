-- SPEC-0033 R3e: one exact, bounded, supervisor-only snapshot of the work ASSIGNED TO THE CALLER.
-- Counts leave PostgreSQL as text; no finance value of any kind is exposed (no est_cost, no
-- unit_cost, no rate/wage/pay, no budget or expense figure).
--
-- HONESTY CONTRACT (docs/CLAUDE.md #1 and #4). Every number here is an EXACT COUNT OF RECORDED
-- ROWS assigned to this caller in the active organisation. It is never a claim that the farm is
-- fully covered, nor that nothing else is outstanding, nor that the caller has no other work.
--
-- ASSIGNMENT IS THE CALLER'S REAL PERSON LINK, NEVER THE TEAM.
-- The caller is resolved through `people.user_id = auth.uid()` inside p_org. Work is assigned when
-- the operation's `responsible_person_id` is that person (the single-lead back-compat pointer kept
-- by migration 20260622000090) OR that person appears in `plan_operation_assignees`. When no person
-- row links the caller, the snapshot returns link_state = 'unlinked' with NULL counts and NULL
-- drivers — never zeros, and never an all-team fallback, because a zero would read as "all clear"
-- to a field supervisor who simply has not been linked yet. When MORE THAN ONE person row in the
-- organisation links to the same auth user, "my work" is not well defined, so the snapshot returns
-- link_state = 'ambiguous' with the same NULL shape rather than silently picking one row and
-- hiding real assigned work.
--
-- ACTIONABILITY MIRRORS fn_execute_operation, IT DOES NOT INVENT GATES.
-- `executable` is true only when EVERY condition below holds. Each one was read off the shipped
-- execute path (20260706093000 fn_execute_operation + 20260701180000 fn_post_movement), not guessed:
--   1. status is not terminal — fn_execute_operation raises 22023 for blocked/abandoned/skipped and
--      23505 for an already-done operation (the claim-first guard). Terminal rows never enter this
--      snapshot at all.
--   2. a dose-bearing operation (fertilization/spraying) has BOTH sign-off halves recorded. This is
--      the PRODUCT rule of docs/CLAUDE.md #4 and is STRICTER than the RPC, which does not gate on
--      sign-off: an unsigned dose is an editable template, so the supervisor is shown the recorded
--      blocker and a link to the record, never a "record it now" shortcut.
--   3. the operation's target resolves. fn_execute_operation raises 22023 for an unrecognised
--      target_type and P0002 for a typed target_id that has no same-organisation row of that type.
--      A NULL target_type is the legacy path: the RPC tolerates it and only records a location
--      warning, so it is NOT treated as a blocker here.
--   4. no material's unit contradicts its item's tracked unit. fn_execute_operation issues each
--      material through fn_post_movement with `coalesce(requirement.unit, 'kg')`, and
--      fn_post_movement raises 22023 when that differs from a non-null `inventory_items.unit`.
--      This rejection is fully determined by stored rows, so it is derived exactly.
--
-- WHAT `executable` DELIBERATELY DOES NOT CLAIM. Stock sufficiency is NOT preflighted: the issue
-- quantity is entered by the worker at execution time and fn_post_movement checks it against the
-- live bin, so no stored row can settle it in advance. Neither is a concurrent execution race. The
-- server RPC remains the only enforcement; `executable` only decides whether the fast record
-- shortcut is offered, and the UI must never present it as a guarantee that the record will post.
--
-- Multi-day semantics are inclusive: an operation is due today across its whole planned_at..ends_on
-- span, and becomes overdue only AFTER its effective end. Undated assigned work is kept explicit in
-- its own bucket instead of being silently dropped or counted as due.

begin;

create or replace function public.fn_supervisor_home_snapshot(
  p_org uuid,
  p_as_of date,
  p_detail_limit integer default 6
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
  v_person uuid;
  v_person_name text;
  v_person_links integer;
  v_link_state text;
  v_result jsonb;
begin
  if p_org is null or p_as_of is null then
    raise exception 'organization and as-of date are required' using errcode = '23502';
  end if;
  if p_detail_limit is null or p_detail_limit < 1 or p_detail_limit > 20 then
    raise exception 'detail limit must be between 1 and 20' using errcode = '22023';
  end if;
  if p_as_of <> (pg_catalog.now() at time zone 'Africa/Cairo')::date then
    raise exception 'supervisor home as-of must equal the current Cairo business date' using errcode = '22007';
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
    raise exception 'forbidden: supervisor home requires the active organization' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_member m
     where m.user_id = v_uid and m.org_id = p_org and m.role = 'supervisor'
  ) then
    raise exception 'forbidden: supervisor membership is required' using errcode = '42501';
  end if;
  if p_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: organization is outside the active scope' using errcode = '42501';
  end if;

  -- Cross-organisation relationship integrity fails CLOSED: a corrupt link must never be silently
  -- summarised into assigned work. Covers operation-to-plan, assignee-to-operation,
  -- assignee-to-person, material-to-operation, material-to-item, the responsible and sign-off
  -- person pointers, and the plan scope used for the location label. A cross-organisation
  -- operation TARGET is handled per row as a recorded blocker instead, because that is exactly what
  -- fn_execute_operation does with it (P0002 on that one operation, not a whole-page failure).
  if exists (
    select 1 from public.plan_operations o
    left join public.plans p on p.id = o.plan_id and p.org_id = p_org
    where o.org_id = p_org and p.id is null
  ) or exists (
    select 1 from public.plan_operation_assignees a
    left join public.plan_operations o on o.id = a.plan_op_id and o.org_id = p_org
    where a.org_id = p_org and o.id is null
  ) or exists (
    select 1 from public.plan_operation_assignees a
    left join public.people pe on pe.id = a.person_id and pe.org_id = p_org
    where a.org_id = p_org and pe.id is null
  ) or exists (
    select 1 from public.plan_material_requirements r
    left join public.plan_operations o on o.id = r.plan_op_id and o.org_id = p_org
    where r.org_id = p_org and o.id is null
  ) or exists (
    select 1 from public.plan_material_requirements r
    left join public.inventory_items i on i.id = r.item_id and i.org_id = p_org
    where r.org_id = p_org and i.id is null
  ) or exists (
    select 1 from public.plan_operations o
    left join public.people pe on pe.id = o.responsible_person_id and pe.org_id = p_org
    where o.org_id = p_org and o.responsible_person_id is not null and pe.id is null
  ) or exists (
    select 1 from public.plan_operations o
    left join public.people pe on pe.id = o.signed_off_by and pe.org_id = p_org
    where o.org_id = p_org and o.signed_off_by is not null and pe.id is null
  ) or exists (
    select 1 from public.plans p
    where p.org_id = p_org and p.scope_id is not null and (
      (p.scope_type = 'farm' and not exists (
        select 1 from public.farms f where f.id = p.scope_id and f.org_id = p_org))
      or (p.scope_type = 'sector' and not exists (
        select 1 from public.sectors s where s.id = p.scope_id and s.org_id = p_org))
      or (p.scope_type = 'hawsha' and not exists (
        select 1 from public.hawshat h where h.id = p.scope_id and h.org_id = p_org))
    )
  ) then
    raise exception 'supervisor home organization relationship mismatch' using errcode = '23514';
  end if;

  -- The caller's real person link. Counted first so an ambiguous link is reported as such rather
  -- than resolved by an arbitrary limit 1.
  select pg_catalog.count(*)::integer into v_person_links
    from public.people pe
   where pe.org_id = p_org and pe.user_id = v_uid;

  if v_person_links = 1 then
    select pe.id, pe.name into v_person, v_person_name
      from public.people pe
     where pe.org_id = p_org and pe.user_id = v_uid;
    v_link_state := 'linked';
  elsif v_person_links = 0 then
    v_link_state := 'unlinked';
  else
    v_link_state := 'ambiguous';
  end if;

  if v_link_state <> 'linked' then
    return jsonb_build_object(
      'version', 'farm-os.supervisor-home.v1',
      'org_id', p_org,
      'as_of', p_as_of::text,
      'detail_limit', p_detail_limit,
      'authority', coalesce((
        select jsonb_object_agg(d.domain, d.status)
          from public.data_authority_status d
         where d.org_id = p_org and d.domain = 'operations'
      ), '{}'::jsonb),
      'link', jsonb_build_object('state', v_link_state, 'person_id', null, 'person_name', null),
      -- NULL, never zero: no linked person means assigned work cannot be determined at all.
      'recorded', null,
      'drivers', null
    );
  end if;

  with
  active_plans as materialized (
    select p.id, p.type, p.period_start, p.scope_type, p.scope_id
      from public.plans p
     where p.org_id = p_org and p.status = 'active'
  ),
  -- Assigned, non-terminal work on ACTIVE plans only. Terminal statuses are dropped here so they
  -- can never be offered, counted or drilled into.
  assigned_ops as materialized (
    select o.id, o.plan_id, p.type as plan_type, p.period_start, p.scope_type, p.scope_id,
           o.subtype, o.status, o.planned_at, o.ends_on, o.priority,
           o.target_type, o.target_id, o.signed_off_by, o.signed_off_at,
           coalesce(o.ends_on, o.planned_at) as effective_end
      from public.plan_operations o
      join active_plans p on p.id = o.plan_id
     where o.org_id = p_org
       and coalesce(o.status, 'planned') not in ('done', 'blocked', 'abandoned', 'skipped')
       and (
         o.responsible_person_id = v_person
         or exists (
           select 1 from public.plan_operation_assignees a
            where a.org_id = p_org and a.plan_op_id = o.id and a.person_id = v_person
         )
       )
  ),
  -- Location context, resolved same-organisation only. `target_state` mirrors fn_execute_operation:
  -- 'legacy' (null target_type) is tolerated by the RPC, 'unrecognized' and 'unresolved' are not.
  located_ops as materialized (
    select o.*,
           case
             when o.target_type is null then 'legacy'
             when o.target_type not in ('farm', 'sector', 'hawsha', 'line', 'palm') then 'unrecognized'
             when o.target_id is null then 'ok'
             when o.target_type = 'farm' and exists (
               select 1 from public.farms f where f.id = o.target_id and f.org_id = p_org) then 'ok'
             when o.target_type = 'sector' and exists (
               select 1 from public.sectors s where s.id = o.target_id and s.org_id = p_org) then 'ok'
             when o.target_type = 'hawsha' and exists (
               select 1 from public.hawshat h where h.id = o.target_id and h.org_id = p_org) then 'ok'
             when o.target_type = 'line' and exists (
               select 1 from public.lines l where l.id = o.target_id and l.org_id = p_org) then 'ok'
             when o.target_type = 'palm' and exists (
               select 1 from public.assets a
                where a.id = o.target_id and a.org_id = p_org and a.type = 'palm') then 'ok'
             else 'unresolved'
           end as target_state,
           case o.target_type
             when 'farm' then (select f.name from public.farms f where f.id = o.target_id and f.org_id = p_org)
             when 'sector' then (select s.name from public.sectors s where s.id = o.target_id and s.org_id = p_org)
             when 'hawsha' then (select h.name from public.hawshat h where h.id = o.target_id and h.org_id = p_org)
             when 'line' then (select coalesce(l.line_code, l.line_no::text)
                                 from public.lines l where l.id = o.target_id and l.org_id = p_org)
             when 'palm' then (select coalesce(a.id_tag, a.name)
                                 from public.assets a
                                where a.id = o.target_id and a.org_id = p_org and a.type = 'palm')
             else null
           end as target_label,
           case o.scope_type
             when 'farm' then (select f.name from public.farms f where f.id = o.scope_id and f.org_id = p_org)
             when 'sector' then (select s.name from public.sectors s where s.id = o.scope_id and s.org_id = p_org)
             when 'hawsha' then (select h.name from public.hawshat h where h.id = o.scope_id and h.org_id = p_org)
             else null
           end as scope_label
      from assigned_ops o
  ),
  -- Recorded blockers: exactly the stored conditions that make the operation non-recordable now.
  -- `signoff_missing` is the product rule (docs/CLAUDE.md #4); the other two are literal
  -- fn_execute_operation / fn_post_movement rejections derived from stored rows.
  classified_ops as materialized (
    select o.*,
           (o.subtype in ('fertilization', 'spraying')
              and (o.signed_off_by is null or o.signed_off_at is null)) as signoff_missing,
           (o.target_state in ('unrecognized', 'unresolved')) as target_blocked,
           exists (
             select 1
               from public.plan_material_requirements r
               join public.inventory_items i on i.id = r.item_id and i.org_id = p_org
              where r.org_id = p_org and r.plan_op_id = o.id
                and i.unit is not null and i.unit <> coalesce(r.unit, 'kg')
           ) as unit_mismatch,
           case
             when o.planned_at is null then 'unscheduled'
             when o.effective_end < p_as_of then 'overdue'
             when o.planned_at <= p_as_of and o.effective_end >= p_as_of then 'today'
             else 'upcoming'
           end as urgency
      from located_ops o
  ),
  work as materialized (
    select c.*,
           (not c.signoff_missing and not c.target_blocked and not c.unit_mismatch) as executable
      from classified_ops c
  ),
  -- Due today and overdue together are "work for today"; it splits cleanly into what can be
  -- recorded now and what is blocked. That split is what the strict count reconciliation checks.
  today_work as materialized (
    select * from work where urgency in ('today', 'overdue')
  ),
  recorded_summary as (
    select (select pg_catalog.count(*) from work where urgency = 'today')::bigint as due_today_count,
           (select pg_catalog.count(*) from work where urgency = 'overdue')::bigint as overdue_count,
           (select pg_catalog.count(*) from today_work where executable)::bigint as ready_now_count,
           (select pg_catalog.count(*) from today_work where not executable)::bigint as blocked_now_count,
           (select pg_catalog.count(*) from work where urgency = 'unscheduled')::bigint as unscheduled_count,
           (select pg_catalog.count(*) from work where urgency = 'upcoming')::bigint as upcoming_count
  ),
  ready_now_rows as materialized (
    select w.*,
           row_number() over (
             order by case when urgency = 'overdue' then 0 else 1 end,
                      effective_end asc, priority asc nulls last, id
           ) as display_order
      from today_work w where executable
     order by case when urgency = 'overdue' then 0 else 1 end,
              effective_end asc, priority asc nulls last, id
     limit p_detail_limit
  ),
  blocked_now_rows as materialized (
    select w.*,
           row_number() over (
             order by case when urgency = 'overdue' then 0 else 1 end,
                      effective_end asc, priority asc nulls last, id
           ) as display_order
      from today_work w where not executable
     order by case when urgency = 'overdue' then 0 else 1 end,
              effective_end asc, priority asc nulls last, id
     limit p_detail_limit
  ),
  unscheduled_rows as materialized (
    select w.*,
           row_number() over (order by priority asc nulls last, id) as display_order
      from work w where urgency = 'unscheduled'
     order by priority asc nulls last, id
     limit p_detail_limit
  ),
  upcoming_rows as materialized (
    select w.*,
           row_number() over (order by planned_at asc, priority asc nulls last, id) as display_order
      from work w where urgency = 'upcoming'
     order by planned_at asc, priority asc nulls last, id
     limit p_detail_limit
  ),
  all_rows as materialized (
    select 'ready_now' as bucket, 1 as bucket_order, r.* from ready_now_rows r
    union all
    select 'blocked_now', 2, r.* from blocked_now_rows r
    union all
    select 'unscheduled', 3, r.* from unscheduled_rows r
    union all
    select 'upcoming', 4, r.* from upcoming_rows r
  ),
  -- Materials and crew are the field questions (بماذا / مع من). Each nested list is bounded
  -- INDEPENDENTLY by the same detail limit, and carries its own exact recorded total so a truncated
  -- sample can never read as the whole requirement. Quantities only — never a cost.
  detailed_rows as (
    select r.bucket, r.bucket_order, r.display_order, r.id, r.plan_id, r.plan_type, r.period_start, r.subtype,
           r.status, r.planned_at, r.ends_on, r.urgency, r.priority, r.effective_end,
           r.target_type, r.target_state, r.target_label, r.scope_type, r.scope_label,
           r.executable, r.signoff_missing, r.target_blocked, r.unit_mismatch,
           (select pg_catalog.count(*)::text
              from public.plan_material_requirements m
             where m.org_id = p_org and m.plan_op_id = r.id) as material_count,
           coalesce((
             select jsonb_agg(bounded.entry order by bounded.sort_name, bounded.sort_id)
               from (
                 select i.name as sort_name, m.id as sort_id, jsonb_build_object(
                          'id', m.id::text,
                          'item_id', m.item_id::text,
                          'item_name', i.name,
                          'qty', m.qty::text,
                          'unit', m.unit,
                          'item_unit', i.unit
                        ) as entry
                   from public.plan_material_requirements m
                   join public.inventory_items i on i.id = m.item_id and i.org_id = p_org
                  where m.org_id = p_org and m.plan_op_id = r.id
                  order by i.name, m.id
                  limit p_detail_limit
               ) bounded
           ), '[]'::jsonb) as materials,
           (select pg_catalog.count(*)::text
              from public.plan_operation_assignees a
             where a.org_id = p_org and a.plan_op_id = r.id) as crew_count,
           coalesce((
             select jsonb_agg(bounded.entry order by bounded.sort_name, bounded.sort_id)
               from (
                 select pe.name as sort_name, a.id as sort_id, jsonb_build_object(
                          'person_id', pe.id::text,
                          'name', pe.name,
                          'is_lead', a.is_lead
                        ) as entry
                   from public.plan_operation_assignees a
                   join public.people pe on pe.id = a.person_id and pe.org_id = p_org
                  where a.org_id = p_org and a.plan_op_id = r.id
                  order by pe.name, a.id
                  limit p_detail_limit
               ) bounded
           ), '[]'::jsonb) as crew
      from all_rows r
  ),
  driver_json as (
    select d.bucket, jsonb_agg(jsonb_build_object(
             'id', d.id::text,
             'plan_id', d.plan_id::text,
             'plan_type', d.plan_type,
             'period_start', d.period_start::text,
             'subtype', d.subtype,
             'status', d.status,
             'planned_at', d.planned_at::text,
             'ends_on', d.ends_on::text,
             'urgency', d.urgency,
             'target_type', d.target_type,
             'target_state', d.target_state,
             'target_label', d.target_label,
             'scope_type', d.scope_type,
             'scope_label', d.scope_label,
             'executable', d.executable,
             'blockers', (
               case when d.signoff_missing then jsonb_build_array('signoff_missing') else '[]'::jsonb end
               || case when d.target_blocked then jsonb_build_array('target_unresolved') else '[]'::jsonb end
               || case when d.unit_mismatch then jsonb_build_array('unit_mismatch') else '[]'::jsonb end
             ),
             'material_count', d.material_count,
             'materials', d.materials,
             'crew_count', d.crew_count,
             'crew', d.crew
           -- Preserve the exact rank assigned before each independent bucket was bounded.
           ) order by d.display_order
         ) as rows
      from detailed_rows d
     group by d.bucket
  ),
  authority as (
    select jsonb_object_agg(a.domain, a.status) as statuses
      from public.data_authority_status a
     where a.org_id = p_org and a.domain = 'operations'
  )
  select jsonb_build_object(
    'version', 'farm-os.supervisor-home.v1',
    'org_id', p_org,
    'as_of', p_as_of::text,
    'detail_limit', p_detail_limit,
    'authority', coalesce((select statuses from authority), '{}'::jsonb),
    'link', jsonb_build_object(
      'state', 'linked', 'person_id', v_person::text, 'person_name', v_person_name
    ),
    -- `recorded` is deliberately named: these are exact counts of rows recorded as ASSIGNED TO THIS
    -- CALLER in this organisation, not a statement about everything happening on the farm.
    'recorded', jsonb_build_object(
      'due_today', (select due_today_count::text from recorded_summary),
      'overdue', (select overdue_count::text from recorded_summary),
      'ready_now', (select ready_now_count::text from recorded_summary),
      'blocked_now', (select blocked_now_count::text from recorded_summary),
      'unscheduled', (select unscheduled_count::text from recorded_summary),
      'upcoming', (select upcoming_count::text from recorded_summary)
    ),
    'drivers', jsonb_build_object(
      'ready_now', coalesce((select rows from driver_json where bucket = 'ready_now'), '[]'::jsonb),
      'blocked_now', coalesce((select rows from driver_json where bucket = 'blocked_now'), '[]'::jsonb),
      'unscheduled', coalesce((select rows from driver_json where bucket = 'unscheduled'), '[]'::jsonb),
      'upcoming', coalesce((select rows from driver_json where bucket = 'upcoming'), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.fn_supervisor_home_snapshot(uuid, date, integer) from public;
revoke all on function public.fn_supervisor_home_snapshot(uuid, date, integer) from anon;
grant execute on function public.fn_supervisor_home_snapshot(uuid, date, integer) to authenticated;

comment on function public.fn_supervisor_home_snapshot(uuid, date, integer) is
  'Exact bounded supervisor home snapshot of the RECORDED work assigned to the calling person for the active organization and current Cairo business date; no finance values, no team fallback, actionability mirrors fn_execute_operation.';

commit;
