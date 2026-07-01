-- Farm OS — operation vocabulary (2/2): fn_add_plan_operation_multi re-emit adding an optional
-- p_harvest_stage param so a harvest operation can record its ripening stage (خلال/رطب/تمر,
-- migration 20260701235000's plan_operations.harvest_stage column + CHECK).
--
-- Re-emitted from the CURRENT definition (20260701170000, the unit-reconciliation 'kg'-default
-- fix) — see the authorize()-re-emit footgun: a re-emit copied from an older base silently drops
-- whatever an intervening migration added. The ONLY functional change vs 20260701170000 is the new
-- p_harvest_stage parameter (appended LAST, defaulting to null, so no existing call site breaks)
-- and passing it through to the plan_operations insert. Everything else — the plan.write authz
-- gate, the cross-org guard, the multi-day/lead validation, the CREATE-2 dedup, the materials/
-- labour/assignee loops, the unit-reconcile-by-trigger behaviour — is unchanged byte-for-byte.
-- Grants preserved by create-or-replace + the explicit revoke/grant block (new signature needs its
-- own grant; Postgres does not carry grants across a parameter-list change).

create or replace function public.fn_add_plan_operation_multi(
  p_plan_id       uuid,
  p_subtype       text,
  p_planned_at    date,
  p_ends_on       date,
  p_est_cost      numeric,
  p_materials     jsonb,
  p_labor         jsonb,
  p_assignee_ids  uuid[],
  p_lead_id       uuid,
  p_harvest_stage text default null)
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
  v_dup        uuid;
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

  if not public.authorize('plan.write', v_org) then
    raise exception 'forbidden: plan.write is required to author a plan operation'
      using errcode = '42501';
  end if;
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org plan operation on plan %', p_plan_id
      using errcode = '42501';
  end if;

  if p_ends_on is not null and p_planned_at is not null and p_ends_on < p_planned_at then
    raise exception 'ends_on % precedes planned_at %', p_ends_on, p_planned_at using errcode = '22023';
  end if;
  if p_lead_id is not null and (p_assignee_ids is null or not (p_lead_id = any (p_assignee_ids))) then
    raise exception 'lead % must be one of the assignees', p_lead_id using errcode = '22023';
  end if;

  select po.id into v_dup from public.plan_operations po
    where po.plan_id = p_plan_id and po.subtype = p_subtype
      and po.planned_at is not distinct from p_planned_at
    limit 1;
  if v_dup is not null then
    return jsonb_build_object('operationId', v_dup, 'deduped', true, 'materials', 0, 'labor', 0, 'assignees', 0);
  end if;

  insert into public.plan_operations (org_id, plan_id, subtype, target_type, target_id, planned_at,
                                      ends_on, priority, responsible_person_id, est_cost, approval_needed,
                                      status, harvest_stage)
  values (v_org, p_plan_id, p_subtype, coalesce(v_scope_type, 'sector'), v_scope_id, p_planned_at,
          p_ends_on, 1, p_lead_id, p_est_cost, true, 'planned', p_harvest_stage)
  returning id into v_op_id;

  for v_mat in select * from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb)) loop
    if not exists (select 1 from public.inventory_items it
                   where it.id = (v_mat->>'item_id')::uuid and it.org_id = v_org) then
      raise exception 'material item % is not in org %', v_mat->>'item_id', v_org using errcode = '22023';
    end if;
    if coalesce((v_mat->>'qty')::numeric, 0) < 0 then
      raise exception 'material qty must be non-negative' using errcode = '22023';
    end if;
    -- unit: null when omitted/blank → the trg_pmr_unit_reconcile trigger defaults it to the item's canonical
    -- unit and rejects a real mismatch (unchanged from 20260701170000).
    insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
    values (v_org, v_op_id, (v_mat->>'item_id')::uuid, (v_mat->>'qty')::numeric, nullif(v_mat->>'unit', ''));
    v_n_mat := v_n_mat + 1;
  end loop;

  for v_lab in select * from jsonb_array_elements(coalesce(p_labor, '[]'::jsonb)) loop
    if coalesce((v_lab->>'count')::int, 0) < 0 or coalesce((v_lab->>'days')::numeric, 0) < 0 then
      raise exception 'labour count/days must be non-negative' using errcode = '22023';
    end if;
    insert into public.plan_labor_requirements (org_id, plan_op_id, person_or_team, count, days)
    values (v_org, v_op_id, v_lab->>'person_or_team', (v_lab->>'count')::int, (v_lab->>'days')::numeric);
    v_n_lab := v_n_lab + 1;
  end loop;

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

-- Old 9-arg signature (pre-p_harvest_stage) is gone after create-or-replace with a different arg
-- list only if Postgres treats it as a new overload — it does NOT: create-or-replace requires an
-- IDENTICAL argument list to replace in place, and appending a DEFAULT-valued parameter changes
-- the signature, so this actually CREATES A NEW OVERLOAD alongside the old 9-arg one. Drop the old
-- overload explicitly so there is exactly one fn_add_plan_operation_multi (avoids an orphaned,
-- ungoverned 9-arg overload retaining its own grants).
drop function if exists public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid);

revoke all     on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid, text) from public;
revoke execute on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid, text) from anon;
grant  execute on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid, text) to authenticated;
