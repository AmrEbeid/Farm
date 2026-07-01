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
-- CONTRACT CHANGE — new param `p_material_actuals jsonb default null`, an array of
-- `{"requirement_id": "...", "item_id": "...", "actual_qty": ...}` — one entry PER
-- plan_material_requirements ROW on the op. Appended LAST with a default so the existing
-- 4-positional-arg call shape (used by tests 18/26/58 and today's client) keeps resolving to the SAME
-- function — this is a signature change (a 5th parameter), so the exact-signature catalog probes in
-- tests/19 are updated to match, but no EXISTING caller has to change how it invokes the RPC.
--
-- MATCH KEY — `requirement_id` (= plan_material_requirements.id), NOT `item_id`: an operation can
-- legitimately carry TWO SEPARATE plan_material_requirements rows for the SAME item_id (e.g. two
-- applications of the same fertilizer on different sub-dates within a multi-day operation) — there is
-- no `UNIQUE(plan_op_id, item_id)` constraint and none is being added here (duplicate-item rows are
-- valid input, not an edge case to reject). An earlier revision of this migration matched each
-- requirement row to its actuals entry by `item_id` with `limit 1`; when two rows shared an item_id,
-- BOTH resolved to the same first-matching actuals entry, silently discarding the other actual quantity
-- and issuing the wrong stock amount (reproduced: two requirement rows qty 5/20 same item + actuals
-- [5,20] → on_hand only dropped by 10, double-counting the first, instead of 25). `id` is the
-- requirement row's own primary key, so it uniquely identifies one planned-material-need row
-- regardless of how many rows share an item_id — that is the correct, and now the ONLY, match key used
-- below. `item_id` is still carried in each actuals entry/output for debuggability, but is never used
-- to resolve which requirement row an actual belongs to.
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
-- PER-MATERIAL WORK: for every plan_material_requirements row on the op — matched to its actuals entry
-- by `requirement_id` (= the row's own `id`), NEVER by `item_id` (see MATCH KEY above) — validate its
-- actual_qty is present, non-negative and finite (mirrors the existing 22023 convention), insert its
-- OWN `quantities` consumption row, and call fn_post_movement('issue', ...) against ITS OWN item_id
-- (never a combined/summed quantity across different items). A requirement row with no matching
-- actuals entry (missing/wrong requirement_id) raises 22023 rather than silently defaulting/skipping;
-- a mismatched/stale/cross-op requirement_id in the actuals array is rejected the same way (it can
-- never match one of THIS op's rows, so the row it was meant for is left unmatched → 22023). `data.
-- material_actuals` on the farm_event now carries the per-material breakdown (including each row's
-- requirement_id); the legacy scalar `data.actual_qty` is preserved for the 0/1-material case (null for
-- >1 materials, where a single scalar has no coherent meaning) so existing readers of the
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
--
-- ADDITIONAL FIX (flagged by #566 while building read-only KPI queries, out of that PR's scope —
-- not yet merged, so not fixed there): the `event_locations` insert below unconditionally wrote the
-- op's target_id as `sector_id`, regardless of what `plan_operations.target_type` actually is. This
-- is silently wrong today whenever target_type is `hawsha`/`farm` (target_id is not a sector id in
-- those cases — the row picks up a `sector_id` that resolves to a WRONG or nonexistent sector) and
-- would be actively dangerous once PR #563 (`feat/individual-palm-treatment`, open) merges: it
-- introduces `target_type='palm'` operations whose target_id is an `assets.id` (a specific palm),
-- not a sector — blindly writing that into `sector_id` would either violate the `sector_id` FK (if
-- the palm id doesn't happen to collide with a real sector id — normal case) or, worse, silently
-- attribute the event to whatever unrelated sector that uuid happens to match (pathological but not
-- impossible across tables). Fixed by making the insert target_type-aware: a `case` on target_type
-- populates ONLY the matching event_locations column, leaving the others null. `event_locations` has
-- no palm/asset-level column yet (it was never needed before #563), so this migration adds one
-- (`asset_id`, FK to `assets(id)`, nullable, sibling to the existing farm_id/sector_id/hawsha_id/
-- line_id — same pattern `assets` itself already uses for its own farm/sector/hawsha/line columns).
--
-- BACKWARD COMPATIBILITY: `target_type` has no CHECK constraint and is NULL in every existing test
-- fixture and in any op not authored via fn_add_plan_operation(_multi) (which is the only place that
-- sets it, always to a real value via `coalesce(scope_type, 'sector')`). NULL is therefore a
-- legitimate "unspecified target" state, not just a test-fixture gap — this fix preserves the
-- EXACT pre-existing behaviour for it (write target_id into sector_id), so every existing test
-- (which never sets target_type) is byte-identical. Only a NON-null, unrecognized target_type now
-- raises loudly (22023) rather than silently mis-writing a column — per the non-negotiable of never
-- fabricating/guessing which structure level a target belongs to.
alter table public.event_locations add column if not exists asset_id uuid references public.assets(id);
create index if not exists event_locations_asset_idx on public.event_locations(asset_id);

-- RLS re-emit (mirrors the #306 cross-org-FK residual pattern from 20260622000064, tests/74's
-- invariant): a member-writable nullable FK to an org-scoped table must be same-org-validated in the
-- table's WITH CHECK, or tests/74 fails loudly. asset_id is added to the SAME clause list that
-- farm_id/sector_id/hawsha_id/line_id already use here — every other predicate (org_id, op.execute,
-- the parent-event EXISTS) is carried over VERBATIM from 20260622000064, unchanged.
drop policy if exists tenant_all on public.event_locations;
create policy tenant_all on public.event_locations for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('op.execute', org_id)
    and exists (select 1 from public.farm_event e where e.id = event_locations.event_id and e.org_id = event_locations.org_id)
    and (event_locations.farm_id is null
         or exists (select 1 from public.farms f where f.id = event_locations.farm_id and f.org_id = event_locations.org_id))
    and (event_locations.sector_id is null
         or exists (select 1 from public.sectors s where s.id = event_locations.sector_id and s.org_id = event_locations.org_id))
    and (event_locations.hawsha_id is null
         or exists (select 1 from public.hawshat h where h.id = event_locations.hawsha_id and h.org_id = event_locations.org_id))
    and (event_locations.line_id is null
         or exists (select 1 from public.lines l where l.id = event_locations.line_id and l.org_id = event_locations.org_id))
    and (event_locations.asset_id is null
         or exists (select 1 from public.assets a where a.id = event_locations.asset_id and a.org_id = event_locations.org_id))
  );

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
  v_target_type text;
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
  select po.org_id, po.plan_id, po.subtype, po.target_id, po.target_type, po.est_cost, po.status
    into v_org, v_plan, v_subtype, v_target, v_target_type, v_est, v_status
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
    -- requirement_id is still populated (= that one row's id) so this flows through the SAME
    -- requirement_id-keyed matching loop below as the explicit multi-material path.
    select jsonb_build_array(jsonb_build_object(
        'requirement_id', pmr.id, 'item_id', pmr.item_id, 'actual_qty', p_actual_qty))
      into v_actuals
      from public.plan_material_requirements pmr
      where pmr.plan_op_id = p_op_id;
  else
    -- >1 materials and no per-material actuals supplied: refuse rather than guess which material the
    -- bare scalar belongs to (never silently mis-issue any of them).
    raise exception 'operation % has % materials; p_material_actuals is required', p_op_id, v_mat_count
      using errcode = '22023';
  end if;

  -- a supplied array must cover EXACTLY the op's materials (catches a stray/mismatched requirement_id
  -- loudly rather than silently under-consuming one material or over-consuming a wrong one; a length
  -- mismatch alone isn't sufficient on its own — the per-row match below also rejects a same-length
  -- array whose requirement_ids don't correspond 1:1 to this op's rows).
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
    -- Ordered by pmr.id (the row's own identity), not item_id — deterministic even when two rows
    -- share an item_id (see the MATCH KEY note in the header).
    for v_rec in
      select pmr.id as req_id, pmr.item_id, pmr.qty, pmr.unit
        from public.plan_material_requirements pmr
        where pmr.plan_op_id = p_op_id
        order by pmr.id
    loop
      -- Match this REQUIREMENT ROW (not this item) to its actuals entry by requirement_id. `id` is
      -- plan_material_requirements' primary key, so `limit 1` is safe here (at most one row in
      -- v_actuals can carry a given requirement_id, unlike item_id which can repeat across rows).
      select (elem->>'actual_qty')::numeric into v_actual_i
        from jsonb_array_elements(v_actuals) elem
        where (elem->>'requirement_id')::uuid = v_rec.req_id
        limit 1;

      if v_actual_i is null or v_actual_i < 0 or v_actual_i = 'NaN'::numeric then
        -- No actuals entry has THIS row's requirement_id — either it was simply omitted, or the
        -- caller supplied a stale/mismatched/cross-op requirement_id that (correctly) cannot match
        -- any row here. Either way: refuse loudly rather than silently skipping/mis-issuing.
        raise exception 'invalid actual_qty % for material requirement %', v_actual_i, v_rec.req_id
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
        'requirement_id', v_rec.req_id, 'item_id', v_rec.item_id, 'unit', v_rec.unit,
        'planned_qty', v_rec.qty, 'actual_qty', v_actual_i, 'actual_cost', v_cost_i));
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

  -- event_locations: populate ONLY the column matching the op's actual target_type, never a blind
  -- sector_id (see the migration header — this is the fix for the bug #566 flagged). v_target_type
  -- is null for every op authored before target_type existed / not authored via
  -- fn_add_plan_operation(_multi) — that legacy/unspecified state keeps the exact pre-existing
  -- behaviour (sector_id) so no existing caller/test regresses. A non-null, unrecognized
  -- target_type is refused loudly rather than guessing a column (never fabricate/mis-attribute).
  -- Same-org validation of target_id against its structure table already happens at authoring time
  -- (fn_add_plan_operation_multi validates a supplied palm target's org before insert; sector/hawsha
  -- targets are plan-scope-derived from the plan's own org) — re-validating here would be redundant
  -- defence-in-depth, not a closed gap; the FK on each event_locations column (sector_id/hawsha_id/
  -- line_id/asset_id all reference their own org-scoped table) still catches a nonexistent target_id
  -- outright even if authoring-time validation were ever bypassed.
  -- NOTE: a simple `case v_target_type when ...` cannot match NULL (`x = NULL` is never true in SQL),
  -- so NULL is handled as its own explicit branch via a searched CASE (`case when ... is null`),
  -- not folded into the simple form above.
  case
    when v_target_type is null then
      insert into public.event_locations (event_id, org_id, sector_id) values (v_event, v_org, v_target);
    when v_target_type = 'farm' then
      insert into public.event_locations (event_id, org_id, farm_id) values (v_event, v_org, v_target);
    when v_target_type = 'sector' then
      insert into public.event_locations (event_id, org_id, sector_id) values (v_event, v_org, v_target);
    when v_target_type = 'hawsha' then
      insert into public.event_locations (event_id, org_id, hawsha_id) values (v_event, v_org, v_target);
    when v_target_type = 'line' then
      insert into public.event_locations (event_id, org_id, line_id) values (v_event, v_org, v_target);
    when v_target_type = 'palm' then
      insert into public.event_locations (event_id, org_id, asset_id) values (v_event, v_org, v_target);
    else
      raise exception 'operation % has unrecognized target_type %', p_op_id, v_target_type
        using errcode = '22023';
  end case;

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
