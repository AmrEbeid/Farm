-- 23 — RCP-ATOMIC-1: fn_post_receipt posts a PR's receipts atomically (migration 0024).
--
-- recordReceipt used to claim-flip the PR approved→received, then LOOP fn_post_movement('receipt',…)
-- once per line item from the client. If item ≥1 failed after item 0 committed, the PR was left
-- `received` with only partial stock posted and no clean retry path (the claim was consumed) → a
-- corrupt half-received state. fn_post_receipt runs the claim + every receipt in ONE transaction, so
-- a mid-loop failure rolls ALL of it back (PR stays `approved`, nothing posted, cleanly retryable).
--
-- Asserts: (a) a normal multi-item receipt posts every item + flips status; (b) a second call is
-- rejected (idempotent, errcode 23505); (c) anon cannot EXECUTE fn_post_receipt; (d) atomicity — a
-- forced mid-loop failure rolls the claim + the first item's receipt back (no partial receipt).
-- Run via `supabase test db`.

begin;
select plan(13);

-- ===== grants (migration 0024 lockdown): anon must NOT execute; authenticated MUST =====
-- Catalog-level (has_function_privilege) — independent of RLS, valid on the local superuser cluster.
select ok(not has_function_privilege('anon', 'public.fn_post_receipt(uuid)', 'EXECUTE'),
  '0024: anon cannot EXECUTE fn_post_receipt');
select ok(has_function_privilege('authenticated', 'public.fn_post_receipt(uuid)', 'EXECUTE'),
  '0024: authenticated CAN EXECUTE fn_post_receipt (the legitimate inventory.write gate)');

\set orgA  '00000000-0000-0000-0000-000000000001'
\set itemA 'c0000000-0000-0000-0000-000000000023'
\set itemB 'c0000000-0000-0000-0000-000000000123'
\set pr    'ccab2323-2323-2323-2323-ccab23232323'
\set prbad 'ccab2324-2324-2324-2324-ccab23242324'

-- actors: storekeeper HAS inventory.write; accountant does NOT (negative authz case).
select set_config('t.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);
select set_config('t.acc', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1), false);
select set_config('t.mgr', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('t.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);
-- GUCs for the throws_ok format() strings
select set_config('t.pr', :'pr', false);
select set_config('t.prbad', :'prbad', false);

-- two clean items at on_hand 0, and an APPROVED two-item PR (the multi-item case the bug needed).
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'itemA', :'orgA', 'صنف استلام أ', 'kg', 1, 0, 5),
         (:'itemB', :'orgA', 'صنف استلام ب', 'kg', 1, 0, 5);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved, ordered, projected)
  values (:'orgA', :'itemA', 'main', 0, 0, 0, 0),
         (:'orgA', :'itemB', 'main', 0, 0, 0, 0);

insert into public.purchase_requests (id, org_id, code, requested_by, approved_by, status)
  values (:'pr', :'orgA', 'PR-RCP23',
          current_setting('t.mgr')::uuid, current_setting('t.owner')::uuid, 'approved');
insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit, supplier_id)
  values (:'pr', :'orgA', :'itemA', 100, 'kg', null),
         (:'pr', :'orgA', :'itemB', 250, 'kg', null);

-- The (d) atomicity PR is set up HERE, as superuser (no JWT) — the insert-side SoD guard (migration
-- 0023) blocks a born-approved PR for a real authenticated caller, so it must be created before any
-- request.jwt.claims GUC is set below. Its 2nd item (itemB, which sorts AFTER itemA) has a NULL qty:
-- fn_post_receipt coalesces NULL→0 and fn_post_movement raises 22023 on qty<=0 — AFTER itemA's
-- receipt has already been inserted in-transaction, forcing the mid-loop rollback we assert in (d).
insert into public.purchase_requests (id, org_id, code, requested_by, approved_by, status)
  values (:'prbad', :'orgA', 'PR-RCP23B',
          current_setting('t.mgr')::uuid, current_setting('t.owner')::uuid, 'approved');
insert into public.purchase_request_items (pr_id, org_id, item_id, qty, unit, supplier_id)
  values (:'prbad', :'orgA', :'itemA', 50, 'kg', null),
         (:'prbad', :'orgA', :'itemB', null, 'kg', null);

-- ===== (c) authz: an accountant (no inventory.write) is refused, with NO side effect =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.acc'), 'role','authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_post_receipt('%s'::uuid) $$, current_setting('t.pr', true)),
  '42501', null,
  'RCP-AUTHZ-3: an accountant (no inventory.write) is refused by fn_post_receipt');
reset role;
select is((select status from public.purchase_requests where id = :'pr'), 'approved',
  'RCP-AUTHZ-3: the refused attempt left the PR approved (no partial receipt)');

-- ===== (a) a storekeeper posts the whole multi-item receipt atomically =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role','authenticated')::text, true);
set local role authenticated;
select set_config('t.res', public.fn_post_receipt(:'pr')::text, false);
reset role;

select is(((current_setting('t.res')::jsonb)->>'items_posted')::int, 2,
  'RCP-ATOMIC-1: both line items were posted in one call');
select is((select status from public.purchase_requests where id = :'pr'), 'received',
  'RCP-ATOMIC-1: the PR is flipped approved → received');
select is((select on_hand from public.inventory_bin where item_id = :'itemA' and location='main'),
  100::numeric, 'RCP-ATOMIC-1: item A on_hand 0 → 100 (+100)');
select is((select on_hand from public.inventory_bin where item_id = :'itemB' and location='main'),
  250::numeric, 'RCP-ATOMIC-1: item B on_hand 0 → 250 (+250)');

-- ===== (b) idempotency: a second call is rejected (claim-first), nothing re-posted =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role','authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_post_receipt('%s'::uuid) $$, current_setting('t.pr', true)),
  '23505', null,
  'RCP-1: a second fn_post_receipt on the same PR is refused (already received)');
reset role;
select is((select on_hand from public.inventory_bin where item_id = :'itemA' and location='main'),
  100::numeric, 'RCP-1: the rejected second call did NOT re-post (on_hand still 100, no phantom IN)');

-- ===== (d) atomicity: a forced mid-loop failure rolls the claim + prior receipt back =====
-- The :prbad PR (set up above) has itemA (qty 50) + itemB (NULL qty). fn_post_movement raises on the
-- NULL→0 qty for itemB AFTER itemA's +50 receipt is inserted in-transaction; the whole RPC must roll
-- back — the PR stays `approved` and itemA's on_hand stays at 100 (its (a) value), proving the failed
-- claim posted nothing.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role','authenticated')::text, true);
set local role authenticated;
-- itemB's NULL→0 qty makes fn_post_movement raise '22023' (qty must be a positive number) —
-- pinned so the test proves WHY it rolled back, not merely that *something* threw.
select throws_ok(
  format($$ select public.fn_post_receipt('%s'::uuid) $$, current_setting('t.prbad', true)),
  '22023', null,
  'RCP-ATOMIC-1: a mid-loop fn_post_movement failure raises 22023 (does not commit a partial receipt)');
reset role;

select is((select status from public.purchase_requests where id = :'prbad'), 'approved',
  'RCP-ATOMIC-1: the failed receipt rolled the claim back — PR stays approved (cleanly retryable)');
select is((select on_hand from public.inventory_bin where item_id = :'itemA' and location='main'),
  100::numeric,
  'RCP-ATOMIC-1: the failed receipt rolled the first item back — item A on_hand unchanged (no partial IN)');

select * from finish();
rollback;
