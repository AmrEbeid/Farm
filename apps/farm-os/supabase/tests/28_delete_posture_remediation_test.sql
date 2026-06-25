-- 28 — DELETE-posture remediation (migration 0027): close the schema-wide direct-DELETE surface.
--
-- Finding (docs/SECURITY-FINDING-delete-exposure-2026-06-25.md): migration 0009's blanket
-- `grant ... delete ... to authenticated` + the single tenant_all FOR ALL policy (DELETE governed by
-- org-membership USING alone) let ANY authenticated org member DELETE rows directly via PostgREST on
-- ~28 tenant tables. The app only legitimately deletes ONE table as the authenticated client —
-- plan_checks (the plan builder recomputes via delete + re-insert). Migration 0027 REVOKEs DELETE
-- from authenticated|anon on every exposed tenant table EXCEPT plan_checks.
--
-- This test pins a representative sample of the locked tables (financial/operational/structural/PII)
-- as DELETE-denied to an authenticated member, and confirms plan_checks stays deletable. REVOKE
-- raises 42501 (insufficient_privilege) before any row scan, so a no-match predicate is sufficient.
--
-- The per-table runtime checks above only sample 5 of ~27 locked tables, so a future table added
-- without a DELETE revoke could silently regress. The CATALOG-DRIVEN invariant at the bottom closes
-- that gap: it asserts — over the whole public schema, via has_table_privilege on pg_catalog — that
-- NO tenant table grants DELETE to authenticated|anon EXCEPT the intentionally-exempt plan_checks.
-- Built dynamically (count of violations = 0) in the style of tests 22/29, so it auto-extends to any
-- future table without editing a list. These catalog checks are pure pg_catalog / has_table_privilege
-- and so are valid on the local superuser cluster where the RUNTIME REVOKE behaviour above relies on
-- the JWT role (superuser would otherwise hold every privilege).
--
-- Mirrors test 20 (the ledger append-only pin). Run via `supabase test db`.

begin;
select plan(10);

\set orgA '00000000-0000-0000-0000-000000000001'

select set_config('test.sup', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='supervisor'), false);

-- ===== act as a plain authenticated org member (supervisor) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.sup'), 'role','authenticated')::text, true);
set local role authenticated;

-- Locked tables — direct DELETE must be denied (privilege revoked).
select throws_ok($$ delete from public.expenses $$, '42501', null,
  '0027: authenticated member cannot DELETE expenses (financial record of truth)');
select throws_ok($$ delete from public.people $$, '42501', null,
  '0027: authenticated member cannot DELETE people (PII)');
select throws_ok($$ delete from public.farm_event $$, '42501', null,
  '0027: authenticated member cannot DELETE farm_event (operational ledger)');
select throws_ok($$ delete from public.quantities $$, '42501', null,
  '0027: authenticated member cannot DELETE quantities (operational ledger)');
select throws_ok($$ delete from public.plans $$, '42501', null,
  '0027: authenticated member cannot DELETE plans');

-- reads stay open so dashboards/engine keep working for every role
select isnt((select count(*) from public.people), 0::bigint,
  '0027: authenticated member can still READ people (tenant policy USING untouched)');

-- plan_checks is intentionally LEFT deletable — the plan builder needs it (actions.ts:91).
-- A no-match predicate exercises the privilege without touching seed rows.
select lives_ok(
  $$ delete from public.plan_checks where plan_id = '00000000-0000-0000-0000-000000000000' $$,
  '0027: authenticated member CAN still DELETE plan_checks (plan builder recompute path)');

reset role;

-- ============================================================================================
-- CATALOG-DRIVEN invariant (closes the sampling gap above) — over EVERY base table / partition
-- child in schema public, NO tenant table may grant DELETE to authenticated or anon, with the
-- single intentional exemption of plan_checks (the plan builder recompute path, actions.ts:91).
--
-- has_table_privilege returns the EFFECTIVE privilege (grant minus revoke) for the role, so it is
-- the right oracle for "is DELETE reachable from this client role?" regardless of how the grant was
-- shaped across migrations. Pure pg_catalog — RLS-independent, valid on the superuser shim. Built
-- as a count-of-violations = 0 so a future tenant table that forgets its DELETE revoke is caught
-- here without editing the per-table sample list above.
-- ============================================================================================
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname <> 'plan_checks'                       -- the one intentional exemption
      and (has_table_privilege('authenticated', c.oid, 'DELETE')
        or has_table_privilege('anon',          c.oid, 'DELETE'))),
  0,
  '0027 INV: no public tenant table (except plan_checks) grants DELETE to authenticated/anon');

-- Sanity floor: there is at least one locked table (otherwise the invariant above is vacuously
-- true and a future change that drops every revoke would silently stop testing this surface).
select cmp_ok(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not has_table_privilege('authenticated', c.oid, 'DELETE')
      and not has_table_privilege('anon',          c.oid, 'DELETE')),
  '>=', 1,
  '0027 INV: at least one public table denies DELETE to authenticated+anon (invariant not vacuous)');

-- Positive side: plan_checks MUST stay DELETE-able by authenticated (a future over-zealous revoke
-- that breaks the plan builder recompute path is then also caught by this same test).
select ok(
  has_table_privilege('authenticated', 'public.plan_checks', 'DELETE'),
  '0027 INV: plan_checks remains DELETE-able by authenticated (plan builder recompute path)');

select * from finish();
rollback;
