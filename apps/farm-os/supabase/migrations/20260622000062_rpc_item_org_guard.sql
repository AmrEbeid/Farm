-- Farm OS MVP-0 — #235 (RPC arm of the cross-org item fix, companion to 0061): fn_add_plan_operation
-- must reject a p_item_id that is not in the plan's org. The function is SECURITY DEFINER and runs as the
-- BYPASSRLS owner, so the plan_material_requirements item-org WITH CHECK added in 0061 is NOT evaluated
-- for its insert — a member could call /rest/v1/rpc/fn_add_plan_operation with their own plan + a
-- CROSS-ORG p_item_id and the requirement would persist (org_id = the plan's org, item_id = a foreign
-- org's item), the same tenant-isolation hazard 0061 closed on the direct-REST path. Re-emitted VERBATIM
-- from migration 0038 with ONLY an item-org guard added after the existing org guard. SECURITY DEFINER +
-- set search_path preserved; the trailing grant/revoke are unchanged.

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
  v_dup_op uuid;
  v_op_id uuid;
begin
  -- resolve the plan's org + scope (the operation's target). Fail loudly on a missing/bad plan rather
  -- than silently defaulting scope to a null sector (which the app guarded against).
  select pl.org_id, pl.scope_type, pl.scope_id
    into v_org, v_scope_type, v_scope_id
    from public.plans pl
    where pl.id = p_plan_id;
  if v_org is null then
    raise exception 'plan % not found', p_plan_id using errcode = 'P0002';
  end if;

  -- AUTHZ-2 (#181): enforce plan.write SCOPED TO THE PLAN'S ORG, now that v_org is resolved.
  if not public.authorize('plan.write', v_org) then
    raise exception 'forbidden: plan.write is required to author a plan operation'
      using errcode = '42501';
  end if;

  -- org guard: anon is rejected; an authenticated caller's plan must be in one of their orgs (defence
  -- in depth alongside RLS). The null-uid path is the trusted service/superuser context only.
  if (select auth.role()) = 'anon'
     or ((select auth.uid()) is not null and v_org not in (select public.user_org_ids())) then
    raise exception 'forbidden: cross-org plan operation on plan %', p_plan_id
      using errcode = '42501';
  end if;

  -- #235: the requirement's item must belong to the plan's org. fn_add_plan_operation is SECURITY
  -- DEFINER (BYPASSRLS), so the plan_material_requirements item-org WITH CHECK (migration 0061) does
  -- NOT apply to the insert below — validate here so a CROSS-ORG p_item_id cannot be smuggled into a
  -- plan material requirement via the RPC path. Scoped to an item that EXISTS in another org: a wholly
  -- non-existent p_item_id is left to the requirement insert's FK (23503, the pre-existing CREATE-3
  -- behaviour), so only the tenant-isolation case is reclassified to 42501.
  if exists (select 1 from public.inventory_items where id = p_item_id)
     and not exists (select 1 from public.inventory_items where id = p_item_id and org_id = v_org) then
    raise exception 'forbidden: item % is not in the plan''s org', p_item_id using errcode = '42501';
  end if;

  -- CREATE-2 dedup (preserved): a double-submit / retry would otherwise create a DUPLICATE op + a
  -- second requirement, over-counting planned demand. Find-or-create: if an op for this plan with the
  -- same natural key (subtype + planned_at) ALREADY carries a requirement for this item, reuse it.
  select po.id into v_dup_op
    from public.plan_operations po
    join public.plan_material_requirements pmr on pmr.plan_op_id = po.id
    where po.plan_id = p_plan_id
      and po.subtype = p_subtype
      and po.planned_at = p_planned_at
      and pmr.item_id = p_item_id
    limit 1;
  if v_dup_op is not null then
    return jsonb_build_object('operationId', v_dup_op, 'deduped', true);
  end if;

  -- Atomic create: insert the op, THEN its single material requirement, both in THIS transaction. A
  -- requirement failure (e.g. a bad item_id FK) rolls the op back automatically — never an orphan op.
  insert into public.plan_operations (org_id, plan_id, subtype, target_type, target_id, planned_at,
                                      priority, responsible_person_id, est_cost, approval_needed, status)
  values (v_org, p_plan_id, p_subtype, coalesce(v_scope_type, 'sector'), v_scope_id, p_planned_at,
          1,
          -- the caller's person in this org (nullable), for responsible_person_id
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
