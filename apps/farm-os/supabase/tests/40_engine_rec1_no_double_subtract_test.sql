-- 40 — #184 (ENGINE-REC1) regression: the purchase recommendation must NOT subtract the period-1
-- scheduled receipts a second time. The shortfall read off the PAB recurrence
--   v_pab[t+1] = v_pab[t] - issues[t] + receipts[t]
-- ALREADY nets receipts[1], so doing `v_shortfall + v_ss - receipts[1]` double-counts and can emit the
-- contradictory output shortage=true AND recommend_qty=0 (an under-order that leaves the farm short in
-- the field — SPEC-0001 #1 risk). Migration 0040. Run via `supabase test db`.
--
-- Seed: سلفات بوتاسيوم (39e2…) on_hand 300; the fertilization op (planned_at 2025-07-08) needs 500 →
-- v_period_start = 2025-07-08; safety_stock 74; pack_size 50.
--
-- Scenario: inject ONE approved, in-window PO (needed_by 2025-07-08 = period 1) for qty 150 that
-- PARTIALLY covers the 200 gap. Then:
--   receipts[1] = 150 → PAB[2] = 300 - 500 + 150 = -50  → shortage=true, first_shortage_period=1,
--   shortfall = 50.
--   OLD (buggy) recommend: greatest(0, shortfall 50 + SS 74 - receipts 150) = 0  → recommend_qty 0
--                          (shortage=true yet "order nothing" — the #184 contradiction).
--   NEW (fixed)  recommend: greatest(0, shortfall 50 + SS 74) = 124 → ceil(124/50)*50 = 150
--                          = the true remaining gap + safety stock, pack-rounded.

begin;
select plan(4);

\set orgA      '00000000-0000-0000-0000-000000000001'
\set potassium '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4'
\set seedplan  '5d5d302e-c385-5d0b-94f5-3dc2c9948e79'

-- ── inject a VALID open PO that PARTIALLY covers the shortage: qty 150, needed_by 2025-07-08
--    (= v_period_start, period 1). Triggers off only to construct the approved end-state (the
--    born-approved SoD guard blocks a direct approved insert; the same state arises naturally once a
--    requested PR is approved). Mirrors test 35's injection harness. ──────────────────────────────────
set local session_replication_role = replica;
insert into public.purchase_requests (id, org_id, code, requested_by, needed_by, reason, plan_id, status, version)
  values ('c0000000-0000-0000-0000-000000000184', :'orgA', 'PR-PARTIAL-184', gen_random_uuid(),
          date '2025-07-08', 'partial-cover approved PO', :'seedplan', 'approved', 1);
insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit)
  values ('c0000000-0000-0000-0000-000000000184', :'orgA', :'potassium', 150, 'kg');
set local session_replication_role = origin;

-- ── t1: the shortage is still real (period-1 PAB = -50) — the partial PO does NOT clear it ──────────
select is(
  (public.fn_stock_coverage(:'potassium', 'main') ->> 'shortage')::boolean, true,
  '#184: a partially-covering in-window PO still leaves a real period-1 shortage (shortage=true)');

-- ── t2: first shortage is period 1 ─────────────────────────────────────────────────────────────────
select is(
  (public.fn_stock_coverage(:'potassium', 'main') ->> 'first_shortage_period')::int, 1,
  '#184: the shortage is in period 1 (PAB[2] = 300 - 500 + 150 = -50)');

-- ── t3: the FIX — recommend_qty is > 0 (the OLD double-subtract gave 0 alongside shortage=true) ─────
select cmp_ok(
  (public.fn_stock_coverage(:'potassium', 'main') ->> 'recommend_qty')::numeric, '>', 0::numeric,
  '#184 fix: shortage=true must not coexist with recommend_qty=0 (no double-subtract of receipts[1])');

-- ── t4: recommend_qty equals the true remaining gap (50) + safety stock (74) = 124, pack-rounded
--        to the next 50 → 150. NOT 0 (old bug) and NOT 300 (the no-PO recommendation). ───────────────
select is(
  (public.fn_stock_coverage(:'potassium', 'main') ->> 'recommend_qty')::numeric, 150::numeric,
  '#184 fix: recommend_qty = ceil((shortfall 50 + SS 74)/50)*50 = 150 (remaining gap + SS, pack-rounded)');

select * from finish();
rollback;
