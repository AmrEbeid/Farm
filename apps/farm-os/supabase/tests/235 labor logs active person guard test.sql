-- 235 — attendance may be newly assigned only to an active same-org person.
-- Historical rows keep their person and remain correctable until the existing payroll freeze closes them.

begin;
create extension if not exists dblink;
select plan(33);

\set orgA            '00000000-0000-0000-0000-000000000001'
\set orgB            '23500000-0000-0000-0000-000000000010'
\set inactivePerson  '23500000-0000-0000-0000-000000000001'
\set historyPerson   '23500000-0000-0000-0000-000000000002'
\set activePerson    '23500000-0000-0000-0000-000000000003'
\set foreignPerson   '23500000-0000-0000-0000-000000000004'
\set foreignInactive '23500000-0000-0000-0000-000000000011'
\set historyLog      '23500000-0000-0000-0000-000000000005'
\set ownerLog        '23500000-0000-0000-0000-000000000006'
\set supervisorLog   '23500000-0000-0000-0000-000000000007'
\set racePerson      '23500000-0000-0000-0000-000000000008'
\set raceLog         '23500000-0000-0000-0000-000000000009'
\set rejectedRaceLog '23500000-0000-0000-0000-000000000012'

insert into public.organization (id, name) values (:'orgB', 'مزرعة حراسة حضور بعيدة');
insert into public.people (id, org_id, name, active) values
  (:'inactivePerson', :'orgA', 'عامل مؤرشف', false),
  (:'historyPerson', :'orgA', 'عامل سيؤرشف', true),
  (:'activePerson', :'orgA', 'عامل نشط', true),
  (:'foreignPerson', :'orgB', 'عامل نشط في مزرعة أخرى', true),
  (:'foreignInactive', :'orgB', 'عامل مؤرشف في مزرعة أخرى', false);

select has_function(
  'private', 'fn_guard_labor_log_active_person', array[]::text[],
  'active-person assignment guard exists'
);
select is_definer(
  'private', 'fn_guard_labor_log_active_person', array[]::text[],
  'active-person assignment guard is SECURITY DEFINER'
);
select is(
  (select proconfig from pg_proc
    where oid = 'private.fn_guard_labor_log_active_person()'::regprocedure),
  array['search_path=""']::text[],
  'active-person assignment guard pins an empty search_path'
);
select ok(
  not has_function_privilege('public',
    'private.fn_guard_labor_log_active_person()', 'EXECUTE')
  and not has_function_privilege('anon',
    'private.fn_guard_labor_log_active_person()', 'EXECUTE')
  and not has_function_privilege('authenticated',
    'private.fn_guard_labor_log_active_person()', 'EXECUTE'),
  'active-person assignment guard has no direct client execution grant'
);
select is(
  (select count(*)::integer
     from pg_trigger
    where tgrelid = 'public.labor_logs'::regclass
      and tgname = 'zz_guard_labor_log_active_person'
      and not tgisinternal),
  1,
  'labor_logs has exactly one active-person assignment trigger'
);
select ok(
  position('for share' in lower(pg_get_functiondef(
    'private.fn_guard_labor_log_active_person()'::regprocedure))) > 0
  and position('new.person_id is not distinct from old.person_id' in lower(pg_get_functiondef(
    'private.fn_guard_labor_log_active_person()'::regprocedure))) > 0
  and position('public.authorize(''labor.write'', new.org_id)' in lower(pg_get_functiondef(
    'private.fn_guard_labor_log_active_person()'::regprocedure))) > 0,
  'guard locks the worker, preserves unchanged attribution, and checks labor.write before lookup'
);
select ok(
  (select count(*) = 1
     from pg_policy
    where polrelid = 'public.labor_logs'::regclass
      and polname = 'tenant_all'
      and polcmd = '*'
      and polroles = array['authenticated'::regrole::oid]
      and position('user_org_ids' in pg_get_expr(polqual, polrelid)) > 0
      and position('authorize(''labor.write''' in pg_get_expr(polwithcheck, polrelid)) > 0
      and position('people' in pg_get_expr(polwithcheck, polrelid)) > 0
      and position('plan_operations' in pg_get_expr(polwithcheck, polrelid)) > 0),
  'the single authenticated tenant_all policy retains read, tenant, role, person and plan guards'
);

select set_config('test.owner', (
  select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1
), false);
select set_config('test.manager', (
  select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1
), false);
select set_config('test.supervisor', (
  select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'supervisor' limit 1
), false);
select set_config('test.accountant', (
  select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'accountant' limit 1
), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.accountant'));
select throws_ok(
  format($$insert into public.labor_logs (org_id, person_id, work_date, hours)
           values (%L, %L, current_date, 8)$$, :'orgA', :'activePerson'),
  '42501', null,
  'a non-labor.write member is denied without a worker-availability oracle'
);
select throws_ok(
  format($$insert into public.labor_logs (org_id, person_id, work_date, hours)
           values (%L, %L, current_date, 8)$$, :'orgA', :'inactivePerson'),
  '42501', null,
  'a non-labor.write member cannot distinguish an inactive same-org person'
);
reset role;

select pg_temp.as_user(current_setting('test.manager'));
select throws_ok(
  format($$insert into public.labor_logs (org_id, person_id, work_date, hours)
           values (%L, %L, current_date, 8)$$, :'orgA', :'inactivePerson'),
  'P7001', null,
  'an inactive person cannot receive new attendance'
);
select lives_ok(
  format($$insert into public.labor_logs (id, org_id, person_id, work_date, hours)
           values (%L, %L, %L, current_date, 8)$$,
         :'historyLog', :'orgA', :'historyPerson'),
  'an active same-org person can receive attendance'
);
select lives_ok(
  format($$insert into public.labor_logs (org_id, team_name, work_date, hours)
           values (%L, 'فريق موسمي', current_date, 6)$$, :'orgA'),
  'free-text crew attendance remains available'
);
select throws_ok(
  format($$insert into public.labor_logs (org_id, person_id, work_date, hours)
           values (%L, %L, current_date, 8)$$, :'orgA', :'foreignPerson'),
  '42501', null,
  'a cross-org person retains the existing RLS denial without revealing whether the person is active'
);
select throws_ok(
  format($$insert into public.labor_logs (org_id, person_id, work_date, hours)
           values (%L, %L, current_date, 8)$$, :'orgA', :'foreignInactive'),
  '42501', null,
  'an authorized writer cannot distinguish an inactive cross-org person'
);
reset role;

-- RLS-bypassing service/admin paths must still obey the trigger's integrity rule.
select throws_ok(
  format($$insert into public.labor_logs (org_id, person_id, work_date, hours)
           values (%L, %L, current_date, 8)$$, :'orgA', :'inactivePerson'),
  'P7001', null,
  'a privileged direct write cannot assign an inactive person'
);
select throws_ok(
  format($$insert into public.labor_logs (org_id, person_id, work_date, hours)
           values (%L, %L, current_date, 8)$$, :'orgA', :'foreignPerson'),
  'P7001', null,
  'a privileged direct write cannot create a cross-org person reference'
);

update public.people set active = false where id = :'historyPerson';

select pg_temp.as_user(current_setting('test.manager'));
select is(
  (select count(*)::integer from public.labor_logs where id = :'historyLog'),
  1,
  'historical attendance remains readable after the person is archived'
);
select throws_ok(
  format($$insert into public.labor_logs (org_id, person_id, work_date, hours)
           values (%L, %L, current_date + 1, 8)$$, :'orgA', :'historyPerson'),
  'P7001', null,
  'an archived historical person cannot receive another attendance row'
);
select lives_ok(
  format($$update public.labor_logs set note = 'تصحيح مفتوح بعد الأرشفة' where id = %L$$, :'historyLog'),
  'an open historical row may be corrected without changing its archived person'
);
select throws_ok(
  format($$update public.labor_logs set person_id = %L where id = %L$$,
         :'inactivePerson', :'historyLog'),
  'P7001', null,
  'an attendance row cannot be reassigned to an inactive person'
);
select lives_ok(
  format($$update public.labor_logs set person_id = %L where id = %L$$,
         :'activePerson', :'historyLog'),
  'an attendance row may be reassigned to an active same-org person'
);
select lives_ok(
  format($$update public.labor_logs set person_id = null, team_name = 'فريق مصحح' where id = %L$$,
         :'historyLog'),
  'a person attendance row may be corrected to a free-text team'
);
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  format($$insert into public.labor_logs (id, org_id, person_id, work_date, hours)
           values (%L, %L, %L, current_date, 7)$$,
         :'ownerLog', :'orgA', :'activePerson'),
  'owner can assign attendance to an active person'
);
reset role;

select pg_temp.as_user(current_setting('test.supervisor'));
select lives_ok(
  format($$insert into public.labor_logs (id, org_id, person_id, work_date, hours)
           values (%L, %L, %L, current_date, 7)$$,
         :'supervisorLog', :'orgA', :'activePerson'),
  'supervisor can assign attendance to an active person'
);
reset role;

-- Concurrency proof: an accepted insert holds FOR SHARE on the worker until commit, so archival cannot
-- overtake that assignment. The reverse ordering is covered above: once archival commits, P7001 wins.
select set_config('test.dsn', format(
  'host=%s port=%s dbname=%s user=%s',
  (select setting from pg_settings where name = 'unix_socket_directories'),
  (select setting from pg_settings where name = 'port'),
  current_database(), current_user
), false);
select dblink_connect('labor_guard_setup', current_setting('test.dsn'));
select dblink_exec('labor_guard_setup', format(
  'insert into public.people(id, org_id, name, active) values (%L, %L, %L, true)',
  :'racePerson', :'orgA', 'عامل سباق الأرشفة'));
select dblink_connect('labor_guard_writer', current_setting('test.dsn'));
select dblink_connect('labor_guard_archiver', current_setting('test.dsn'));
select dblink_exec('labor_guard_writer', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('test.manager'), 'role', 'authenticated')::text));
select dblink_exec('labor_guard_writer', 'set role authenticated');
select set_config('test.archiver_pid', (
  select pid::text from dblink('labor_guard_archiver', 'select pg_backend_pid()') as t(pid integer)
), false);

create or replace function pg_temp.wait_for_lock(p_pid integer)
returns boolean language plpgsql as $$
begin
  for i in 1..500 loop
    if exists (
      select 1 from pg_catalog.pg_stat_activity
       where pid = p_pid and wait_event_type = 'Lock'
    ) then
      return true;
    end if;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  return false;
end $$;

select dblink_exec('labor_guard_writer', 'begin');
select is(
  dblink_exec('labor_guard_writer', format(
    'insert into public.labor_logs(id, org_id, person_id, work_date, hours) values (%L, %L, %L, %L, 8)',
    :'raceLog', :'orgA', :'racePerson', '2099-01-01')),
  'INSERT 0 1',
  'race writer accepts an active person while retaining the worker row lock'
);
select is(
  dblink_send_query('labor_guard_archiver', format(
    'update public.people set active = false where id = %L returning active', :'racePerson')),
  1,
  'concurrent worker archival is dispatched'
);
select ok(
  pg_temp.wait_for_lock(current_setting('test.archiver_pid')::integer),
  'concurrent archival waits for the attendance assignment worker lock'
);
select dblink_exec('labor_guard_writer', 'commit');
select is(
  (select active from dblink_get_result('labor_guard_archiver') as t(active boolean)),
  false,
  'archival proceeds only after the accepted attendance transaction commits'
);
select * from dblink_get_result('labor_guard_archiver') as drained(active boolean);

-- Reverse ordering: archive first but leave it uncommitted. Assignment must wait for that row and then
-- reject the newly inactive worker after the archive commits.
select dblink_exec('labor_guard_archiver', format(
  'update public.people set active = true where id = %L', :'racePerson'));
select set_config('test.writer_pid', (
  select pid::text from dblink('labor_guard_writer', 'select pg_backend_pid()') as t(pid integer)
), false);
select dblink_exec('labor_guard_archiver', 'begin');
select dblink_exec('labor_guard_archiver', format(
  'update public.people set active = false where id = %L', :'racePerson'));
select is(
  dblink_send_query('labor_guard_writer', format(
    'insert into public.labor_logs(id, org_id, person_id, work_date, hours) values (%L, %L, %L, %L, 8)',
    :'rejectedRaceLog', :'orgA', :'racePerson', '2099-01-02')),
  1,
  'archive-first concurrent attendance is dispatched'
);
select ok(
  pg_temp.wait_for_lock(current_setting('test.writer_pid')::integer),
  'archive-first attendance waits for the worker archival transaction'
);
select dblink_exec('labor_guard_archiver', 'commit');
do $$
declare
  v_state text;
begin
  begin
    perform * from dblink_get_result('labor_guard_writer') as result(status text);
    perform set_config('test.archive_first_state', 'no error', false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform set_config('test.archive_first_state', v_state, false);
  end;
  begin
    perform * from dblink_get_result('labor_guard_writer') as drained(status text);
  exception when others then null;
  end;
end $$;
select is(
  current_setting('test.archive_first_state'),
  'P7001',
  'archive-first attendance rechecks the committed worker state and fails closed'
);
select is(
  (select count(*)::integer from public.labor_logs where id = :'rejectedRaceLog'),
  0,
  'archive-first rejection leaves no attendance row'
);

select dblink_exec('labor_guard_archiver', 'set session_replication_role = replica');
select dblink_exec('labor_guard_archiver', format(
  'delete from public.audit_log where entity_id in (%L, %L); delete from public.labor_logs where id = %L; delete from public.people where id = %L',
  :'raceLog', :'racePerson', :'raceLog', :'racePerson'));
select dblink_exec('labor_guard_archiver', 'set session_replication_role = origin');
select dblink_disconnect('labor_guard_writer');
select dblink_disconnect('labor_guard_archiver');
select dblink_disconnect('labor_guard_setup');
select is(
  (select count(*)::integer from public.people where id = :'racePerson'),
  0,
  'committed concurrency fixture is removed'
);

select * from finish();
rollback;
