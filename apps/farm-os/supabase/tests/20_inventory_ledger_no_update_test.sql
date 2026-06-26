-- 20 — B2.1 completion (migration 0022): the stock ledger is FULLY append-only — no client UPDATE.
--
-- Migration 0016 revoked DELETE on inventory_movements/inventory_bin, but UPDATE was still granted,
-- so any inventory.write role could `UPDATE inventory_movements SET ...` via REST and forge/erase
-- stock without a trace (flagged by the prod-push assurance; issue #76). Migration 0022 revokes
-- UPDATE from authenticated|anon on both tables. Combined with 0015 (gated INSERT) + 0016 (no DELETE),
-- the ledger is genuinely append-only: rows can be added by write roles but never mutated or removed.
--
-- Mirrors test 11 (the DELETE-immutability pin). Run via `supabase test db`.

begin;
select plan(5);

\set orgA '00000000-0000-0000-0000-000000000001'
\set pot  '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4'

select set_config('test.sup', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='supervisor'), false);
select set_config('test.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='storekeeper'), false);

-- ===== supervisor: NO inventory.write — cannot mutate the ledger in place =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.sup'), 'role','authenticated')::text, true);
set local role authenticated;

select throws_ok($$ update public.inventory_movements set org_id = org_id $$, '42501', null,
  'B2.1: supervisor cannot UPDATE inventory_movements directly');
select throws_ok($$ update public.inventory_bin set org_id = org_id $$, '42501', null,
  'B2.1: supervisor cannot UPDATE inventory_bin directly');
-- reads stay open so dashboards/engine keep working for every role
select isnt((select count(*) from public.inventory_movements), 0::bigint,
  'B2.1: supervisor can still READ inventory_movements');

reset role;

-- ===== storekeeper: HAS inventory.write — the ledger is append-only even for write roles =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.store'), 'role','authenticated')::text, true);
set local role authenticated;

select throws_ok($$ update public.inventory_movements set org_id = org_id $$, '42501', null,
  'B2.1: storekeeper cannot UPDATE inventory_movements directly (append-only ledger)');
-- but legit append via the gated bypassrls RPC is unaffected. AUTHZ-3 (#182, migration 0036):
-- fn_post_movement is now internal; the client-facing write path is fn_reserve_stock (inventory.write,
-- which storekeeper holds).
select isnt(public.fn_reserve_stock(:'pot', 1, null), null,
  'B2.1: storekeeper can still reserve stock via the gated fn_reserve_stock RPC (path unaffected)');

reset role;
select * from finish();
rollback;
