-- Farm OS — #398 slice 2 (RPC): atomic multi-line plan-operation authoring.
-- The Owner asked for an operation to carry SEVERAL needs at once — multiple materials (e.g. more than
-- one fertilizer, plus fuel/gas as items), multiple labour lines — span MORE THAN ONE DAY, and be
-- assigned to ONE OR MORE employees. The existing fn_add_plan_operation (0038) creates an op + exactly
-- ONE material; this RPC creates the op + N materials + N labour lines + N assignees + ends_on, all in
-- ONE transaction (any line failing rolls the whole op back — never an orphan, extending the 0038/
-- fn_post_receipt precedent). Builds on the 0090 schema (ends_on, plan_operation_assignees).
--
-- Security (mirrors 0038): plan.write enforced SCOPED TO THE PLAN'S ORG (org-scoped authorize, 0035);
-- anon rejected; an authenticated caller's plan must be in one of their orgs. Each material item and
-- each assignee person is validated to be IN THE PLAN'S ORG (definer bypasses RLS, so the cross-org
-- checks are explicit here — mirrors the cross-org FK invariant the RLS layer enforces for direct
-- writes). search_path pinned empty; fully schema-qualified; EXECUTE locked to authenticated.
--
-- p_materials : jsonb array of {item_id uuid, qty numeric, unit text}
-- p_labor     : jsonb array of {person_or_team text, count int, days numeric}
-- p_assignee_ids : people to assign (one-or-more); p_lead_id : which assignee is the lead (optional).
create or replace function public.fn_add_plan_operation_multi(
  p_plan_id      uuid,
  p_subtype      text,
  p_planned_at   date,
  p_ends_on      date,
  p_est_cost     numeric,
  p_materials    jsonb,
  p_labor        jsonb,
  p_assignee_ids uuid[],
  p_lead_id      uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org        uuid;
  v_scope_type text;
  v_scope_id   uuid;
  v_op_id      uuid;
  v_mat        jsonb;
  v_lab        jsonb;
  v_pid        uuid;
  v_n_mat      int := 0;
  v_n_lab      int := 0;
  v_n_asg      int := 0;
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

  insert into public.plan_operations (org_id, plan_id, subtype, target_type, target_id, planned_at,
                                      ends_on, priority, responsible_person_id, est_cost, approval_needed, status)
  values (v_org, p_plan_id, p_subtype, coalesce(v_scope_type, 'sector'), v_scope_id, p_planned_at,
          p_ends_on, 1, p_lead_id, p_est_cost, true, 'planned')
  returning id into v_op_id;

  -- materials: each item must be in the plan's org; qty non-negative.
  for v_mat in select * from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb)) loop
    if not exists (select 1 from public.inventory_items it
                   where it.id = (v_mat->>'item_id')::uuid and it.org_id = v_org) then
      raise exception 'material item % is not in org %', v_mat->>'item_id', v_org using errcode = '22023';
    end if;
    if coalesce((v_mat->>'qty')::numeric, 0) < 0 then
      raise exception 'material qty must be non-negative' using errcode = '22023';
    end if;
    insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
    values (v_org, v_op_id, (v_mat->>'item_id')::uuid, (v_mat->>'qty')::numeric, coalesce(v_mat->>'unit', 'kg'));
    v_n_mat := v_n_mat + 1;
  end loop;

  -- labour: non-negative count/days.
  for v_lab in select * from jsonb_array_elements(coalesce(p_labor, '[]'::jsonb)) loop
    if coalesce((v_lab->>'count')::int, 0) < 0 or coalesce((v_lab->>'days')::numeric, 0) < 0 then
      raise exception 'labour count/days must be non-negative' using errcode = '22023';
    end if;
    insert into public.plan_labor_requirements (org_id, plan_op_id, person_or_team, count, days)
    values (v_org, v_op_id, v_lab->>'person_or_team', (v_lab->>'count')::int, (v_lab->>'days')::numeric);
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

revoke all     on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid) from public;
revoke execute on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid) from anon;
grant  execute on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid) to authenticated;
