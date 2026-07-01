-- 105 — #512 FIXED (hard gate): fn_execute_operation no longer posts a blind bin-wide `release`
-- (migration 20260701190000). Previously it released v_req_qty unconditionally (0057:108-111), and since
-- `reserved` is a bin-wide aggregate greatest(0, Σreserve − Σrelease) with no plan/op scoping (fn_bin_rebuild
-- 0013), executing an UNRELATED op wiped another op's earmark → the engine over-stated `available` → a masked
-- shortage (SPEC-0001 #1, the cardinal sin). Execute owns no per-op reservation (reserves are item-level
-- coverage earmarks under SEED_PLAN), so removing its release means a real earmark ALWAYS survives an unrelated
-- execute. This test now asserts that survival as a HARD gate (the todo wrapper was removed when the fix
-- landed). Mirrors test 18's fn_execute_operation setup. Run via test-shims/run-pgtap-local.sh.

begin;
select plan(2);

\set orgA '00000000-0000-0000-0000-000000000001'
\set item 'c0000000-0000-0000-0000-000000000512'
\set plan 'c0000000-0000-0000-0000-000000000612'
\set op   'c0000000-0000-0000-0000-000000000712'

select set_config('t.sup', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'supervisor' limit 1), false);

-- Bin holds 200 on hand with 100 EARMARKED (a reserve movement — e.g. another plan-op's committed stock).
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'item', :'orgA', 'صنف #512', 'kg', 1, 0, 0);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved, ordered, projected)
  values (:'orgA', :'item', 'main', 0, 0, 0, 0);
select public.fn_post_movement(:'item', 'receipt', 200, 'main', 'kg');
select public.fn_post_movement(:'item', 'reserve', 100, 'main', 'kg');  -- the earmark that must survive

-- A SEPARATE operation (never reserved anything itself) that needs 100 and is about to be executed.
insert into public.plans (id, org_id, status) values (:'plan', :'orgA', 'active');
insert into public.plan_operations (id, org_id, plan_id, subtype, target_id, est_cost, approval_needed, status)
  values (:'op', :'orgA', :'plan', 'fertilization', null, 0, false, 'ready');
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
  values (:'orgA', :'op', :'item', 100, 'kg');

-- baseline: the earmark is on the books before execution
select is(
  (select reserved from public.inventory_bin where item_id = :'item' and location = 'main'), 100::numeric,
  '#512 baseline: the 100-unit earmark is reserved before the unrelated op executes');

-- execute the UNRELATED op (supervisor). It issues 100 and (after the fix) does NOT release.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.sup'), 'role','authenticated')::text, true);
set local role authenticated;
select set_config('t.ignore', public.fn_execute_operation(:'op', 100, 1, 'exec')::text, false);
reset role;

-- The unrelated op reserved nothing, so the 100-unit earmark MUST survive (no blind release). Hard gate.
select is(
  (select reserved from public.inventory_bin where item_id = :'item' and location = 'main'), 100::numeric,
  '#512: executing an unrelated (never-reserved) op must NOT release the 100-unit earmark');

select * from finish();
rollback;
