-- 102 — engine masked-shortage regression (HARD gate). An operation whose work has STARTED (status
-- 'in_progress') has NOT yet issued its material — fn_execute_operation issues stock only at the
-- execute→'done' flip (EXE-STATUS 0057 lists planned/reserved/ready/in_progress as "proceed normally").
-- So an in_progress op carries real, un-issued material demand. The engine demand filter was
-- ('planned','reserved','ready') — it DROPPED in_progress demand, masking a true shortage (the engine's
-- cardinal sin, SPEC-0001 #1). The fix aligns the filter to the app's LIVE_OP set
-- ('planned','approved','reserved','ready','in_progress'). Run via test-shims/run-pgtap-local.sh.
begin;
select plan(2);
\set orgA '00000000-0000-0000-0000-000000000001'
\set item 'e1e10001-0000-0000-0000-0000000000e1'
\set plan 'e1e10002-0000-0000-0000-0000000000e1'
\set op   'e1e10003-0000-0000-0000-0000000000e1'
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'item', :'orgA', 'in_progress demand item', 'kg', 1, 0, 0);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved)
  values (:'orgA', :'item', 'main', 300, 0);
insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'active');
-- the demanding op has STARTED (in_progress) and needs 500 kg vs 300 on hand → a real 200 kg shortage
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status)
  values (:'op', :'orgA', :'plan', 'fertilization', current_date, 'in_progress');
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
  values (:'orgA', :'op', :'item', 500, 'kg');

select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'shortage')::boolean, true,
  'EXE-MASK: an in_progress op (started, material NOT yet issued) is real demand → shortage=true, not masked');
select ok(
  (public.fn_stock_coverage(:'item', 'main') ->> 'recommend_qty')::numeric > 0,
  'EXE-MASK: in_progress demand drives a non-zero purchase recommendation');

select * from finish();
rollback;
