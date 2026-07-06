-- D5: keep the legacy single-material plan operation RPC from deduping across targets.
--
-- The newer multi-operation RPC includes target_type/target_id in its natural key so a palm-targeted
-- treatment and a plan-scope demand on the same plan/subtype/date are distinct. This older sibling
-- still keyed retries only by plan/subtype/date/item and could return a palm operation as "deduped"
-- when the caller intended the plan-scope operation that this function writes.

create or replace function public.fn_add_plan_operation(
  p_plan_id uuid,
  p_subtype text,
  p_planned_at date,
  p_est_cost numeric,
  p_item_id uuid,
  p_qty numeric,
  p_unit text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_scope_type text;
  v_scope_id uuid;
  v_target_type text;
  v_dup_op uuid;
  v_op_id uuid;
begin
  -- Resolve the plan's org + scope (the operation's target). Fail loudly on a missing/bad plan rather
  -- than silently defaulting scope to a null sector (which the app guarded against).
  select pl.org_id, pl.scope_type, pl.scope_id
    into v_org, v_scope_type, v_scope_id
    from public.plans pl
    where pl.id = p_plan_id;
  if v_org is null then
    raise exception 'plan % not found', p_plan_id using errcode = 'P0002';
  end if;
  v_target_type := coalesce(v_scope_type, 'sector');

  -- AUTHZ-2 (#181): enforce plan.write SCOPED TO THE PLAN'S ORG, now that v_org is resolved.
  if not public.authorize('plan.write', v_org) then
    raise exception 'forbidden: plan.write is required to author a plan operation'
      using errcode = '42501';
  end if;

  -- Org guard: anon is rejected; an authenticated caller's plan must be in one of their orgs.
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org plan operation on plan %', p_plan_id
      using errcode = '42501';
  end if;

  -- The requirement's item must belong to the plan's org. A wholly non-existent p_item_id is left to
  -- the requirement insert's FK, preserving the pre-existing CREATE-3 behavior.
  if exists (select 1 from public.inventory_items where id = p_item_id)
     and not exists (select 1 from public.inventory_items where id = p_item_id and org_id = v_org) then
    raise exception 'forbidden: item % is not in the plan''s org', p_item_id using errcode = '42501';
  end if;

  -- CREATE-2 dedup: preserve retry idempotency, but include the target this function will write.
  -- Without target_type/target_id, an existing palm-scoped operation with the same item/date/subtype
  -- can swallow a distinct plan-scope demand.
  select po.id into v_dup_op
    from public.plan_operations po
    join public.plan_material_requirements pmr on pmr.plan_op_id = po.id
    where po.plan_id = p_plan_id
      and po.subtype = p_subtype
      and po.planned_at is not distinct from p_planned_at
      and po.target_type is not distinct from v_target_type
      and po.target_id is not distinct from v_scope_id
      and pmr.item_id = p_item_id
    limit 1;
  if v_dup_op is not null then
    return jsonb_build_object('operationId', v_dup_op, 'deduped', true);
  end if;

  -- Atomic create: insert the op, THEN its single material requirement, both in THIS transaction. A
  -- requirement failure (e.g. a bad item_id FK) rolls the op back automatically.
  insert into public.plan_operations (org_id, plan_id, subtype, target_type, target_id, planned_at,
                                      priority, responsible_person_id, est_cost, approval_needed, status)
  values (v_org, p_plan_id, p_subtype, v_target_type, v_scope_id, p_planned_at,
          1,
          (select pe.id from public.people pe
             where pe.user_id = (select auth.uid()) and pe.org_id = v_org limit 1),
          p_est_cost, true, 'planned')
  returning id into v_op_id;

  insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
  values (v_org, v_op_id, p_item_id, p_qty, p_unit);

  return jsonb_build_object('operationId', v_op_id, 'deduped', false);
end $$;

revoke all     on function public.fn_add_plan_operation(uuid, text, date, numeric, uuid, numeric, text) from public;
revoke execute on function public.fn_add_plan_operation(uuid, text, date, numeric, uuid, numeric, text) from anon;
grant  execute on function public.fn_add_plan_operation(uuid, text, date, numeric, uuid, numeric, text) to authenticated;
