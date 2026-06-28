-- 90 — #270 C2 regression: an APPROVED purchase order that is OVERDUE relative to today (its needed_by
-- has passed) and was never received must NOT be projected as guaranteed period-1 supply. If it is, it
-- masks a real shortage — the engine's cardinal sin (SPEC-0001 #1 risk).
--
-- Why test 35 doesn't catch this: #197/test-35 excludes a PO with needed_by < v_period_start, but
-- v_period_start = min(planned_at) and can itself be IN THE PAST. When the plan's only demanding op is
-- past-dated, an overdue PO with needed_by == v_period_start satisfies `needed_by >= v_period_start`
-- (the current receipts filter, 0018/0034/0047) and is counted as supply — even though today is long
-- past its due date and it never arrived. The fix is to anchor the receipts window forward:
-- require `needed_by >= greatest(v_period_start, current_date)` (or anchor the timeline at
-- greatest(min(planned_at), current_date)); when applied, test 35's t3 (which currently asserts
-- shortage=false for a now-past needed_by) must be updated in lockstep.
--
-- Status: the fix is an engine-SQL change owned by the DB/authz lane + an Owner gate (issue #270 was
-- filed-not-fixed to avoid competing migrations). Until it lands, t2 is wrapped in `todo` so this pins
-- the bug WITHOUT failing CI; empirically confirmed FAILING on main fbdd10f (overdue PO masks the
-- shortage). When the engine fix lands, REMOVE the todo wrapper so this becomes a hard gate.
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh. Service/null-uid path (like 04/35/78).
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
  values (:'op', :'orgA', :'plan', 'fertilization', date '2025-08-01', 'planned');
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
  values (:'orgA', :'op', :'item', 500, 'kg');

-- t1: baseline with NO supply — a genuine shortage is reported (need 500, have 300).
select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'shortage')::boolean, true,
  'C2 baseline: 300 on hand vs 500 need → shortage=true');

-- inject an APPROVED PR due 2025-08-01 (= v_period_start, long before today) that NEVER arrived.
-- session_replication_role=replica bypasses the born-approved SoD guard to construct the end-state
-- (the same state arises naturally once an approved PR's needed_by passes).
set local session_replication_role = replica;
insert into public.purchase_requests (id, org_id, code, requested_by, needed_by, reason, plan_id, status, version)
  values (:'pr', :'orgA', 'PR-C2-REG', gen_random_uuid(), date '2025-08-01', 'overdue never-received PO', :'plan', 'approved', 1);
insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit)
  values (:'pr', :'orgA', :'item', 500, 'kg');
set local session_replication_role = origin;

-- t2: the overdue, never-received PO must NOT be projected as supply → shortage stays true.
-- FAILS on main today (engine counts the past-due PO) → wrapped in todo until the forward-anchor fix.
select todo_start('#270 C2 engine forward-anchor fix pending (DB/authz lane + Owner gate)');
select is(
  (public.fn_stock_coverage(:'item', 'main') ->> 'shortage')::boolean, true,
  'C2 #270: an overdue (past-due) never-received PO must NOT mask the shortage');
select todo_end();

select * from finish();
rollback;
