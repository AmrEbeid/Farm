-- 142 — Stage-M payroll privacy/access review: the evidence the existing suite did NOT pin.
--
-- WHY THIS FILE EXISTS. The payroll confidentiality boundary is already well covered, but the
-- independent access review (SPEC-0006 §4.1 "Independent access review REQUIRED", MASTER-PLAN Stage 8
-- / Stage M) found four assertions that no test in this suite actually makes. Each one below is a
-- DIFFERENT fact from what is already pinned — nothing here duplicates an existing test:
--
--   (1) DIRECT RLS READ on payroll_runs / payroll_run_lines / people_compensation, per app role.
--       The slice-3 test (20260729090000_payroll_run_persistence_test.sql) proves the CLOSE RPC
--       refuses a supervisor and that a supervisor sees zero payroll AUDIT rows, and it pins the anon
--       GRANT — but every one of its payroll_runs/payroll_run_lines reads runs either as the
--       superuser or through the SECURITY DEFINER RPC. Nothing asserts what the six app roles see
--       when they query the BASE TABLES directly through PostgREST. That is the exact attack the UI
--       cannot prevent, and it is the review's headline question.
--
--       people_compensation is included here for a narrower reason, stated precisely so this is not
--       read as a duplicate: tests/46 already exercises the DIRECT table read for exactly TWO of the
--       six roles — an accountant (rows) and a supervisor (zero) — and covers the other four only at
--       the `authorize('payroll.read')` level, which is a permission fact, not a read fact. The
--       review's §5.1 matrix asserts a value for all six roles on all three C3 tables, so all six are
--       exercised here against the table itself, in one place, on the same fixtures. Owner,
--       farm_manager, agri_engineer and storekeeper are new evidence; accountant and supervisor
--       restate an existing fact on this file's own fixtures so the row is complete and self-contained.
--
--   (2) CROSS-ORG READ DENIAL for the payroll/PII tables. Tests 01/24/62-65/74-76 pin cross-org
--       WRITE isolation and cross-org reads for the inventory/engine tables; none of them touches
--       people_compensation, payroll_runs, payroll_run_lines or labor_logs. A caller who legitimately
--       holds payroll.read IN THEIR OWN ORG is the realistic threat actor here (an accountant serving
--       two farms), and no test covers them.
--
--   (3) private-SCHEMA PAYROLL INTERNALS. tests/22 INV-1/INV-2 are scoped to `nspname = 'public'`, so
--       private.fn_payroll_run_report(uuid) and private.fn_payroll_run_mutex_key(uuid) are covered by
--       NO grant invariant at all. fn_payroll_run_report returns a whole run's wage lines as jsonb and
--       is SECURITY DEFINER — a stray EXECUTE grant on it bypasses the payroll.read RLS entirely.
--       (The public-schema payroll guards ARE covered by INV-1/INV-2 and are deliberately not re-pinned.)
--
--   (4) CONTACT PII IS DENIED TO EVERY ROLE, INCLUDING THE PAYROLL ROLES. Test 48 pins the 0048
--       column-grant lockdown against a supervisor. The review needs the stronger statement the
--       migration actually implements: phone/email are deny-by-default for the `authenticated` role as
--       such, so even an OWNER cannot read them through the table. Stated as a fact about the payroll
--       roles, because "owner/accountant can see wages" invites the assumption that they see contacts
--       too — they do not, and the go/no-go checklist depends on that being true.
--
--   (5) THE labor_logs CLASSIFICATION, structurally. 20260701310000's header justifies leaving
--       labor_logs reads ORG-WIDE (no payroll.read gate) on the ground that the table carries no
--       rate/money column, so hours alone cannot leak a wage. That justification is a comment; this
--       pins it as a catalog invariant, so a future migration that adds a money column to labor_logs
--       fails here instead of silently widening wage exposure to every org member.
--
-- HARNESS. The local shim runs as a SUPERUSER, which bypasses RLS (including FORCE RLS) — every RLS
-- assertion therefore runs under `set local role authenticated` with request.jwt.claims impersonation,
-- the same harness as tests 46/48/53/115 and the slice-3 payroll test. Grant/catalog assertions need
-- no role switch. Fixtures are created as the superuser inside this transaction and rolled back.
--
-- SYNTHETIC ONLY. Every person, rate and labor row below is an obviously fake fixture. Nothing here
-- reads, imports or implies real staff data, and this file changes no schema — it is evidence, not a
-- migration. Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(34);

\set orgX 'aaaa0730-0000-0000-0000-00000000000b'
\set orgY 'aaaa0730-0000-0000-0000-00000000000c'
\set pX   'aaaa0730-0000-0000-0000-0000000000d1'
\set pY   'aaaa0730-0000-0000-0000-0000000000d2'
\set runX 'aaaa0730-0000-0000-0000-0000000000e1'
\set runY 'aaaa0730-0000-0000-0000-0000000000e2'

-- The seeded org, whose six role-holders are reused as the impersonated users.
\set seedOrg '00000000-0000-0000-0000-000000000001'

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- (5) CLASSIFICATION: labor_logs carries no money column — the stated reason its reads are org-wide.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
select is(
  (select coalesce(string_agg(att.attname, ', ' order by att.attname), '(none)')
     from pg_attribute att
    where att.attrelid = 'public.labor_logs'::regclass
      and att.attnum > 0 and not att.attisdropped
      and att.attname ~ '(rate|gross|salary|wage|amount|cost|pay|price)'),
  '(none)',
  'labor_logs carries NO wage/money column — the structural basis for its org-wide (operational) read class');

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- (3) private-schema payroll internals hold NO client EXECUTE (outside tests/22 INV-1/INV-2 scope).
-- ══════════════════════════════════════════════════════════════════════════════════════════════
select ok(
  not has_function_privilege('anon', 'private.fn_payroll_run_report(uuid)', 'EXECUTE'),
  'anon holds NO EXECUTE on private.fn_payroll_run_report (it returns a run''s wage lines as jsonb)');
select ok(
  not has_function_privilege('authenticated', 'private.fn_payroll_run_report(uuid)', 'EXECUTE'),
  'authenticated holds NO EXECUTE on private.fn_payroll_run_report (reachable only from inside fn_close_payroll_run)');
select ok(
  not has_function_privilege('anon', 'private.fn_payroll_run_mutex_key(uuid)', 'EXECUTE'),
  'anon holds NO EXECUTE on private.fn_payroll_run_mutex_key (the per-org close mutex key)');
select ok(
  not has_function_privilege('authenticated', 'private.fn_payroll_run_mutex_key(uuid)', 'EXECUTE'),
  'authenticated holds NO EXECUTE on private.fn_payroll_run_mutex_key');

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- FIXTURES — two dedicated orgs, each with its own person, wage row, labor row and CLOSED run.
-- orgX carries all six app roles (the seeded users); orgY carries NONE of them, so every orgX
-- caller is a genuine non-member of orgY.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
select set_config('t.owner', (select user_id::text from public.organization_member
  where org_id = :'seedOrg' and role = 'owner' limit 1), false);
select set_config('t.accountant', (select user_id::text from public.organization_member
  where org_id = :'seedOrg' and role = 'accountant' limit 1), false);
select set_config('t.manager', (select user_id::text from public.organization_member
  where org_id = :'seedOrg' and role = 'farm_manager' limit 1), false);
select set_config('t.engineer', (select user_id::text from public.organization_member
  where org_id = :'seedOrg' and role = 'agri_engineer' limit 1), false);
select set_config('t.supervisor', (select user_id::text from public.organization_member
  where org_id = :'seedOrg' and role = 'supervisor' limit 1), false);
select set_config('t.storekeeper', (select user_id::text from public.organization_member
  where org_id = :'seedOrg' and role = 'storekeeper' limit 1), false);

insert into public.organization (id, name) values
  (:'orgX', 'مزرعة مراجعة الوصول'),
  (:'orgY', 'مزرعة أخرى — لا عضوية');

insert into public.organization_member (org_id, user_id, role) values
  (:'orgX', current_setting('t.owner')::uuid,       'owner'),
  (:'orgX', current_setting('t.accountant')::uuid,  'accountant'),
  (:'orgX', current_setting('t.manager')::uuid,     'farm_manager'),
  (:'orgX', current_setting('t.engineer')::uuid,    'agri_engineer'),
  (:'orgX', current_setting('t.supervisor')::uuid,  'supervisor'),
  (:'orgX', current_setting('t.storekeeper')::uuid, 'storekeeper');

insert into public.people (id, org_id, name, position, employment_type, active) values
  (:'pX', :'orgX', 'عامل تجريبي س', 'قطاف', 'seasonal', true),
  (:'pY', :'orgY', 'عامل تجريبي ص', 'قطاف', 'seasonal', true);

insert into public.people_compensation (org_id, person_id, mode, rate) values
  (:'orgX', :'pX', 'hourly', 40),
  (:'orgY', :'pY', 'hourly', 60);

-- labor rows are inserted BEFORE any payroll_runs row exists, and their work_date sits OUTSIDE the
-- closed period below, so the labor_logs payroll-freeze trigger (20260729090000 §7) never fires.
insert into public.labor_logs (org_id, person_id, work_date, hours, mode) values
  (:'orgX', :'pX', '2027-01-05', 8, 'hourly'),
  (:'orgY', :'pY', '2027-01-05', 8, 'hourly');

insert into public.payroll_runs (id, org_id, period_start, period_end, closed_by, total_gross) values
  (:'runX', :'orgX', '2027-02-01', '2027-02-07', current_setting('t.owner')::uuid, 320.00),
  (:'runY', :'orgY', '2027-02-01', '2027-02-07', current_setting('t.owner')::uuid, 480.00);

insert into public.payroll_run_lines (org_id, run_id, person_id, mode, unit, quantity, rate, gross) values
  (:'orgX', :'runX', :'pX', 'hourly', null, 8, 40, 320.00),
  (:'orgY', :'runY', :'pY', 'hourly', null, 8, 60, 480.00);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- (1) DIRECT RLS READ on the three C3 base tables, per app role, INSIDE the caller's own org.
--     owner + accountant see the run, its line and the wage row; the other four roles see NOTHING —
--     not a redacted row, not a count, nothing. This is the property the /people/payroll route gate
--     is only the outer layer of. All six roles × all three tables, so §5.1 of the review has one
--     place to point at; each role block reuses the SAME caller and the SAME fixtures, so the wage
--     assertion adds a table to an existing impersonation rather than a second set of rows.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(current_setting('t.owner'));
select is((select count(*)::int from public.payroll_runs where org_id = :'orgX'), 1,
  'RLS: an owner (payroll.read) reads payroll_runs in their own org');
select is((select count(*)::int from public.payroll_run_lines where org_id = :'orgX'), 1,
  'RLS: an owner (payroll.read) reads payroll_run_lines in their own org');
select is((select count(*)::int from public.people_compensation where org_id = :'orgX'), 1,
  'RLS: an owner (payroll.read) reads people_compensation in their own org');
reset role;

select pg_temp.as_user(current_setting('t.accountant'));
select is((select count(*)::int from public.payroll_runs where org_id = :'orgX'), 1,
  'RLS: an accountant (payroll.read) reads payroll_runs in their own org');
select is((select count(*)::int from public.payroll_run_lines where org_id = :'orgX'), 1,
  'RLS: an accountant (payroll.read) reads payroll_run_lines in their own org');
select is((select count(*)::int from public.people_compensation where org_id = :'orgX'), 1,
  'RLS: an accountant (payroll.read) reads people_compensation in their own org');
reset role;

select pg_temp.as_user(current_setting('t.manager'));
select is((select count(*)::int from public.payroll_runs where org_id = :'orgX'), 0,
  'RLS: a farm_manager sees ZERO payroll_runs rows (direct table read, not just a hidden nav entry)');
select is((select count(*)::int from public.payroll_run_lines where org_id = :'orgX'), 0,
  'RLS: a farm_manager sees ZERO payroll_run_lines rows');
select is((select count(*)::int from public.people_compensation where org_id = :'orgX'), 0,
  'RLS: a farm_manager sees ZERO people_compensation rows — people.write buys no wage read');
reset role;

select pg_temp.as_user(current_setting('t.engineer'));
select is((select count(*)::int from public.payroll_runs where org_id = :'orgX'), 0,
  'RLS: an agri_engineer sees ZERO payroll_runs rows');
select is((select count(*)::int from public.payroll_run_lines where org_id = :'orgX'), 0,
  'RLS: an agri_engineer sees ZERO payroll_run_lines rows');
select is((select count(*)::int from public.people_compensation where org_id = :'orgX'), 0,
  'RLS: an agri_engineer sees ZERO people_compensation rows');
reset role;

select pg_temp.as_user(current_setting('t.supervisor'));
select is((select count(*)::int from public.payroll_runs where org_id = :'orgX'), 0,
  'RLS: a supervisor sees ZERO payroll_runs rows');
select is((select count(*)::int from public.payroll_run_lines where org_id = :'orgX'), 0,
  'RLS: a supervisor sees ZERO payroll_run_lines rows');
select is((select count(*)::int from public.people_compensation where org_id = :'orgX'), 0,
  'RLS: a supervisor sees ZERO people_compensation rows — labor.write buys no wage read');
reset role;

select pg_temp.as_user(current_setting('t.storekeeper'));
select is((select count(*)::int from public.payroll_runs where org_id = :'orgX'), 0,
  'RLS: a storekeeper sees ZERO payroll_runs rows');
select is((select count(*)::int from public.payroll_run_lines where org_id = :'orgX'), 0,
  'RLS: a storekeeper sees ZERO payroll_run_lines rows');
select is((select count(*)::int from public.people_compensation where org_id = :'orgX'), 0,
  'RLS: a storekeeper sees ZERO people_compensation rows');
reset role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- (2) CROSS-ORG DENIAL. The caller is orgX's OWNER — a real payroll.read holder, not an outsider.
--     They must still read nothing at all from orgY, on every payroll/PII surface. The two
--     non-vacuity controls prove the same caller and the same predicate DO return their own org's
--     rows, so a zero above is denial, not an empty fixture.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(current_setting('t.owner'));
select is((select count(*)::int from public.people_compensation where org_id = :'orgY'), 0,
  'cross-org: a payroll.read holder in org X reads ZERO people_compensation rows of org Y');
select is((select count(*)::int from public.payroll_runs where org_id = :'orgY'), 0,
  'cross-org: a payroll.read holder in org X reads ZERO payroll_runs rows of org Y');
select is((select count(*)::int from public.payroll_run_lines where org_id = :'orgY'), 0,
  'cross-org: a payroll.read holder in org X reads ZERO payroll_run_lines rows of org Y');
select is((select count(*)::int from public.labor_logs where org_id = :'orgY'), 0,
  'cross-org: an org X member reads ZERO labor_logs rows of org Y');
select is((select count(*)::int from public.people where org_id = :'orgY'), 0,
  'cross-org: an org X member reads ZERO people rows of org Y');

-- These two restate a fact §1 already asserts, deliberately: here they are the CONTROL for the five
-- zeros immediately above — same caller, same predicate, only org_id differs — so a zero is proven to
-- be a denial rather than an empty fixture. Without them the cross-org block would not stand alone.
select is((select count(*)::int from public.people_compensation where org_id = :'orgX'), 1,
  'non-vacuity: the SAME caller does read their OWN org''s people_compensation row');
select is((select count(*)::int from public.labor_logs where org_id = :'orgX'), 1,
  'non-vacuity: the SAME caller does read their OWN org''s labor_logs row');
reset role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- (4) CONTACT PII is denied to EVERY app role, the payroll roles included. Wages and contacts are
--     two separate classes: holding payroll.read buys no phone/email access whatsoever.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(current_setting('t.owner'));
select throws_ok(
  'select phone from public.people',
  '42501', null,
  'contact PII: even an OWNER cannot SELECT people.phone (deny-by-default is universal, not role-scoped)');
select throws_ok(
  'select email from public.people',
  '42501', null,
  'contact PII: even an OWNER cannot SELECT people.email');
reset role;

select pg_temp.as_user(current_setting('t.accountant'));
select throws_ok(
  'select phone from public.people',
  '42501', null,
  'contact PII: an ACCOUNTANT (payroll.read) cannot SELECT people.phone — wage access is not contact access');
select throws_ok(
  'select email from public.people',
  '42501', null,
  'contact PII: an ACCOUNTANT (payroll.read) cannot SELECT people.email');
reset role;

select * from finish();
rollback;
