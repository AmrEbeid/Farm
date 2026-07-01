-- 110 — engine masked-shortage regression from #509 (HARD gate, migration 20260701200000). #509 widened the
-- ORIGIN query min(planned_at) to include in_progress/approved ops. A long-running in_progress op with a STALE
-- PAST planned_at then anchors period 1 in the past, shifting genuine near-term demand beyond the horizon
-- filter → its demand is SILENTLY DROPPED → shortage=false while stock is short (cardinal sin, SPEC-0001 #1).
-- The fix clamps the bucket origin to today (greatest(v_period_start, current_date)). Run via
-- test-shims/run-pgtap-local.sh.
begin;
select plan(2);
\set orgA '00000000-0000-0000-0000-000000000001'
\set item 'e2e20001-0000-0000-0000-0000000000e2'
\set plan 'e2e20002-0000-0000-0000-0000000000e2'
\set opA  'e2e20003-0000-0000-0000-0000000000e2'
\set opB  'e2e20004-0000-0000-0000-0000000000e2'
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'item', :'orgA', 'clamp-origin item', 'kg', 1, 0, 0);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved)
  values (:'orgA', :'item', 'main', 300, 0);
insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'active');
-- A: a long-running in_progress op with a STALE PAST planned_at (10 weeks ago), tiny demand. Without the
--    clamp it anchors period 1 ten weeks back.
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status)
  values (:'opA', :'orgA', :'plan', 'fertilization', current_date - 70, 'in_progress');
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
  values (:'orgA', :'opA', :'item', 1, 'kg');
-- B: the REAL near-term demand — 500 kg next week vs 300 on hand → a genuine 200 kg shortage.
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status)
  values (:'opB', :'orgA', :'plan', 'fertilization', current_date + 7, 'planned');
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
  values (:'orgA', :'opB', :'item', 500, 'kg');

-- Without the clamp, opA's past planned_at anchors the origin 10 weeks back → opB (next week) lands in bucket
-- 12 > horizon 8 → its 500 kg is silently dropped → shortage=false (masked). With the clamp → shortage=true.
select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'shortage')::boolean, true,
  'ENGINE-H3: a stale past in_progress op must not push genuine near-term demand past the horizon (no mask)');
select ok(
  (public.fn_stock_coverage(:'item', 'main') ->> 'recommend_qty')::numeric > 0,
  'ENGINE-H3: the near-term 500kg demand drives a non-zero purchase recommendation');

select * from finish();
rollback;
