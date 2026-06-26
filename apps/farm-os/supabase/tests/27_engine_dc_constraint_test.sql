-- 27 — ENGINE-DC: a DB-level guard enforces the engine's disjointness invariant (migration 0026).
--
-- Migration 0018 made the stock-coverage engine's two supply sources disjoint BY CONVENTION:
--   * on_hand            = Σ(receipt movements)         — received-to-date     (fn_bin_rebuild)
--   * forward projection = APPROVED-not-received PRs     — genuinely-future supply (fn_stock_coverage)
-- Tests 14/16 pin the engine arithmetic. This pins the new DB CONTROL (migration 0026): a BEFORE
-- INSERT trigger on inventory_movements rejects a `receipt` posted while an approved (needed_by-bearing)
-- purchase request for the same (org, item) is still open — the exact double-count state, where the qty
-- would sit in on_hand AND be projected forward. Full finding:
-- SECURITY-FINDING-engine-receipt-doublecount-2026-06-25.md.
--
-- Asserts: (a) the trigger exists; (b) the LEGITIMATE approve→receive roundtrip via fn_post_receipt
-- still succeeds (it flips the PR 'received' before posting, so no open PO remains); (c) a receipt with
-- NO matching PR (opening stock / manual adjustment) still succeeds; (d) an approved PR with a NULL
-- needed_by is not projected by the engine, so a receipt against it is NOT blocked; (e) the
-- double-count/orphan state — a direct receipt while an approved needed_by PR is still open — is
-- REJECTED (errcode 23514); and (f) a non-receipt movement (issue) is never gated by this guard.
-- Run via `supabase test db`.

begin;
-- 7 assertions below; the plan said 8 (an off-by-one the false-green harness hid — no
-- 8th assertion exists in this file). Matched to the actual count.
select plan(7);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set itemA 'c0000000-0000-0000-0000-000000000027'
\set itemB 'c0000000-0000-0000-0000-000000000127'
\set itemC 'c0000000-0000-0000-0000-000000000227'
\set prA   'ccab2727-2727-2727-2727-ccab27272727'
\set prC   'ccab2728-2728-2728-2728-ccab27282728'

-- ===== the trigger is installed on inventory_movements =====
select ok(
  exists (select 1 from pg_trigger
            where tgname = 'inv_guard_receipt_no_open_po'
              and tgrelid = 'public.inventory_movements'::regclass
              and not tgisinternal),
  '0026: the inv_guard_receipt_no_open_po BEFORE INSERT trigger is installed');

-- fixtures: three clean items + bins at on_hand 0.
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'itemA', :'orgA', 'صنف دي-سي أ', 'kg', 1, 0, 5),
         (:'itemB', :'orgA', 'صنف دي-سي ب', 'kg', 1, 0, 5),
         (:'itemC', :'orgA', 'صنف دي-سي ج', 'kg', 1, 0, 5);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved, ordered, projected)
  values (:'orgA', :'itemA', 'main', 0, 0, 0, 0),
         (:'orgA', :'itemB', 'main', 0, 0, 0, 0),
         (:'orgA', :'itemC', 'main', 0, 0, 0, 0);

-- ── (c) a receipt with NO matching PR (opening stock / manual adjustment) is allowed ─────────────
insert into public.inventory_movements (org_id, item_id, type, qty, unit, location, occurred_at)
  values (:'orgA', :'itemB', 'receipt', 70, 'kg', 'main', '2025-07-10T00:00:00+00:00');
select public.fn_bin_rebuild(:'itemB', 'main');
select is((select on_hand from public.inventory_bin where item_id = :'itemB' and location='main'),
  70::numeric, 'ENGINE-DC: a receipt with no open PO is allowed (on_hand 0 → 70)');

-- ── (f) a non-receipt movement (issue) is never gated by this guard ──────────────────────────────
select lives_ok(
  format($$ insert into public.inventory_movements (org_id, item_id, type, qty, unit, location)
            values ('%s', '%s', 'issue', 10, 'kg', 'main') $$, :'orgA', :'itemB'),
  'ENGINE-DC: a non-receipt movement (issue) is not gated by the guard');

-- ── (e) the double-count state: an APPROVED needed_by PR open + a direct receipt → REJECTED ───────
-- Set up the open PO as superuser (the insert-side SoD guard, migration 0023, blocks a born-approved
-- PR for a real authenticated caller — same precedent as test 23).
insert into public.purchase_requests (id, org_id, code, needed_by, status)
  values (:'prA', :'orgA', 'PR-DC27A', '2025-07-08', 'approved');
insert into public.purchase_request_items (org_id, pr_id, item_id, qty, unit)
  values (:'orgA', :'prA', :'itemA', 100, 'kg');

select throws_ok(
  format($$ insert into public.inventory_movements (org_id, item_id, type, qty, unit, location, occurred_at)
            values ('%s', '%s', 'receipt', 100, 'kg', 'main', '2025-07-10T00:00:00+00:00') $$,
         :'orgA', :'itemA'),
  '23514', null,
  'ENGINE-DC: a receipt is REJECTED while an approved (needed_by) PO for the item is still open');
-- and the rejected receipt left nothing behind
select is((select on_hand from public.inventory_bin where item_id = :'itemA' and location='main'),
  0::numeric, 'ENGINE-DC: the rejected receipt posted nothing (on_hand still 0)');

-- ── (b) the LEGITIMATE roundtrip: flip the PO approved→received first, then the receipt is allowed.
--        This is exactly what fn_post_receipt does claim-first, so the field path is unaffected.
update public.purchase_requests set status = 'received' where id = :'prA';
insert into public.inventory_movements (org_id, item_id, type, qty, unit, location, occurred_at)
  values (:'orgA', :'itemA', 'receipt', 100, 'kg', 'main', '2025-07-10T00:00:00+00:00');
select public.fn_bin_rebuild(:'itemA', 'main');
select is((select on_hand from public.inventory_bin where item_id = :'itemA' and location='main'),
  100::numeric,
  'ENGINE-DC: once the PO is received (approved→received), the receipt is allowed (on_hand 0 → 100)');

-- ── (d) an APPROVED PR with a NULL needed_by is NOT projected by the engine → receipt NOT blocked ─
-- fn_stock_coverage only projects PRs with needed_by is not null, so such a PR cannot double-count;
-- the guard mirrors that condition and must let the receipt through.
insert into public.purchase_requests (id, org_id, code, needed_by, status)
  values (:'prC', :'orgA', 'PR-DC27C', null, 'approved');
insert into public.purchase_request_items (org_id, pr_id, item_id, qty, unit)
  values (:'orgA', :'prC', :'itemC', 40, 'kg');
select lives_ok(
  format($$ insert into public.inventory_movements (org_id, item_id, type, qty, unit, location)
            values ('%s', '%s', 'receipt', 40, 'kg', 'main') $$, :'orgA', :'itemC'),
  'ENGINE-DC: an approved PR with NULL needed_by (not projected) does not block a receipt');

select * from finish();
rollback;
