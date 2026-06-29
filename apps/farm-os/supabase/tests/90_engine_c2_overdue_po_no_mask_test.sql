-- 90 — #270 C2 regression (HARD gate; migration 0094 fixes it). An APPROVED purchase order that is
-- OVERDUE relative to today (needed_by has passed) and never received must NOT be projected as
-- guaranteed period-1 supply — else it masks a real shortage (the engine's cardinal sin, SPEC-0001 #1).
-- Why test 35 didn't catch this: it excludes needed_by < v_period_start, but v_period_start =
-- min(planned_at) can itself be PAST. Migration 0094 changes the receipts filter to
-- `needed_by >= greatest(v_period_start, current_date)`. Run via test-shims/run-pgtap-local.sh.
begin;
select plan(2);
\set orgA '00000000-0000-0000-0000-000000000001'
\set item 'c2c20001-0000-0000-0000-0000000000c2'
\set plan 'c2c20002-0000-0000-0000-0000000000c2'
\set op   'c2c20003-0000-0000-0000-0000000000c2'
\set pr   'c2c20004-0000-0000-0000-0000000000c2'
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'item', :'orgA', 'C2 regression item', 'kg', 1, 0, 0);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved)
  values (:'orgA', :'item', 'main', 300, 0);
insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'approved');
-- the plan's only demanding op is PAST-dated → v_period_start is in the past
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status)
  values (:'op', :'orgA', :'plan', 'fertilization', (current_date - 60), 'planned');
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
  values (:'orgA', :'op', :'item', 500, 'kg');
select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'shortage')::boolean, true,
  'C2 baseline: 300 on hand vs 500 need → shortage=true');
set local session_replication_role = replica;
insert into public.purchase_requests (id, org_id, code, requested_by, needed_by, reason, plan_id, status, version)
  values (:'pr', :'orgA', 'PR-C2-REG', gen_random_uuid(), (current_date - 60), 'overdue never-received PO', :'plan', 'approved', 1);
insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit)
  values (:'pr', :'orgA', :'item', 500, 'kg');
set local session_replication_role = origin;
select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'shortage')::boolean, true,
  'C2 #270: an overdue (past-due) never-received PO must NOT mask the shortage');
select * from finish();
rollback;
