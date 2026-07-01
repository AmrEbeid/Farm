-- 112 — #520 (oracle, hard gate): fn_execute_operation must consume EVERY material on a multi-material
-- operation, not just the first by item_id order (migration 20260701230000). Before the fix, an op
-- created via fn_add_plan_operation_multi with several materials had its stock issued, its
-- `quantities` consumption row written, and its actual_cost computed from ONLY ONE material — every
-- other material's stock silently stayed un-decremented. This test builds a 3-material operation
-- directly (mirrors fn_add_plan_operation_multi's own shape) and asserts:
--   (a) all 3 materials get a `quantities` consumption row,
--   (b) on_hand drops for ALL 3 items (not just the first by item_id order),
--   (c) actual_cost reflects contributions from all 3 (the documented proportional-by-value split —
--       see the migration header for the cost-split assumption),
--   (d) a second call on the same op_id still 23505s (idempotency preserved), and
--   (e) an existing SINGLE-material op (the common/legacy case, no p_material_actuals) still executes
--       end-to-end unchanged (byte-identical formula/behaviour to tests/18).
--
-- H1 (adversarial-review CRITICAL, reproduced): plan_material_requirements has NO
-- UNIQUE(plan_op_id, item_id) constraint, and an op can legitimately carry TWO SEPARATE requirement
-- rows for the SAME item (e.g. two applications of the same fertilizer on different sub-dates). An
-- earlier revision matched each requirement row to its actuals entry by item_id with `limit 1`, so
-- both rows resolved to the SAME first-matching actuals entry — silently discarding the other actual
-- quantity and issuing the wrong stock amount. The fix matches by `requirement_id` (the row's own
-- `id`) instead. This file's "duplicate item_id" section proves: on_hand drops by the SUM of both
-- actuals (not just one), TWO separate quantities rows are recorded (not merged), a mismatched/unknown
-- requirement_id in the actuals array is rejected (22023), and a requirement row with no matching
-- actuals entry is rejected (22023).
--
-- H2 (adversarial-review — zero coverage before this file): the central safety refusal (">1 material
-- + no p_material_actuals → 22023") had no test. The "H2" section below proves it via throws_ok.
--
-- TARGET-TYPE (flagged by #566, fixed in this same migration): fn_execute_operation used to write the
-- op's target_id into event_locations.sector_id UNCONDITIONALLY, regardless of target_type — silently
-- wrong for hawsha/farm-scoped ops and actively dangerous for the palm-scoped ops PR #563 introduces
-- (target_id there is an assets.id, not a sector). The "TARGET-TYPE" section below proves: a
-- target_type='hawsha' op populates hawsha_id plus its parent sector/farm — the pre-existing
-- real-world common case, now covered; a target_type='palm' op populates the new asset_id column
-- plus its parent hawsha/sector/farm; a target_type=null op keeps writing sector_id (byte-identical legacy behaviour, since target_type has
-- no CHECK constraint and is null for every op not authored via fn_add_plan_operation(_multi)); and an
-- unrecognized non-null target_type is refused (22023) rather than silently mis-attributing the event.
--
-- Run via test-shims/run-pgtap-local.sh.

begin;
select plan(37);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set item1 'c0000000-0000-0000-0000-000000000112'
\set item2 'c0000000-0000-0000-0000-000000000113'
\set item3 'c0000000-0000-0000-0000-000000000114'
\set item4 'c0000000-0000-0000-0000-000000000115'
\set item5 'c0000000-0000-0000-0000-000000000116'
\set item6 'c0000000-0000-0000-0000-000000000117'
\set item7 'c0000000-0000-0000-0000-000000000118'
\set item8 'c0000000-0000-0000-0000-000000000119'
\set item9 'c0000000-0000-0000-0000-000000000120'
\set plan  'c0000000-0000-0000-0000-000000001112'
\set op    'c0000000-0000-0000-0000-000000002112'
\set op2   'c0000000-0000-0000-0000-000000002113'
\set op3   'c0000000-0000-0000-0000-000000002114'
\set op4   'c0000000-0000-0000-0000-000000002115'
\set op6   'c0000000-0000-0000-0000-000000002117'
\set req1  'd0000000-0000-0000-0000-000000000112'
\set req2  'd0000000-0000-0000-0000-000000000113'
\set req3  'd0000000-0000-0000-0000-000000000114'
\set req4  'd0000000-0000-0000-0000-000000000115'
\set reqA  'd0000000-0000-0000-0000-000000000116'
\set reqB  'd0000000-0000-0000-0000-000000000117'
\set reqC  'd0000000-0000-0000-0000-000000000118'
\set reqD  'd0000000-0000-0000-0000-000000000119'
\set bogusReq 'd0000000-0000-0000-0000-00000000ffff'
\set farm    'e0000000-0000-0000-0000-000000000112'
\set sector  'e0000000-0000-0000-0000-000000000113'
\set hawsha  'e0000000-0000-0000-0000-000000000114'
\set palm    'e0000000-0000-0000-0000-000000000115'
\set opHawsha 'c0000000-0000-0000-0000-000000002118'
\set opPalm   'c0000000-0000-0000-0000-000000002119'
\set opNull   'c0000000-0000-0000-0000-000000002120'
\set opBad    'c0000000-0000-0000-0000-000000002121'

select set_config('t.sup', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'supervisor' limit 1), false);

-- ============================================================================================
-- Fixture: one operation with THREE distinct materials. item1 unit_cost=10 (qty 5 → weight 50),
-- item2 unit_cost=30 (qty 5 → weight 150), item3 has NO unit_cost (qty 5 → weight 0, the documented
-- "unpriced material gets a 0 cost share" fallback case). weight_sum = 200. est_cost = 400 splits
-- 25% / 75% / 0% → est_cost_i = 100 / 300 / 0.
-- ============================================================================================
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days, unit_cost) values
  (:'item1', :'orgA', 'صنف 112-1', 'kg', 1, 0, 0, 10),
  (:'item2', :'orgA', 'صنف 112-2', 'kg', 1, 0, 0, 30),
  (:'item3', :'orgA', 'صنف 112-3', 'kg', 1, 0, 0, null),
  (:'item4', :'orgA', 'صنف 112-4', 'kg', 1, 0, 0, 20),
  (:'item5', :'orgA', 'صنف 112-5', 'kg', 1, 0, 0, 5),
  (:'item6', :'orgA', 'صنف 112-6', 'kg', 1, 0, 0, 5),
  (:'item7', :'orgA', 'صنف 112-7', 'kg', 1, 0, 0, 8),
  (:'item8', :'orgA', 'صنف 112-8', 'kg', 1, 0, 0, 8),
  (:'item9', :'orgA', 'صنف 112-9', 'kg', 1, 0, 0, 8);

insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved, ordered, projected) values
  (:'orgA', :'item1', 'main', 0, 0, 0, 0),
  (:'orgA', :'item2', 'main', 0, 0, 0, 0),
  (:'orgA', :'item3', 'main', 0, 0, 0, 0),
  (:'orgA', :'item4', 'main', 0, 0, 0, 0),
  (:'orgA', :'item5', 'main', 0, 0, 0, 0),
  (:'orgA', :'item6', 'main', 0, 0, 0, 0),
  (:'orgA', :'item7', 'main', 0, 0, 0, 0),
  (:'orgA', :'item8', 'main', 0, 0, 0, 0),
  (:'orgA', :'item9', 'main', 0, 0, 0, 0);
select public.fn_post_movement(:'item1', 'receipt', 1000, 'main', 'kg');
select public.fn_post_movement(:'item2', 'receipt', 1000, 'main', 'kg');
select public.fn_post_movement(:'item3', 'receipt', 1000, 'main', 'kg');
select public.fn_post_movement(:'item4', 'receipt', 1000, 'main', 'kg');
select public.fn_post_movement(:'item5', 'receipt', 1000, 'main', 'kg');
select public.fn_post_movement(:'item6', 'receipt', 1000, 'main', 'kg');
select public.fn_post_movement(:'item7', 'receipt', 500, 'main', 'kg');
select public.fn_post_movement(:'item8', 'receipt', 500, 'main', 'kg');
select public.fn_post_movement(:'item9', 'receipt', 500, 'main', 'kg');

insert into public.plans (id, org_id, status) values (:'plan', :'orgA', 'active');

insert into public.plan_operations (id, org_id, plan_id, subtype, target_id, est_cost, approval_needed, status)
  values (:'op', :'orgA', :'plan', 'fertilization', null, 400, false, 'reserved');
insert into public.plan_material_requirements (id, org_id, plan_op_id, item_id, qty, unit) values
  (:'req1', :'orgA', :'op', :'item1', 5, 'kg'),
  (:'req2', :'orgA', :'op', :'item2', 5, 'kg'),
  (:'req3', :'orgA', :'op', :'item3', 5, 'kg');

-- a SECOND op with exactly one material — the common/legacy case (mirrors tests/18's fixture).
insert into public.plan_operations (id, org_id, plan_id, subtype, target_id, est_cost, approval_needed, status)
  values (:'op2', :'orgA', :'plan', 'fertilization', null, 500, false, 'reserved');
insert into public.plan_material_requirements (id, org_id, plan_op_id, item_id, qty, unit)
  values (:'req4', :'orgA', :'op2', :'item4', 25, 'kg');

-- ===== execute the 3-material op (supervisor holds op.execute) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select set_config('t.res', public.fn_execute_operation(
  :'op', 0, 3, 'تنفيذ متعدد المواد',
  jsonb_build_array(
    jsonb_build_object('requirement_id', :'req1', 'item_id', :'item1', 'actual_qty', 5),
    jsonb_build_object('requirement_id', :'req2', 'item_id', :'item2', 'actual_qty', 10),
    jsonb_build_object('requirement_id', :'req3', 'item_id', :'item3', 'actual_qty', 2)
  ))::text, false);
reset role;
select set_config('t.event', (current_setting('t.res')::jsonb ->> 'event_id'), false);

-- (c) actual_cost reflects ALL THREE materials: 5×(100/5) + 10×(300/5) + 2×(0/5) = 100 + 600 + 0 = 700
select is(((current_setting('t.res')::jsonb)->>'actual_cost')::numeric, 700::numeric,
  '#520: actual_cost sums contributions from all 3 materials (100 + 600 + 0), not just the first');

-- (b) on_hand dropped for ALL THREE items — the pre-fix code only issued the first by item_id order.
select is((select on_hand from public.inventory_bin where item_id = :'item1' and location = 'main'), 995::numeric,
  '#520: item1 on_hand issued (1000 − 5)');
select is((select on_hand from public.inventory_bin where item_id = :'item2' and location = 'main'), 990::numeric,
  '#520: item2 on_hand issued (1000 − 10) — was silently skipped before the fix');
select is((select on_hand from public.inventory_bin where item_id = :'item3' and location = 'main'), 998::numeric,
  '#520: item3 on_hand issued (1000 − 2) — was silently skipped before the fix');

-- (a) all 3 materials got a quantities consumption row, each against its OWN item.
select is((select count(*)::int from public.quantities where event_id = current_setting('t.event', true)::uuid), 3,
  '#520: 3 quantities consumption rows recorded (one per material), not 1');
select is((select inventory_adjustment from public.quantities
  where event_id = current_setting('t.event', true)::uuid and material_id = :'item1'), -5::numeric,
  '#520: item1 consumption row records -5');
select is((select inventory_adjustment from public.quantities
  where event_id = current_setting('t.event', true)::uuid and material_id = :'item2'), -10::numeric,
  '#520: item2 consumption row records -10 (would be MISSING entirely before the fix)');
select is((select inventory_adjustment from public.quantities
  where event_id = current_setting('t.event', true)::uuid and material_id = :'item3'), -2::numeric,
  '#520: item3 consumption row records -2 (would be MISSING entirely before the fix)');

select is((select status from public.plan_operations where id = :'op'), 'done',
  '#520: the multi-material operation is marked done');
select is(jsonb_array_length((select data -> 'material_actuals' from public.farm_event
  where id = current_setting('t.event', true)::uuid)), 3,
  '#520: farm_event.data.material_actuals carries all 3 materials');

-- (d) idempotency: a second execute on the SAME op is refused, and does NOT double-issue anything.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_execute_operation(%L, 0, 3, 'again',
    jsonb_build_array(jsonb_build_object('requirement_id', %L::uuid, 'item_id', %L::uuid, 'actual_qty', 5))) $$,
    :'op', :'req1', :'item1'),
  '23505', null,
  '#520 EXE-1: a second fn_execute_operation on the multi-material op is refused (already executed)');
reset role;
select is((select on_hand from public.inventory_bin where item_id = :'item1' and location = 'main'), 995::numeric,
  '#520: the refused retry did not double-issue item1 (on_hand unchanged)');

-- ===== (e) legacy single-material op: unchanged end-to-end behaviour (no p_material_actuals) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select set_config('t.res2', public.fn_execute_operation(:'op2', 50, 2, 'ملاحظة')::text, false);
reset role;
select set_config('t.event2', (current_setting('t.res2')::jsonb ->> 'event_id'), false);

select is(((current_setting('t.res2')::jsonb)->>'actual_cost')::numeric, 1000::numeric,
  '#520 legacy: single-material actual_cost = 50 × (500/25) = 1000, unchanged formula');
select is((select on_hand from public.inventory_bin where item_id = :'item4' and location = 'main'), 950::numeric,
  '#520 legacy: item4 on_hand issued (1000 − 50)');
select is((select count(*)::int from public.quantities where event_id = current_setting('t.event2', true)::uuid), 1,
  '#520 legacy: exactly 1 quantities row (single-material op)');
select is((select inventory_adjustment from public.quantities
  where event_id = current_setting('t.event2', true)::uuid and material_id = :'item4'), -50::numeric,
  '#520 legacy: item4 consumption row records -50');
select is((select status from public.plan_operations where id = :'op2'), 'done',
  '#520 legacy: the single-material operation is marked done');
select is(((select data ->> 'actual_qty' from public.farm_event
  where id = current_setting('t.event2', true)::uuid))::numeric, 50::numeric,
  '#520 legacy: farm_event.data.actual_qty scalar preserved for the 0/1-material case');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_execute_operation('%s'::uuid, 50, 2, 'again') $$, :'op2'),
  '23505', null,
  '#520 legacy: a second execute on the single-material op is still refused (already executed)');
reset role;

-- ============================================================================================
-- H1 regression — TWO plan_material_requirements rows for the SAME item_id on one op (item5,
-- qty 5 and qty 20 — e.g. two applications of the same fertilizer on different sub-dates). Before
-- the fix, matching by item_id with `limit 1` made BOTH rows resolve to the SAME first actuals entry:
-- on_hand would only drop by 10 (double-counting the qty-5 actual), never 25. Matching by
-- requirement_id (each row's own primary key) fixes this.
-- ============================================================================================
insert into public.plan_operations (id, org_id, plan_id, subtype, target_id, est_cost, approval_needed, status)
  values (:'op3', :'orgA', :'plan', 'fertilization', null, 100, false, 'reserved');
insert into public.plan_material_requirements (id, org_id, plan_op_id, item_id, qty, unit) values
  (:'reqA', :'orgA', :'op3', :'item5', 5, 'kg'),
  (:'reqB', :'orgA', :'op3', :'item5', 20, 'kg');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select set_config('t.res3', public.fn_execute_operation(
  :'op3', 0, 1, 'H1 regression: two requirements, same item',
  jsonb_build_array(
    jsonb_build_object('requirement_id', :'reqA', 'item_id', :'item5', 'actual_qty', 5),
    jsonb_build_object('requirement_id', :'reqB', 'item_id', :'item5', 'actual_qty', 20)
  ))::text, false);
reset role;
select set_config('t.event3', (current_setting('t.res3')::jsonb ->> 'event_id'), false);

-- (a) on_hand for item5 drops by the SUM of both actuals (25), not just one (10 would mean the
-- pre-fix double-count-the-first bug is back).
select is((select on_hand from public.inventory_bin where item_id = :'item5' and location = 'main'), 975::numeric,
  '#520 H1: on_hand for the shared item drops by the SUM of both requirements'' actuals (1000 − 25), not just one');

-- (b) TWO separate quantities rows are recorded (one per requirement row), not merged into one.
select is((select count(*)::int from public.quantities where event_id = current_setting('t.event3', true)::uuid), 2,
  '#520 H1: two separate quantities rows recorded (one per requirement), not merged into one');
select is((select array_agg(inventory_adjustment order by inventory_adjustment)
  from public.quantities where event_id = current_setting('t.event3', true)::uuid),
  array[-20, -5]::numeric[],
  '#520 H1: the two quantities rows carry -5 and -20 respectively — neither actual was discarded or double-applied');

select is((select status from public.plan_operations where id = :'op3'), 'done',
  '#520 H1: the duplicate-item-id operation is marked done');

-- (c) a mismatched/unknown requirement_id in the actuals array is rejected (22023), never silently
-- ignored — even though the array length still matches the op's material count.
insert into public.plan_operations (id, org_id, plan_id, subtype, target_id, est_cost, approval_needed, status)
  values (:'op4', :'orgA', :'plan', 'fertilization', null, 100, false, 'reserved');
insert into public.plan_material_requirements (id, org_id, plan_op_id, item_id, qty, unit) values
  (:'reqC', :'orgA', :'op4', :'item6', 5, 'kg'),
  (:'reqD', :'orgA', :'op4', :'item6', 20, 'kg');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_execute_operation(%L, 0, 1, 'H1 mismatched requirement_id',
    jsonb_build_array(
      jsonb_build_object('requirement_id', %L::uuid, 'item_id', %L::uuid, 'actual_qty', 5),
      jsonb_build_object('requirement_id', %L::uuid, 'item_id', %L::uuid, 'actual_qty', 20)
    )) $$,
    :'op4', :'reqC', :'item6', :'bogusReq', :'item6'),
  '22023', null,
  '#520 H1(c): an actuals entry with a requirement_id that is not one of this op''s rows is rejected (22023)');
reset role;

-- (d) a requirement row with NO matching actuals entry is rejected (22023) — same array length, but
-- one entry is a duplicate of another requirement_id instead of covering the missing row.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_execute_operation(%L, 0, 1, 'H1 missing requirement actuals',
    jsonb_build_array(
      jsonb_build_object('requirement_id', %L::uuid, 'item_id', %L::uuid, 'actual_qty', 5),
      jsonb_build_object('requirement_id', %L::uuid, 'item_id', %L::uuid, 'actual_qty', 7)
    )) $$,
    :'op4', :'reqC', :'item6', :'reqC', :'item6'),
  '22023', null,
  '#520 H1(d): a requirement row with no matching actuals entry (reqD never referenced) is rejected (22023)');
reset role;

-- both rejected attempts above must roll back cleanly: no stock issued, op4 never flipped to done.
select is((select on_hand from public.inventory_bin where item_id = :'item6' and location = 'main'), 1000::numeric,
  '#520 H1: the two rejected op4 attempts issued NO stock (on_hand untouched)');
select is((select status from public.plan_operations where id = :'op4'), 'reserved',
  '#520 H1: op4 was never claimed/marked done by either rejected attempt');

-- ============================================================================================
-- H2 — the central safety refusal has zero test coverage before this file: a >1-material operation
-- executed WITHOUT p_material_actuals must be refused (22023), never silently executed against a
-- guessed/partial material.
-- ============================================================================================
insert into public.plan_operations (id, org_id, plan_id, subtype, target_id, est_cost, approval_needed, status)
  values (:'op6', :'orgA', :'plan', 'fertilization', null, 300, false, 'reserved');
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit) values
  (:'orgA', :'op6', :'item7', 5, 'kg'),
  (:'orgA', :'op6', :'item8', 5, 'kg'),
  (:'orgA', :'op6', :'item9', 5, 'kg');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_execute_operation(%L, 5, 1, 'H2: no p_material_actuals supplied') $$, :'op6'),
  '22023', null,
  '#520 H2: a >1-material op executed WITHOUT p_material_actuals is refused (22023), not silently executed');
reset role;

select is((select on_hand from public.inventory_bin where item_id = :'item7' and location = 'main'), 500::numeric,
  '#520 H2: the refused call issued no stock for item7');
select is((select status from public.plan_operations where id = :'op6'), 'reserved',
  '#520 H2: the refused call left op6 unclaimed (still reserved, not done)');

-- ============================================================================================
-- TARGET-TYPE (#566) — event_locations must populate the column matching target_type, never a blind
-- sector_id. Zero-material ops (no p_material_actuals needed) isolate the event_locations behaviour
-- cleanly from the material-consumption logic already covered above.
-- ============================================================================================
insert into public.farms (id, org_id, name, code) values (:'farm', :'orgA', 'مزرعة 112', 'F112');
insert into public.sectors (id, org_id, farm_id, name, code)
  values (:'sector', :'orgA', :'farm', 'قطاع 112', 'S112');
insert into public.hawshat (id, org_id, sector_id, name, code)
  values (:'hawsha', :'orgA', :'sector', 'حوشة 112', 'H112');
insert into public.assets (id, org_id, type, hawsha_id, sector_id, name)
  values (:'palm', :'orgA', 'palm', :'hawsha', :'sector', 'نخلة 112');

-- (i) target_type='hawsha' — the real-world common case (fn_add_plan_operation_multi's actual
-- default today) — must populate hawsha_id, NOT sector_id.
insert into public.plan_operations (id, org_id, plan_id, subtype, target_type, target_id, est_cost, approval_needed, status)
  values (:'opHawsha', :'orgA', :'plan', 'inspection', 'hawsha', :'hawsha', 0, false, 'reserved');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select set_config('t.resH', public.fn_execute_operation(:'opHawsha', 0, 0, 'hawsha target')::text, false);
reset role;
select set_config('t.eventH', (current_setting('t.resH')::jsonb ->> 'event_id'), false);
select is((select hawsha_id from public.event_locations where event_id = current_setting('t.eventH', true)::uuid),
  :'hawsha'::uuid, '#566: target_type=hawsha populates event_locations.hawsha_id');
select is((select sector_id from public.event_locations where event_id = current_setting('t.eventH', true)::uuid),
  :'sector'::uuid, '#566: target_type=hawsha rolls up the parent sector_id');

-- (ii) target_type='palm' — PR #563's shape: target_id is an assets.id, not a sector. Must populate
-- the new asset_id column, NOT sector_id (the pre-fix bug this migration closes).
insert into public.plan_operations (id, org_id, plan_id, subtype, target_type, target_id, est_cost, approval_needed, status)
  values (:'opPalm', :'orgA', :'plan', 'inspection', 'palm', :'palm', 0, false, 'reserved');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select set_config('t.resP', public.fn_execute_operation(:'opPalm', 0, 0, 'palm target')::text, false);
reset role;
select set_config('t.eventP', (current_setting('t.resP')::jsonb ->> 'event_id'), false);
select is((select asset_id from public.event_locations where event_id = current_setting('t.eventP', true)::uuid),
  :'palm'::uuid, '#566: target_type=palm populates the new event_locations.asset_id (not sector_id)');
select is((select sector_id from public.event_locations where event_id = current_setting('t.eventP', true)::uuid),
  :'sector'::uuid, '#566: target_type=palm rolls up the parent sector_id, not the palm id');

-- (iii) target_type=null — legacy/unspecified (no CHECK constraint; every pre-existing test/caller
-- never sets it) — must keep the EXACT pre-existing behaviour: sector_id = target_id. Byte-identical
-- to tests/18's fixture shape (target_type omitted entirely).
insert into public.plan_operations (id, org_id, plan_id, subtype, target_id, est_cost, approval_needed, status)
  values (:'opNull', :'orgA', :'plan', 'inspection', :'sector', 0, false, 'reserved');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select set_config('t.resN', public.fn_execute_operation(:'opNull', 0, 0, 'null target_type')::text, false);
reset role;
select set_config('t.eventN', (current_setting('t.resN')::jsonb ->> 'event_id'), false);
select is((select sector_id from public.event_locations where event_id = current_setting('t.eventN', true)::uuid),
  :'sector'::uuid, '#566 legacy: target_type=null still populates sector_id (unchanged pre-existing behaviour)');

-- (iv) an unrecognized, non-null target_type must be refused loudly (22023), never silently
-- mis-writing a column or silently doing nothing.
insert into public.plan_operations (id, org_id, plan_id, subtype, target_type, target_id, est_cost, approval_needed, status)
  values (:'opBad', :'orgA', :'plan', 'inspection', 'planet', :'sector', 0, false, 'reserved');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_execute_operation(%L, 0, 0, 'bad target_type') $$, :'opBad'),
  '22023', null,
  '#566: an unrecognized non-null target_type is refused (22023), never silently mis-attributed');
reset role;
select is((select status from public.plan_operations where id = :'opBad'), 'reserved',
  '#566: the refused unrecognized-target_type call left opBad unclaimed (still reserved, not done)');

select * from finish();
rollback;
