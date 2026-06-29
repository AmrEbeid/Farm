-- 40 — #184 (ENGINE-REC1) regression: the purchase recommendation must NOT subtract the period-1
-- scheduled receipts a second time. v_pab[t+1] = v_pab[t] - issues[t] + receipts[t] already nets
-- receipts[1], so `v_shortfall + v_ss - receipts[1]` double-counts and can emit the contradictory
-- shortage=true AND recommend_qty=0 (an under-order that leaves the farm short — SPEC-0001 #1). Mig 0040.
--
-- Self-contained + current_date-relative (so the in-window PO is genuinely future under the #270 C2
-- forward-anchor, migration 0094): own item on_hand 300, SS 74, pack 50; a fertilization op TODAY needs
-- 500 → v_period_start = current_date; one approved PO needed_by TODAY (= period 1) for qty 150 that
-- PARTIALLY covers the 200 gap →
--   receipts[1] = 150 → PAB[2] = 300 - 500 + 150 = -50 → shortage=true, first_shortage_period=1, shortfall 50.
--   OLD (buggy): greatest(0, 50 + 74 - 150) = 0  → recommend 0 (the #184 contradiction).
--   NEW (fixed): greatest(0, 50 + 74) = 124 → ceil(124/50)*50 = 150.
-- Run via supabase test db or test-shims/run-pgtap-local.sh.
begin;
select plan(4);

\set orgA '00000000-0000-0000-0000-000000000001'
\set item '40400001-0000-0000-0000-000000000040'
\set plan '40400002-0000-0000-0000-000000000040'
\set op   '40400003-0000-0000-0000-000000000040'
\set pr   '40400004-0000-0000-0000-000000000040'

insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'item', :'orgA', 'REC1 item', 'kg', 50, 74, 0);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved)
  values (:'orgA', :'item', 'main', 300, 0);
insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'approved');
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status)
  values (:'op', :'orgA', :'plan', 'fertilization', current_date, 'planned');
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
  values (:'orgA', :'op', :'item', 500, 'kg');

-- inject a VALID open PO that PARTIALLY covers the shortage: qty 150, needed_by TODAY (= v_period_start,
-- period 1). Triggers off only to construct the approved end-state (born-approved SoD guard blocks a
-- direct approved insert; the same state arises once a requested PR is approved).
set local session_replication_role = replica;
insert into public.purchase_requests (id, org_id, code, requested_by, needed_by, reason, plan_id, status, version)
  values (:'pr', :'orgA', 'PR-PARTIAL-184', gen_random_uuid(), current_date, 'partial-cover approved PO', :'plan', 'approved', 1);
insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit)
  values (:'pr', :'orgA', :'item', 150, 'kg');
set local session_replication_role = origin;

select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'shortage')::boolean, true,
  '#184: a partially-covering in-window PO still leaves a real period-1 shortage (shortage=true)');
select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'first_shortage_period')::int, 1,
  '#184: the shortage is in period 1 (PAB[2] = 300 - 500 + 150 = -50)');
select cmp_ok(
  (public.fn_stock_coverage(:'item', 'main') ->> 'recommend_qty')::numeric, '>', 0::numeric,
  '#184 fix: shortage=true must not coexist with recommend_qty=0 (no double-subtract of receipts[1])');
select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'recommend_qty')::numeric, 150::numeric,
  '#184 fix: recommend_qty = ceil((shortfall 50 + SS 74)/50)*50 = 150 (remaining gap + SS, pack-rounded)');

select * from finish();
rollback;
