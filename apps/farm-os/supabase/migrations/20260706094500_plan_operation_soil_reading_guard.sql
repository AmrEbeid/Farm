-- D7: keep fn_add_plan_operation_multi's 16-argument public shape frozen, but stop accepting
-- ambiguous soil-moisture readings through the RPC. The table column remains free text for field
-- language, while the write path now normalizes whitespace and rejects values that are only
-- meaningful when a soil-test irrigation basis is present.

create or replace function public.fn_add_plan_operation_multi(
  p_plan_id               uuid,
  p_subtype               text,
  p_planned_at            date,
  p_ends_on               date,
  p_est_cost              numeric,
  p_materials             jsonb,
  p_labor                 jsonb,
  p_assignee_ids          uuid[],
  p_lead_id               uuid,
  p_harvest_stage         text default null,
  p_preferred_time_of_day text default null,
  p_irrigation_basis      text default null,
  p_soil_moisture_reading text default null,
  p_target_type           text default null,
  p_target_id             uuid default null,
  p_note                  text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org                   uuid;
  v_scope_type            text;
  v_scope_id              uuid;
  v_op_id                 uuid;
  v_mat                   jsonb;
  v_lab                   jsonb;
  v_lab_person            uuid;
  v_pid                   uuid;
  v_dup                   uuid;
  v_n_mat                 int := 0;
  v_n_lab                 int := 0;
  v_n_asg                 int := 0;
  v_target_type           text;
  v_target_id             uuid;
  v_zone                  text;
  v_applicator            uuid;
  v_soil_moisture_reading text;
begin
  select pl.org_id, pl.scope_type, pl.scope_id
    into v_org, v_scope_type, v_scope_id
    from public.plans pl
    where pl.id = p_plan_id;
  if v_org is null then
    raise exception 'plan % not found', p_plan_id using errcode = 'P0002';
  end if;

  -- AUTHZ-2 (#181): plan.write, scoped to the plan's org.
  if not public.authorize('plan.write', v_org) then
    raise exception 'forbidden: plan.write is required to author a plan operation'
      using errcode = '42501';
  end if;
  -- org guard: anon rejected; authenticated caller's plan must be in one of their orgs.
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org plan operation on plan %', p_plan_id
      using errcode = '42501';
  end if;

  -- multi-day validity (the 0090 CHECK also enforces this; validate early for a clean 22023).
  if p_ends_on is not null and p_planned_at is not null and p_ends_on < p_planned_at then
    raise exception 'ends_on % precedes planned_at %', p_ends_on, p_planned_at using errcode = '22023';
  end if;
  -- a named lead must be one of the assignees.
  if p_lead_id is not null and (p_assignee_ids is null or not (p_lead_id = any (p_assignee_ids))) then
    raise exception 'lead % must be one of the assignees', p_lead_id using errcode = '22023';
  end if;
  -- preferred_time_of_day: same closed vocabulary as the table CHECK (clean 22023, not raw 23514).
  -- [PR #562]
  if p_preferred_time_of_day is not null
     and p_preferred_time_of_day not in ('morning','midday','late_afternoon','evening') then
    raise exception 'preferred_time_of_day % is not a recognised value', p_preferred_time_of_day
      using errcode = '22023';
  end if;
  -- irrigation-basis vocabulary (the table CHECK also enforces this; validate early for a clean
  -- 22023). [PR #560]
  if p_irrigation_basis is not null and p_irrigation_basis not in ('fixed_schedule', 'soil_test') then
    raise exception 'invalid irrigation_basis %', p_irrigation_basis using errcode = '22023';
  end if;

  v_soil_moisture_reading := nullif(btrim(p_soil_moisture_reading), '');
  if v_soil_moisture_reading is not null and length(v_soil_moisture_reading) > 120 then
    raise exception 'invalid soil_moisture_reading: too long' using errcode = '22023';
  end if;
  if v_soil_moisture_reading is not null and v_soil_moisture_reading ~ '[[:cntrl:]]' then
    raise exception 'invalid soil_moisture_reading: control characters are not allowed'
      using errcode = '22023';
  end if;
  if p_irrigation_basis = 'soil_test' and v_soil_moisture_reading is null then
    raise exception 'soil_moisture_reading is required when irrigation_basis is soil_test'
      using errcode = '22023';
  end if;
  if p_irrigation_basis is distinct from 'soil_test' and v_soil_moisture_reading is not null then
    raise exception 'soil_moisture_reading requires irrigation_basis soil_test'
      using errcode = '22023';
  end if;

  -- Palm-target override: validate BOTH-or-neither and that the palm belongs to this plan's org.
  -- A cross-org or non-palm target_id is rejected loudly (22023) rather than silently ignored -
  -- an ignored bad target would otherwise fall back to the plan's own scope, misattributing the
  -- treatment to the wrong tree without any error. [PR #563]
  if p_target_type is not null or p_target_id is not null then
    if p_target_type is distinct from 'palm' or p_target_id is null then
      raise exception 'target_type/target_id must both be set, with target_type = ''palm'''
        using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.assets a
      where a.id = p_target_id and a.org_id = v_org and a.type = 'palm'
    ) then
      raise exception 'target palm % is not in org %', p_target_id, v_org using errcode = '22023';
    end if;
    v_target_type := 'palm';
    v_target_id := p_target_id;
  else
    v_target_type := coalesce(v_scope_type, 'sector');
    v_target_id := v_scope_id;
  end if;

  -- CREATE-2 dedup (preserved from 0038; #399 review; #563 added the target columns to the natural
  -- key so a palm-scoped op and a plan-scoped op on the same subtype/date don't collide/dedup into
  -- each other). Find-or-create on the natural key: if such an op already exists, return it as
  -- deduped - no duplicate op/lines/assignees.
  select po.id into v_dup from public.plan_operations po
    where po.plan_id = p_plan_id and po.subtype = p_subtype
      and po.planned_at is not distinct from p_planned_at
      and po.target_type is not distinct from v_target_type
      and po.target_id is not distinct from v_target_id
    limit 1;
  if v_dup is not null then
    return jsonb_build_object('operationId', v_dup, 'deduped', true, 'materials', 0, 'labor', 0, 'assignees', 0);
  end if;

  insert into public.plan_operations (org_id, plan_id, subtype, target_type, target_id, planned_at,
                                      ends_on, priority, responsible_person_id, est_cost, approval_needed,
                                      status, harvest_stage, preferred_time_of_day, irrigation_basis,
                                      soil_moisture_reading, note)
  values (v_org, p_plan_id, p_subtype, v_target_type, v_target_id, p_planned_at,
          p_ends_on, 1, p_lead_id, p_est_cost, true, 'planned',
          p_harvest_stage, p_preferred_time_of_day, p_irrigation_basis, v_soil_moisture_reading,
          nullif(btrim(p_note), ''))
  returning id into v_op_id;

  -- materials: each item must be in the plan's org; qty non-negative; optional compliance fields
  -- (from PR #562/Layer 2 - carried forward verbatim, including its validation of target_zone/
  -- applicator and the correct `nullif` unit handling).
  for v_mat in select * from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb)) loop
    if not exists (select 1 from public.inventory_items it
                   where it.id = (v_mat->>'item_id')::uuid and it.org_id = v_org) then
      raise exception 'material item % is not in org %', v_mat->>'item_id', v_org using errcode = '22023';
    end if;
    if coalesce((v_mat->>'qty')::numeric, 0) < 0 then
      raise exception 'material qty must be non-negative' using errcode = '22023';
    end if;

    v_zone := nullif(v_mat->>'target_zone', '');
    if v_zone is not null and v_zone not in ('bunch','crown','trunk','offshoot','whole_palm') then
      raise exception 'target_zone % is not a recognised zone', v_zone using errcode = '22023';
    end if;

    v_applicator := nullif(v_mat->>'applicator_person_id', '')::uuid;
    if v_applicator is not null and not exists (
         select 1 from public.people pe where pe.id = v_applicator and pe.org_id = v_org and pe.active) then
      raise exception 'applicator % is not an active member of org %', v_applicator, v_org using errcode = '22023';
    end if;

    -- unit: null when omitted/blank -> the trg_pmr_unit_reconcile trigger (migration 20260701170000)
    -- defaults it to the item's canonical unit and rejects a real mismatch.
    insert into public.plan_material_requirements (
      org_id, plan_op_id, item_id, qty, unit,
      target_pest, apc_registration_ref, rei_hours, phi_days, target_zone,
      applicator_person_id, wind_speed_kmh, wind_direction, air_temp_c)
    values (
      v_org, v_op_id, (v_mat->>'item_id')::uuid, (v_mat->>'qty')::numeric, nullif(v_mat->>'unit', ''),
      nullif(v_mat->>'target_pest', ''), nullif(v_mat->>'apc_registration_ref', ''),
      (v_mat->>'rei_hours')::numeric, (v_mat->>'phi_days')::numeric, v_zone,
      v_applicator, (v_mat->>'wind_speed_kmh')::numeric, nullif(v_mat->>'wind_direction', ''),
      (v_mat->>'air_temp_c')::numeric);
    v_n_mat := v_n_mat + 1;
  end loop;

  -- labour: non-negative count/days; an OPTIONAL person_id (from PR #549/Layer 1) must be an ACTIVE
  -- same-org person - mirrors the assignee validation below. A line with no person_id stays
  -- free-text-only (unchanged).
  for v_lab in select * from jsonb_array_elements(coalesce(p_labor, '[]'::jsonb)) loop
    if coalesce((v_lab->>'count')::int, 0) < 0 or coalesce((v_lab->>'days')::numeric, 0) < 0 then
      raise exception 'labour count/days must be non-negative' using errcode = '22023';
    end if;
    v_lab_person := nullif(v_lab->>'person_id', '')::uuid;
    if v_lab_person is not null
       and not exists (select 1 from public.people pe
                       where pe.id = v_lab_person and pe.org_id = v_org and pe.active) then
      raise exception 'labour person % is not an active member of org %', v_lab_person, v_org
        using errcode = '22023';
    end if;
    insert into public.plan_labor_requirements (org_id, plan_op_id, person_or_team, count, days, person_id)
    values (v_org, v_op_id, v_lab->>'person_or_team', (v_lab->>'count')::int, (v_lab->>'days')::numeric, v_lab_person);
    v_n_lab := v_n_lab + 1;
  end loop;

  -- assignees: each person must be an ACTIVE member of the plan's org.
  if p_assignee_ids is not null then
    foreach v_pid in array p_assignee_ids loop
      if not exists (select 1 from public.people pe
                     where pe.id = v_pid and pe.org_id = v_org and pe.active) then
        raise exception 'assignee % is not an active member of org %', v_pid, v_org using errcode = '22023';
      end if;
      insert into public.plan_operation_assignees (org_id, plan_op_id, person_id, is_lead)
      values (v_org, v_op_id, v_pid, (v_pid = p_lead_id))
      on conflict (plan_op_id, person_id) do nothing;
      v_n_asg := v_n_asg + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'operationId', v_op_id, 'materials', v_n_mat, 'labor', v_n_lab, 'assignees', v_n_asg);
end $$;

revoke all     on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid, text, text, text, text, text, uuid, text) from public;
revoke execute on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid, text, text, text, text, text, uuid, text) from anon;
grant  execute on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid, text, text, text, text, text, uuid, text) to authenticated;
