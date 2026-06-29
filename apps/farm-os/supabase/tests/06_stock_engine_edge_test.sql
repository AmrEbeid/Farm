-- 06 — stock-coverage engine edge cases (SPEC-0001 §2 "Test strategy": on_hand ≥
-- requirement, lead time > horizon, multiple scheduled receipts, multiple demanding
-- ops). Complements 04 (the worked example) and 05 (the security/remediation cases).
-- Test-only: self-contained fixtures in org A, created as the superuser then read as the
-- authenticated owner (the engine is org-scoped). begin/rollback — no committed state.

begin;
select plan(11);

\set orgA '00000000-0000-0000-0000-000000000001'

-- One plan to hang all the demand operations on (status active -> counted by the engine).
insert into public.plans (id, org_id, type, period_start, status)
  values ('cccc0000-0000-0000-0000-00000000e001', :'orgA', 'weekly', current_date, 'active');

-- Helper data: 4 items, each with a bin and (most) a demand op needing material.
-- A: ample stock, no shortage/warning.   B: coverage < a >horizon lead time.
-- C: shortage offset by a scheduled receipt.   D: shortage caused by the 2nd-period op.
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days) values
  ('cccc0000-0000-0000-0000-0000000000a0', :'orgA', 'صنف وفير',        'kg', 1,  60, 5),
  ('cccc0000-0000-0000-0000-0000000000b0', :'orgA', 'صنف مهلة طويلة',  'kg', 1,   0, 70),
  ('cccc0000-0000-0000-0000-0000000000c0', :'orgA', 'صنف بتوريد',      'kg', 1,   0, 5),
  ('cccc0000-0000-0000-0000-0000000000d0', :'orgA', 'صنف عمليتين',     'kg', 50,  0, 5);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved, ordered, projected) values
  (:'orgA','cccc0000-0000-0000-0000-0000000000a0','main',1000,0,0,1000),
  (:'orgA','cccc0000-0000-0000-0000-0000000000b0','main', 100,0,0, 100),
  (:'orgA','cccc0000-0000-0000-0000-0000000000c0','main', 100,0,0, 100),
  (:'orgA','cccc0000-0000-0000-0000-0000000000d0','main', 150,0,0, 150);

-- demand operations (period 1 = 2025-07-08, period 2 = 2025-07-15)
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status) values
  ('cccc0000-0000-0000-0000-0000000a0001', :'orgA','cccc0000-0000-0000-0000-00000000e001','irrigation',current_date,'planned'), -- A
  ('cccc0000-0000-0000-0000-0000000b0001', :'orgA','cccc0000-0000-0000-0000-00000000e001','irrigation',current_date,'planned'), -- B
  ('cccc0000-0000-0000-0000-0000000c0001', :'orgA','cccc0000-0000-0000-0000-00000000e001','irrigation',current_date,'planned'), -- C
  ('cccc0000-0000-0000-0000-0000000d0001', :'orgA','cccc0000-0000-0000-0000-00000000e001','irrigation',current_date,'planned'), -- D op1
  ('cccc0000-0000-0000-0000-0000000d0002', :'orgA','cccc0000-0000-0000-0000-00000000e001','irrigation',(current_date + 7),'planned'); -- D op2
insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit) values
  (:'orgA','cccc0000-0000-0000-0000-0000000a0001','cccc0000-0000-0000-0000-0000000000a0', 50,'kg'),  -- A: 50/wk
  (:'orgA','cccc0000-0000-0000-0000-0000000b0001','cccc0000-0000-0000-0000-0000000000b0',150,'kg'),  -- B: 150 in P1 (> 100 on hand → shortfall 50)
  (:'orgA','cccc0000-0000-0000-0000-0000000c0001','cccc0000-0000-0000-0000-0000000000c0',200,'kg'),  -- C: 200 in P1
  (:'orgA','cccc0000-0000-0000-0000-0000000d0001','cccc0000-0000-0000-0000-0000000000d0',100,'kg'),  -- D: 100 in P1
  (:'orgA','cccc0000-0000-0000-0000-0000000d0002','cccc0000-0000-0000-0000-0000000000d0',100,'kg');  -- D: 100 in P2
-- C's scheduled receipts: 60 in P1, 80 in P2 — modeled as APPROVED purchase requests (open POs).
-- ENGINE-DC (migration 0018): scheduled supply is approved-not-received PRs (future supply, not yet
-- in on_hand) bucketed by needed_by — NOT actual receipt movements (those are already in on_hand, and
-- projecting them double-counted). on_hand and the forward projection stay disjoint by construction.
insert into public.purchase_requests (id, org_id, code, needed_by, status) values
  ('cccc0000-0000-0000-0000-0000000c00a1', :'orgA', 'PR-C-P1', current_date, 'approved'),
  ('cccc0000-0000-0000-0000-0000000c00a2', :'orgA', 'PR-C-P2', (current_date + 7), 'approved');
insert into public.purchase_request_items (org_id, pr_id, item_id, qty, unit) values
  (:'orgA','cccc0000-0000-0000-0000-0000000c00a1','cccc0000-0000-0000-0000-0000000000c0',60,'kg'),
  (:'orgA','cccc0000-0000-0000-0000-0000000c00a2','cccc0000-0000-0000-0000-0000000000c0',80,'kg');

select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='owner'), false);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role','authenticated')::text, true);
set role authenticated;

-- ===== Case A: on_hand (1000) >> requirement → no shortage, no warning, no order =====
select is((public.fn_stock_coverage('cccc0000-0000-0000-0000-0000000000a0','main',8)::jsonb ->> 'recommend_qty')::numeric,
  0::numeric, 'A: ample stock → recommend_qty 0');
select is((public.fn_stock_coverage('cccc0000-0000-0000-0000-0000000000a0','main',8)::jsonb ->> 'shortage')::boolean,
  false, 'A: ample stock → no shortage');
select cmp_ok((public.fn_stock_coverage('cccc0000-0000-0000-0000-0000000000a0','main',8)::jsonb ->> 'coverage_days')::numeric,
  '>', 5::numeric, 'A: coverage_days exceeds the 5-day lead');

-- ===== Case B: coverage (4.7d) < lead time (70d > 8-week horizon) → order flagged today =====
select is((public.fn_stock_coverage('cccc0000-0000-0000-0000-0000000000b0','main',8)::jsonb ->> 'coverage_days')::numeric,
  4.7::numeric, 'B: coverage_days == 4.7 (100 ÷ 150/7)');
select isnt((public.fn_stock_coverage('cccc0000-0000-0000-0000-0000000000b0','main',8)::jsonb ->> 'order_by'),
  null, 'B: coverage < lead → order_by set');
select is((public.fn_stock_coverage('cccc0000-0000-0000-0000-0000000000b0','main',8)::jsonb ->> 'recommend_qty')::numeric,
  50::numeric, 'B: recommend covers the shortfall (50)');

-- ===== Case C: a real period-1 shortage partly offset by an in-period receipt → still order the gap =====
-- on_hand 100, demand 200 in P1, receipts 60 in P1 (80 in P2). PAB[2] = 100 - 200 + 60 = -40 → a REAL
-- period-1 shortage of 40 (the P2 receipt arrives too late for the P1 op). ENGINE-REC1 (#184): the
-- shortfall (40) already nets the P1 receipt via the PAB recurrence, so the recommendation is
-- shortfall + SS = 40 + 0 = 40 (pack 1). The OLD code subtracted receipts[1]=60 a SECOND time —
-- greatest(0, 40 + 0 - 60) = 0 — emitting shortage=true with recommend_qty=0 (the #184 contradiction,
-- an under-order). The corrected oracle is 40.
select is((public.fn_stock_coverage('cccc0000-0000-0000-0000-0000000000c0','main',8)::jsonb ->> 'shortage')::boolean,
  true, 'C: a period-1 PAB dip to -40 is a real shortage (shortage=true)');
select is((public.fn_stock_coverage('cccc0000-0000-0000-0000-0000000000c0','main',8)::jsonb ->> 'recommend_qty')::numeric,
  40::numeric, 'C: ENGINE-REC1 — order the remaining gap (shortfall 40 + SS 0), no double-subtract of receipts[1]');
select is((public.fn_stock_coverage('cccc0000-0000-0000-0000-0000000000c0','main',8)::jsonb -> 'pab' ->> 2)::numeric,
  40::numeric, 'C: PAB recovers to 40 after the 2nd-period receipt (80)');

-- ===== Case D: the 2nd-period op is what tips PAB negative → shortage in period 2 =====
select is((public.fn_stock_coverage('cccc0000-0000-0000-0000-0000000000d0','main',8)::jsonb ->> 'first_shortage_period')::int,
  2, 'D: multi-period demand → first shortage in period 2');
select is((public.fn_stock_coverage('cccc0000-0000-0000-0000-0000000000d0','main',8)::jsonb ->> 'recommend_qty')::numeric,
  50::numeric, 'D: recommend rounds the 50 shortfall up to pack 50');

reset role;
select * from finish();
rollback;
