-- 20260729090000 — SPEC-0006 slice 3: payroll persistence/reporting kernel (migration
-- 20260729090000_payroll_run_persistence.sql). Oracles required by the ratified build (#388/#394):
--   owner/accountant success; supervisor/anon/cross-org denial; hand-computed mixed-mode
--   reconciliation; missing-rate leaves zero rows; sequential idempotency; REAL two-session
--   concurrency (dblink, mirrors "200 accounting reconciliation execute expense batch test.sql");
--   immutable close; confidential audit; grants/search_path/FORCE RLS/FK indexes/constraints;
--   daily quantity counts DISTINCT work_date; overlapping-period reject while exact replay stays
--   idempotent; labor_logs freeze (insert/update/delete) against a closed period; seasonal exact-period
--   resolution (never inferred cadence); compensation mutation consistency (a later rate/contract edit
--   never retouches an already-closed run); and REAL two-session races for both the overlapping-period
--   serialization and the labor-write/close coordination (#394 follow-up items).
--
-- BYTE REVIEW FIXES (this revision): (1) a privileged cross-org UPDATE that moves a labor_logs row OUT
-- of its own org's closed period must still be rejected — regression-tested directly below (PART A) —
-- proving the freeze trigger checks the OLD row against OLD.org_id, never a NEW-org-coalesced org. (2)
-- people_compensation mutations now coordinate with close via the SAME per-org mutex (internal trigger,
-- no exception, no freeze of rate edits) so a close's aggregation loop can never see a torn mix of old
-- and new rates across its own per-line statements — proved with a REAL two-session race (PART C3)
-- mirroring PART C2a/C2b's shape.
-- authorize() completeness is NOT re-tested here — this migration does not touch authorize() at all
-- (reuses the existing payroll.read permission), so 97_authorize_perms_complete_test.sql is untouched
-- and still the authority on that invariant. AI/export exposure is pinned in
-- lib/assistant-policy.test.ts (a TypeScript concern, not pgTAP).
--
-- PART A runs entirely inside this file's own transaction (rolled back at the end) against a
-- dedicated org (orgP) — mirrors tests 46/76/93's JWT-impersonation harness.
-- PART B is REAL two-session concurrency: two separate backend connections (dblink) racing
-- fn_close_payroll_run for the SAME org+period. Its fixture is inserted (and, at the end, deleted)
-- through committed side-connections — mirrors "200 accounting reconciliation execute expense batch
-- test.sql"'s own race + self-cleaning teardown, since dblink-committed rows survive this file's
-- outer ROLLBACK.
-- PART C is REAL two-session concurrency for the #394 follow-up items: (1) two closers racing
-- OVERLAPPING-but-different periods for the same org, (2) a labor_logs write racing a close of the SAME
-- period in both directions (write-commits-first-so-is-included vs close-commits-first-so-the-write-is-
-- rejected). Same dblink/self-cleaning-teardown shape as PART B, on dedicated orgs.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(104);

\set orgA '00000000-0000-0000-0000-000000000001'
\set orgP 'aaaa0729-0000-0000-0000-000000000001'
\set pHourly   'aaaa0729-0000-0000-0000-0000000000b1'
\set pDaily    'aaaa0729-0000-0000-0000-0000000000b2'
\set pPiece    'aaaa0729-0000-0000-0000-0000000000b3'
\set pSeasonal 'aaaa0729-0000-0000-0000-0000000000b4'
\set pMissing  'aaaa0729-0000-0000-0000-0000000000b5'

-- ── structure ────────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'payroll_runs', 'payroll_runs table exists');
select has_table('public', 'payroll_run_lines', 'payroll_run_lines table exists');
select is(
  (select c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'payroll_runs'),
  true, 'payroll_runs: FORCE row level security is on');
select is(
  (select c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'payroll_run_lines'),
  true, 'payroll_run_lines: FORCE row level security is on');
select ok(
  not has_function_privilege('anon', 'public.fn_close_payroll_run(uuid, date, date)', 'EXECUTE'),
  'anon holds NO EXECUTE on fn_close_payroll_run');
select ok(
  not has_table_privilege('anon', 'public.payroll_runs', 'SELECT'),
  'anon holds NO SELECT on payroll_runs');
select ok(
  not has_table_privilege('anon', 'public.payroll_run_lines', 'SELECT'),
  'anon holds NO SELECT on payroll_run_lines');
select has_column('public', 'people_compensation', 'contract_period_start',
  'people_compensation.contract_period_start exists (#394 follow-up: explicit seasonal contract bounds)');
select has_column('public', 'people_compensation', 'contract_period_end',
  'people_compensation.contract_period_end exists');
select has_trigger('public', 'labor_logs', 'guard_labor_log_payroll_freeze',
  'labor_logs carries the payroll-freeze BEFORE trigger');

-- ── byte review fix #2 structure: people_compensation close-coordination trigger (internal, no client
-- EXECUTE, empty search_path) — direct trigger/grant/search_path pins, not just the generic INV-1/INV-2/
-- INV-5 catalog invariants in 22_security_invariants_test.sql. ─────────────────────────────────────────
select has_trigger('public', 'people_compensation', 'guard_people_compensation_payroll_coordination',
  'people_compensation carries the close-coordination BEFORE trigger (byte review fix #2)');
select ok(
  not has_function_privilege('anon',
    'public.fn_guard_people_compensation_payroll_coordination()', 'EXECUTE'),
  'anon holds NO EXECUTE on fn_guard_people_compensation_payroll_coordination');
select ok(
  not has_function_privilege('authenticated',
    'public.fn_guard_people_compensation_payroll_coordination()', 'EXECUTE'),
  'authenticated holds NO EXECUTE on fn_guard_people_compensation_payroll_coordination (internal only)');
select ok(
  (select 'search_path=""' = any(p.proconfig) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_guard_people_compensation_payroll_coordination'),
  'the compensation close-coordination trigger pins an empty search_path');

-- ── fixture: dedicated org, reusing orgA's seeded auth users for role impersonation ─────────────────
select set_config('t.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);
select set_config('t.accountant', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1), false);
select set_config('t.supervisor', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'supervisor' limit 1), false);
select set_config('t.storekeeper', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);

insert into public.organization (id, name) values (:'orgP', 'مزرعة اختبار الأجور');
insert into public.organization_member (org_id, user_id, role) values
  (:'orgP', current_setting('t.owner')::uuid, 'owner'),
  (:'orgP', current_setting('t.accountant')::uuid, 'accountant'),
  (:'orgP', current_setting('t.supervisor')::uuid, 'supervisor');

insert into public.people (id, org_id, name, employment_type, active) values
  (:'pHourly',   :'orgP', 'عامل بالساعة',   'seasonal', true),
  (:'pDaily',    :'orgP', 'عامل باليومية',  'seasonal', true),
  (:'pPiece',    :'orgP', 'عامل بالقطعة',   'seasonal', true),
  (:'pSeasonal', :'orgP', 'متعاقد موسمي',   'contract', true),
  (:'pMissing',  :'orgP', 'عامل بلا سعر',   'seasonal', true);

-- pHourly deliberately holds TWO rates (hourly + piece/tree) — #388 pt.5: modes mix per worker.
-- pSeasonal's contract bounds are set to EXACTLY period M (2026-02-01..2026-02-07) — the only period
-- that may ever resolve this seasonal rate (#394 follow-up: exact declared period, never inferred).
insert into public.people_compensation (org_id, person_id, mode, unit, rate, contract_period_start, contract_period_end) values
  (:'orgP', :'pHourly',   'hourly',   null,   50,   null,          null),
  (:'orgP', :'pHourly',   'piece',    'tree', 10,   null,          null),
  (:'orgP', :'pDaily',    'daily',    null,   200,  null,          null),
  (:'orgP', :'pPiece',    'piece',    'box',  15,   null,          null),
  (:'orgP', :'pSeasonal', 'seasonal', null,   5000, '2026-02-01',  '2026-02-07');

-- period M ('2026-02-01'..'2026-02-07'): the hand-computed mixed-mode fixture.
--   pHourly hourly:   8 + 4 = 12h  × 50   = 600.00
--   pHourly piece/tree:      5     × 10   =  50.00
--   pDaily  daily:       3 days    × 200  = 600.00
--   pPiece  piece/box: 20 + 30 = 50 × 15  = 750.00
--   pSeasonal seasonal:       1    × 5000 = 5000.00
--   TOTAL                                 = 7000.00 across 5 lines
-- non-hourly rows carry deliberately non-zero `hours` (6 on the piece/tree row, 8 on the daily,
-- piece/box, and seasonal rows) — pricing ignores `hours` outside mode='hourly', and the oracle above
-- proves it: a future edit that zeroes these out would silently weaken that coverage.
insert into public.labor_logs (org_id, person_id, work_date, hours, mode, quantity, unit) values
  (:'orgP', :'pHourly',   '2026-02-02', 8, 'hourly',   null, null),
  (:'orgP', :'pHourly',   '2026-02-03', 4, 'hourly',   null, null),
  (:'orgP', :'pHourly',   '2026-02-04', 6, 'piece',    5,    'tree'),
  (:'orgP', :'pDaily',    '2026-02-02', 8, 'daily',    null, null),
  (:'orgP', :'pDaily',    '2026-02-03', 8, 'daily',    null, null),
  (:'orgP', :'pDaily',    '2026-02-04', 8, 'daily',    null, null),
  (:'orgP', :'pPiece',    '2026-02-02', 8, 'piece',    20,   'box'),
  (:'orgP', :'pPiece',    '2026-02-03', 8, 'piece',    30,   'box'),
  (:'orgP', :'pSeasonal', '2026-02-02', 8, 'seasonal', null, null);

-- ── owner success + hand-computed mixed-mode reconciliation ─────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('t.run_report',
  (select public.fn_close_payroll_run(:'orgP'::uuid, '2026-02-01'::date, '2026-02-07'::date)::text), false);
reset role;

select is((current_setting('t.run_report')::jsonb->>'total_gross')::numeric, 7000.00,
  'owner success: mixed-mode total_gross reconciles to the hand-computed fixture (7000.00)');
select is(jsonb_array_length(current_setting('t.run_report')::jsonb->'lines'), 5,
  'owner success: exactly 5 snapshot lines (pHourly gets 2 — hourly + piece/tree)');
select is(
  (select gross from public.payroll_run_lines l join public.payroll_runs r on r.id = l.run_id
    where r.org_id = :'orgP' and r.period_start = '2026-02-01' and l.person_id = :'pHourly' and l.mode = 'hourly'),
  600.00, 'mixed-mode: pHourly hourly line = 12h × 50 = 600.00');
select is(
  (select gross from public.payroll_run_lines l join public.payroll_runs r on r.id = l.run_id
    where r.org_id = :'orgP' and r.period_start = '2026-02-01' and l.person_id = :'pHourly' and l.mode = 'piece'),
  50.00, 'mixed-mode: pHourly piece/tree line = 5 × 10 = 50.00');
select is(
  (select gross from public.payroll_run_lines l join public.payroll_runs r on r.id = l.run_id
    where r.org_id = :'orgP' and r.period_start = '2026-02-01' and l.person_id = :'pDaily'),
  600.00, 'mixed-mode: pDaily daily line = 3 days × 200 = 600.00');
select is(
  (select gross from public.payroll_run_lines l join public.payroll_runs r on r.id = l.run_id
    where r.org_id = :'orgP' and r.period_start = '2026-02-01' and l.person_id = :'pPiece'),
  750.00, 'mixed-mode: pPiece piece/box line = 50 × 15 = 750.00');
select is(
  (select gross from public.payroll_run_lines l join public.payroll_runs r on r.id = l.run_id
    where r.org_id = :'orgP' and r.period_start = '2026-02-01' and l.person_id = :'pSeasonal'),
  5000.00, 'mixed-mode: pSeasonal seasonal line = 1 × 5000 = 5000.00');
select is(
  (select total_gross from public.payroll_runs where org_id = :'orgP' and period_start = '2026-02-01'),
  7000.00, 'payroll_runs.total_gross persists the same 7000.00 total');
select is(
  (select closed_by from public.payroll_runs where org_id = :'orgP' and period_start = '2026-02-01'),
  current_setting('t.owner')::uuid, 'payroll_runs.closed_by records the closing owner');

-- ── accountant success (separate, simple hourly period) ─────────────────────────────────────────────
insert into public.labor_logs (org_id, person_id, work_date, hours, mode) values
  (:'orgP', :'pHourly', '2026-08-02', 4, 'hourly');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.accountant'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('t.acct_report',
  (select public.fn_close_payroll_run(:'orgP'::uuid, '2026-08-01'::date, '2026-08-07'::date)::text), false);
reset role;
select is((current_setting('t.acct_report')::jsonb->>'total_gross')::numeric, 200.00,
  'accountant success: closes a simple hourly period (4h × 50 = 200.00)');

-- ── denial: supervisor (member, no payroll.read) ─────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.supervisor'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$select public.fn_close_payroll_run(%L::uuid, '2026-09-01'::date, '2026-09-07'::date)$$, :'orgP'),
  '42501', null, 'a supervisor (no payroll.read) is refused closing payroll');
reset role;

-- ── denial: cross-org (storekeeper of orgA is NOT a member of orgP) ─────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.storekeeper'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$select public.fn_close_payroll_run(%L::uuid, '2026-09-01'::date, '2026-09-07'::date)$$, :'orgP'),
  '42501', null, 'a non-member of orgP cannot close its payroll (cross-org)');
reset role;

-- ── denial: anon (no EXECUTE grant at all) ───────────────────────────────────────────────────────────
-- '{}', not NULL: set_config(name, NULL, ...) sets the GUC to '' (not unset), and auth.uid()/auth.role()
-- cast it via ::json, which fails on an empty string. '{}' clears the storekeeper's claims while staying
-- valid JSON, so the anon case runs with NO claims (sub/role both null) rather than an inherited member.
select set_config('request.jwt.claims', '{}', true);
set local role anon;
select throws_ok(
  format($$select public.fn_close_payroll_run(%L::uuid, '2026-09-01'::date, '2026-09-07'::date)$$, :'orgP'),
  '42501', null, 'anon cannot execute fn_close_payroll_run at all');
reset role;

-- ── fail-closed: missing rate leaves ZERO rows ───────────────────────────────────────────────────────
insert into public.labor_logs (org_id, person_id, work_date, hours, mode) values
  (:'orgP', :'pMissing', '2026-03-02', 5, 'hourly');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$select public.fn_close_payroll_run(%L::uuid, '2026-03-01'::date, '2026-03-07'::date)$$, :'orgP'),
  '22023', format('missing or invalid rate for (person:mode/unit): %s:hourly', :'pMissing'),
  'a missing rate aborts the WHOLE close');
reset role;
select is(
  (select count(*)::int from public.payroll_runs where org_id = :'orgP' and period_start = '2026-03-01'),
  0, 'missing-rate leaves ZERO payroll_runs rows for that period');
select is(
  (select count(*)::int from public.payroll_run_lines l join public.payroll_runs r on r.id = l.run_id
    where r.org_id = :'orgP' and r.period_start = '2026-03-01'),
  0, 'missing-rate leaves ZERO payroll_run_lines rows for that period');

-- ── fail-closed: empty input ──────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$select public.fn_close_payroll_run(%L::uuid, '2026-04-01'::date, '2026-04-07'::date)$$, :'orgP'),
  '22023', format('no labor logs found for org %s in period 2026-04-01 .. 2026-04-07', :'orgP'),
  'empty input (no labor logs in the period) aborts the close');
reset role;
select is(
  (select count(*)::int from public.payroll_runs where org_id = :'orgP' and period_start = '2026-04-01'),
  0, 'empty-input leaves ZERO payroll_runs rows');

-- ── fail-closed: period errors ───────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$select public.fn_close_payroll_run(%L::uuid, '2026-05-07'::date, '2026-05-01'::date)$$, :'orgP'),
  '22023', 'invalid period: period_start (2026-05-07) is after period_end (2026-05-01)',
  'period_start after period_end aborts the close');
select throws_ok(
  $$select public.fn_close_payroll_run(null, null, null)$$,
  '22023', 'org, period_start and period_end are required', 'null org/period bounds abort the close');
reset role;

-- ── fail-closed: free-text crews ──────────────────────────────────────────────────────────────────────
insert into public.labor_logs (org_id, team_name, work_date, hours, mode) values
  (:'orgP', 'طاقم غير مسجل', '2026-05-10', 8, 'hourly');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$select public.fn_close_payroll_run(%L::uuid, '2026-05-08'::date, '2026-05-14'::date)$$, :'orgP'),
  '22023', 'free-text crew labor logs exist in this period — assign a person before closing payroll',
  'a free-text crew labor log aborts the whole close');
reset role;
select is(
  (select count(*)::int from public.payroll_runs where org_id = :'orgP' and period_start = '2026-05-08'),
  0, 'free-text-crew leaves ZERO payroll_runs rows');

-- ── fail-closed: cross-org data reference (bypasses the upstream RLS/guard, superuser-inserted) ───────
-- a person belonging to orgA, deliberately referenced from an orgP labor log — derived from the current
-- seed rather than hardcoded, so a reseed can never leave this fixture pointing at a nonexistent row.
set local session_replication_role = replica;
insert into public.labor_logs (org_id, person_id, work_date, hours, mode)
select :'orgP', p.id, '2026-06-02', 8, 'hourly'
  from public.people p where p.org_id = :'orgA' limit 1;
set local session_replication_role = origin;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$select public.fn_close_payroll_run(%L::uuid, '2026-06-01'::date, '2026-06-07'::date)$$, :'orgP'),
  '23514', null, 'a cross-org person reference in labor_logs aborts the close');
reset role;
select is(
  (select count(*)::int from public.payroll_runs where org_id = :'orgP' and period_start = '2026-06-01'),
  0, 'cross-org-reference leaves ZERO payroll_runs rows');

-- ── fail-closed: unsupported unit (rejected at INSERT, never reaches the close RPC) ────────────────────
select throws_ok(
  format($$insert into public.labor_logs (org_id, person_id, work_date, hours, mode, quantity, unit)
           values (%L, %L, '2026-06-10', 8, 'piece', 5, 'parsec')$$, :'orgP', :'pPiece'),
  '23514', null, 'an unsupported unit is rejected by the labor_logs CHECK constraint');

-- ── ambiguous rate is structurally impossible (partial unique index) ────────────────────────────────────
select throws_ok(
  format($$insert into public.people_compensation (org_id, person_id, mode, rate) values (%L, %L, 'hourly', 60)$$,
    :'orgP', :'pHourly'),
  '23505', null, 'a second active hourly rate for the same person is rejected (ambiguity structurally impossible)');

-- ── sequential idempotency ────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('t.run_report_2',
  (select public.fn_close_payroll_run(:'orgP'::uuid, '2026-02-01'::date, '2026-02-07'::date)::text), false);
reset role;
select is(
  current_setting('t.run_report_2')::jsonb->>'run_id', current_setting('t.run_report')::jsonb->>'run_id',
  'sequential idempotency: re-closing the same org/period returns the SAME run_id');
select is(
  (select count(*)::int from public.payroll_runs where org_id = :'orgP' and period_start = '2026-02-01'),
  1, 'sequential idempotency: still exactly ONE run row for that period');
select is(
  (select count(*)::int from public.payroll_run_lines l join public.payroll_runs r on r.id = l.run_id
    where r.org_id = :'orgP' and r.period_start = '2026-02-01'),
  5, 'sequential idempotency: still exactly 5 lines (no duplicate insert on replay)');

-- ── fail-closed: overlapping (non-exact) period is rejected; exact replay stays idempotent ─────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$select public.fn_close_payroll_run(%L::uuid, '2026-02-05'::date, '2026-02-10'::date)$$, :'orgP'),
  '23505', null, 'a period overlapping the already-closed Feb1-7 run (Feb5-10) is rejected');
reset role;
select is(
  (select count(*)::int from public.payroll_runs where org_id = :'orgP' and period_start = '2026-02-05'),
  0, 'overlap-reject leaves ZERO payroll_runs rows for the overlapping period');
select is(
  (select count(*)::int from public.payroll_runs where org_id = :'orgP' and period_start = '2026-02-01'),
  1, 'overlap-reject does not disturb the original Feb1-7 run (still exactly ONE)');

-- ── freeze: labor_logs covered by a closed period is frozen against insert/update/delete ────────────────
select throws_ok(
  format($$insert into public.labor_logs (org_id, person_id, work_date, hours, mode) values (%L, %L, '2026-02-03', 3, 'hourly')$$,
    :'orgP', :'pHourly'),
  '55000', null, 'inserting a NEW labor_logs row back-dated into a closed period is rejected');
select throws_ok(
  format($$update public.labor_logs set hours = 99 where org_id = %L and person_id = %L and work_date = '2026-02-02'$$,
    :'orgP', :'pHourly'),
  '55000', null, 'updating a labor_logs row already covered by a closed period is rejected');
select throws_ok(
  format($$delete from public.labor_logs where org_id = %L and person_id = %L and work_date = '2026-02-02'$$,
    :'orgP', :'pHourly'),
  '55000', null, 'deleting a labor_logs row already covered by a closed period is rejected');
-- an otherwise-untouched row (dated OUTSIDE any closed period) whose work_date is moved INTO a closed
-- range must also be rejected — the NEW-row half of the freeze check, not just the OLD-row half above.
insert into public.labor_logs (org_id, person_id, work_date, hours, mode) values
  (:'orgP', :'pHourly', '2026-11-05', 2, 'hourly');
select throws_ok(
  format($$update public.labor_logs set work_date = '2026-02-03' where org_id = %L and person_id = %L and work_date = '2026-11-05'$$,
    :'orgP', :'pHourly'),
  '55000', null, 'updating a labor_logs row''s work_date so it MOVES INTO a closed period is rejected');
select is(
  (select work_date from public.labor_logs where org_id = :'orgP' and person_id = :'pHourly' and hours = 2 and mode = 'hourly'),
  '2026-11-05'::date, 'the rejected move leaves the row''s work_date UNCHANGED (still outside any closed period)');

-- ── byte review fix #1 regression: a privileged (superuser-bypassing-RLS) UPDATE that moves a labor_logs
-- row OUT of its own org's already-closed period into a DIFFERENT org with no closed run for that date
-- must still be rejected. `v_org := coalesce(new.org_id, old.org_id)` in the pre-fix trigger checked the
-- OLD row's work_date against the NEW org (orgQ, no closed run) instead of the OLD org (orgP, closed
-- Feb1-7) and would have let this escape; the fix checks the OLD row against OLD.org_id specifically. ───
\set orgQ 'aaaa0729-0000-0000-0000-0000000000a9'
insert into public.organization (id, name) values (:'orgQ', 'مزرعة استقبال بلا إغلاق');
select throws_ok(
  format($$update public.labor_logs set org_id = %L where org_id = %L and person_id = %L and work_date = '2026-02-02'$$,
    :'orgQ', :'orgP', :'pHourly'),
  '55000', null,
  'a privileged cross-org UPDATE moving a row OUT of orgP''s closed Feb1-7 period into orgQ is rejected');
select is(
  (select org_id from public.labor_logs where person_id = :'pHourly' and work_date = '2026-02-02' and hours = 8),
  :'orgP'::uuid, 'the rejected cross-org move leaves the row''s org_id UNCHANGED (still orgP)');
select is(
  (select count(*)::int from public.labor_logs where org_id = :'orgQ'),
  0, 'the rejected cross-org move landed NO row under orgQ');

-- ── compensation mutation consistency: mutating people_compensation AFTER a close never retouches it ────
update public.people_compensation set rate = 999
  where org_id = :'orgP' and person_id = :'pHourly' and mode = 'hourly';
update public.people_compensation set rate = 1, contract_period_start = '2027-01-01', contract_period_end = '2027-01-07'
  where org_id = :'orgP' and person_id = :'pSeasonal' and mode = 'seasonal';
select is(
  (select total_gross from public.payroll_runs where org_id = :'orgP' and period_start = '2026-02-01'),
  7000.00, 'compensation mutation consistency: total_gross of the already-closed Feb1-7 run is UNCHANGED');
select is(
  (select gross from public.payroll_run_lines l join public.payroll_runs r on r.id = l.run_id
    where r.org_id = :'orgP' and r.period_start = '2026-02-01' and l.person_id = :'pHourly' and l.mode = 'hourly'),
  600.00, 'compensation mutation consistency: the frozen hourly line gross is UNCHANGED after the rate edit');
select is(
  (select gross from public.payroll_run_lines l join public.payroll_runs r on r.id = l.run_id
    where r.org_id = :'orgP' and r.period_start = '2026-02-01' and l.person_id = :'pSeasonal'),
  5000.00, 'compensation mutation consistency: the frozen seasonal line gross is UNCHANGED after the contract edit');
-- the ACTUAL regression risk: a REPLAY of the close (not just a read of the stored snapshot) must also
-- return the frozen 7000.00, never recompute against the just-edited rate (999) or contract (1).
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('t.run_report_replay',
  (select public.fn_close_payroll_run(:'orgP'::uuid, '2026-02-01'::date, '2026-02-07'::date)::text), false);
reset role;
select is((current_setting('t.run_report_replay')::jsonb->>'total_gross')::numeric, 7000.00,
  'compensation mutation consistency: REPLAYING the closed Feb1-7 run after the rate/contract edits still returns 7000.00 (no recompute)');

-- ── daily quantity counts DISTINCT work_date, not row count ──────────────────────────────────────────────
\set pDailyDup 'aaaa0729-0000-0000-0000-0000000000b6'
insert into public.people (id, org_id, name, employment_type, active) values
  (:'pDailyDup', :'orgP', 'عامل يومية مكرر', 'seasonal', true);
insert into public.people_compensation (org_id, person_id, mode, rate) values
  (:'orgP', :'pDailyDup', 'daily', 300);
-- two labor_logs rows on the SAME work_date (two tasks logged in one day) must count as ONE day.
insert into public.labor_logs (org_id, person_id, work_date, hours, mode) values
  (:'orgP', :'pDailyDup', '2026-09-02', 4, 'daily'),
  (:'orgP', :'pDailyDup', '2026-09-02', 4, 'daily'),
  (:'orgP', :'pDailyDup', '2026-09-03', 8, 'daily');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('t.daily_dedup_report',
  (select public.fn_close_payroll_run(:'orgP'::uuid, '2026-09-01'::date, '2026-09-07'::date)::text), false);
reset role;
select is(
  (select quantity from public.payroll_run_lines l join public.payroll_runs r on r.id = l.run_id
    where r.org_id = :'orgP' and r.period_start = '2026-09-01' and l.person_id = :'pDailyDup'),
  2::numeric, 'daily quantity is exactly 2 (DISTINCT work_date), not 3 (row count)');
select is(
  (select gross from public.payroll_run_lines l join public.payroll_runs r on r.id = l.run_id
    where r.org_id = :'orgP' and r.period_start = '2026-09-01' and l.person_id = :'pDailyDup'),
  600.00, 'daily quantity counts DISTINCT work_date: 2 distinct days × 300 = 600.00 (not 3 × 300 = 900)');

-- ── seasonal: resolved ONLY on an EXACT match to the rate's declared contract period ─────────────────────
\set pSeasonalBad 'aaaa0729-0000-0000-0000-0000000000b7'
insert into public.people (id, org_id, name, employment_type, active) values
  (:'pSeasonalBad', :'orgP', 'متعاقد موسمي بفترة مختلفة', 'contract', true);
-- contract bounds (Oct1-14) do NOT match the close period below (Oct1-7): must be treated as a missing
-- rate, never resolved by inferring "the close period is CONTAINED IN the contract".
insert into public.people_compensation (org_id, person_id, mode, rate, contract_period_start, contract_period_end) values
  (:'orgP', :'pSeasonalBad', 'seasonal', 4000, '2026-10-01', '2026-10-14');
insert into public.labor_logs (org_id, person_id, work_date, hours, mode) values
  (:'orgP', :'pSeasonalBad', '2026-10-02', 8, 'seasonal');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$select public.fn_close_payroll_run(%L::uuid, '2026-10-01'::date, '2026-10-07'::date)$$, :'orgP'),
  '22023', format('missing or invalid rate for (person:mode/unit): %s:seasonal', :'pSeasonalBad'),
  'a seasonal rate whose contract bounds do not EXACTLY match the close period is treated as missing (never inferred)');
reset role;
select is(
  (select count(*)::int from public.payroll_runs where org_id = :'orgP' and period_start = '2026-10-01'),
  0, 'seasonal exact-period mismatch leaves ZERO payroll_runs rows');
-- closing the EXACT declared contract period succeeds and pays the seasonal amount once.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('t.seasonal_exact_report',
  (select public.fn_close_payroll_run(:'orgP'::uuid, '2026-10-01'::date, '2026-10-14'::date)::text), false);
reset role;
select is(
  (current_setting('t.seasonal_exact_report')::jsonb->>'total_gross')::numeric, 4000.00,
  'seasonal exact-period match: closing the EXACT declared contract period (Oct1-14) resolves and pays 4000.00');

-- ── gross-vs-stored-quantity rounding: a >2-decimal aggregate quantity must round ONCE, and gross must be
-- computed from that SAME rounded value — never from the unrounded aggregate — or payroll_run_lines'
-- OWN gross-exact CHECK (which re-derives gross from the STORED, rounded quantity) rejects the close.
-- rate=3.00, aggregate quantity=5.002+5.002=10.004 rounds to 10.00; the OLD logic computed
-- gross=round(10.004*3.00,2)=30.01, which the CHECK (round(10.00*3.00,2)=30.00) would have rejected.
\set pFrac 'aaaa0729-0000-0000-0000-0000000000b8'
insert into public.people (id, org_id, name, employment_type, active) values
  (:'pFrac', :'orgP', 'عامل قطعة كسري', 'seasonal', true);
insert into public.people_compensation (org_id, person_id, mode, unit, rate) values
  (:'orgP', :'pFrac', 'piece', 'kg', 3.00);
insert into public.labor_logs (org_id, person_id, work_date, hours, mode, quantity, unit) values
  (:'orgP', :'pFrac', '2026-11-02', 8, 'piece', 5.002, 'kg'),
  (:'orgP', :'pFrac', '2026-11-03', 8, 'piece', 5.002, 'kg');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('t.frac_qty_report',
  (select public.fn_close_payroll_run(:'orgP'::uuid, '2026-11-01'::date, '2026-11-07'::date)::text), false);
reset role;
select is(
  (select quantity from public.payroll_run_lines l join public.payroll_runs r on r.id = l.run_id
    where r.org_id = :'orgP' and r.period_start = '2026-11-01' and l.person_id = :'pFrac'),
  10.00::numeric, 'fractional-quantity close: the aggregate 10.004 is stored rounded ONCE to 10.00');
select is(
  (select gross from public.payroll_run_lines l join public.payroll_runs r on r.id = l.run_id
    where r.org_id = :'orgP' and r.period_start = '2026-11-01' and l.person_id = :'pFrac'),
  30.00, 'fractional-quantity close: gross is computed from the STORED rounded quantity (10.00 × 3.00 = 30.00), not the unrounded aggregate (which would compute 30.01 and violate payroll_run_lines_gross_exact)');

-- ── immutable close (rejected even from the table-owning/superuser role) ────────────────────────────────
select throws_ok(
  format($$update public.payroll_runs set total_gross = 0 where org_id = %L and period_start = '2026-02-01'$$,
    :'orgP'),
  '22023', 'payroll_runs rows are immutable and cannot be updated', 'a closed payroll_runs row cannot be updated');
select throws_ok(
  format($$delete from public.payroll_runs where org_id = %L and period_start = '2026-02-01'$$, :'orgP'),
  '22023', 'payroll_runs rows are immutable and cannot be deleted', 'a closed payroll_runs row cannot be deleted');
select throws_ok(
  format($$update public.payroll_run_lines set gross = 0 where run_id =
           (select id from public.payroll_runs where org_id = %L and period_start = '2026-02-01')$$, :'orgP'),
  '22023', 'payroll_run_lines rows are immutable and cannot be updated', 'a payroll_run_lines row cannot be updated');
select throws_ok(
  format($$delete from public.payroll_run_lines where run_id =
           (select id from public.payroll_runs where org_id = %L and period_start = '2026-02-01')$$, :'orgP'),
  '22023', 'payroll_run_lines rows are immutable and cannot be deleted', 'a payroll_run_lines row cannot be deleted');

-- ── confidential audit ────────────────────────────────────────────────────────────────────────────────
select isnt(
  (select count(*)::int from public.audit_log where entity_type = 'payroll_run' and org_id = :'orgP'),
  0, 'closing payroll writes audit_log rows (entity_type=payroll_run)');
select isnt(
  (select count(*)::int from public.audit_log where entity_type = 'payroll_run_line' and org_id = :'orgP'),
  0, 'closing payroll writes audit_log rows for each line (entity_type=payroll_run_line)');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.supervisor'), 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select count(*)::int from public.audit_log
    where entity_type in ('payroll_run', 'payroll_run_line') and org_id = :'orgP'),
  0, 'a supervisor (no payroll.read) sees ZERO payroll audit rows (confidential audit)');
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.accountant'), 'role', 'authenticated')::text, true);
set local role authenticated;
select isnt(
  (select count(*)::int from public.audit_log
    where entity_type in ('payroll_run', 'payroll_run_line') and org_id = :'orgP'),
  0, 'an accountant (payroll.read) CAN see payroll audit rows');
reset role;

-- ── snapshot shape/gross constraints (defense-in-depth direct-insert checks) ────────────────────────────
select throws_ok(
  format($$insert into public.payroll_run_lines (org_id, run_id, person_id, mode, unit, quantity, rate, gross)
           select %L, r.id, %L, 'daily', null, 10, 5, 999
             from public.payroll_runs r where r.org_id = %L and r.period_start = '2026-02-01'$$,
    :'orgP', :'pHourly', :'orgP'),
  '23514', null, 'a wrong gross value is rejected (gross must equal round(quantity*rate,2))');
select throws_ok(
  format($$insert into public.payroll_run_lines (org_id, run_id, person_id, mode, unit, quantity, rate, gross)
           select %L, r.id, %L, 'piece', null, 10, 5, 50
             from public.payroll_runs r where r.org_id = %L and r.period_start = '2026-02-01'$$,
    :'orgP', :'pHourly', :'orgP'),
  '23514', null, 'a piece-mode snapshot line without a unit is rejected');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PART B — REAL two-session concurrency (dblink). Fixture inserted/removed through committed side
-- connections since the outer ROLLBACK cannot undo dblink-committed writes.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
\set orgR 'aaaa0729-0000-0000-0000-0000000000c0'
\set pRace 'aaaa0729-0000-0000-0000-0000000000c1'

create extension if not exists dblink;

-- PID-free: proves the race by matching the SPECIFIC ungranted advisory waiter for this org's
-- deterministic per-org mutex key — the same md5-derived classid/objid split
-- private.fn_payroll_run_mutex_key uses (migration 20260729090000, section 3) — rather than an
-- instance-wide waiter COUNT. pg_locks is instance-wide, so counting ungranted advisory waiters picks up
-- every other database/session on the instance; matching the exact key means an unrelated advisory
-- waiter elsewhere can no longer make this assertion flaky.
create or replace function pg_temp.wait_for_solo_advisory_waiter(p_org uuid)
returns boolean
language plpgsql
as $$
declare
  attempt   int;
  v_key_hex text := substr(md5(p_org::text), 1, 16);
  v_classid int  := ('x' || substr(v_key_hex, 1, 8))::bit(32)::int;
  v_objid   int  := ('x' || substr(v_key_hex, 9, 8))::bit(32)::int;
begin
  for attempt in 1..1000 loop
    if exists (
      select 1 from pg_catalog.pg_locks
       where locktype = 'advisory' and granted = false and objsubid = 1
         and classid = v_classid and objid = v_objid
    ) then
      return true;
    end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end;
$$;

-- self-healing race fixtures: a part that errors before its own teardown block runs would otherwise
-- leave its org's rows committed forever (dblink-committed writes survive this file's outer ROLLBACK),
-- poisoning every later invocation with a duplicate-key insert. This single helper is called both as
-- idempotent PRE-setup cleanup (ahead of each part's fixture insert) and as the happy-path teardown, so
-- a mid-part failure is recoverable rather than terminal.
create or replace function pg_temp.reset_payroll_race_org(p_conn text, p_org uuid)
returns void
language plpgsql
as $$
begin
  perform dblink_exec(p_conn, 'set session_replication_role = replica');
  perform dblink_exec(p_conn, format($f$delete from public.payroll_run_lines where org_id = %L$f$, p_org));
  perform dblink_exec(p_conn, format($f$delete from public.payroll_runs where org_id = %L$f$, p_org));
  perform dblink_exec(p_conn, format($f$delete from public.labor_logs where org_id = %L$f$, p_org));
  perform dblink_exec(p_conn, format($f$delete from public.people_compensation where org_id = %L$f$, p_org));
  perform dblink_exec(p_conn, format($f$delete from public.people where org_id = %L$f$, p_org));
  perform dblink_exec(p_conn, format($f$delete from public.organization_member where org_id = %L$f$, p_org));
  perform dblink_exec(p_conn, format($f$delete from public.organization where id = %L$f$, p_org));
end;
$$;

select set_config('t.dsn', format(
  'host=%s port=%s dbname=%s user=%s',
  (select btrim(split_part(setting, ',', 1))
     from pg_settings where name = 'unix_socket_directories'),
  (select setting from pg_settings where name = 'port'),
  current_database(), current_user
), false);

-- idempotent pre-setup cleanup: recover from a prior run that errored before its own teardown ran.
select dblink_connect('payroll_race_precleanup', current_setting('t.dsn'));
select pg_temp.reset_payroll_race_org('payroll_race_precleanup', :'orgR');
select dblink_disconnect('payroll_race_precleanup');

select dblink_connect('payroll_race_setup', current_setting('t.dsn'));
select dblink_exec('payroll_race_setup',
  format($$insert into public.organization(id, name) values (%L, 'مزرعة سباق الأجور')$$, :'orgR'));
select dblink_exec('payroll_race_setup',
  format($$insert into public.organization_member(org_id, user_id, role) values (%L, %L::uuid, 'owner')$$,
    :'orgR', current_setting('t.owner')));
select dblink_exec('payroll_race_setup',
  format($$insert into public.people(id, org_id, name, active) values (%L, %L, 'عامل السباق', true)$$,
    :'pRace', :'orgR'));
select dblink_exec('payroll_race_setup',
  format($$insert into public.people_compensation(org_id, person_id, mode, rate) values (%L, %L, 'hourly', 50)$$,
    :'orgR', :'pRace'));
select dblink_exec('payroll_race_setup',
  format(
    $$insert into public.labor_logs(org_id, person_id, work_date, hours, mode)
       values (%L, %L, '2026-07-02', 4, 'hourly')$$,
    :'orgR', :'pRace'));
select dblink_disconnect('payroll_race_setup');

select dblink_connect('payroll_racer_1', current_setting('t.dsn'));
select dblink_connect('payroll_racer_2', current_setting('t.dsn'));
select dblink_exec('payroll_racer_1', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('payroll_racer_1', 'set role authenticated');
select dblink_exec('payroll_racer_2', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('payroll_racer_2', 'set role authenticated');

select dblink_exec('payroll_racer_1', 'begin');
select is(
  (select (result->>'total_gross')::numeric
     from dblink('payroll_racer_1',
       format($$select public.fn_close_payroll_run(%L::uuid, '2026-07-01'::date, '2026-07-07'::date)$$, :'orgR')
     ) as race_one(result jsonb)),
  200.00, 'race backend 1 closes the period while holding the per-(org,period) mutex (4h × 50 = 200)');

select is(
  dblink_send_query('payroll_racer_2',
    format($$select public.fn_close_payroll_run(%L::uuid, '2026-07-01'::date, '2026-07-07'::date)$$, :'orgR')),
  1, 'race backend 2 dispatches the concurrent close');

select ok(
  pg_temp.wait_for_solo_advisory_waiter(:'orgR'::uuid),
  'race backend 2 blocks on the SAME per-(org,period) payroll mutex');

select dblink_exec('payroll_racer_1', 'commit');

do $$
declare
  v_result jsonb;
  v_state  text;
begin
  begin
    select result into v_result from dblink_get_result('payroll_racer_2') as race_two(result jsonb);
    perform set_config('t.payroll_race_result', coalesce(v_result::text, '{"status":"missing"}'), false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform set_config('t.payroll_race_result',
      json_build_object('status', 'error', 'sqlstate', v_state)::text, false);
  end;
  begin
    perform * from dblink_get_result('payroll_racer_2') as drained(result jsonb);
  exception when others then
    null;
  end;
end $$;

select is(
  (current_setting('t.payroll_race_result')::jsonb->>'total_gross')::numeric,
  200.00, 'race backend 2 replays the SAME closed run — no recompute, no double pay');
select is(
  current_setting('t.payroll_race_result')::jsonb->>'run_id',
  (select id::text from public.payroll_runs where org_id = :'orgR' limit 1),
  'race backend 2''s replayed run_id matches the single committed run');
select is(
  (select count(*)::int from public.payroll_runs where org_id = :'orgR'),
  1, 'exactly ONE payroll run exists for the raced org/period');
select is(
  (select count(*)::int from public.payroll_run_lines l join public.payroll_runs r on r.id = l.run_id
    where r.org_id = :'orgR'),
  1, 'exactly ONE snapshot line exists — the losing racer never double-inserted');

select dblink_disconnect('payroll_racer_1');
select dblink_disconnect('payroll_racer_2');

-- Self-cleaning teardown of everything this race COMMITTED on side connections (mirrors "200
-- accounting reconciliation execute expense batch test.sql"'s own teardown) — the outer rollback below
-- cannot remove rows another backend already committed.
select dblink_connect('payroll_race_cleanup', current_setting('t.dsn'));
select pg_temp.reset_payroll_race_org('payroll_race_cleanup', :'orgR');
select dblink_disconnect('payroll_race_cleanup');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PART C1 — REAL two-session concurrency: two closers racing OVERLAPPING-but-DIFFERENT periods for the
-- SAME org (#394 follow-up). Must serialize on the SAME per-org mutex as the exact-period race above,
-- and the loser must be REJECTED (23505), never double-priced.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
\set orgR2 'aaaa0729-0000-0000-0000-0000000000d0'
\set pRace2 'aaaa0729-0000-0000-0000-0000000000d1'

-- idempotent pre-setup cleanup: recover from a prior run that errored before its own teardown ran.
select dblink_connect('payroll_race2_precleanup', current_setting('t.dsn'));
select pg_temp.reset_payroll_race_org('payroll_race2_precleanup', :'orgR2');
select dblink_disconnect('payroll_race2_precleanup');

select dblink_connect('payroll_race2_setup', current_setting('t.dsn'));
select dblink_exec('payroll_race2_setup',
  format($$insert into public.organization(id, name) values (%L, 'مزرعة سباق التداخل')$$, :'orgR2'));
select dblink_exec('payroll_race2_setup',
  format($$insert into public.organization_member(org_id, user_id, role) values (%L, %L::uuid, 'owner')$$,
    :'orgR2', current_setting('t.owner')));
select dblink_exec('payroll_race2_setup',
  format($$insert into public.people(id, org_id, name, active) values (%L, %L, 'عامل سباق التداخل', true)$$,
    :'pRace2', :'orgR2'));
select dblink_exec('payroll_race2_setup',
  format($$insert into public.people_compensation(org_id, person_id, mode, rate) values (%L, %L, 'hourly', 50)$$,
    :'orgR2', :'pRace2'));
select dblink_exec('payroll_race2_setup',
  format(
    $$insert into public.labor_logs(org_id, person_id, work_date, hours, mode)
       values (%L, %L, '2026-07-02', 4, 'hourly')$$,
    :'orgR2', :'pRace2'));
select dblink_disconnect('payroll_race2_setup');

select dblink_connect('payroll_racer2_1', current_setting('t.dsn'));
select dblink_connect('payroll_racer2_2', current_setting('t.dsn'));
select dblink_exec('payroll_racer2_1', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('payroll_racer2_1', 'set role authenticated');
select dblink_exec('payroll_racer2_2', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('payroll_racer2_2', 'set role authenticated');

select dblink_exec('payroll_racer2_1', 'begin');
select is(
  (select (result->>'total_gross')::numeric
     from dblink('payroll_racer2_1',
       format($$select public.fn_close_payroll_run(%L::uuid, '2026-07-01'::date, '2026-07-07'::date)$$, :'orgR2')
     ) as race_one(result jsonb)),
  200.00, 'overlap race: racer 1 closes days 1-7 while holding the per-org payroll mutex (4h × 50 = 200)');

select is(
  dblink_send_query('payroll_racer2_2',
    format($$select public.fn_close_payroll_run(%L::uuid, '2026-07-05'::date, '2026-07-11'::date)$$, :'orgR2')),
  1, 'overlap race: racer 2 dispatches a concurrent close for an OVERLAPPING-but-different period (5-11)');

select ok(
  pg_temp.wait_for_solo_advisory_waiter(:'orgR2'::uuid),
  'overlap race: racer 2 blocks on the SAME per-org payroll mutex racer 1 holds');

select dblink_exec('payroll_racer2_1', 'commit');

do $$
declare
  v_state text;
begin
  begin
    perform * from dblink_get_result('payroll_racer2_2') as t(r jsonb);
    perform set_config('t.race2_state', 'no error', false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform set_config('t.race2_state', v_state, false);
  end;
  begin
    perform * from dblink_get_result('payroll_racer2_2') as drained(r jsonb);
  exception when others then null;
  end;
end $$;

select is(
  current_setting('t.race2_state'), '23505',
  'overlap race: racer 2 is rejected (23505) once racer 1''s overlapping close has committed — no double price');
select is(
  (select count(*)::int from public.payroll_runs where org_id = :'orgR2'),
  1, 'overlap race: exactly ONE payroll run exists for the raced org (the loser never inserted)');

select dblink_disconnect('payroll_racer2_1');
select dblink_disconnect('payroll_racer2_2');

select dblink_connect('payroll_race2_cleanup', current_setting('t.dsn'));
select pg_temp.reset_payroll_race_org('payroll_race2_cleanup', :'orgR2');
select dblink_disconnect('payroll_race2_cleanup');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PART C2a — REAL two-session concurrency: a labor_logs write that COMMITS BEFORE a concurrent close's
-- aggregation runs must be INCLUDED in that close — the write-holds-the-mutex-first direction of #394's
-- "coordinate labor writes with close so late writes cannot escape".
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
\set orgR3 'aaaa0729-0000-0000-0000-0000000000e0'
\set pRace3 'aaaa0729-0000-0000-0000-0000000000e1'

-- idempotent pre-setup cleanup: recover from a prior run that errored before its own teardown ran.
select dblink_connect('payroll_race3_precleanup', current_setting('t.dsn'));
select pg_temp.reset_payroll_race_org('payroll_race3_precleanup', :'orgR3');
select dblink_disconnect('payroll_race3_precleanup');

select dblink_connect('payroll_race3_setup', current_setting('t.dsn'));
select dblink_exec('payroll_race3_setup',
  format($$insert into public.organization(id, name) values (%L, 'مزرعة سباق الكتابة المتأخرة')$$, :'orgR3'));
select dblink_exec('payroll_race3_setup',
  format($$insert into public.organization_member(org_id, user_id, role) values (%L, %L::uuid, 'owner')$$,
    :'orgR3', current_setting('t.owner')));
select dblink_exec('payroll_race3_setup',
  format($$insert into public.people(id, org_id, name, active) values (%L, %L, 'عامل سباق الكتابة', true)$$,
    :'pRace3', :'orgR3'));
select dblink_exec('payroll_race3_setup',
  format($$insert into public.people_compensation(org_id, person_id, mode, rate) values (%L, %L, 'hourly', 50)$$,
    :'orgR3', :'pRace3'));
select dblink_exec('payroll_race3_setup',
  format(
    $$insert into public.labor_logs(org_id, person_id, work_date, hours, mode)
       values (%L, %L, '2026-07-02', 4, 'hourly')$$,
    :'orgR3', :'pRace3'));
select dblink_disconnect('payroll_race3_setup');

select dblink_connect('payroll_writer_3', current_setting('t.dsn'));
select dblink_connect('payroll_closer_3', current_setting('t.dsn'));
select dblink_exec('payroll_writer_3', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('payroll_writer_3', 'set role authenticated');
select dblink_exec('payroll_closer_3', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('payroll_closer_3', 'set role authenticated');

-- the writer begins and inserts a LATE labor_logs row, holding the SHARE mutex open (uncommitted).
select dblink_exec('payroll_writer_3', 'begin');
select ok(
  dblink_exec('payroll_writer_3',
    format($$insert into public.labor_logs(org_id, person_id, work_date, hours, mode)
             values (%L, %L, '2026-07-03', 4, 'hourly')$$, :'orgR3', :'pRace3')
  ) = 'INSERT 0 1',
  'write race: the writer inserts a LATE labor_logs row and holds the SHARE mutex open (uncommitted)');

select is(
  dblink_send_query('payroll_closer_3',
    format($$select public.fn_close_payroll_run(%L::uuid, '2026-07-01'::date, '2026-07-07'::date)$$, :'orgR3')),
  1, 'write race: the closer dispatches a concurrent close for the SAME period');

select ok(
  pg_temp.wait_for_solo_advisory_waiter(:'orgR3'::uuid),
  'write race: the closer blocks on the per-org mutex the writer holds');

select dblink_exec('payroll_writer_3', 'commit');

do $$
declare
  v_state text;
  v_result jsonb;
begin
  begin
    select r into v_result from dblink_get_result('payroll_closer_3') as t(r jsonb);
    perform set_config('t.close3_state', 'no error', false);
    perform set_config('t.close3_result', coalesce(v_result::text, '{"status":"missing"}'), false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform set_config('t.close3_state', v_state, false);
    perform set_config('t.close3_result', '{"status":"missing"}', false);
  end;
  begin
    perform * from dblink_get_result('payroll_closer_3') as drained(r jsonb);
  exception when others then null;
  end;
end $$;

select is(current_setting('t.close3_state'), 'no error',
  'write race: the close succeeds once the writer''s transaction commits');
select is(
  (current_setting('t.close3_result')::jsonb->>'total_gross')::numeric, 400.00,
  'write race: total_gross INCLUDES the late-but-committed-before-aggregation write (8h × 50 = 400)');

select dblink_disconnect('payroll_writer_3');
select dblink_disconnect('payroll_closer_3');

select dblink_connect('payroll_race3_cleanup', current_setting('t.dsn'));
select pg_temp.reset_payroll_race_org('payroll_race3_cleanup', :'orgR3');
select dblink_disconnect('payroll_race3_cleanup');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PART C2b — REAL two-session concurrency: a close that COMMITS BEFORE a concurrent labor_logs write's
-- freeze-check runs must cause that write to be REJECTED — the close-holds-the-mutex-first direction of
-- the same #394 coordination requirement.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
\set orgR4 'aaaa0729-0000-0000-0000-0000000000f0'
\set pRace4 'aaaa0729-0000-0000-0000-0000000000f1'

-- idempotent pre-setup cleanup: recover from a prior run that errored before its own teardown ran.
select dblink_connect('payroll_race4_precleanup', current_setting('t.dsn'));
select pg_temp.reset_payroll_race_org('payroll_race4_precleanup', :'orgR4');
select dblink_disconnect('payroll_race4_precleanup');

select dblink_connect('payroll_race4_setup', current_setting('t.dsn'));
select dblink_exec('payroll_race4_setup',
  format($$insert into public.organization(id, name) values (%L, 'مزرعة سباق التجميد')$$, :'orgR4'));
select dblink_exec('payroll_race4_setup',
  format($$insert into public.organization_member(org_id, user_id, role) values (%L, %L::uuid, 'owner')$$,
    :'orgR4', current_setting('t.owner')));
select dblink_exec('payroll_race4_setup',
  format($$insert into public.people(id, org_id, name, active) values (%L, %L, 'عامل سباق التجميد', true)$$,
    :'pRace4', :'orgR4'));
select dblink_exec('payroll_race4_setup',
  format($$insert into public.people_compensation(org_id, person_id, mode, rate) values (%L, %L, 'hourly', 50)$$,
    :'orgR4', :'pRace4'));
select dblink_exec('payroll_race4_setup',
  format(
    $$insert into public.labor_logs(org_id, person_id, work_date, hours, mode)
       values (%L, %L, '2026-07-02', 4, 'hourly')$$,
    :'orgR4', :'pRace4'));
select dblink_disconnect('payroll_race4_setup');

select dblink_connect('payroll_closer_4', current_setting('t.dsn'));
select dblink_connect('payroll_writer_4', current_setting('t.dsn'));
select dblink_exec('payroll_closer_4', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('payroll_closer_4', 'set role authenticated');
select dblink_exec('payroll_writer_4', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('payroll_writer_4', 'set role authenticated');

-- the closer begins and closes the period, holding the EXCLUSIVE mutex open (uncommitted).
select dblink_exec('payroll_closer_4', 'begin');
select is(
  (select (result->>'total_gross')::numeric
     from dblink('payroll_closer_4',
       format($$select public.fn_close_payroll_run(%L::uuid, '2026-07-01'::date, '2026-07-07'::date)$$, :'orgR4')
     ) as race_close(result jsonb)),
  200.00, 'freeze race: the closer closes days 1-7 (4h × 50 = 200) and holds the EXCLUSIVE mutex open');

select is(
  dblink_send_query('payroll_writer_4',
    format($$insert into public.labor_logs(org_id, person_id, work_date, hours, mode)
             values (%L, %L, '2026-07-03', 4, 'hourly')$$, :'orgR4', :'pRace4')),
  1, 'freeze race: a concurrent labor_logs write for the SAME (now-closing) period is dispatched');

select ok(
  pg_temp.wait_for_solo_advisory_waiter(:'orgR4'::uuid),
  'freeze race: the write blocks on the per-org mutex the closer holds');

select dblink_exec('payroll_closer_4', 'commit');

do $$
declare
  v_state text;
begin
  begin
    perform * from dblink_get_result('payroll_writer_4') as t(r int);
    perform set_config('t.write4_state', 'no error', false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform set_config('t.write4_state', v_state, false);
  end;
  begin
    perform * from dblink_get_result('payroll_writer_4') as drained(r int);
  exception when others then null;
  end;
end $$;

select is(current_setting('t.write4_state'), '55000',
  'freeze race: the write is REJECTED (55000) once the closer''s close has committed — no late write escapes');
select is(
  (select count(*)::int from public.labor_logs where org_id = :'orgR4' and work_date = '2026-07-03'),
  0, 'freeze race: the rejected write never landed a row');

select dblink_disconnect('payroll_closer_4');
select dblink_disconnect('payroll_writer_4');

select dblink_connect('payroll_race4_cleanup', current_setting('t.dsn'));
select pg_temp.reset_payroll_race_org('payroll_race4_cleanup', :'orgR4');
select dblink_disconnect('payroll_race4_cleanup');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PART C3 — REAL two-session concurrency: a people_compensation rate UPDATE that COMMITS BEFORE a
-- concurrent close's aggregation runs must block that close on the shared per-org mutex, and the close
-- must price against the FULLY COMMITTED new rate (byte review fix #2 — "coordinate compensation writes
-- with close so a run cannot mix old/new rates across loop statements"). Also proves a further
-- compensation edit issued AFTER the close still succeeds unblocked (no freeze of future rate edits) and
-- never retouches the already-frozen snapshot line.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
\set orgR5 'aaaa0729-0000-0000-0000-0000000000a0'
\set pRace5 'aaaa0729-0000-0000-0000-0000000000a1'

-- idempotent pre-setup cleanup: recover from a prior run that errored before its own teardown ran.
select dblink_connect('payroll_race5_precleanup', current_setting('t.dsn'));
select pg_temp.reset_payroll_race_org('payroll_race5_precleanup', :'orgR5');
select dblink_disconnect('payroll_race5_precleanup');

select dblink_connect('payroll_race5_setup', current_setting('t.dsn'));
select dblink_exec('payroll_race5_setup',
  format($$insert into public.organization(id, name) values (%L, 'مزرعة سباق سعر الأجر')$$, :'orgR5'));
select dblink_exec('payroll_race5_setup',
  format($$insert into public.organization_member(org_id, user_id, role) values (%L, %L::uuid, 'owner')$$,
    :'orgR5', current_setting('t.owner')));
select dblink_exec('payroll_race5_setup',
  format($$insert into public.people(id, org_id, name, active) values (%L, %L, 'عامل سباق السعر', true)$$,
    :'pRace5', :'orgR5'));
select dblink_exec('payroll_race5_setup',
  format($$insert into public.people_compensation(org_id, person_id, mode, rate) values (%L, %L, 'hourly', 50)$$,
    :'orgR5', :'pRace5'));
select dblink_exec('payroll_race5_setup',
  format(
    $$insert into public.labor_logs(org_id, person_id, work_date, hours, mode)
       values (%L, %L, '2026-07-02', 4, 'hourly')$$,
    :'orgR5', :'pRace5'));
select dblink_disconnect('payroll_race5_setup');

select dblink_connect('payroll_rate_writer_5', current_setting('t.dsn'));
select dblink_connect('payroll_closer_5', current_setting('t.dsn'));
select dblink_exec('payroll_rate_writer_5', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('payroll_rate_writer_5', 'set role authenticated');
select dblink_exec('payroll_closer_5', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text));
select dblink_exec('payroll_closer_5', 'set role authenticated');

-- the rate writer begins and raises the hourly rate 50 -> 80, holding the SHARE mutex open (uncommitted).
select dblink_exec('payroll_rate_writer_5', 'begin');
select ok(
  dblink_exec('payroll_rate_writer_5',
    format($$update public.people_compensation set rate = 80
             where org_id = %L and person_id = %L and mode = 'hourly'$$, :'orgR5', :'pRace5')
  ) = 'UPDATE 1',
  'rate race: the writer raises the hourly rate 50->80 and holds the SHARE mutex open (uncommitted)');

select is(
  dblink_send_query('payroll_closer_5',
    format($$select public.fn_close_payroll_run(%L::uuid, '2026-07-01'::date, '2026-07-07'::date)$$, :'orgR5')),
  1, 'rate race: the closer dispatches a concurrent close for the period covering the raced rate');

select ok(
  pg_temp.wait_for_solo_advisory_waiter(:'orgR5'::uuid),
  'rate race: the closer blocks on the per-org mutex the rate writer holds');

select dblink_exec('payroll_rate_writer_5', 'commit');

do $$
declare
  v_state text;
  v_result jsonb;
begin
  begin
    select r into v_result from dblink_get_result('payroll_closer_5') as t(r jsonb);
    perform set_config('t.close5_state', 'no error', false);
    perform set_config('t.close5_result', coalesce(v_result::text, '{"status":"missing"}'), false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform set_config('t.close5_state', v_state, false);
    perform set_config('t.close5_result', '{"status":"missing"}', false);
  end;
  begin
    perform * from dblink_get_result('payroll_closer_5') as drained(r jsonb);
  exception when others then null;
  end;
end $$;

select is(current_setting('t.close5_state'), 'no error',
  'rate race: the close succeeds once the rate writer''s transaction commits');
select is(
  (current_setting('t.close5_result')::jsonb->>'total_gross')::numeric, 320.00,
  'rate race: total_gross prices against the FULLY COMMITTED new rate (4h x 80 = 320), never the stale 50');

select dblink_disconnect('payroll_rate_writer_5');
select dblink_disconnect('payroll_closer_5');

-- a further rate edit issued AFTER the close is unblocked (no freeze of future rate edits) and never
-- retouches the already-frozen snapshot line. Run this through a named side connection in
-- autocommit and disconnect it before asserting, so the outer (still-open) pgTAP transaction never
-- holds the row lock that the cleanup dblink connection below needs to delete the same row.
select dblink_connect('payroll_race5_postclose_writer', current_setting('t.dsn'));
select dblink_exec('payroll_race5_postclose_writer',
  format($$update public.people_compensation set rate = 999
           where org_id = %L and person_id = %L and mode = 'hourly'$$, :'orgR5', :'pRace5'));
select dblink_disconnect('payroll_race5_postclose_writer');

select is(
  (select rate from public.people_compensation where org_id = :'orgR5' and person_id = :'pRace5' and mode = 'hourly'),
  999::numeric, 'rate race: a compensation edit AFTER the close is not frozen (the coordination trigger never blocks it)');
select is(
  (select gross from public.payroll_run_lines l join public.payroll_runs r on r.id = l.run_id
    where r.org_id = :'orgR5' and l.person_id = :'pRace5'),
  320.00, 'rate race: the already-closed run''s snapshot line gross is UNCHANGED by the post-close rate edit');

select dblink_connect('payroll_race5_cleanup', current_setting('t.dsn'));
select pg_temp.reset_payroll_race_org('payroll_race5_cleanup', :'orgR5');
select dblink_disconnect('payroll_race5_cleanup');

select * from finish();
rollback;
