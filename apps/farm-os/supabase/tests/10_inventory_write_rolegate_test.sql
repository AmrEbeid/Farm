-- 10 — B2 / #158: the stock ledger is INSERT-only via the bypassrls RPCs — NO client direct INSERT,
-- for any role; reads stay open to the org.
--
-- AUTHZ-3 (#182, migration 0036): fn_post_movement is now an INTERNAL primitive (EXECUTE revoked from
-- `authenticated`) — a client can no longer call it directly. The client-facing reserve path is the
-- role-gated wrapper fn_reserve_stock (inventory.write). This test now pins: a non-write role
-- (supervisor) gets 42501 on the direct primitive, while a write role (storekeeper) reserves via the
-- gated wrapper — the legitimate RPC write path stays open.
--
-- Originally (migration 0015) direct inserts were gated to `inventory.write` (supervisor denied,
-- storekeeper allowed). Migration 0030 REVOKEs INSERT on inventory_movements from authenticated|anon
-- entirely (closing the #158 forgeable-GUC bypass — see test 31), so now NO client role can
-- direct-insert; the only write path is the SECURITY DEFINER RPC (owner-context, unaffected). This
-- supersedes the 0015 direct-INSERT role-gate. Run via `supabase test db`.

begin;
select plan(5);

\set orgA '00000000-0000-0000-0000-000000000001'
\set pot  '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4'

select set_config('test.sup', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='supervisor'), false);
select set_config('test.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='storekeeper'), false);

-- ===== supervisor: NO inventory.write — direct insert denied; reads + RPC execution work =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.sup'), 'role','authenticated')::text, true);
set local role authenticated;

select throws_ok($$
  insert into public.inventory_movements (org_id, item_id, type, qty, location)
  values ('00000000-0000-0000-0000-000000000001','39e22867-fbe2-5cd9-8a76-ce5871a8e8f4','receipt',5,'main')
$$, '42501', null, '#158: supervisor cannot direct-insert inventory_movements (ledger is RPC-only)');

select isnt((select count(*) from public.inventory_bin), 0::bigint,
  'B2: supervisor can still read inventory_bin');
select throws_ok($$ select public.fn_post_movement('39e22867-fbe2-5cd9-8a76-ce5871a8e8f4', 'issue', 1) $$,
  '42501', null,
  'AUTHZ-3 #182: fn_post_movement is internal — authenticated cannot call it directly (42501)');

reset role;

-- ===== storekeeper: HAS inventory.write — STILL cannot direct-insert (0030); RPC path works =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.store'), 'role','authenticated')::text, true);
set local role authenticated;

select throws_ok($$
  insert into public.inventory_movements (org_id, item_id, type, qty, location)
  values ('00000000-0000-0000-0000-000000000001','39e22867-fbe2-5cd9-8a76-ce5871a8e8f4','adjustment',1,'main')
$$, '42501', null,
  '#158: storekeeper (inventory.write) ALSO cannot direct-insert inventory_movements (RPC-only ledger)');

-- but legit reserve via the gated bypassrls wrapper is unaffected (storekeeper HAS inventory.write)
select isnt(public.fn_reserve_stock(:'pot', 1, null), null,
  'AUTHZ-3 #182: storekeeper (inventory.write) reserves via the gated fn_reserve_stock wrapper (RPC path unaffected)');

reset role;
select * from finish();
rollback;
