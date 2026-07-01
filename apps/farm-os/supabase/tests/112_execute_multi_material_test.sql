-- 112 — #520 (oracle, hard gate): fn_execute_operation must consume EVERY material on a multi-material
-- operation, not just the first by item_id order (migration 20260701220000). Before the fix, an op
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
-- Run via test-shims/run-pgtap-local.sh.

begin;
select plan(19);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set item1 'c0000000-0000-0000-0000-000000000112'
\set item2 'c0000000-0000-0000-0000-000000000113'
\set item3 'c0000000-0000-0000-0000-000000000114'
\set item4 'c0000000-0000-0000-0000-000000000115'
\set plan  'c0000000-0000-0000-0000-000000001112'
\set op    'c0000000-0000-0000-0000-000000002112'
\set op2   'c0000000-0000-0000-0000-000000002113'

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
  (:'item4', :'orgA', 'صنف 112-4', 'kg', 1, 0, 0, 20);

insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved, ordered, projected) values
  (:'orgA', :'item1', 'main', 0, 0, 0, 0),
  (:'orgA', :'item2', 'main', 0, 0, 0, 0),
  (:'orgA', :'item3', 'main', 0, 0, 0, 0),
  (:'orgA', :'item4', 'main', 0, 0, 0, 0);
select public.fn_post_movement(:'item1', 'receipt', 1000, 'main', 'kg');
select public.fn_post_movement(:'item2', 'receipt', 1000, 'main', 'kg');
select public.fn_post_movement(:'item3', 'receipt', 1000, 'main', 'kg');
select public.fn_post_movement(:'item4', 'receipt', 1000, 'main', 'kg');

insert into public.plans (id, org_id, status) values (:'plan', :'orgA', 'active');

insert into public.plan_operations (id, org_id, plan_id, subtype, target_id, est_cost, approval_needed, status)
  values (:'op', :'orgA', :'plan', 'fertilization', null, 400, false, 'reserved');
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit) values
  (:'orgA', :'op', :'item1', 5, 'kg'),
  (:'orgA', :'op', :'item2', 5, 'kg'),
  (:'orgA', :'op', :'item3', 5, 'kg');

-- a SECOND op with exactly one material — the common/legacy case (mirrors tests/18's fixture).
insert into public.plan_operations (id, org_id, plan_id, subtype, target_id, est_cost, approval_needed, status)
  values (:'op2', :'orgA', :'plan', 'fertilization', null, 500, false, 'reserved');
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
  values (:'orgA', :'op2', :'item4', 25, 'kg');

-- ===== execute the 3-material op (supervisor holds op.execute) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select set_config('t.res', public.fn_execute_operation(
  :'op', 0, 3, 'تنفيذ متعدد المواد',
  jsonb_build_array(
    jsonb_build_object('item_id', :'item1', 'actual_qty', 5),
    jsonb_build_object('item_id', :'item2', 'actual_qty', 10),
    jsonb_build_object('item_id', :'item3', 'actual_qty', 2)
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
    jsonb_build_array(jsonb_build_object('item_id', %L::uuid, 'actual_qty', 5))) $$,
    :'op', :'item1'),
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

select * from finish();
rollback;
