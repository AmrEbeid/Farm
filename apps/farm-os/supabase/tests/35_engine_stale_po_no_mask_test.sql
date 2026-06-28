-- 35 — #197 (ENGINE-STALE-1) regression: an overdue approved PO (needed_by BEFORE the plan window's
-- origin) must NOT be projected as period-1 supply, so it can never mask a real shortage. A PO due
-- within the window (needed_by >= v_period_start) must still count. Migration 0034. Run via `supabase test db`.
--
-- Seed: potassium (39e2…) on_hand 300; the fertilization op (planned_at 2025-07-08) needs 500 →
-- v_period_start = 2025-07-08, shortage 200.

begin;
select plan(3);

\set orgA      '00000000-0000-0000-0000-000000000001'
\set potassium '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4'
\set seedplan  '5d5d302e-c385-5d0b-94f5-3dc2c9948e79'

-- ── t1: baseline — a genuine shortage is reported ──────────────────────────────────────────────────
select is(
  (public.fn_stock_coverage(:'potassium', 'main') ->> 'shortage')::boolean, true,
  '#197 baseline: potassium (300 on hand vs 500 need) reports shortage=true');

-- ── inject a STALE approved PO: qty 500, needed_by 2025-05-01 (BEFORE v_period_start 2025-07-08), never
--    received. Triggers off only to construct the end-state (the born-approved SoD guard would block a
--    direct approved insert; the same state arises naturally once an approved PR's needed_by passes). ──
set local session_replication_role = replica;
insert into public.purchase_requests (id, org_id, code, requested_by, needed_by, reason, plan_id, status, version)
  values ('a0000000-0000-0000-0000-000000000197', :'orgA', 'PR-STALE-197', gen_random_uuid(),
          date '2025-05-01', 'stale approved PO', :'seedplan', 'approved', 1);
insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit)
  values ('a0000000-0000-0000-0000-000000000197', :'orgA', :'potassium', 500, 'kg');
set local session_replication_role = origin;

-- ── t2: the stale PO is EXCLUDED → the shortage is still reported (no masking) ──────────────────────
select is(
  (public.fn_stock_coverage(:'potassium', 'main') ->> 'shortage')::boolean, true,
  '#197 fix: an overdue PO (needed_by < v_period_start) does NOT mask the shortage');

-- ── inject a VALID open PO: qty 500, needed_by 2025-07-08 (= v_period_start, within the window) ─────
set local session_replication_role = replica;
insert into public.purchase_requests (id, org_id, code, requested_by, needed_by, reason, plan_id, status, version)
  values ('b0000000-0000-0000-0000-000000000197', :'orgA', 'PR-VALID-197', gen_random_uuid(),
          date '2025-07-08', 'valid open PO', :'seedplan', 'approved', 1);
insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit)
  values ('b0000000-0000-0000-0000-000000000197', :'orgA', :'potassium', 500, 'kg');
set local session_replication_role = origin;

-- ── t3: #270 C2 forward-anchor — this PO's needed_by (2025-07-08 = v_period_start) is in the PAST
--    relative to today, so it is OVERDUE and no longer projected as guaranteed supply → it does NOT
--    mask the shortage. SUPERSEDES the old #197-era assertion that a needed_by == v_period_start PO
--    always counts: that enshrined C2 whenever the plan window itself is in the past. (Migration 0094:
--    receipts filter is needed_by >= greatest(v_period_start, current_date). A genuinely-future PO of a
--    current plan still counts — see the self-contained current_date setups in tests 16/40/45.)
select is(
  (public.fn_stock_coverage(:'potassium', 'main') ->> 'shortage')::boolean, true,
  '#270 C2: an overdue PO (needed_by < today, even if == v_period_start) does NOT mask the shortage');

select * from finish();
rollback;
