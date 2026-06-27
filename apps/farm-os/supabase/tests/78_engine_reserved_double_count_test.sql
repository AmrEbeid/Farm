-- 78 — CHARACTERIZATION of the engine's reserved-stock handling (RESV-1, issue #199). This test PINS
-- the CURRENT behavior — it does NOT assert it is correct. fn_stock_coverage computes
--   available = on_hand − reserved   (migration 0055)
-- AND separately projects every plan_operation with status in (planned,reserved,ready) as a future
-- issue. So when stock is reserved FOR a 'reserved' op, that op's demand is subtracted TWICE: once via
-- bin.reserved (lowering available) and again via the op's projected requirement. bin.reserved and the
-- 'reserved' op status are maintained by SEPARATE paths (fn_reserve_stock posts a reserve movement; it
-- does not set op status), so this double-count is a real, if currently-latent, double subtraction.
--
-- Scenario: on_hand 100, reserved 80, ONE 'reserved' op demanding 80 (safety_stock 0, pack 1).
--   available = 100 − 80 = 20. The op then subtracts 80 again → PAB −60 → a phantom shortage of 60.
--   TRUE intent (reserve already earmarks the op's stock): available 20, no further deficit, recommend 0.
-- The double-count ERRS TOWARD OVER-ORDERING (recommends 60 of phantom stock) — SAFE re non-negotiable
-- #1 (it never masks a shortage), which is why it is deferred to the RESV-1 semantics decision rather
-- than hot-fixed. ⚠️ When RESV-1 is resolved (count the reserved demand ONCE), UPDATE this test: the
-- expected recommend_qty becomes 0 and shortage becomes false. Until then it locks the behavior so an
-- UNINTENDED change to reserved handling is caught. Called as the null-uid service path (like 04/55).
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(3);

\set orgA '00000000-0000-0000-0000-000000000001'
\set item '5e500001-0000-0000-0000-0000000000a1'
\set plan '5e500002-0000-0000-0000-0000000000a2'
\set op   '5e500003-0000-0000-0000-0000000000a3'

insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'item', :'orgA', 'RESV-1 characterization item', 'kg', 1, 0, 0);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved)
  values (:'orgA', :'item', 'main', 100, 80);
insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'draft');
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status)
  values (:'op', :'orgA', :'plan', 'fertilization', date '2026-07-01', 'reserved');
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
  values (:'orgA', :'op', :'item', 80, 'kg');

-- available reflects the reservation ONCE (on_hand 100 − reserved 80 = 20)
select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'available')::numeric, 20::numeric,
  'RESV-1 #199: available = on_hand − reserved = 20');

-- ...but the SAME reserved demand is ALSO projected as the op's issue → a phantom shortage (CURRENT behavior)
select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'shortage')::boolean, true,
  'RESV-1 #199 [CHARACTERIZATION — over-orders, see header]: the reserved op''s demand is double-counted → phantom shortage');

-- recommend_qty sizes the phantom deficit (60) — would be 0 once RESV-1 counts the reserved demand once
select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'recommend_qty')::numeric, 60::numeric,
  'RESV-1 #199 [CHARACTERIZATION]: recommend_qty = 60 (double-counted phantom; becomes 0 when RESV-1 is fixed)');

select * from finish();
rollback;
