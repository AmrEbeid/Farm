-- 93 — SPEC-0016 slice 1: export-compliance schema (migration 0092). Validates the four tables, FORCE
-- RLS, anon lockdown, the new export.write gate (owner/farm_manager write; other roles refused), and
-- that writes are audited. Mirrors test 38/92's JWT-claim role simulation. Run via supabase test db or
-- test-shims/run-pgtap-local.sh.
begin;
select plan(10);

\set orgA '00000000-0000-0000-0000-000000000001'
\set rtid '9e300001-0000-0000-0000-000000000093'

-- ── structure ────────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'export_registrations', 'export_registrations table exists');
select has_table('public', 'farm_export_accreditations', 'farm_export_accreditations table exists');
select has_table('public', 'residue_tests', 'residue_tests table exists');
select has_table('public', 'residue_test_results', 'residue_test_results table exists');
select is(
  (select relforcerowsecurity from pg_class where relname = 'export_registrations'), true,
  'export_registrations: FORCE row level security is on');
select ok(
  not has_table_privilege('anon', 'public.export_registrations', 'INSERT')
  and not has_table_privilege('anon', 'public.residue_tests', 'INSERT'),
  'export tables: anon holds NO write grant (authenticated-only)');

-- ── role setup ───────────────────────────────────────────────────────────────────────────────────
select set_config('t.fm', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('t.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);

-- ── export.write gate: farm_manager CAN write; an residue test + result too ─────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  format($$insert into public.export_registrations (org_id, market, registration_no, product, status)
           values (%L, 'CN', 'QEGY-TEST', 'Dates', 'Normal')$$, :'orgA'),
  'export.write: a farm_manager can record an export registration');
-- parent test first (separate statement so its row is visible to the child's same-org WITH CHECK —
-- a data-modifying CTE's insert is NOT visible mid-statement, which is the real insert order anyway).
insert into public.residue_tests (id, org_id, lab, certificate_no, crop, variety)
  values (:'rtid', :'orgA', 'QCAP', 'CERT-TEST', 'dates', 'Barhi');
select lives_ok(
  format($$insert into public.residue_test_results (org_id, residue_test_id, compound, value_mg_kg, method)
           values (%L, %L, 'Hexythiazox', 0.01, 'QuEChERS')$$, :'orgA', :'rtid'),
  'export.write: a residue result line (same-org parent test) is accepted');
reset role;

-- ── export.write gate: a non-export role (storekeeper) is refused by RLS WITH CHECK ─────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$insert into public.export_registrations (org_id, market, product)
           values (%L, 'CN', 'Dates')$$, :'orgA'),
  '42501', null, 'a storekeeper (no export.write) is refused by RLS (42501)');
reset role;

-- ── audit ──────────────────────────────────────────────────────────────────────────────────────────
select isnt(
  (select count(*) from public.audit_log where entity_type = 'export_registration'), 0::bigint,
  'export-registration writes are recorded in the append-only audit_log');

select * from finish();
rollback;
