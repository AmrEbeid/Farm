-- 43 — SPEC-0009 (#155) partial / over-receipt oracle (slices 1-3).
--
-- Pins the §4 acceptance oracle for the cases that do NOT need the #156 guard/horizon work (slice 4):
--   (1) approve 500, receive 300 (per-line p_lines) → on_hand +300, line received_qty=300, PR
--       'partially_received', and fn_stock_coverage projects the REMAINING 200 (not 0, not 500).
--   (2) receive the remaining 200 → PR 'received', on_hand +500 total, projection 0, and
--       Σ(receipt movements) == on_hand (SPEC-0001 §2.2 reconciliation oracle).
--   (3) over-receipt: receive 600 against 500 remaining → rejected (23514); no movement; PR unchanged.
--   (5) idempotency: a full receipt then a re-submit posts once (the second call raises 23505).
--
-- Fixtures: cases (1)+(2) use the seed potassium-sulfate path (on_hand 300, period-1 demand 500,
-- period_start 2025-07-08); cases (3)+(5) use fresh isolated items. fn_post_receipt requires
-- inventory.write, so the approved PRs are INSERTed as superuser first (the pr_guard_approval INSERT
-- SoD guard blocks a born-approved PR for a real authenticated caller), then received as a storekeeper.
-- Run via `supabase test db`.

begin;
select plan(20);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set itemC 'c0000000-0000-0000-0000-000000000042'
\set itemD 'c0000000-0000-0000-0000-000000000142'
\set prPot 'ccab4242-4242-4242-4242-ccab42420001'
\set prC   'ccab4242-4242-4242-4242-ccab42420003'
\set prD   'ccab4242-4242-4242-4242-ccab42420005'

-- the seed potassium item + its actors
select set_config('t.item',
  (select id::text from public.inventory_items where org_id = :'orgA' and name ilike '%بوتاس%' limit 1), false);
select set_config('t.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);
select set_config('t.mgr', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('t.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);
select set_config('t.prPot', :'prPot', false);
select set_config('t.prC', :'prC', false);
select set_config('t.prD', :'prD', false);

-- fresh isolated items for the over-receipt + idempotency cases (on_hand 0)
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'itemC', :'orgA', 'صنف استلام جزئي ج', 'kg', 1, 0, 5),
         (:'itemD', :'orgA', 'صنف استلام جزئي د', 'kg', 1, 0, 5);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved, ordered, projected)
  values (:'orgA', :'itemC', 'main', 0, 0, 0, 0),
         (:'orgA', :'itemD', 'main', 0, 0, 0, 0);

-- approved PRs (created as superuser, before any JWT is set):
--   prPot — 500 kg potash needed in period 1 (2025-07-08)        → cases (1)+(2)
--   prC   — 500 kg itemC                                          → case  (3) over-receipt
--   prD   — 100 kg itemD                                          → case  (5) idempotency
insert into public.purchase_requests (id, org_id, code, needed_by, requested_by, approved_by, status)
  values (:'prPot', :'orgA', 'PR-42-POT', '2025-07-08',
          current_setting('t.mgr')::uuid, current_setting('t.owner')::uuid, 'approved'),
         (:'prC',   :'orgA', 'PR-42-C',  '2025-07-08',
          current_setting('t.mgr')::uuid, current_setting('t.owner')::uuid, 'approved'),
         (:'prD',   :'orgA', 'PR-42-D',  '2025-07-08',
          current_setting('t.mgr')::uuid, current_setting('t.owner')::uuid, 'approved');
insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit)
  values (:'prPot', :'orgA', current_setting('t.item')::uuid, 500, 'kg'),
         (:'prC',   :'orgA', :'itemC', 500, 'kg'),
         (:'prD',   :'orgA', :'itemD', 100, 'kg');

-- GUCs holding the p_lines jsonb literals for the throws_ok format() strings
select set_config('t.linesC600',
  jsonb_build_array(jsonb_build_object('item_id', :'itemC', 'qty', 600))::text, false);

-- baseline potash on_hand (seed = 300) for the +300/+500 deltas
select set_config('t.pot_base',
  (select on_hand::text from public.inventory_bin where item_id = current_setting('t.item')::uuid and location='main'), false);

-- ════════════════════ act as the storekeeper (has inventory.write) ════════════════════
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role','authenticated')::text, true);
set local role authenticated;

-- ── CASE 1: receive 300 of 500 (per-line p_lines) ───────────────────────────────────────────────
select set_config('t.res1',
  public.fn_post_receipt(current_setting('t.prPot')::uuid,
    jsonb_build_array(jsonb_build_object('item_id', current_setting('t.item'), 'qty', 300)))::text, false);
reset role;

select is((select on_hand from public.inventory_bin where item_id = current_setting('t.item')::uuid and location='main'),
  (current_setting('t.pot_base')::numeric + 300),
  'SPEC-0009 §4.1: receiving 300 raises potash on_hand by +300');
select is((select received_qty from public.purchase_request_items
            where pr_id = current_setting('t.prPot')::uuid and item_id = current_setting('t.item')::uuid),
  300::numeric, 'SPEC-0009 §4.1: the line received_qty is 300');
select is((select status from public.purchase_requests where id = current_setting('t.prPot')::uuid),
  'partially_received', 'SPEC-0009 §4.1: the PR is partially_received (not received)');
select is(
  ((public.fn_stock_coverage(current_setting('t.item')::uuid, 'main', 8))->>'available')::numeric,
  (current_setting('t.pot_base')::numeric + 300),
  'SPEC-0009 §4.1: available reflects the +300 received-to-date in on_hand');
-- period-2 PAB = avail(600) - demand(500) + projected-receipt. Correct remaining 200 → 300; the
-- full-500 double-count bug → 600; the "received → vanish" bug (project 0) → 100. Pins remaining=200.
select is(
  ((public.fn_stock_coverage(current_setting('t.item')::uuid, 'main', 8))->'pab'->>1)::numeric,
  300::numeric,
  'SPEC-0009 §4.1: the engine projects the REMAINING 200 on-order (PAB[2]=300, not 600=full nor 100=vanished)');
select is(
  ((public.fn_stock_coverage(current_setting('t.item')::uuid, 'main', 8))->>'shortage')::boolean,
  false,
  'SPEC-0009 §4.1: with on_hand 600 + 200 remaining vs 500 demand, no period-1 shortage');

-- ── CASE 2: receive the remaining 200 (default path = receive remaining) ─────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role','authenticated')::text, true);
set local role authenticated;
select set_config('t.res2', public.fn_post_receipt(current_setting('t.prPot')::uuid)::text, false);
reset role;

select is((select on_hand from public.inventory_bin where item_id = current_setting('t.item')::uuid and location='main'),
  (current_setting('t.pot_base')::numeric + 500),
  'SPEC-0009 §4.2: receiving the remaining 200 brings total on_hand to +500');
select is((select received_qty from public.purchase_request_items
            where pr_id = current_setting('t.prPot')::uuid and item_id = current_setting('t.item')::uuid),
  500::numeric, 'SPEC-0009 §4.2: the line is fully received (received_qty=500)');
select is((select status from public.purchase_requests where id = current_setting('t.prPot')::uuid),
  'received', 'SPEC-0009 §4.2: every line fully received → PR flips to received');
-- PR now received → leaves the projection. PAB[2] = avail(800) - demand(500) + 0 = 300; a residual
-- projection of the (already-received) 200 would give 500. Pins projection = 0.
select is(
  ((public.fn_stock_coverage(current_setting('t.item')::uuid, 'main', 8))->'pab'->>1)::numeric,
  300::numeric,
  'SPEC-0009 §4.2: a received PR projects 0 (PAB[2]=300, not 500) — on_hand and projection stay disjoint');
-- reconciliation oracle: Σ(receipt movements) == on_hand (seed opening 300 + 300 + 200 = 800)
select is(
  (select coalesce(sum(qty),0) from public.inventory_movements
     where item_id = current_setting('t.item')::uuid and location='main' and type='receipt'),
  (select on_hand from public.inventory_bin where item_id = current_setting('t.item')::uuid and location='main'),
  'SPEC-0009 §4.2: Σ(receipt movements) == on_hand (SPEC-0001 §2.2 reconciliation oracle)');

-- ── CASE 3: over-receipt — receive 600 against 500 remaining → rejected, nothing posted ──────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role','authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_post_receipt('%s'::uuid, '%s'::jsonb) $$,
         current_setting('t.prC', true), current_setting('t.linesC600', true)),
  '23514', null,
  'SPEC-0009 §4.3: receiving 600 against 500 remaining is rejected as over-receipt (23514)');
reset role;
select is((select on_hand from public.inventory_bin where item_id = :'itemC' and location='main'),
  0::numeric, 'SPEC-0009 §4.3: the rejected over-receipt posted NO movement (on_hand still 0)');
select is((select status from public.purchase_requests where id = :'prC'),
  'approved', 'SPEC-0009 §4.3: the PR is unchanged (still approved) after the rejected over-receipt');
select is((select received_qty from public.purchase_request_items where pr_id = :'prC' and item_id = :'itemC'),
  0::numeric, 'SPEC-0009 §4.3: received_qty is unchanged (0) after the rejected over-receipt');

-- ── CASE 5: idempotency — a full receipt, then a re-submit posts once ────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role','authenticated')::text, true);
set local role authenticated;
select set_config('t.res5', public.fn_post_receipt(current_setting('t.prD')::uuid)::text, false);
reset role;
select is((current_setting('t.res5')::jsonb)->>'status', 'received',
  'SPEC-0009 §4.5: the full receipt flips the PR to received');
select is((select on_hand from public.inventory_bin where item_id = :'itemD' and location='main'),
  100::numeric, 'SPEC-0009 §4.5: the full receipt posted +100');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role','authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_post_receipt('%s'::uuid) $$, current_setting('t.prD', true)),
  '23505', null,
  'SPEC-0009 §4.5: a re-submit of a fully-received PR is rejected (23505) — claim-first idempotency');
reset role;
select is((select on_hand from public.inventory_bin where item_id = :'itemD' and location='main'),
  100::numeric, 'SPEC-0009 §4.5: the rejected re-submit did NOT re-post (on_hand still 100, posted once)');

-- ── #155 security (independent-review finding): received_qty is engine-trusted; a member must NOT be
-- able to write it directly — only the SECURITY DEFINER fn_post_receipt (table owner). The column-level
-- UPDATE grant is revoked from authenticated, so a direct update is denied at the privilege layer (42501)
-- EVEN WITH the forgeable app.posting_receipt GUC set — closing the mask-a-shortage / double-count vector.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role','authenticated')::text, true);
set local role authenticated;
select set_config('app.posting_receipt', '1', true);   -- forge the trusted-path marker…
select throws_ok(
  format($$ update public.purchase_request_items set received_qty = 999 where pr_id = '%s'::uuid $$,
         current_setting('t.prPot')),
  '42501', null,
  '#155 security: a member cannot directly UPDATE received_qty (column grant revoked) even with a forged app.posting_receipt GUC');
select set_config('app.posting_receipt', '0', true);
reset role;

select * from finish();
rollback;
