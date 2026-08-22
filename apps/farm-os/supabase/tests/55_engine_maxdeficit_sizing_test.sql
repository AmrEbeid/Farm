-- 55 — #280 F4: the purchase recommendation must cover the DEEPEST projected deficit, not just the
-- first dip below zero. fn_stock_coverage (0047) captured the shortfall only at the first PAB<0 crossing
-- and sized recommend_qty off it; when the deficit deepens later in the horizon the recommendation
-- under-orders and leaves the farm short at the worst point. 0055 tracks v_maxdef (worst deficit
-- anywhere) and sizes off it — a safe direction (v_maxdef >= v_shortfall, so recommend_qty only ever
-- rises). Fresh isolated item so the scenario is independent of seed demand. Called as superuser
-- (null-uid service path), like the other engine tests (04/40/47).
--
-- Scenario (safety_stock 0, pack 1 → recommend_qty = the raw deficit, no rounding noise):
--   avail 100; demand 150 at period 1, 1000 at period 4; no receipts.
--   PAB: [100, -50, -50, -50, -1050, -1050, -1050, -1050]
--   first crossing: period 1, shortfall 50.   worst deficit: 1050 (period 4).
--   OLD recommend_qty = 50 (first dip).        F4 recommend_qty = 1050 (covers the deep shortage).
--
-- Dates are RELATIVE to current_date, never absolute. 0009 bucketed from the plan's own period_start
-- ("deterministic regardless of now()"), so absolute planned_at values were safe; ENGINE-H3
-- (20260701200000) then clamped the bucket origin to today — v_period_start := greatest(min(planned_at),
-- current_date) — a correct masked-shortage fix. Once today moved past a hardcoded planned_at, BOTH ops
-- bucketed to greatest(<=0, 1) = period 1, collapsing the scenario into a single 1150 kg period-1 demand:
-- shortfall reported 1050 instead of 50. Anchoring op1 at current_date makes the clamp a no-op and
-- restores the intended period-1 / period-4 spread.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(4);

\set orgA '00000000-0000-0000-0000-000000000001'
\set item 'f4f40001-0000-0000-0000-0000000000a1'
\set plan 'f4f40002-0000-0000-0000-0000000000a2'
\set op1  'f4f40003-0000-0000-0000-0000000000a3'
\set op2  'f4f40004-0000-0000-0000-0000000000a4'

-- fresh item: safety_stock 0, pack 1 (clean arithmetic)
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'item', :'orgA', 'F4 deepening item', 'kg', 1, 0, 0);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved)
  values (:'orgA', :'item', 'main', 100, 0);

-- a plan with a shallow period-1 demand and a deep period-4 demand
insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'draft');
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status) values
  (:'op1', :'orgA', :'plan', 'fertilization', current_date,      'planned'),   -- origin = period 1
  (:'op2', :'orgA', :'plan', 'fertilization', current_date + 21, 'planned');   -- +21d = period 4
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit) values
  (:'orgA', :'op1', :'item', 150,  'kg'),
  (:'orgA', :'op2', :'item', 1000, 'kg');

-- ===== assertions =====
select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'shortage')::boolean, true,
  '#280 F4: the deepening scenario is a shortage');

select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'first_shortage_period')::int, 1,
  '#280 F4: first_shortage_period is still the FIRST crossing (period 1) — unchanged');

select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'shortfall')::numeric, 50::numeric,
  '#280 F4: shortfall still reports the first-crossing deficit (50), paired with first_shortage_period');

-- the fix: recommend_qty covers the WORST deficit (1050), not the first dip (the OLD engine gave 50)
select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'recommend_qty')::numeric, 1050::numeric,
  '#280 F4: recommend_qty sizes off the deepest deficit (1050+SS0), not the shallow first dip (was 50)');

select * from finish();
rollback;
