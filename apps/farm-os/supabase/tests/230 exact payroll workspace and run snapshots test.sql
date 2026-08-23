-- R4b pass 1: the payroll WORKSPACE (run history) and RUN detail snapshots are exact, bounded,
-- active-organisation only, and read exclusively the frozen payroll_runs/payroll_run_lines columns.
--
-- The facts this file exists to pin:
--   1. exact run/line counts and totals are published SEPARATELY from the bounded page;
--   2. a run outside the active organisation reads exactly like one that never existed;
--   3. neither snapshot ever leaks closed_by (closer identity) or person contact PII;
--   4. a total_gross/line-sum drift, a cross-org line reference, or a closed run with zero stored
--      lines, fails the read closed (23514) — an empty closed run is corruption, never a valid zero
--      run, since fn_close_payroll_run itself refuses to write one.
begin;
select no_plan();

\set org '23000000-0000-0000-0000-0000000000a0'
\set org_b '23000000-0000-0000-0000-0000000000b0'
\set person_a '23000000-0000-0000-0000-000000000101'
\set person_b '23000000-0000-0000-0000-000000000102'
\set person_foreign '23000000-0000-0000-0000-000000000103'
\set run_1 '23000000-0000-0000-0000-000000000201'
\set run_2 '23000000-0000-0000-0000-000000000202'
\set run_empty '23000000-0000-0000-0000-000000000203'
\set run_foreign '23000000-0000-0000-0000-000000000204'
\set run_trigger '23000000-0000-0000-0000-000000000205'
\set line_a1 '23000000-0000-0000-0000-000000000301'
\set line_a2 '23000000-0000-0000-0000-000000000302'
\set line_b1 '23000000-0000-0000-0000-000000000303'
\set line_trigger '23000000-0000-0000-0000-000000000305'
\set missing '23000000-0000-0000-0000-0000000000ff'

select set_config('test.owner', (select user_id::text from public.organization_member where role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member where role = 'accountant' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member where role = 'farm_manager' limit 1), false);
select set_config('test.storekeeper', (select user_id::text from public.organization_member where role = 'storekeeper' limit 1), false);

insert into public.organization(id, name) values
  (:'org', 'Exact payroll workspace org'),
  (:'org_b', 'Exact payroll foreign org');
insert into public.organization_member(org_id, user_id, role) values
  (:'org', current_setting('test.owner')::uuid, 'owner'),
  (:'org', current_setting('test.accountant')::uuid, 'accountant'),
  (:'org', current_setting('test.manager')::uuid, 'farm_manager'),
  (:'org', current_setting('test.storekeeper')::uuid, 'storekeeper'),
  (:'org_b', current_setting('test.owner')::uuid, 'owner');
insert into public.data_authority_status(org_id, domain, status, source_label, record_count, notes) values
  (:'org', 'payroll', 'partial', 'fixture', 2, 'partial test fixture');

insert into public.people(id, org_id, name) values
  (:'person_a', :'org', 'Person A'),
  (:'person_b', :'org', 'Person B'),
  (:'person_foreign', :'org_b', 'Foreign Person');

-- Runs and lines written with triggers disabled: this is recorded CLOSED state, not a live close.
-- `run_empty` is deliberately NOT part of this baseline: a closed run with zero stored lines is
-- corruption under the corrected contract (fn_close_payroll_run itself refuses to write one), so it is
-- introduced later, in its own corruption section, rather than as a legitimate baseline row.
set local session_replication_role = replica;
insert into public.payroll_runs(id, org_id, period_start, period_end, closed_at, total_gross) values
  (:'run_1', :'org', '2026-01-01', '2026-01-15', '2026-01-16T09:00:00+00', 300),
  (:'run_2', :'org', '2026-01-16', '2026-01-31', '2026-02-01T09:00:00+00', 100),
  (:'run_foreign', :'org_b', '2026-01-01', '2026-01-15', '2026-01-16T09:00:00+00', 50);
insert into public.payroll_run_lines(id, org_id, run_id, person_id, person_name_snapshot, mode, unit, quantity, rate, gross) values
  (:'line_a1', :'org', :'run_1', :'person_a', 'Person A', 'hourly', null, 20, 10, 200),
  (:'line_a2', :'org', :'run_1', :'person_b', 'Person B', 'daily', null, 2, 50, 100),
  (:'line_b1', :'org', :'run_2', :'person_a', 'Person A', 'piece', 'box', 10, 10, 100);
insert into public.payroll_run_lines(id, org_id, run_id, person_id, person_name_snapshot, mode, unit, quantity, rate, gross) values
  ('23000000-0000-0000-0000-000000000304', :'org_b', :'run_foreign', :'person_foreign', 'Foreign Person', 'hourly', null, 5, 10, 50);
set local session_replication_role = origin;

-- ── grants and metadata ────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('public', 'public.fn_payroll_workspace_snapshot(uuid,integer,integer)', 'EXECUTE'), 'PUBLIC cannot execute the payroll workspace snapshot');
select ok(not has_function_privilege('anon', 'public.fn_payroll_workspace_snapshot(uuid,integer,integer)', 'EXECUTE'), 'anon cannot execute the payroll workspace snapshot');
select ok(has_function_privilege('authenticated', 'public.fn_payroll_workspace_snapshot(uuid,integer,integer)', 'EXECUTE'), 'authenticated reaches the payroll workspace gate');
select ok(not has_function_privilege('public', 'public.fn_payroll_run_snapshot(uuid,uuid,integer,integer)', 'EXECUTE'), 'PUBLIC cannot execute the payroll run snapshot');
select ok(not has_function_privilege('anon', 'public.fn_payroll_run_snapshot(uuid,uuid,integer,integer)', 'EXECUTE'), 'anon cannot execute the payroll run snapshot');
select ok(has_function_privilege('authenticated', 'public.fn_payroll_run_snapshot(uuid,uuid,integer,integer)', 'EXECUTE'), 'authenticated reaches the payroll run gate');
select ok(not (select prosecdef from pg_proc where oid = 'public.fn_payroll_workspace_snapshot(uuid,integer,integer)'::regprocedure), 'workspace snapshot is SECURITY INVOKER');
select ok(not (select prosecdef from pg_proc where oid = 'public.fn_payroll_run_snapshot(uuid,uuid,integer,integer)'::regprocedure), 'run snapshot is SECURITY INVOKER');
select is((select provolatile::text from pg_proc where oid = 'public.fn_payroll_workspace_snapshot(uuid,integer,integer)'::regprocedure), 's', 'workspace snapshot is stable');
select is((select provolatile::text from pg_proc where oid = 'public.fn_payroll_run_snapshot(uuid,uuid,integer,integer)'::regprocedure), 's', 'run snapshot is stable');
select is((select proconfig[1] from pg_proc where oid = 'public.fn_payroll_workspace_snapshot(uuid,integer,integer)'::regprocedure), 'search_path=""', 'workspace snapshot has an empty search_path');
select is((select proconfig[1] from pg_proc where oid = 'public.fn_payroll_run_snapshot(uuid,uuid,integer,integer)'::regprocedure), 'search_path=""', 'run snapshot has an empty search_path');
select ok(not has_function_privilege('public', 'public.fn_freeze_payroll_person_name()', 'EXECUTE'), 'PUBLIC cannot call the internal name-freeze trigger function');
select ok(not has_function_privilege('authenticated', 'public.fn_freeze_payroll_person_name()', 'EXECUTE'), 'authenticated cannot call the internal name-freeze trigger function');
select ok((select attnotnull from pg_attribute where attrelid = 'public.payroll_run_lines'::regclass and attname = 'person_name_snapshot'), 'the stored person-name snapshot is mandatory');

create or replace function pg_temp.as_user(uid text, active_org uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', case when active_org is null
    then json_build_object('sub', uid, 'role', 'authenticated')
    else json_build_object('sub', uid, 'role', 'authenticated', 'active_org_id', active_org) end::text, true);
  execute 'set local role authenticated';
end $$;

-- A normal line insert freezes today's name without changing fn_close_payroll_run itself. Roll the
-- fixture back after proving the trigger so workspace totals remain the two intended baseline runs.
savepoint payroll_name_freeze_trigger;
insert into public.payroll_runs(id, org_id, period_start, period_end, closed_at, total_gross)
values (:'run_trigger', :'org', '2026-02-01', '2026-02-01', '2026-02-02T09:00:00+00', 10);
insert into public.payroll_run_lines(id, org_id, run_id, person_id, mode, unit, quantity, rate, gross)
values (:'line_trigger', :'org', :'run_trigger', :'person_a', 'hourly', null, 1, 10, 10);
select is(
  (select person_name_snapshot from public.payroll_run_lines where id = :'line_trigger'),
  'Person A',
  'a normal payroll-line insert freezes the current worker name'
);
rollback to savepoint payroll_name_freeze_trigger;
release savepoint payroll_name_freeze_trigger;

-- ── the workspace snapshot: exact totals, exact counts, bounded deterministic page ─────────────
select pg_temp.as_user(current_setting('test.owner'), :'org');
select set_config('test.workspace', public.fn_payroll_workspace_snapshot(:'org', 20, 0)::text, false);

select is(current_setting('test.workspace')::jsonb->>'version', 'farm-os.payroll-workspace.v1', 'workspace version is pinned');
select is(current_setting('test.workspace')::jsonb->>'org_id', :'org', 'the workspace is bound to the active organization');
select is(current_setting('test.workspace')::jsonb->'authority'->>'payroll', 'partial', 'payroll authority is reported as partial');
select is((current_setting('test.workspace')::jsonb->'counts'->>'total_runs')::integer, 2, 'every recorded run in the organization is counted exactly');
select is((current_setting('test.workspace')::jsonb->'totals'->>'total_gross')::numeric, 400::numeric, 'the exact total gross sums every run, including the unpaginated ones');
select ok(jsonb_typeof(current_setting('test.workspace')::jsonb->'counts'->'total_runs') = 'string', 'counts leave PostgreSQL as exact text');
select ok(jsonb_typeof(current_setting('test.workspace')::jsonb->'totals'->'total_gross') = 'string', 'totals leave PostgreSQL as exact text too');
select is(jsonb_array_length(current_setting('test.workspace')::jsonb->'rows'), 2, 'the page holds every run when it fits');
select ok(not exists (
    select 1 from jsonb_array_elements(current_setting('test.workspace')::jsonb->'rows') r
     where r->>'run_id' = :'run_foreign'),
  'another organization''s run never appears');

-- deterministic order: most recently closed period first
select is(current_setting('test.workspace')::jsonb->'rows'->0->>'run_id', :'run_2', 'the most recent period leads the workspace');
select is(current_setting('test.workspace')::jsonb->'rows'->1->>'run_id', :'run_1', 'the oldest closed run trails');

-- exact line_count per run, and real paging
select is((select r->>'line_count' from jsonb_array_elements(current_setting('test.workspace')::jsonb->'rows') r
            where r->>'run_id' = :'run_1'), '2', 'the line count for a run with lines is exact');
select is(jsonb_array_length(public.fn_payroll_workspace_snapshot(:'org', 1, 0)->'rows'), 1, 'the page obeys its limit');
select is(jsonb_array_length(public.fn_payroll_workspace_snapshot(:'org', 1, 1)->'rows'), 1, 'the last page holds only what is left');
select is(jsonb_array_length(public.fn_payroll_workspace_snapshot(:'org', 1, 5)->'rows'), 0, 'a page past the end is empty, not an error');
select is((public.fn_payroll_workspace_snapshot(:'org', 1, 0)->'counts'->>'total_runs')::integer, 2,
  'the exact total is published SEPARATELY from the bounded page');

-- no closer identity anywhere
select ok(current_setting('test.workspace') not like '%closed_by%', 'the workspace snapshot never publishes who closed a run');
reset role;

-- ── other member roles with payroll.read keep the same workspace ──────────────────────────────
select pg_temp.as_user(current_setting('test.accountant'), :'org');
select is((public.fn_payroll_workspace_snapshot(:'org', 20, 0)->'counts'->>'total_runs')::integer, 2, 'the accountant sees the same exact workspace');
reset role;
select pg_temp.as_user(current_setting('test.manager'), :'org');
select throws_ok(format($$select public.fn_payroll_workspace_snapshot(%L, 20, 0)$$, :'org'), '42501', null, 'a member without payroll.read is refused the workspace');
reset role;
select pg_temp.as_user(current_setting('test.storekeeper'), :'org');
select throws_ok(format($$select public.fn_payroll_workspace_snapshot(%L, 20, 0)$$, :'org'), '42501', null, 'the storekeeper has no payroll.read and is refused the workspace');
reset role;

-- ── the run snapshot: frozen identity, exact line count, deterministic bounded page ────────────
select pg_temp.as_user(current_setting('test.owner'), :'org');
select set_config('test.run', public.fn_payroll_run_snapshot(:'org', :'run_1', 20, 0)::text, false);

select is(current_setting('test.run')::jsonb->>'version', 'farm-os.payroll-run.v1', 'run version is pinned');
select is(current_setting('test.run')::jsonb->>'run_id', :'run_1', 'the run snapshot is bound to its run');
select is(current_setting('test.run')::jsonb->>'org_id', :'org', 'the run snapshot is bound to the active organization');
select is(current_setting('test.run')::jsonb->>'period_start', '2026-01-01', 'the frozen period start is published as exact text');
select is(current_setting('test.run')::jsonb->>'period_end', '2026-01-15', 'the frozen period end is published as exact text');
select is((current_setting('test.run')::jsonb->>'total_gross')::numeric, 300::numeric, 'the frozen run total is published');
select is((current_setting('test.run')::jsonb->'counts'->>'total_lines')::integer, 2, 'the exact line count for the run is published');
select is(jsonb_array_length(current_setting('test.run')::jsonb->'rows'), 2, 'the page holds every line when it fits');

select is(current_setting('test.run')::jsonb->'rows'->0->>'person_name', 'Person A', 'lines are ordered by person name');
select is(current_setting('test.run')::jsonb->'rows'->1->>'person_name', 'Person B', 'then the next person');
select is((select r->>'gross' from jsonb_array_elements(current_setting('test.run')::jsonb->'rows') r
            where r->>'line_id' = :'line_a1'), '200', 'a frozen line gross is published exactly as stored');
select is((select r->>'mode' from jsonb_array_elements(current_setting('test.run')::jsonb->'rows') r
            where r->>'line_id' = :'line_a2'), 'daily', 'the frozen mode is published as stored');
select is((select r->>'unit' from jsonb_array_elements(current_setting('test.run')::jsonb->'rows') r
            where r->>'line_id' = :'line_a1'), null, 'a non-piece line publishes no unit');

-- real paging on the run's own lines
select is(jsonb_array_length(public.fn_payroll_run_snapshot(:'org', :'run_1', 1, 0)->'rows'), 1, 'the run line page obeys its own limit');
select is(jsonb_array_length(public.fn_payroll_run_snapshot(:'org', :'run_1', 1, 1)->'rows'), 1, 'the next line page holds the remainder');
select is(jsonb_array_length(public.fn_payroll_run_snapshot(:'org', :'run_1', 1, 2)->'rows'), 0, 'a run line page past the end is empty, not an error');
select is((public.fn_payroll_run_snapshot(:'org', :'run_1', 1, 0)->'counts'->>'total_lines')::integer, 2,
  'the exact line total is published SEPARATELY from the bounded page');

-- no contact PII, no closer identity, anywhere in the run payload
select ok(current_setting('test.run') not like '%closed_by%', 'the run snapshot never publishes who closed it');
select ok(current_setting('test.run') not like '%phone%' and current_setting('test.run') not like '%email%',
  'the run snapshot carries no contact PII for any person');

-- Historical identity is stored on the immutable line. Renaming today's person cannot rewrite a
-- closed report or reshuffle its bounded pages.
reset role;
update public.people set name = 'Person A renamed after close' where id = :'person_a';
select pg_temp.as_user(current_setting('test.owner'), :'org');
select is(
  public.fn_payroll_run_snapshot(:'org', :'run_1', 20, 0)->'rows'->0->>'person_name',
  'Person A',
  'a later people.name edit cannot change the stored historical payroll identity'
);

-- cross-org and nonexistent runs are indistinguishable
select ok(public.fn_payroll_run_snapshot(:'org', :'run_foreign', 20, 0) is null, 'another organization''s run reads as not found');
select ok(public.fn_payroll_run_snapshot(:'org', :'missing', 20, 0) is null, 'and a run id that exists nowhere reads exactly the same');
reset role;

-- ── tenant, claim and argument gates ───────────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_payroll_workspace_snapshot(%L, 20, 0)$$, :'org'), '42501', null, 'a missing active org fails closed on the workspace');
select throws_ok(format($$select public.fn_payroll_run_snapshot(%L, %L, 20, 0)$$, :'org', :'run_1'), '42501', null, 'a missing active org fails closed on the run');
reset role;
select pg_temp.as_user(current_setting('test.owner'), :'org_b');
select throws_ok(format($$select public.fn_payroll_workspace_snapshot(%L, 20, 0)$$, :'org'), '42501', null, 'an active-org mismatch fails closed on the workspace');
select throws_ok(format($$select public.fn_payroll_run_snapshot(%L, %L, 20, 0)$$, :'org', :'run_1'), '42501', null, 'an active-org mismatch fails closed on the run');
reset role;
select pg_temp.as_user(current_setting('test.manager'), :'org_b');
select throws_ok(format($$select public.fn_payroll_workspace_snapshot(%L, 20, 0)$$, :'org_b'), '42501', null, 'a non-member of the active org is refused');
reset role;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_payroll_workspace_snapshot(%L, 0, 0)$$, :'org'), '22023', null, 'a zero limit is refused on the workspace');
select throws_ok(format($$select public.fn_payroll_workspace_snapshot(%L, 51, 0)$$, :'org'), '22023', null, 'a limit above fifty is refused on the workspace');
select throws_ok(format($$select public.fn_payroll_workspace_snapshot(%L, 20, -1)$$, :'org'), '22023', null, 'a negative offset is refused on the workspace');
select throws_ok(format($$select public.fn_payroll_run_snapshot(%L, %L, 0, 0)$$, :'org', :'run_1'), '22023', null, 'a zero limit is refused on the run');
select throws_ok(format($$select public.fn_payroll_run_snapshot(%L, %L, 51, 0)$$, :'org', :'run_1'), '22023', null, 'a limit above fifty is refused on the run');
select throws_ok(format($$select public.fn_payroll_run_snapshot(%L, %L, 20, -1)$$, :'org', :'run_1'), '22023', null, 'a negative offset is refused on the run');
select throws_ok(format($$select public.fn_payroll_workspace_snapshot(null, 20, 0)$$), '23502', null, 'a null organization is refused on the workspace');
select throws_ok(format($$select public.fn_payroll_run_snapshot(%L, null, 20, 0)$$, :'org'), '23502', null, 'a null run is refused');
reset role;

-- ── corruption fails closed: a closed run with zero stored lines ───────────────────────────────
-- fn_close_payroll_run refuses an empty crew before its first write, so a payroll_runs row with no
-- payroll_run_lines behind it can only be corruption — never a valid "zero run" to report honestly.
set local session_replication_role = replica;
insert into public.payroll_runs(id, org_id, period_start, period_end, closed_at, total_gross) values
  (:'run_empty', :'org', '2026-02-01', '2026-02-15', '2026-02-16T09:00:00+00', 0);
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_payroll_workspace_snapshot(%L, 20, 0)$$, :'org'),
  '23514', null, 'a closed run with zero stored lines fails the workspace closed');
select throws_ok(format($$select public.fn_payroll_run_snapshot(%L, %L, 20, 0)$$, :'org', :'run_empty'),
  '23514', null, 'and fails that specific run closed too');
reset role;
set local session_replication_role = replica;
delete from public.payroll_runs where id = :'run_empty';
set local session_replication_role = origin;

-- Once the empty run is gone both snapshots read again: the guard is a gate, not a wall.
select pg_temp.as_user(current_setting('test.owner'), :'org');
select lives_ok(format($$select public.fn_payroll_workspace_snapshot(%L, 20, 0)$$, :'org'), 'a clean organization reads its workspace again');
reset role;

-- ── corruption fails closed: cross-org line reference and reconciliation drift ─────────────────
set local session_replication_role = replica;
insert into public.payroll_run_lines(id, org_id, run_id, person_id, person_name_snapshot, mode, unit, quantity, rate, gross)
values ('23000000-0000-0000-0000-000000000901', :'org', :'run_1', :'person_foreign', 'Foreign Person', 'hourly', null, 1, 10, 10);
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_payroll_workspace_snapshot(%L, 20, 0)$$, :'org'),
  '23514', null, 'a line whose person belongs to another organization fails the workspace closed');
select throws_ok(format($$select public.fn_payroll_run_snapshot(%L, %L, 20, 0)$$, :'org', :'run_1'),
  '23514', null, 'and fails the specific run closed too');
reset role;
set local session_replication_role = replica;
delete from public.payroll_run_lines where id = '23000000-0000-0000-0000-000000000901';
set local session_replication_role = origin;

-- Once the corrupt link is removed both snapshots read again: the guard is a gate, not a wall.
select pg_temp.as_user(current_setting('test.owner'), :'org');
select lives_ok(format($$select public.fn_payroll_workspace_snapshot(%L, 20, 0)$$, :'org'), 'a clean organization still reads its workspace');
select lives_ok(format($$select public.fn_payroll_run_snapshot(%L, %L, 20, 0)$$, :'org', :'run_1'), 'a clean organization still reads its run');
reset role;

set local session_replication_role = replica;
update public.payroll_runs set total_gross = 999 where id = :'run_1';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_payroll_workspace_snapshot(%L, 20, 0)$$, :'org'),
  '23514', null, 'a run whose total_gross drifts from its stored lines fails the workspace closed');
select throws_ok(format($$select public.fn_payroll_run_snapshot(%L, %L, 20, 0)$$, :'org', :'run_1'),
  '23514', null, 'and fails the specific run closed too');
reset role;
set local session_replication_role = replica;
update public.payroll_runs set total_gross = 300 where id = :'run_1';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select lives_ok(format($$select public.fn_payroll_workspace_snapshot(%L, 20, 0)$$, :'org'), 'reconciled again, the workspace reads cleanly');
reset role;

select * from finish();
rollback;
