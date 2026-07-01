-- Farm OS — #520 (code-map review): fn_execute_operation only ever consumed ONE material.
--
-- THE BUG: fn_add_plan_operation_multi (0093) lets an operation carry SEVERAL materials, but
-- fn_execute_operation (re-emitted most recently at 20260701190000, #512) loaded the requirement with
-- `... from plan_material_requirements where plan_op_id = p_op_id order by item_id limit 1` — ONE row.
-- Executing a multi-material op therefore issued stock for only the FIRST material (by item_id order),
-- derived actual_cost from only that one material, wrote only one `quantities` consumption row, and
-- silently left every OTHER material's stock un-decremented and un-consumed. This does not mask a
-- *future* shortage (the cardinal sin, SPEC-0001 §1 — under-reporting a shortage), but it corrupts
-- actual on-hand accounting going forward: on_hand stays too HIGH for the skipped materials, which can
-- eventually make the engine believe more stock exists than really does.
--
-- THE FIX: accept the actuals for ALL of the op's materials and loop every
-- plan_material_requirements row, never just the first.
--
-- CONTRACT CHANGE — new param `p_material_actuals jsonb default null`, shaped like
-- fn_add_plan_operation_multi's `p_materials` (an array of `{"item_id": "...", "actual_qty": ...}`).
-- Appended LAST with a default so the existing 4-positional-arg call shape (used by tests 18/26/58 and
-- today's client) keeps resolving to the SAME function — this is a signature change (a 5th parameter),
-- so the exact-signature catalog probes in tests/19 are updated to match, but no EXISTING caller has to
-- change how it invokes the RPC.
--
-- BACKWARD COMPATIBILITY (the deliberately least-risky choice, per the review): when
-- p_material_actuals is null/empty —
--   • the op has 0 materials  → unchanged: no consumption/issue at all, actual_cost = est_cost.
--   • the op has EXACTLY 1 material → the legacy scalar p_actual_qty is treated as that one material's
--     actual (byte-identical to the pre-existing behaviour/tests — this remains the common case's UX).
--   • the op has >1 materials → REFUSED (22023). Guessing which material a bare scalar belongs to would
--     risk mis-issuing stock against the wrong item; a loud, explicit error is safer than a silent guess.
-- p_actual_qty is still validated unconditionally (unchanged input hygiene), but once
-- p_material_actuals is supplied its value is authoritative for cost/consumption; p_actual_qty is then
-- vestigial (kept only because it is a required, non-defaulted positional parameter).
--
-- COST-SPLIT ASSUMPTION (a judgment call — flagged prominently for review): `est_cost` lives on the
-- OPERATION, not per material, so a multi-material op's total est_cost must be divided across its
-- materials to price each one's actual consumption. This migration splits it PROPORTIONALLY by each
-- material's `qty (planned) × inventory_items.unit_cost` share when that pricing data is available
-- (sum of shares > 0); when it is NOT available (no material on the op has a priced unit_cost, or their
-- planned qty is 0) it falls back to an EVEN split across the materials. This is the simplest defensible
-- rule, not a precise costing model — a material with no unit_cost gets a $0 share of the proportional
-- split (it still gets its stock correctly issued; only the cost attribution is approximate). For an op
-- with a single material this formula collapses EXACTLY to the pre-existing
-- `actual_qty × (est_cost ÷ planned_qty)` computation (share = 1), so the common case's numbers are
-- unchanged.
--
-- PER-MATERIAL WORK: for every plan_material_requirements row on the op — validate its actual_qty is
-- present, non-negative and finite (mirrors the existing 22023 convention), insert its OWN `quantities`
-- consumption row, and call fn_post_movement('issue', ...) against ITS OWN item_id (never a combined/
-- summed quantity across different items). `data.material_actuals` on the farm_event now carries the
-- per-material breakdown; the legacy scalar `data.actual_qty` is preserved for the 0/1-material case
-- (null for >1 materials, where a single scalar has no coherent meaning) so existing readers of the
-- single-material shape (the PvA report) keep working unchanged for the common case.
--
-- ATOMICITY / IDEMPOTENCY: unchanged. The whole per-material loop runs inside this same function body
-- (one implicit Postgres transaction, no sub-transactions/savepoints) AFTER the claim-first
-- `update ... where status <> 'done'` guard, so a retried/duplicate call still 23505s before touching
-- any material, and either every material is issued + the op flips to done, or (on any error) the whole
-- execution rolls back and NONE are. authorize('op.execute', ...), the cross-org guard, and the
-- EXE-STATUS terminal-status guard are re-emitted verbatim (untouched). #512's "no blind release" fix
-- (this function owns no per-op reservation) is preserved as-is.
--
-- Validation: pgTAP 112 (new oracle, define-check-first) + full harness; tests 18/19/26/30/58 updated
-- only where the signature literal changed (19) — their assertions are otherwise unchanged.
--
-- SIGNATURE-CHANGE FOOTGUN: `create or replace function` does NOT replace a function whose parameter
-- list differs — Postgres would instead CREATE A NEW OVERLOAD, leaving the pre-existing 4-arg
-- `fn_execute_operation(uuid, numeric, int, text)` (with its LIMIT-1 body) callable side-by-side with
-- the new 5-arg one. An explicit DROP of the old signature is required before the create-or-replace
-- below, or the bug this migration fixes would remain reachable.
drop function if exists public.fn_execute_operation(uuid, numeric, int, text);

create or replace function public.fn_execute_operation(
  p_op_id uuid,
  p_actual_qty numeric,
  p_labor_count int,
  p_note text default null,
  p_material_actuals jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid; v_plan uuid; v_subtype text; v_target uuid; v_est numeric; v_status text;
  v_person uuid; v_event uuid; v_actual_cost numeric; v_now timestamptz := now();
  v_claimed int;
  v_mat_count int;
  v_actuals jsonb;
  v_weight_sum numeric := 0;
  v_result_actuals jsonb := '[]'::jsonb;
  v_legacy_actual_qty numeric;
  v_rec record;
  v_actual_i numeric;
  v_weight_i numeric;
  v_share_i numeric;
  v_est_i numeric;
  v_cost_i numeric;
  v_mat_json jsonb;
  v_item_i uuid;
begin
  -- B4: range-check inputs (a negative actual_qty would otherwise RAISE on_hand via the issue path).
  -- Validated unconditionally for input hygiene, even though its value is only authoritative in the
  -- 0/1-material (legacy) path once p_material_actuals is supplied — see header comment.
  if p_actual_qty is null or p_actual_qty < 0 then
    raise exception 'invalid actual_qty: %', p_actual_qty using errcode = '22023';
  end if;
  if p_labor_count is null or p_labor_count < 0 then
    raise exception 'invalid labor_count: %', p_labor_count using errcode = '22023';
  end if;

  -- the operation (material requirements are loaded separately below, AFTER the claim, so the
  -- LIMIT-1 masking bug cannot recur: every row on the op is read, not just one).
  select po.org_id, po.plan_id, po.subtype, po.target_id, po.est_cost, po.status
    into v_org, v_plan, v_subtype, v_target, v_est, v_status
    from public.plan_operations po
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

  -- how many materials does this op actually carry?
  select count(*) into v_mat_count from public.plan_material_requirements where plan_op_id = p_op_id;

  -- Resolve the per-material actuals to use, honouring the backward-compatibility contract above.
  if p_material_actuals is not null and jsonb_typeof(p_material_actuals) = 'array'
     and jsonb_array_length(p_material_actuals) > 0 then
    v_actuals := p_material_actuals;
  elsif v_mat_count = 0 then
    v_actuals := '[]'::jsonb;
  elsif v_mat_count = 1 then
    -- legacy fallback: the op's one material takes the scalar p_actual_qty (unchanged behaviour).
    select jsonb_build_array(jsonb_build_object('item_id', pmr.item_id, 'actual_qty', p_actual_qty))
      into v_actuals
      from public.plan_material_requirements pmr
      where pmr.plan_op_id = p_op_id;
  else
    -- >1 materials and no per-material actuals supplied: refuse rather than guess which material the
    -- bare scalar belongs to (never silently mis-issue any of them).
    raise exception 'operation % has % materials; p_material_actuals is required', p_op_id, v_mat_count
      using errcode = '22023';
  end if;

  -- a supplied array must cover EXACTLY the op's materials (catches a stray/mismatched item_id loudly
  -- rather than silently under-consuming one material or over-consuming a wrong one).
  if jsonb_array_length(v_actuals) <> v_mat_count then
    raise exception 'operation % expects % material actuals, got %',
      p_op_id, v_mat_count, jsonb_array_length(v_actuals)
      using errcode = '22023';
  end if;

  -- actual cost = actual qty × the plan's unit rate (est_cost ÷ planned qty); B3. When the op has
  -- multiple materials, est_cost is split across them first (see the COST-SPLIT ASSUMPTION above);
  -- for 0/1 materials this reduces to the pre-existing formula exactly (share = 1). Default (0
  -- materials) mirrors the original: the full est_cost, unattached to any consumption.
  v_actual_cost := coalesce(v_est, 0);

  if v_mat_count > 0 then
    -- pass 1: the pricing weight sum, so every material's share can be computed in pass 2.
    select coalesce(sum(pmr.qty * coalesce(ii.unit_cost, 0)), 0)
      into v_weight_sum
      from public.plan_material_requirements pmr
      join public.inventory_items ii on ii.id = pmr.item_id
      where pmr.plan_op_id = p_op_id;

    v_actual_cost := 0;

    -- pass 2: one iteration per material — validate, price, consume (quantities + fn_post_movement).
    for v_rec in
      select pmr.item_id, pmr.qty, pmr.unit
        from public.plan_material_requirements pmr
        where pmr.plan_op_id = p_op_id
        order by pmr.item_id
    loop
      select (elem->>'actual_qty')::numeric into v_actual_i
        from jsonb_array_elements(v_actuals) elem
        where (elem->>'item_id')::uuid = v_rec.item_id
        limit 1;

      if v_actual_i is null or v_actual_i < 0 or v_actual_i = 'NaN'::numeric then
        raise exception 'invalid actual_qty % for material %', v_actual_i, v_rec.item_id
          using errcode = '22023';
      end if;

      -- this material's share of est_cost: proportional by qty×unit_cost when priced, else even split.
      v_weight_i := v_rec.qty * coalesce((select unit_cost from public.inventory_items where id = v_rec.item_id), 0);
      v_share_i := case when v_weight_sum > 0 then v_weight_i / v_weight_sum else 1.0 / v_mat_count end;
      v_est_i := coalesce(v_est, 0) * v_share_i;
      v_cost_i := case when coalesce(v_rec.qty, 0) > 0
                    then trim_scale(v_actual_i * (v_est_i / v_rec.qty))
                    else trim_scale(v_est_i)
                  end;
      v_actual_cost := v_actual_cost + v_cost_i;

      -- the done farm_event is inserted AFTER this loop (needs v_event); the consumption row below
      -- references v_event, so materials are recorded once v_event exists — see below.
      v_result_actuals := v_result_actuals || jsonb_build_array(jsonb_build_object(
        'item_id', v_rec.item_id, 'unit', v_rec.unit, 'planned_qty', v_rec.qty,
        'actual_qty', v_actual_i, 'actual_cost', v_cost_i));
    end loop;

    v_actual_cost := trim_scale(v_actual_cost);
  end if;

  -- legacy scalar mirror of actual_qty on the farm_event: coherent only for 0/1 materials (matches the
  -- pre-existing single-value shape the PvA report already reads); null for >1 (no single number is
  -- meaningful across different materials/units) — the report reads `material_actuals` for those.
  v_legacy_actual_qty := case when v_mat_count <= 1 then p_actual_qty else null end;

  -- the actor's person row (nullable), for performed_by_person_id
  select id into v_person from public.people
    where user_id = (select auth.uid()) and org_id = v_org limit 1;

  -- 1) the done farm_event (actuals embedded for the PvA report). occurred_at = now() → routes to the
  --    farm_event_default partition for dates outside the seed months.
  insert into public.farm_event (org_id, type, subtype, status, occurred_at, planned_at,
                                 performed_by_person_id, plan_id, notes, data)
  values (v_org, 'operation', v_subtype, 'done', v_now, v_now, v_person, v_plan, p_note,
          jsonb_build_object('labor_count', p_labor_count, 'actual_qty', v_legacy_actual_qty,
                             'actual_cost', v_actual_cost, 'op_id', p_op_id,
                             'material_actuals', v_result_actuals))
  returning id into v_event;

  insert into public.event_locations (event_id, org_id, sector_id) values (v_event, v_org, v_target);

  -- 2) consume EVERY material: one quantities row PER material + one fn_post_movement issue PER
  --    material against ITS OWN item_id (never combined/summed across items). Sourced straight from
  --    v_result_actuals (already validated + priced in pass 2 above) rather than re-parsing v_actuals,
  --    so there is exactly one place that maps the caller's input onto per-material actuals. Each call
  --    is transactional and part of THIS transaction, so any failure rolls the whole execution back.
  -- #512: NO `release` here. Execute owns no per-op reservation (reserves are item-level coverage
  -- earmarks under SEED_PLAN), so a blind bin-wide release wiped unrelated ops' earmarks → masked their
  -- shortage. The earmark is released by an attributed release-on-receipt, NOT here.
  for v_mat_json in select value from jsonb_array_elements(v_result_actuals)
  loop
    v_item_i := (v_mat_json->>'item_id')::uuid;
    v_actual_i := (v_mat_json->>'actual_qty')::numeric;

    insert into public.quantities (org_id, event_id, measure, value_num, label, material_id,
                                   inventory_adjustment)
    values (v_org, v_event, 'weight', v_actual_i, 'كمية مستخدمة', v_item_i, -v_actual_i);

    perform public.fn_post_movement(v_item_i, 'issue', v_actual_i, 'main',
                                    coalesce(v_mat_json->>'unit', 'kg'), null, v_event, v_plan);
  end loop;

  return jsonb_build_object('event_id', v_event, 'actual_cost', v_actual_cost,
                           'op_id', p_op_id, 'plan_id', v_plan);
end $$;

-- Grants: unchanged intent (authenticated only, no anon/public), re-stated for the new 5-arg
-- signature (the OLD 4-arg overload was explicitly DROPPED above, so it cannot linger with its
-- stale LIMIT-1 body and stale grants).
revoke all     on function public.fn_execute_operation(uuid, numeric, int, text, jsonb) from public;
revoke execute on function public.fn_execute_operation(uuid, numeric, int, text, jsonb) from anon;
grant  execute on function public.fn_execute_operation(uuid, numeric, int, text, jsonb) to authenticated;
