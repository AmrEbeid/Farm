-- 207 - C-4 three-backend period-close concurrency regression.
-- A shared holder keeps a close queued for EXCLUSIVE access while a third backend attempts
-- the custody reversal. The reversal must fail immediately with 55P03, never join the mutex
-- queue, and append nothing. This makes the former rows-before-mutex deadlock state unreachable.

begin;
select no_plan();
create extension if not exists dblink;

\set race_org 'c2070000-0000-0000-0000-000000000001'
\set race_account 'c2070000-0000-0000-0000-000000000002'

select set_config('c207.owner', (
  select user_id::text
    from public.organization_member
   where org_id = '00000000-0000-0000-0000-000000000001'
     and role = 'owner'
   limit 1
), false);
select set_config('c207.dsn', format(
  'host=%s port=%s dbname=%s user=%s',
  (select setting from pg_settings where name = 'unix_socket_directories'),
  (select setting from pg_settings where name = 'port'),
  current_database(), current_user
), false);

create or replace function pg_temp.wait_for_period_mutex(p_pid integer, p_org uuid)
returns boolean language plpgsql as $$
declare
  v_classid oid := (((private.fn_accounting_period_mutex_key(p_org)) >> 32) & 4294967295)::oid;
  v_objid oid := ((private.fn_accounting_period_mutex_key(p_org)) & 4294967295)::oid;
begin
  for attempt in 1..500 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1
        from pg_locks lock
       where lock.pid = p_pid
         and lock.locktype = 'advisory'
         and lock.classid = v_classid
         and lock.objid = v_objid
         and not lock.granted
    ) then
      return true;
    end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end $$;

create or replace function pg_temp.settle_without_period_mutex(
  p_conn text, p_pid integer, p_org uuid
) returns text language plpgsql as $$
declare
  v_classid oid := (((private.fn_accounting_period_mutex_key(p_org)) >> 32) & 4294967295)::oid;
  v_objid oid := ((private.fn_accounting_period_mutex_key(p_org)) & 4294967295)::oid;
begin
  for attempt in 1..500 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1
        from pg_locks lock
       where lock.pid = p_pid
         and lock.locktype = 'advisory'
         and lock.classid = v_classid
         and lock.objid = v_objid
         and not lock.granted
    ) then
      return 'queued';
    end if;
    if dblink_is_busy(p_conn) = 0 then
      return 'settled';
    end if;
    perform pg_sleep(0.01);
  end loop;
  return 'timeout';
end $$;

create or replace function pg_temp.cleanup_c207(p_conn text, p_org uuid)
returns void language plpgsql as $$
begin
  perform dblink_exec(p_conn, 'set lock_timeout = ''5s''');
  perform dblink_exec(p_conn, 'set statement_timeout = ''15s''');
  perform dblink_exec(p_conn, 'set session_replication_role = replica');
  perform dblink_exec(p_conn, format('delete from public.journal_lines where org_id = %L', p_org));
  perform dblink_exec(p_conn, format('delete from public.journal_entries where org_id = %L', p_org));
  perform dblink_exec(p_conn, format('delete from public.custody_movements where org_id = %L', p_org));
  perform dblink_exec(p_conn, format('delete from public.accounting_periods where org_id = %L', p_org));
  perform dblink_exec(p_conn, format('delete from public.custody_accounts where org_id = %L', p_org));
  perform dblink_exec(p_conn, format('delete from public.organization_member where org_id = %L', p_org));
  perform dblink_exec(p_conn, format('delete from public.cost_centers where org_id = %L', p_org));
  perform dblink_exec(p_conn, format('delete from public.accounts where org_id = %L', p_org));
  perform dblink_exec(p_conn, format('delete from public.audit_log where org_id = %L', p_org));
  perform dblink_exec(p_conn, format('delete from public.organization where id = %L', p_org));
  perform dblink_exec(p_conn, 'set session_replication_role = origin');
end $$;

select dblink_connect('c207_setup', current_setting('c207.dsn'));
select pg_temp.cleanup_c207('c207_setup', :'race_org');
select dblink_exec('c207_setup', format(
  'insert into public.organization(id, name) values (%L, %L)',
  :'race_org', 'C-4 concurrency race org'));
select dblink_exec('c207_setup', format(
  'insert into public.organization_member(org_id, user_id, role) values (%L, %L::uuid, %L)',
  :'race_org', current_setting('c207.owner'), 'owner'));
select dblink_exec('c207_setup', format(
  'insert into public.custody_accounts(id, org_id, holder_label, target_float) values (%L, %L, %L, 1000)',
  :'race_account', :'race_org', 'C-4 concurrency account'));
select dblink_exec('c207_setup', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('c207.owner'), 'role', 'authenticated')::text));
select dblink_exec('c207_setup', 'set role authenticated');
select set_config('c207.movement', (
  select movement_id::text
    from dblink('c207_setup', format(
      $$select public.fn_record_custody_movement(%L, 'استلام عهدة من المالك', 500, 0, current_date)$$,
      :'race_account')) as result(movement_id uuid)
), false);
select dblink_exec('c207_setup', 'reset role');
select dblink_disconnect('c207_setup');

select dblink_connect('c207_holder', current_setting('c207.dsn'));
select dblink_connect('c207_close', current_setting('c207.dsn'));
select dblink_connect('c207_reverse', current_setting('c207.dsn'));
select dblink_exec('c207_close', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('c207.owner'), 'role', 'authenticated')::text));
select dblink_exec('c207_reverse', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('c207.owner'), 'role', 'authenticated')::text));
select dblink_exec('c207_close', 'set role authenticated');
select dblink_exec('c207_reverse', 'set role authenticated');
select dblink_exec('c207_close', $$set statement_timeout = '30s'$$);
select dblink_exec('c207_reverse', $$set statement_timeout = '10s'$$);
select set_config('c207.close_pid', (
  select pid::text from dblink('c207_close', 'select pg_backend_pid()') as backend(pid integer)
), false);
select set_config('c207.reverse_pid', (
  select pid::text from dblink('c207_reverse', 'select pg_backend_pid()') as backend(pid integer)
), false);

select dblink_exec('c207_holder', 'begin');
select is(
  (select locked from dblink('c207_holder', format(
    'select true from pg_advisory_xact_lock_shared(private.fn_accounting_period_mutex_key(%L))',
    :'race_org')) as result(locked boolean)),
  true,
  'race holder owns the organization shared period mutex');
select is(
  dblink_send_query('c207_close', format(
    $$select public.fn_close_accounting_period(%L, date '2017-01-01', date '2017-12-31', 'C-4 race close')$$,
    :'race_org')),
  1,
  'race close is dispatched while the shared mutex is held');
select ok(
  pg_temp.wait_for_period_mutex(current_setting('c207.close_pid')::integer, :'race_org'),
  'race close queues for the exclusive period mutex');

select is(
  dblink_send_query('c207_reverse', format(
    $$select public.fn_reverse_custody_movement(%L, 'C-4 race reversal', current_date)$$,
    current_setting('c207.movement'))),
  1,
  'third backend dispatches the C-4 reversal behind the queued close');
select is(
  pg_temp.settle_without_period_mutex(
    'c207_reverse', current_setting('c207.reverse_pid')::integer, :'race_org'),
  'settled',
  'C-4 settles without joining the period mutex queue');

do $$
declare
  v_state text;
begin
  begin
    perform * from dblink_get_result('c207_reverse') as result(payload jsonb);
    perform set_config('c207.reverse_state', 'no error', false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform set_config('c207.reverse_state', v_state, false);
  end;
  begin
    perform * from dblink_get_result('c207_reverse') as drained(payload jsonb);
  exception when others then null;
  end;
end $$;

select is(current_setting('c207.reverse_state'), '55P03',
  'C-4 fails immediately with the retryable close-in-progress SQLSTATE');
select is(
  (select count(*) from public.custody_movements
    where reversal_of = current_setting('c207.movement')::uuid),
  0::bigint,
  'the rejected concurrent reversal appends no custody mirror');
select is(
  (select status from public.journal_entries
    where source_type = 'custody_owner_funding'
      and source_id = current_setting('c207.movement')::uuid),
  'posted',
  'the rejected concurrent reversal leaves the original journal posted');

select dblink_exec('c207_holder', 'commit');
do $$
declare
  v_state text;
  v_period uuid;
begin
  begin
    select period_id into v_period from dblink_get_result('c207_close') as result(period_id uuid);
    perform set_config('c207.close_state', 'no error', false);
    perform set_config('c207.period', coalesce(v_period::text, 'none'), false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform set_config('c207.close_state', v_state, false);
    perform set_config('c207.period', 'none', false);
  end;
  begin
    perform * from dblink_get_result('c207_close') as drained(period_id uuid);
  exception when others then null;
  end;
end $$;
select is(current_setting('c207.close_state'), 'no error',
  'the queued close completes without deadlock or timeout after the holder commits');
select isnt(current_setting('c207.period'), 'none',
  'the queued close creates a real locked period');

select dblink_disconnect('c207_holder');
select dblink_disconnect('c207_close');
select dblink_disconnect('c207_reverse');
select dblink_connect('c207_cleanup', current_setting('c207.dsn'));
select pg_temp.cleanup_c207('c207_cleanup', :'race_org');
select dblink_disconnect('c207_cleanup');
select is((select count(*) from public.journal_lines where org_id = :'race_org'), 0::bigint,
  'cleanup removes every race journal line');
select is((select count(*) from public.journal_entries where org_id = :'race_org'), 0::bigint,
  'cleanup removes every race journal entry');
select is((select count(*) from public.custody_movements where org_id = :'race_org'), 0::bigint,
  'cleanup removes every race custody movement');
select is((select count(*) from public.accounting_periods where org_id = :'race_org'), 0::bigint,
  'cleanup removes every race accounting period');
select is((select count(*) from public.custody_accounts where org_id = :'race_org'), 0::bigint,
  'cleanup removes every race custody account');
select is((select count(*) from public.organization_member where org_id = :'race_org'), 0::bigint,
  'cleanup removes every race membership');
select is((select count(*) from public.cost_centers where org_id = :'race_org'), 0::bigint,
  'cleanup removes every race cost center');
select is((select count(*) from public.accounts where org_id = :'race_org'), 0::bigint,
  'cleanup removes every race ledger account');
select is((select count(*) from public.audit_log where org_id = :'race_org'), 0::bigint,
  'cleanup removes every race audit row');
select is((select count(*) from public.organization where id = :'race_org'), 0::bigint,
  'cleanup removes the race organization');
select is(
  (select count(*) from pg_stat_activity
    where application_name like '%dblink%' and pid <> pg_backend_pid()),
  0::bigint,
  'C-4 concurrency test leaves no dblink backend open');

select * from finish();
rollback;
