-- 31 — #158 regression: the forgeable ENGINE-DC bypass is closed. After migration 0030 revokes
-- INSERT on inventory_movements from authenticated|anon, a client can no longer reach the ledger
-- directly — so it cannot forge the `app.posting_receipt` GUC marker to slip a double-counting
-- receipt past the inv_guard_receipt_no_open_po guard. The attack now fails at the PRIVILEGE layer
-- (42501) before the guard is ever consulted, while the legitimate fn_post_receipt RPC path is
-- unaffected.
--
-- Mirrors the exploratory probe that CONFIRMED the bug (baseline plain direct receipt → 23514; same
-- insert with the GUC set → SUCCEEDED). Here both forms must now be 42501. Run via `supabase test db`.

begin;
select plan(4);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set item  'c0000000-0000-0000-0000-000000000158'
\set prX   'ccab1588-1588-1588-1588-ccab15881588'

-- fixtures (superuser): clean item + bin at on_hand 0, and an APPROVED needed_by PO still open
-- (the exact double-count setup the #158 attack targeted).
insert into public.inventory_items (id, org_id, name, unit, pack_size, safety_stock, lead_time_days)
  values (:'item', :'orgA', 'صنف 158', 'kg', 1, 0, 5);
insert into public.inventory_bin (org_id, item_id, location, on_hand, reserved, ordered, projected)
  values (:'orgA', :'item', 'main', 0, 0, 0, 0);
insert into public.purchase_requests (id, org_id, code, needed_by, status)
  values (:'prX', :'orgA', 'PR-158', '2025-07-08', 'approved');
insert into public.purchase_request_items (org_id, pr_id, item_id, qty, unit)
  values (:'orgA', :'prX', :'item', 100, 'kg');

-- become a storekeeper (inventory.write) — the role that COULD perform the original exploit
select set_config('test.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='storekeeper'), false);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.store'), 'role','authenticated')::text, true);
set local role authenticated;

-- ── #158 ATTACK (with the forged GUC): now DENIED at the privilege layer, not the guard ──────────
select set_config('app.posting_receipt', '1', true);   -- the client forging the trusted-path marker
select throws_ok($$
  insert into public.inventory_movements (org_id, item_id, type, qty, unit, location)
  values ('00000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000158','receipt',100,'kg','main')
$$, '42501', null,
  '#158: forged app.posting_receipt GUC cannot bypass — direct receipt INSERT denied 42501 (was a live BYPASS pre-0030)');

-- ── plain direct receipt (no GUC): also denied 42501 (consistent RPC-only ledger) ────────────────
select set_config('app.posting_receipt', '', true);
select throws_ok($$
  insert into public.inventory_movements (org_id, item_id, type, qty, unit, location)
  values ('00000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000158','receipt',100,'kg','main')
$$, '42501', null,
  '#158: plain authenticated direct receipt INSERT denied 42501 (ledger is RPC-only)');

-- ── the LEGITIMATE path is unaffected: fn_post_receipt flips the PR + posts via the RPC ───────────
select is(
  (public.fn_post_receipt(:'prX') ->> 'status'),
  'received',
  '#158: legitimate fn_post_receipt RPC path still works (PR flipped approved→received)');
select is(
  (select on_hand from public.inventory_bin where item_id = :'item' and location='main'),
  100::numeric,
  '#158: the RPC receipt actually posted (on_hand 0 → 100) — no double-count, guard satisfied via claim-first flip');

reset role;
select * from finish();
rollback;
