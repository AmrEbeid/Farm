-- Farm OS MVP-0 — AUTHZ-1 (SPEC-0002 Option A): the authoritative op.execute gate, as one atomic RPC.
--
-- executeOperation drove the whole execution as ~5 separate un-transactioned writes from the
-- authenticated client, and never enforced op.execute (only the page + the #71 app-layer check did),
-- so a role without op.execute could execute via direct REST, and a partial failure could desync state
-- (EXEC-PARTIAL-1: the quantities/event_locations inserts were unchecked). This RPC closes both:
--
--   * AUTHZ-1: `authorize('op.execute')` is checked at the top, server-side, regardless of REST access.
--     authorize() reads auth.uid() from the JWT GUC, which SECURITY DEFINER does NOT change, so it
--     correctly evaluates the *caller's* permission even though the body runs as the definer.
--   * Atomicity (fixes EXEC-PARTIAL-1 + the EXE-1 non-atomic residual): the claim-first flip, the
--     farm_event/event_locations/quantities inserts, and the issue/release movements are ONE
--     transaction — any failure rolls all of it back automatically, so no app-layer revert is needed
--     and the bin can never be issued without its quantities row.
--   * Idempotency (EXE-1): the claim is `update … where status <> 'done'`; a second/concurrent call
--     affects 0 rows and aborts before any stock moves (the short-transaction lock pattern).
--
-- Mirrors the inventory precedent (fn_post_movement): SECURITY DEFINER, pinned search_path, granted
-- only to authenticated. The operation tables keep their org-only tenant_all policy (no multi-writer
-- breakage — planning/other event capture still write them); the gate lives here.
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
  -- AUTHZ-1: enforce op.execute (the single source of truth) before anything else.
  if not public.authorize('op.execute') then
    raise exception 'forbidden: op.execute is required to execute operations'
      using errcode = '42501';
  end if;

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

  -- org guard: the op must belong to one of the caller's orgs (defence in depth alongside RLS).
  if (select auth.uid()) is not null and v_org not in (select public.user_org_ids()) then
    raise exception 'forbidden: cross-org operation %', p_op_id using errcode = '42501';
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

  -- 2) consume the material: the quantities row + issue stock + release the reservation. Each call is
  --    transactional and part of THIS transaction, so any failure rolls the whole execution back.
  if v_item is not null then
    insert into public.quantities (org_id, event_id, measure, value_num, label, material_id,
                                   inventory_adjustment)
    values (v_org, v_event, 'weight', p_actual_qty, 'كمية مستخدمة', v_item, -p_actual_qty);

    perform public.fn_post_movement(v_item, 'issue', p_actual_qty, 'main', coalesce(v_unit, 'kg'),
                                    null, v_event, v_plan);
    if coalesce(v_req_qty, 0) > 0 then
      perform public.fn_post_movement(v_item, 'release', v_req_qty, 'main', coalesce(v_unit, 'kg'),
                                      null, v_event, v_plan);
    end if;
  end if;

  return jsonb_build_object('event_id', v_event, 'actual_cost', v_actual_cost,
                           'op_id', p_op_id, 'plan_id', v_plan);
end $$;

revoke all on function public.fn_execute_operation(uuid, numeric, int, text) from public;
grant execute on function public.fn_execute_operation(uuid, numeric, int, text) to authenticated;
