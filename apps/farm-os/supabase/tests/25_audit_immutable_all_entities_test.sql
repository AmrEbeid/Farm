-- 25 — AP-4 (generalised): audit_log is append-only / immutable for EVERY audited entity type,
-- and the ONLY writer is the SECURITY DEFINER trigger. Tests 02 and 17 prove the deny side for a
-- single entity each (purchase_request via UPDATE; organization_member via UPDATE) and only for
-- DELETE/UPDATE. This file pins the rest of the surface that migration 0008/0019 actually hardened
-- but that no test exercised:
--   (1) audit-on-write fires for a SECOND, independent entity type (inventory_movement) — proving
--       the trail is not specific to the PR path that test 02 covers;
--   (2) an authenticated client cannot mutate that row by ANY verb — INSERT (forge a row), UPDATE
--       (tamper), DELETE (erase) — regardless of which entity wrote it;
--   (3) TRUNCATE is denied (migration 0008 line `revoke … truncate …`, never previously pinned —
--       TRUNCATE bypasses RLS row filtering, so the privilege REVOKE is the only thing stopping a
--       wholesale wipe of the trail);
--   (4) the catalog invariant that audit_log carries NO INSERT/UPDATE/DELETE/TRUNCATE grant for the
--       client roles — so a future migration that re-grants any of them is caught structurally even
--       if no row happens to be present.
--
-- Run via `supabase test db` or the local shim (test-shims/run-pgtap-local.sh). The local superuser
-- bypasses RLS, but these denials are PRIVILEGE-layer (REVOKE), so they hold on the shim too — the
-- assertions impersonate the `authenticated` role explicitly via `set local role`.

begin;
select plan(10);

\set orgA '00000000-0000-0000-0000-000000000001'
\set item 'dddd0025-0000-0000-0000-0000000000a0'

insert into public.inventory_items (id, org_id, name, unit)
  values (:'item', :'orgA', 'صنف اختبار سجل التدقيق', 'kg');

select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner'), false);

-- ---------------------------------------------------------------------------------------------
-- (1) audit-on-write for a SECOND entity type: a reserve movement (via the gated reserve RPC) writes
-- an inventory_movements row → the audit_movement trigger records it on audit_log. This generalises
-- "an approve writes an audit row" (test 02) to a different, unrelated entity. AUTHZ-3 (#182, migration
-- 0036): fn_post_movement is internal; the client-facing reserve path is fn_reserve_stock
-- (inventory.write), which the owner holds — and it delegates to the same primitive that fires the
-- audit trigger.
-- ---------------------------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok($$ select public.fn_reserve_stock('dddd0025-0000-0000-0000-0000000000a0', 50, null) $$,
  'a reserve movement is posted via the gated fn_reserve_stock wrapper (fires the inventory_movement audit trigger)');

select isnt(
  (select count(*) from public.audit_log
     where entity_type = 'inventory_movement' and org_id = :'orgA' and action = 'INSERT'),
  0::bigint,
  'AP-4: an inventory_movement INSERT writes an audit_log row (audit covers > the PR path)');

select is(
  (select after->>'type' from public.audit_log
     where entity_type = 'inventory_movement' and org_id = :'orgA' and action = 'INSERT'
     order by id desc limit 1),
  'reserve',
  'AP-4: the audit after-image captured the movement payload');

-- ---------------------------------------------------------------------------------------------
-- (2) immutability holds against EVERY write verb, for an authenticated client, on this row.
-- The DELETE/UPDATE are denied at the privilege layer (REVOKE in 0008), not silently filtered.
-- ---------------------------------------------------------------------------------------------
select throws_ok(
  $$ delete from public.audit_log where entity_type = 'inventory_movement' $$,
  '42501', null,
  'AP-4: authenticated cannot DELETE inventory_movement audit rows');

select throws_ok(
  $$ update public.audit_log set action = 'TAMPER' where entity_type = 'inventory_movement' $$,
  '42501', null,
  'AP-4: authenticated cannot UPDATE inventory_movement audit rows');

-- A direct INSERT by a client is denied too — the SECURITY DEFINER trigger is the ONLY writer, so a
-- client cannot forge a fabricated audit entry (or a misleading provenance row).
select throws_ok(
  $$ insert into public.audit_log(org_id, action, entity_type, entity_id)
       values ('00000000-0000-0000-0000-000000000001', 'INSERT', 'inventory_movement', 'forged') $$,
  '42501', null,
  'AP-4: authenticated cannot INSERT (forge) an audit_log row — trigger is the sole writer');

-- TRUNCATE bypasses RLS row-filtering, so only the privilege REVOKE stops a wholesale wipe. Never
-- previously pinned. (TRUNCATE on a missing privilege raises 42501, same class as the others.)
select throws_ok(
  $$ truncate table public.audit_log $$,
  '42501', null,
  'AP-4: authenticated cannot TRUNCATE the audit_log (wholesale wipe denied)');

reset role;

-- anon is even more restricted — the same REVOKE covers it; pin one verb to lock the regression.
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
select throws_ok(
  $$ delete from public.audit_log $$,
  '42501', null,
  'AP-4: anon cannot DELETE from audit_log');
reset role;

-- ---------------------------------------------------------------------------------------------
-- (4) catalog-level invariant: neither authenticated nor anon holds ANY mutating grant on
-- audit_log. This is true even with the table empty, so a re-grant in a future migration is
-- caught structurally — independent of whether a test row happens to exist.
-- ---------------------------------------------------------------------------------------------
select is(
  (select count(*)::int
     from (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as v(priv)
     cross join (values ('authenticated'), ('anon')) as r(grantee)
    where has_table_privilege(r.grantee, 'public.audit_log', v.priv)),
  0,
  'AP-4: authenticated/anon hold no INSERT/UPDATE/DELETE/TRUNCATE grant on audit_log (structural)');

-- Positive floor: SELECT MUST remain granted to authenticated, so the trail stays readable by
-- members (an over-zealous future revoke that blinds the org to its own audit log is also caught).
select ok(
  has_table_privilege('authenticated', 'public.audit_log', 'SELECT'),
  'AP-4: authenticated retains SELECT on audit_log (trail stays readable)');

select * from finish();
rollback;
