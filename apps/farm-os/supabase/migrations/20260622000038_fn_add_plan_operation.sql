-- Farm OS MVP-0 — CREATE-3 (#196): atomic, single-transaction plan-operation authoring.
--
-- addPlanOperation (app/(app)/plans/[planId]/actions.ts) did TWO non-atomic writes from the
-- authenticated client: insert plan_operations, THEN insert plan_material_requirements. If the 2nd
-- failed after the 1st committed, an ORPHAN operation (no requirement) was left behind. The CREATE-2
-- dedup only matches ops that already carry a requirement for the item, so it missed the orphan on
-- retry → a retry inserted a DUPLICATE op. Worse: runPlanChecks still sums the orphan's est_cost
-- (over-counting the budget) while it contributes ZERO demand (it has no requirement).
--
-- This RPC mirrors the fn_post_receipt / fn_execute_operation precedent (migrations 0024 / 0020 / 0035):
-- the op insert AND its material-requirement insert run in ONE transaction, so a requirement failure
-- rolls the op back automatically — no orphan, nothing to retry around. CREATE-2 dedup is preserved
-- server-side (find-or-create on the natural key + item).
--
--   * AUTHZ-2 (#181): authoring a planned operation is plan.write (owner/farm_manager), enforced
--     SCOPED TO THE PLAN'S ORG via the org-scoped authorize() overload (migration 0035), after v_org
--     is resolved. authorize()/auth.uid() read the caller's JWT GUC, which SECURITY DEFINER does NOT
--     change, so the *caller's* permission in v_org is evaluated even though the body runs as definer.
--   * org guard: anon is rejected outright; an authenticated caller's plan must belong to one of their
--     orgs (defence in depth alongside RLS), mirroring fn_post_receipt's cross-org guard.
--
-- Locked down per migrations 0021/0035: pinned empty search_path, fully schema-qualified, revoked from
-- public + anon, granted only to authenticated.
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
