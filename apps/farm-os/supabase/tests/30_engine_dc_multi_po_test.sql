-- 30 — ENGINE-DC fix: the disjointness guard must be PR-scoped in effect, not item-scoped (0029).
--
-- Migration 0026's BEFORE INSERT trigger rejects a receipt whenever ANY approved + needed_by PR exists
-- for the SAME (org, item). That is item-scoped: it cannot see the PR boundary. With TWO approved POs
-- for one item (a supported scenario — tests/06 models it: multiple scheduled receipts in different
-- periods), fn_post_receipt receives ONE PO at a time — it flips only that PR approved→received, then
-- posts its receipt. The OTHER PO is still 'approved', so the item-scoped guard FIRES on the first
-- PO's own receipt → BOTH POs become un-receivable (a deadlock on a legitimate, modeled state).
--
-- Migration 0029 gates the guard to the trusted RPC: fn_post_receipt sets a txn-local GUC and the
-- trigger skips the item-scoped check for receipts it posts (fn_post_receipt maintains disjointness by
-- the claim-first flip — the received PR has already left the forward projection; any other approved
-- PO is genuinely-future supply, correctly still projected, NOT a double-count). Out-of-band/direct
-- receipts stay fully guarded, so the original double-count hole (SPEC-0001 #1) stays closed.
--
-- Asserts:
--   (1) FALSE POSITIVE FIXED: two approved POs for one item → receive one via fn_post_receipt SUCCEEDS,
--       on_hand reflects exactly that PO, the received PR flips to 'received', the other stays open.
--   (1b) the second PO is then receivable too (the deadlock is fully gone, both ends).
--   (2) HOLE STAYS CLOSED: a direct/out-of-band receipt while an approved needed_by PO is open is still
--       REJECTED (errcode 23514) — fn_post_receipt's trust marker does not leak to direct inserts.
--   (3) a normal single-PO receipt via fn_post_receipt still works.
-- Run via `supabase test db`.

begin;
select plan(8);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set itemX 'c0000000-0000-0000-0000-000000000030'
\set itemY 'c0000000-0000-0000-0000-000000000130'
\set pr1   'ccab3030-3030-3030-3030-ccab30303001'
\set pr2   'ccab3030-3030-3030-3030-ccab30303002'
\set prY   'ccab3030-3030-3030-3030-ccab30303009'

-- A storekeeper has inventory.write — the role fn_post_receipt's authz gate requires. Stash its uid +
-- the PR ids in GUCs so the throws_ok/lives_ok format() strings can reach them under `set role`.
select set_config('t.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);
select set_config('t.pr1', :'pr1', false);
select set_config('t.pr2', :'pr2', false);
select set_config('t.prY', :'prY', false);

-- fixtures: two clean items + bins at on_hand 0.
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'itemX', :'orgA', 'صنف متعدد أوامر', 'kg', 1, 0, 5),
         (:'itemY', :'orgA', 'صنف أمر واحد',   'kg', 1, 0, 5);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved, ordered, projected)
  values (:'orgA', :'itemX', 'main', 0, 0, 0, 0),
         (:'orgA', :'itemY', 'main', 0, 0, 0, 0);

-- ── fixtures: born-approved POs (the tests/06 multi-receipt scenario). ─────────────────────────────
-- ALL approved PRs are inserted HERE as the superuser, BEFORE any request.jwt.claims is set: the
-- insert-side SoD guard (migration 0023) blocks a born-approved PR for a real authenticated caller, so
-- once a JWT is set below these inserts would be rejected (same upfront-fixtures precedent as tests
-- 23/27). pr1 + pr2 are the two open POs for itemX; prY is the single open PO for itemY (case 2/3).
insert into public.purchase_requests (id, org_id, code, needed_by, status) values
  (:'pr1', :'orgA', 'PR-30-P1', '2025-07-08', 'approved'),
  (:'pr2', :'orgA', 'PR-30-P2', '2025-07-15', 'approved'),
  (:'prY', :'orgA', 'PR-30-Y',  '2025-07-08', 'approved');
insert into public.purchase_request_items (org_id, pr_id, item_id, qty, unit) values
  (:'orgA', :'pr1', :'itemX', 60, 'kg'),
  (:'orgA', :'pr2', :'itemX', 80, 'kg'),
  (:'orgA', :'prY', :'itemY', 50, 'kg');

-- Receive PR #1 via the trusted RPC (as a storekeeper) while PR #2 is STILL approved. Under the old
-- item-scoped guard this threw 23514; with 0029 it must SUCCEED.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role','authenticated')::text, true);
set local role authenticated;
select lives_ok(
  format($$ select public.fn_post_receipt('%s'::uuid) $$, current_setting('t.pr1', true)),
  '0029: receive one of two approved POs for an item via fn_post_receipt SUCCEEDS (false positive fixed)');
reset role;

select is((select on_hand from public.inventory_bin where item_id = :'itemX' and location='main'),
  60::numeric, '0029: on_hand reflects exactly PO #1 (0 → 60)');
select is((select status from public.purchase_requests where id = :'pr1'),
  'received', '0029: PR #1 flipped approved→received');
select is((select status from public.purchase_requests where id = :'pr2'),
  'approved', '0029: PR #2 is still approved (genuinely-future supply, correctly still projected)');

-- ── (1b) the SECOND PO is now receivable too — the deadlock is gone at both ends. ─────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role','authenticated')::text, true);
set local role authenticated;
select lives_ok(
  format($$ select public.fn_post_receipt('%s'::uuid) $$, current_setting('t.pr2', true)),
  '0029: the second PO is then also receivable (deadlock fully cleared)');
reset role;
select is((select on_hand from public.inventory_bin where item_id = :'itemX' and location='main'),
  140::numeric, '0029: on_hand reflects both POs after both received (60 + 80)');

-- ── (2) the double-count hole stays CLOSED: a direct out-of-band receipt while an approved needed_by
--        PO (prY, set up above) is open is still rejected. The trust marker is txn-local to
--        fn_post_receipt and was reset by it at the end of its loop, so it does NOT leak here. ───────
-- Posted as the superuser (no JWT) — a direct insert with no GUC set; the inventory write-role gate
-- (migration 0015) does not apply to the superuser, isolating the ENGINE-DC guard under test.
select throws_ok(
  format($$ insert into public.inventory_movements (org_id, item_id, type, qty, unit, location, occurred_at)
            values ('%s', '%s', 'receipt', 50, 'kg', 'main', '2025-07-10T00:00:00+00:00') $$,
         :'orgA', :'itemY'),
  '23514', null,
  '0029: a DIRECT (out-of-band) receipt while an approved needed_by PO is open is still REJECTED (hole stays closed)');

-- ── (3) a normal single-PO receipt via fn_post_receipt still works (flip-then-post, no other PO). ──
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role','authenticated')::text, true);
set local role authenticated;
select lives_ok(
  format($$ select public.fn_post_receipt('%s'::uuid) $$, current_setting('t.prY', true)),
  '0029: a normal single-PO receipt via fn_post_receipt still succeeds');
reset role;

select * from finish();
rollback;
