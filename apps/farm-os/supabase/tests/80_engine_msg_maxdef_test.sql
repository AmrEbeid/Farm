-- 80 — engine display fix (0078): the coverage WARNING message must show the deficit consistent with
-- the recommend_qty sizing basis. Since 0055 (#280 F4) recommend_qty is sized off v_maxdef (the DEEPEST
-- projected deficit in the horizon), but the Arabic v_msg printed v_shortfall (the FIRST/shallowest dip).
-- 0078 changes ONLY the v_msg display to trim_scale(greatest(v_shortfall, v_maxdef)) so the predicted
-- shortage shown matches what is being ordered. recommend_qty and all JSON outputs are unchanged.
--
-- Reuses the deepening scenario from test 55 (independent fresh item):
--   avail 100; demand 150 at period 1, 1000 at period 4; safety_stock 0, pack 1.
--   PAB: [100, -50, -50, -50, -1050, ...]   first crossing 50 (period 1); worst deficit 1050 (period 4).
--   message_ar must now print «نقص متوقع: 1050 كجم …» (the maxdef shortfall), NOT the shallow 50.
--   The 'shortfall' JSON field stays 50 (first crossing) — display-only change, no behavior change.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(3);

\set orgA '00000000-0000-0000-0000-000000000001'
\set item 'f8f80001-0000-0000-0000-0000000000b1'
\set plan 'f8f80002-0000-0000-0000-0000000000b2'
\set op1  'f8f80003-0000-0000-0000-0000000000b3'
\set op2  'f8f80004-0000-0000-0000-0000000000b4'

insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'item', :'orgA', 'msg-maxdef deepening item', 'kg', 1, 0, 0);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved)
  values (:'orgA', :'item', 'main', 100, 0);

insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'draft');
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status) values
  (:'op1', :'orgA', :'plan', 'fertilization', date '2026-07-01', 'planned'),
  (:'op2', :'orgA', :'plan', 'fertilization', date '2026-07-22', 'planned');  -- +21d = period 4
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit) values
  (:'orgA', :'op1', :'item', 150,  'kg'),
  (:'orgA', :'op2', :'item', 1000, 'kg');

-- ===== assertions =====
-- recommend_qty unchanged: still sized off the deepest deficit (1050).
select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'recommend_qty')::numeric, 1050::numeric,
  '0078: recommend_qty unchanged — still covers the deepest deficit (1050)');

-- the fix: the message now shows the maxdef shortfall (1050), matching what is ordered.
select ok(
  (public.fn_stock_coverage(:'item', 'main') ->> 'message_ar') like '%نقص متوقع: 1050 كجم%',
  '0078: message_ar shows the max-deficit shortfall (1050 كجم), consistent with recommend_qty');

-- 'shortfall' JSON field is unchanged (still the first crossing) — display-only change.
select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'shortfall')::numeric, 50::numeric,
  '0078: shortfall JSON field unchanged — still the first-crossing deficit (50)');

select * from finish();
rollback;
