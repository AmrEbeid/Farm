-- Farm OS — soil-test-driven irrigation basis (Owner finding A, this session).
--
-- THE GAP. A real Owner instruction reads: "N irrigations over the rest of the month, based on
-- a soil-moisture test" — the FREQUENCY is a decision made from a soil-test reading, not a static
-- number chosen in advance. Today plan_operations for an irrigation op just carries a fixed
-- planned_at date like any other op (migration 0006) — there is no way to record that a given
-- irrigation schedule was soil-test-driven, or capture the reading that justified it.
--
-- THE FIX (deliberately simple — a context/record field, not a new scheduling algorithm). Two new
-- nullable columns on plan_operations:
--   irrigation_basis      text — 'fixed_schedule' | 'soil_test', CHECK-constrained. NULL for any
--                          non-irrigation op (and allowed to stay NULL for an irrigation op that
--                          simply doesn't record a basis yet — no NOT NULL / cross-column CHECK
--                          forcing it, mirroring the harvest_stage precedent on the sibling
--                          feat/operation-vocabulary branch: a plain value-set CHECK, no
--                          irrigation-only enforcement — over-engineering for the current need).
--   soil_moisture_reading text — free text, e.g. "رطوبة منخفضة" or "18%". Free text (not numeric)
--                          because field readings in the real reports arrive as qualitative notes
--                          as often as a number, and there is no single agreed instrument/unit
--                          across farms yet (non-negotiable #4: agronomy fields here are an
--                          editable record, not a structured measurement pipeline). Only
--                          meaningful when irrigation_basis = 'soil_test'; left NULL otherwise.
--
-- The resulting irrigation COUNT/frequency itself needs no schema change — it is just plan_operations
-- rows created as usual (one row per irrigation event), each optionally tagging its basis. This
-- migration only tags the BASIS of the scheduling decision.
--
-- Security: no RLS/authz change — both columns live on the existing plan_operations table, which
-- already has RLS deny-by-default + FORCE RLS (migration 0006 tenant_all policy, 0028 FORCE RLS)
-- and is written only through fn_add_plan_operation / fn_add_plan_operation_multi (SECURITY DEFINER,
-- plan.write org-scoped). Adding nullable columns does not change who can read/write the row.

alter table public.plan_operations
  add column if not exists irrigation_basis text,
  add column if not exists soil_moisture_reading text;

alter table public.plan_operations
  add constraint plan_operations_irrigation_basis_valid
  check (irrigation_basis is null or irrigation_basis in ('fixed_schedule', 'soil_test'));

comment on column public.plan_operations.irrigation_basis is
  'Only meaningful when subtype = ''irrigation''. NULL = not recorded / not applicable. '
  '''fixed_schedule'' = calendar-fixed irrigation. ''soil_test'' = frequency decided from a '
  'soil-moisture test (see soil_moisture_reading).';
comment on column public.plan_operations.soil_moisture_reading is
  'Free-text soil-moisture reading that justified irrigation_basis = ''soil_test'' (e.g. '
  '"رطوبة منخفضة" or "18%"). Record-keeping only — not a structured measurement pipeline.';

-- Extend fn_add_plan_operation_multi (0093) with two new OPTIONAL trailing params so the
-- OperationBuilder UI can set the basis/reading at create time. Postgres identifies a function by
-- (name, arg TYPE list) — appending new parameters changes that signature, so `create or replace`
-- alone would create a SECOND overload (9-arg and 11-arg both existing) instead of truly replacing
-- it, which then makes any untyped/literal 9-arg call ambiguous ("is not unique") at the call site.
-- DROP the old 9-arg signature explicitly first, then create the 11-arg version — every existing
-- caller (the app's addPlanOperationMulti, any other branch/direct-RPC caller) keeps working
-- unchanged because both new trailing params default to NULL and a 9-positional-arg call still
-- resolves (there being only ONE overload left).
drop function if exists public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid);

create function public.fn_add_plan_operation_multi(
  p_plan_id      uuid,
  p_subtype      text,
  p_planned_at   date,
  p_ends_on      date,
  p_est_cost     numeric,
  p_materials    jsonb,
  p_labor        jsonb,
  p_assignee_ids uuid[],
  p_lead_id      uuid,
  p_irrigation_basis      text default null,
  p_soil_moisture_reading text default null)
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
  -- irrigation-basis vocabulary (the table CHECK also enforces this; validate early for a clean 22023).
  if p_irrigation_basis is not null and p_irrigation_basis not in ('fixed_schedule', 'soil_test') then
    raise exception 'invalid irrigation_basis %', p_irrigation_basis using errcode = '22023';
  end if;

  -- CREATE-2 dedup (preserved from 0038; #399 review): a double-submit / network retry that committed
  -- server-side but failed to return would otherwise create a DUPLICATE op that over-counts the budget
  -- while its lines duplicate the demand. Find-or-create on the natural key (plan + subtype +
  -- planned_at): if such an op already exists, return it as deduped — no duplicate op/lines/assignees.
  select po.id into v_dup from public.plan_operations po
    where po.plan_id = p_plan_id and po.subtype = p_subtype
      and po.planned_at is not distinct from p_planned_at
    limit 1;
  if v_dup is not null then
    return jsonb_build_object('operationId', v_dup, 'deduped', true, 'materials', 0, 'labor', 0, 'assignees', 0);
  end if;

  insert into public.plan_operations (org_id, plan_id, subtype, target_type, target_id, planned_at,
                                      ends_on, priority, responsible_person_id, est_cost, approval_needed, status,
                                      irrigation_basis, soil_moisture_reading)
  values (v_org, p_plan_id, p_subtype, coalesce(v_scope_type, 'sector'), v_scope_id, p_planned_at,
          p_ends_on, 1, p_lead_id, p_est_cost, true, 'planned',
          p_irrigation_basis, p_soil_moisture_reading)
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

revoke all     on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid, text, text) from public;
revoke execute on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid, text, text) from anon;
grant  execute on function public.fn_add_plan_operation_multi(uuid, text, date, date, numeric, jsonb, jsonb, uuid[], uuid, text, text) to authenticated;
