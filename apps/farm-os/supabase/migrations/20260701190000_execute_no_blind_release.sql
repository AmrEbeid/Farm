-- Farm OS — #512 FIX (the reservation-wipe masked shortage). Owner-directed build ("go with your
-- recommendation"); independent review + prod re-probe. ENGINE / cardinal-sin surface (SPEC-0001 §1).
--
-- THE BUG: fn_execute_operation posted a BLIND bin-wide `release` of the op's requirement qty (0057:108-111).
-- `reserved` is a bin-wide aggregate (fn_bin_rebuild, no plan/op scoping), and the only real reserve is the
-- item-level coverage-wedge earmark (reserveStock → SEED_PLAN, no op link). Execute's release reverses NO
-- per-op reserve — it blindly decrements whatever earmarks sit in the bin, INCLUDING another op's / the
-- wedge's. So executing an unrelated op wipes a live reservation → `available = on_hand − reserved` over-states
-- → the other item's shortage is MASKED. Reproduced by tests/105.
--
-- INVESTIGATION (2026-07-01, read-only): fn_execute_operation is the ONLY release path — there is NO
-- release-on-receipt / un-reserve / release-on-cancel anywhere, and no reserve is op-keyed (inventory_movements
-- has no plan_op_id). So execute's release corresponds to nothing it owns.
--
-- THE MINIMAL FIX THAT CANNOT MASK: remove execute's blind release. Masking = wrongly LOWERING `reserved`
-- (→ available UP). Execute's blind release is the only thing that wrongly lowers an unrelated op's reserved;
-- removing it means a real earmark ALWAYS survives an unrelated execute — structurally cannot over-state
-- available. Re-emitted VERBATIM from 0057 with ONLY the release block (0057:108-111) deleted (the `issue`
-- stays). Grants preserved by create-or-replace.
--
-- ACCEPTED TRADEOFF (the SAFE direction, non-negotiable #1): coverage-wedge earmarks are now never released, so
-- `reserved` accumulates → available is UNDER-stated → the engine OVER-orders, never masks. This is the same
-- tradeoff the repo already accepts for RESV-1 (#199, tests/78). The coherent removal of the accumulation — an
-- ATTRIBUTED release-on-receipt keyed to the fulfilled PR — is the op-keyed reservation model (#512 proposal /
-- reserve-lifecycle decision), tracked separately; it is NOT required to stop this mask and must not be faked
-- with another bin-wide (attribution-less) release, which would reintroduce the wipe.
--
-- Validation: tests/105 unpinned (todo → hard gate); tests/18 updated (execute no longer releases). Full harness.

create or replace function public.fn_execute_operation(
  p_op_id uuid,
  p_actual_qty numeric,
  p_labor_count int,
  p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_plan uuid; v_subtype text; v_target uuid; v_est numeric; v_status text;
  v_item uuid; v_req_qty numeric; v_unit text;
  v_person uuid; v_event uuid; v_actual_cost numeric; v_now timestamptz := now();
  v_claimed int;
begin
  -- B4: range-check inputs (a negative actual_qty would otherwise RAISE on_hand via the issue path).
  if p_actual_qty is null or p_actual_qty < 0 then
    raise exception 'invalid actual_qty: %', p_actual_qty using errcode = '22023';
  end if;
  if p_labor_count is null or p_labor_count < 0 then
    raise exception 'invalid labor_count: %', p_labor_count using errcode = '22023';
  end if;

  -- the operation + its (single) material requirement
  select po.org_id, po.plan_id, po.subtype, po.target_id, po.est_cost, po.status,
         pmr.item_id, pmr.qty, pmr.unit
    into v_org, v_plan, v_subtype, v_target, v_est, v_status, v_item, v_req_qty, v_unit
    from public.plan_operations po
    left join lateral (
      select item_id, qty, unit from public.plan_material_requirements
      where plan_op_id = po.id order by item_id limit 1
    ) pmr on true
    where po.id = p_op_id;
  if v_org is null then
    raise exception 'operation % not found', p_op_id using errcode = 'P0002';
  end if;

  -- AUTHZ-2 (#181): enforce op.execute SCOPED TO THE OP'S ORG, now that v_org is resolved. authorize()
  -- reads auth.uid() from the JWT GUC, which SECURITY DEFINER does NOT change, so it evaluates the
  -- *caller's* permission IN v_org even though the body runs as the definer.
  if not public.authorize('op.execute', v_org) then
    raise exception 'forbidden: op.execute is required to execute operations'
      using errcode = '42501';
  end if;

  -- org guard: the op must belong to one of the caller's orgs (defence in depth alongside RLS).
  if (select auth.uid()) is not null and v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org operation %', p_op_id using errcode = '42501';
  end if;

  -- EXE-STATUS (#235): only an ACTIVE operation is executable. A terminal op (blocked /
  -- abandoned / skipped) must NOT be executed — doing so would issue stock and flip a cancelled
  -- op to done. ('done' is handled by the claim-first guard below, with the clearer
  -- "already executed" error; planned / reserved / ready / in_progress proceed normally.)
  if v_status in ('blocked', 'abandoned', 'skipped') then
    raise exception 'operation % is not executable in status %', p_op_id, v_status
      using errcode = '22023';
  end if;

  -- EXE-1: claim-first. Flip → done only if not already done; abort if another caller won the race.
  update public.plan_operations set status = 'done'
    where id = p_op_id and status <> 'done';
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    raise exception 'operation % already executed', p_op_id using errcode = '23505';
  end if;

  -- actual cost = actual qty × the plan's unit rate (est_cost ÷ planned qty); B3.
  v_actual_cost := coalesce(v_est, 0);
  if v_item is not null and coalesce(v_req_qty, 0) > 0 then
    -- trim_scale so the stored JSON matches the JS computation (no trailing-zero numeric scale)
    v_actual_cost := trim_scale(p_actual_qty * (coalesce(v_est, 0) / v_req_qty));
  end if;

  -- the actor's person row (nullable), for performed_by_person_id
  select id into v_person from public.people
    where user_id = (select auth.uid()) and org_id = v_org limit 1;

  -- 1) the done farm_event (actuals embedded for the PvA report). occurred_at = now() → routes to the
  --    farm_event_default partition for dates outside the seed months.
  insert into public.farm_event (org_id, type, subtype, status, occurred_at, planned_at,
                                 performed_by_person_id, plan_id, notes, data)
  values (v_org, 'operation', v_subtype, 'done', v_now, v_now, v_person, v_plan, p_note,
          jsonb_build_object('labor_count', p_labor_count, 'actual_qty', p_actual_qty,
                             'actual_cost', v_actual_cost, 'op_id', p_op_id))
  returning id into v_event;

  insert into public.event_locations (event_id, org_id, sector_id) values (v_event, v_org, v_target);

  -- 2) consume the material: the quantities row + issue stock. Each call is transactional and part of THIS
  --    transaction, so any failure rolls the whole execution back.
  -- #512: NO `release` here. Execute owns no per-op reservation (reserves are item-level coverage earmarks
  -- under SEED_PLAN), so a blind bin-wide release wiped unrelated ops' earmarks → masked their shortage. The
  -- earmark is released by an attributed release-on-receipt (the op-keyed reservation model), NOT here.
  if v_item is not null then
    insert into public.quantities (org_id, event_id, measure, value_num, label, material_id,
                                   inventory_adjustment)
    values (v_org, v_event, 'weight', p_actual_qty, 'كمية مستخدمة', v_item, -p_actual_qty);

    perform public.fn_post_movement(v_item, 'issue', p_actual_qty, 'main', coalesce(v_unit, 'kg'),
                                    null, v_event, v_plan);
  end if;

  return jsonb_build_object('event_id', v_event, 'actual_cost', v_actual_cost,
                           'op_id', p_op_id, 'plan_id', v_plan);
end $$;
