-- 16 — ENGINE-DC: the approve→receive round-trip must stay disjoint (migration 0018 invariant).
--
-- Migration 0018 fixed the double-count by making the two supply sources disjoint BY CONSTRUCTION:
--   * on_hand            = Σ(receipt movements)         — received-to-date (fn_bin_rebuild)
--   * forward projection = APPROVED-not-received PRs    — genuinely-future supply (fn_stock_coverage)
-- The whole model hinges on the hand-off at receipt: when a PR is received it flips 'approved'→
-- 'received' (so it LEAVES the projection) at the same moment a receipt movement lands in on_hand.
-- test 14 pins a receipt with no matching PR; test 06/C pins an approved PR projecting forward.
-- This pins the TRANSITION between them — the actual field scenario ("approved a PO, then received
-- it") — which is where a regression would re-introduce the double-count.
--
-- Pristine seed: potash item, on_hand 300, period-1 demand 500 → baseline forward PAB[period 2] = -200.

begin;
select plan(3);

\set orgA '00000000-0000-0000-0000-000000000001'
select set_config('t.item',
  (select id::text from public.inventory_items where org_id = :'orgA' and name ilike '%بوتاس%' limit 1), false);

-- ── baseline: pristine seed, no scheduled supply ────────────────────────────────────────────────
select set_config('t.pab2_base',
  ((public.fn_stock_coverage(current_setting('t.item')::uuid, 'main', 8))->'pab'->>1), false);

-- ── 1) APPROVE a PO for 100 kg needed in period 1 → it must project forward ONCE ────────────────
insert into public.purchase_requests (id, org_id, code, needed_by, status)
  values ('16160000-0000-0000-0000-0000000000a1', :'orgA', 'PR-DC-RT', '2025-07-08', 'approved');
insert into public.purchase_request_items (org_id, pr_id, item_id, qty, unit)
  values (:'orgA', '16160000-0000-0000-0000-0000000000a1', current_setting('t.item')::uuid, 100, 'kg');

select set_config('t.pab2_approved',
  ((public.fn_stock_coverage(current_setting('t.item')::uuid, 'main', 8))->'pab'->>1), false);

select is(
  current_setting('t.pab2_approved')::numeric - current_setting('t.pab2_base')::numeric,
  100::numeric,
  'ENGINE-DC: an approved open PO raises forward PAB by its qty once (not twice)');

-- ── 2) RECEIVE the PO: PR flips approved→received (leaves projection) AND a receipt lands in
--        on_hand. The forward picture must be UNCHANGED — the qty moved source, it did not duplicate.
update public.purchase_requests set status = 'received'
  where id = '16160000-0000-0000-0000-0000000000a1';
insert into public.inventory_movements (org_id, item_id, type, qty, location, occurred_at)
  values (:'orgA', current_setting('t.item')::uuid, 'receipt', 100, 'main', '2025-07-10T00:00:00+00:00');
select public.fn_bin_rebuild(current_setting('t.item')::uuid, 'main');

select is(
  ((public.fn_stock_coverage(current_setting('t.item')::uuid, 'main', 8))->'pab'->>1)::numeric,
  current_setting('t.pab2_approved')::numeric,
  'ENGINE-DC: receiving the PO leaves forward PAB unchanged — on_hand and projection stay disjoint');

-- ── 3) the real period-1 shortage (500 demand vs 400 available) is never masked ─────────────────
select is(
  ((public.fn_stock_coverage(current_setting('t.item')::uuid, 'main', 8))->>'shortage')::boolean,
  true,
  'ENGINE-DC: the receipt does not mask the real period-1 shortage');

select * from finish();
rollback;
