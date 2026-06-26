-- 11 — B2 follow-up: the stock ledger is APPEND-ONLY for direct REST access.
--
-- B2 (migration 0015) gated INSERT/UPDATE on the stock tables to `inventory.write` via the
-- tenant policy's WITH CHECK — but a `FOR ALL` policy governs DELETE by USING alone (there is no
-- WITH CHECK for DELETE). With the blanket `grant ... delete ... to authenticated` from migration
-- 0009 still in force, ANY org member could erase or forge stock by DELETE-ing movements directly
-- via /rest/v1/inventory_movements — the symmetric hole to the INSERT one B2 closed.
--
-- Migration 0016 revokes DELETE on inventory_movements/inventory_bin from authenticated|anon, so the
-- ledger is append-only for every authenticated role (corrections go through compensating movements
-- via fn_post_movement, exactly like audit_log is already delete-locked). Reads stay open to the org
-- and the bypassrls RPC path is unaffected. Run via `supabase test db`.

begin;
select plan(5);

\set orgA '00000000-0000-0000-0000-000000000001'
\set pot  '39e22867-fbe2-5cd9-8a76-ce5871a8e8f4'

select set_config('test.sup', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='supervisor'), false);
select set_config('test.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='storekeeper'), false);

-- ===== supervisor: NO inventory.write — must not be able to delete the ledger =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.sup'), 'role','authenticated')::text, true);
set local role authenticated;

select throws_ok($$ delete from public.inventory_movements $$, '42501', null,
  'B2-followup: supervisor cannot DELETE inventory_movements directly');
select throws_ok($$ delete from public.inventory_bin $$, '42501', null,
  'B2-followup: supervisor cannot DELETE inventory_bin directly');
-- reads stay open so dashboards/engine keep working for every role
select isnt((select count(*) from public.inventory_movements), 0::bigint,
  'B2-followup: supervisor can still READ inventory_movements');

reset role;

-- ===== storekeeper: HAS inventory.write — the ledger is append-only even for write roles =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.store'), 'role','authenticated')::text, true);
set local role authenticated;

select throws_ok($$ delete from public.inventory_movements $$, '42501', null,
  'B2-followup: storekeeper cannot DELETE inventory_movements directly (append-only ledger)');
-- but legit execution via the gated bypassrls RPC is unaffected. AUTHZ-3 (#182, migration 0036):
-- fn_post_movement is now internal; the client-facing write path is fn_reserve_stock (inventory.write,
-- which storekeeper holds).
select isnt(public.fn_reserve_stock(:'pot', 1, null), null,
  'B2-followup: storekeeper can still reserve stock via the gated fn_reserve_stock RPC (path unaffected)');

reset role;
select * from finish();
rollback;
