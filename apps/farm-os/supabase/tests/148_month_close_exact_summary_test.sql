-- fn_month_close_summary: exact, tenant-scoped, as-of checklist for /finance/close.
begin;
select plan(63);
create extension if not exists dblink;

\set org '00000000-0000-0000-0000-000000000001'
\set org_b '14800000-0000-0000-0000-0000000000b0'
\set org_c '14800000-0000-0000-0000-0000000000c0'
\set org_d '14800000-0000-0000-0000-0000000000d0'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.storekeeper', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'storekeeper' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

insert into public.organization (id, name) values (:'org_b', 'مزرعة أخرى 148');

insert into public.accounts(org_id, code, name_ar, account_type, normal_balance, kind, active)
values (:'org', 'EXP-148', 'حساب اختبار الإقفال', 'expense', 'debit', 'operating', true)
returning set_config('test.account', id::text, false);

insert into public.cost_centers(org_id, code, name_ar, active)
values (:'org', 'CC-148', 'مركز اختبار الإقفال', true)
returning set_config('test.cc', id::text, false);

-- In-scope expenses, 2026-07-01 through the supplied 2026-08-10 as-of:
-- R1 known, unrouted + unclassified + unallocated
-- R2 unknown, unrouted + unclassified + unallocated
-- R3 paid, unclassified only
-- R4 paid, unallocated only
-- R5/R6 void/reversed with missing dimensions: excluded from blockers
-- R7 before cutover and R8 after as-of: excluded from the dated snapshot
insert into public.expenses(org_id, date, category, total, kind, account_id, cost_center_id, payment_status)
values
  (:'org', '2026-07-05', 'غير موجّه معروف', 100, 'operating', null, null, null),
  (:'org', '2026-07-06', 'غير موجّه مجهول', null, 'operating', null, null, null),
  (:'org', '2026-07-07', 'غير مصنف', 50, 'operating', null, current_setting('test.cc')::uuid, 'paid_from_custody'),
  (:'org', '2026-07-08', 'غير موزع', 70, 'operating', current_setting('test.account')::uuid, null, 'paid_from_custody'),
  (:'org', '2026-07-09', 'ملغى', 999, 'operating', null, null, 'cancelled'),
  (:'org', '2026-07-10', 'معكوس', 888, 'operating', null, null, 'historical_reversed'),
  (:'org', '2026-06-30', 'قبل القطع', 777, 'operating', null, null, null),
  (:'org', '2026-08-11', 'بعد اللقطة', 666, 'operating', null, null, null),
  (:'org', null, 'بلا تاريخ معروف', 42, 'operating', null, null, 'paid_from_custody'),
  (:'org', null, 'بلا تاريخ مجهول', null, 'operating', null, null, 'paid_from_custody'),
  (:'org_b', '2026-07-05', 'مزرعة أخرى', 555, 'operating', null, null, null);

-- Two dated in-range pending deliveries, one pre-cutover, one after as-of, and two
-- created_at-only boundary rows. Of the boundary pair, exactly the UTC-July row is in scope.
insert into public.sales(
  id, org_id, sale_date, crop, qty, unit, unit_price, total, price_status, delivery_date, payment_status, created_at)
values
  ('14800000-0000-0000-0000-000000000001', :'org', '2026-07-05', 'برحي', 10, 'كجم', null, null, 'pending', '2026-07-05', 'unpaid', '2026-07-05'),
  ('14800000-0000-0000-0000-000000000002', :'org', null, 'موالح', 20, 'كجم', null, null, 'pending', '2026-07-06', 'unpaid', '2026-08-20'),
  ('14800000-0000-0000-0000-000000000003', :'org', '2026-06-30', 'برحي', 10, 'كجم', null, null, 'pending', '2026-06-30', 'unpaid', '2026-07-05'),
  ('14800000-0000-0000-0000-000000000004', :'org', '2026-08-11', 'برحي', 10, 'كجم', null, null, 'pending', '2026-08-11', 'unpaid', '2026-08-11'),
  ('14800000-0000-0000-0000-000000000005', :'org', null, 'برحي', 10, 'كجم', null, null, 'pending', null, 'unpaid', '2026-07-01 00:30:00+00'),
  ('14800000-0000-0000-0000-000000000006', :'org', null, 'برحي', 10, 'كجم', null, null, 'pending', null, 'unpaid', '2026-07-01 00:30:00+02');

-- One old receivable (1,000 less 200 collected by as-of = 800), one exactly 30 days old
-- (600), one not yet 30 days old, one collected before as-of, and one whose current status is
-- collected even though its only collection is after as-of. Future collections must not reduce
-- the historical snapshot.
insert into public.sales(
  id, org_id, sale_date, crop, qty, unit, unit_price, total, price_status, delivery_date, payment_status, created_at)
values
  ('14800000-0000-0000-0000-000000000011', :'org', '2026-07-01', 'برحي', 10, 'كجم', 100, 1000, 'finalized', '2026-07-01', 'partially_collected', '2026-07-01'),
  ('14800000-0000-0000-0000-000000000015', :'org', '2026-07-11', 'برحي', 10, 'كجم', 60, 600, 'finalized', '2026-07-11', 'unpaid', '2026-07-11'),
  ('14800000-0000-0000-0000-000000000012', :'org', '2026-07-20', 'برحي', 10, 'كجم', 90, 900, 'finalized', '2026-07-20', 'unpaid', '2026-07-20'),
  ('14800000-0000-0000-0000-000000000014', :'org', '2026-07-01', 'برحي', 10, 'كجم', 70, 700, 'finalized', '2026-07-01', 'collected', '2026-07-01'),
  ('14800000-0000-0000-0000-000000000016', :'org', '2026-07-01', 'برحي', 10, 'كجم', 50, 500, 'finalized', '2026-07-01', 'collected', '2026-07-01');

insert into public.sale_collections(org_id, sale_id, amount, occurred_at)
values
  (:'org', '14800000-0000-0000-0000-000000000011', 200, '2026-08-05'),
  (:'org', '14800000-0000-0000-0000-000000000011', 300, '2026-08-11'),
  (:'org', '14800000-0000-0000-0000-000000000014', 700, '2026-08-01'),
  (:'org', '14800000-0000-0000-0000-000000000016', 500, '2026-08-11');

select pg_temp.as_user(current_setting('test.owner'));

select is((public.fn_month_close_summary(:'org', '2026-07-01', '2026-08-10')->>'undated_expense_count')::int,
  2, 'undated active expenses remain explicit blockers because their era cannot be proven');
select is((public.fn_month_close_summary(:'org', '2026-07-01', '2026-08-10')->>'undated_expense_known_total')::numeric,
  42::numeric, 'undated expense known total is exact');
select is(
  jsonb_typeof(public.fn_month_close_summary(:'org', '2026-07-01', '2026-08-10')->'undated_expense_known_total'),
  'string', 'month-close money crosses the JSON boundary as exact decimal text');
select is((public.fn_month_close_summary(:'org', '2026-07-01', '2026-08-10')->>'undated_expense_unknown_count')::int,
  1, 'undated expense unknown amount remains explicit');

select set_config('test.undated_expense', (
  select id::text from public.expenses where org_id = :'org' and category = 'بلا تاريخ معروف'
), false);
select lives_ok(
  format(
    'select public.fn_set_missing_expense_date(%L, %L, %L)',
    :'org', current_setting('test.undated_expense'), '2026-07-15'),
  'owner can fill a missing expense date through the narrow correction RPC');
reset role;
select is(
  (select date from public.expenses where id = current_setting('test.undated_expense')::uuid),
  '2026-07-15'::date, 'missing-date correction persists the selected business date');
update public.expenses set date = null where id = current_setting('test.undated_expense')::uuid;
select pg_temp.as_user(current_setting('test.owner'));

set local time zone 'Pacific/Kiritimati';
select is((public.fn_month_close_summary(:'org', '2026-07-01', '2026-08-10')->>'pending_price_count')::int,
  3, 'pending-price count uses UTC for the created-at fallback in a positive-offset session');
set local time zone 'Pacific/Honolulu';
select is((public.fn_month_close_summary(:'org', '2026-07-01', '2026-08-10')->>'pending_price_count')::int,
  3, 'pending-price count is unchanged in a negative-offset session');
set local time zone 'UTC';
select is((public.fn_month_close_summary(:'org', '2026-07-01', '2026-08-10')->>'unrouted_count')::int,
  2, 'unrouted count is exact over the dated snapshot');
select is((public.fn_month_close_summary(:'org', '2026-07-01', '2026-08-10')->>'unrouted_known_total')::numeric,
  100::numeric, 'unrouted total includes known money only');
select is((public.fn_month_close_summary(:'org', '2026-07-01', '2026-08-10')->>'unrouted_unknown_count')::int,
  1, 'unrouted unknown amount is explicit');
select is((public.fn_month_close_summary(:'org', '2026-07-01', '2026-08-10')->>'unclassified_count')::int,
  3, 'unclassified count excludes void/reversed and out-of-range rows');
select is((public.fn_month_close_summary(:'org', '2026-07-01', '2026-08-10')->>'unclassified_known_total')::numeric,
  150::numeric, 'unclassified known total is exact');
select is((public.fn_month_close_summary(:'org', '2026-07-01', '2026-08-10')->>'unclassified_unknown_count')::int,
  1, 'unclassified unknown count is exact');
select is((public.fn_month_close_summary(:'org', '2026-07-01', '2026-08-10')->>'unallocated_count')::int,
  3, 'unallocated count excludes void/reversed and out-of-range rows');
select is((public.fn_month_close_summary(:'org', '2026-07-01', '2026-08-10')->>'unallocated_known_total')::numeric,
  170::numeric, 'unallocated known total is exact');
select is((public.fn_month_close_summary(:'org', '2026-07-01', '2026-08-10')->>'unallocated_unknown_count')::int,
  1, 'unallocated unknown count is exact');
select is((public.fn_month_close_summary(:'org', '2026-07-01', '2026-08-10')->>'aged_receivable_count')::int,
  3, 'aged count includes current-collected sales whose collection occurred after as-of');
select is((public.fn_month_close_summary(:'org', '2026-07-01', '2026-08-10')->>'aged_receivable_total')::numeric,
  1900::numeric, 'aged amount includes the 30-day boundary and uses collections recorded by as-of only');
select is(public.fn_month_close_summary(:'org', '2026-07-01', '2026-08-10')->>'as_of',
  '2026-08-10', 'payload records the exact as-of date');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(
  format('select public.fn_month_close_summary(%L, %L, %L)', :'org', '2026-07-01', '2026-08-10'),
  'accountant can read the exact close summary');
reset role;

select pg_temp.as_user(current_setting('test.storekeeper'));
select throws_ok(
  format('select public.fn_month_close_summary(%L, %L, %L)', :'org', '2026-07-01', '2026-08-10'),
  '42501', null, 'non-finance role is rejected');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(
  format('select public.fn_month_close_summary(%L, %L, %L)', :'org_b', '2026-07-01', '2026-08-10'),
  '42501', null, 'cross-org request is rejected');
select throws_ok(
  format(
    'insert into public.expenses(org_id, date, category, total) values (%L, %L, %L, 1)',
    :'org_b', '2026-07-01', 'foreign mutex probe'),
  '42501', null, 'foreign source write is rejected before it can become a mutex oracle');
select throws_ok(
  'select public.fn_month_close_summary(null, date ''2026-07-01'', date ''2026-08-10'')',
  '23502', null, 'null org is rejected');
select throws_ok(
  format('select public.fn_month_close_summary(%L, %L, %L)', :'org', '2026-08-11', '2026-08-10'),
  '22023', null, 'as-of before cutover is rejected');
select throws_ok(
  format($$select public.fn_close_accounting_period(
    %L, '2026-07-01'::date, ((now() at time zone 'Africa/Cairo')::date + 1), 'future close 148'
  )$$, :'org'),
  '22023', null, 'the server rejects a period ending after the current Cairo business date');
select is(
  (select count(*) from public.accounting_periods
    where org_id = :'org' and note = 'future close 148'),
  0::bigint, 'future-period rejection inserts no accounting-period row');
select throws_ok(
  format(
    'select public.fn_close_accounting_period(%L, %L, %L, %L)',
    :'org', '2026-07-01', '2026-08-05', 'blocked close 148'),
  '55000', null, 'direct close RPC atomically rejects a live-era period with blockers');
reset role;

select is(
  (select count(*) from public.accounting_periods
    where org_id = :'org' and period_start = '2026-07-01' and period_end = '2026-08-05'),
  0::bigint, 'failed readiness check inserts no locked period');

delete from public.expenses where org_id = :'org_b';
insert into public.organization_member(org_id, user_id, role)
values (:'org_b', current_setting('test.owner')::uuid, 'owner');

select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  format(
    'select public.fn_close_accounting_period(%L, %L, %L, %L)',
    :'org_b', '2026-07-01', '2026-08-05', 'clean close 148'),
  'direct close RPC accepts a clean exact snapshot');
reset role;

select is(
  (select count(*) from public.accounting_periods
    where org_id = :'org_b' and period_start = '2026-07-01' and period_end = '2026-08-05'
      and status = 'locked'),
  1::bigint, 'clean readiness check inserts exactly one locked period');

insert into public.organization (id, name) values (:'org_d', 'مزرعة ذمم صحيحة 148');
insert into public.organization_member(org_id, user_id, role)
values (:'org_d', current_setting('test.owner')::uuid, 'owner');
insert into public.sales(
  id, org_id, sale_date, crop, qty, unit, unit_price, total, price_status, delivery_date, payment_status, created_at)
values (
  '14800000-0000-0000-0000-000000000021', :'org_d', '2026-07-01', 'برحي', 10, 'كجم', 100, 1000,
  'finalized', '2026-07-01', 'unpaid', '2026-07-01'
);
select pg_temp.as_user(current_setting('test.owner'));
select is(
  (public.fn_month_close_summary(:'org_d', '2026-07-01', '2026-08-05')->>'aged_receivable_count')::int,
  1, 'a valid aged receivable remains visible in the close snapshot');
select lives_ok(
  format(
    'select public.fn_close_accounting_period(%L, %L, %L, %L)',
    :'org_d', '2026-07-01', '2026-08-05', 'aged receivable follow-up 148'),
  'a valid aged receivable is follow-up work and does not require collection before close');
reset role;
select is(
  (select count(*) from public.accounting_periods
    where org_id = :'org_d' and period_start = '2026-07-01' and period_end = '2026-08-05'
      and status = 'locked'),
  1::bigint, 'aged-receivable-only close inserts exactly one locked period');

reset role;
insert into public.expenses(org_id, date, category, total)
values (:'org_b', null, 'locked-period date correction', 10)
returning set_config('test.locked_undated_expense', id::text, false);
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(
  format(
    'select public.fn_set_missing_expense_date(%L, %L, %L)',
    :'org_b', current_setting('test.locked_undated_expense'), '2026-07-20'),
  '55000', null, 'missing-date correction cannot place an expense inside a locked period');
reset role;
select pg_temp.as_user(current_setting('test.storekeeper'));
select throws_ok(
  format(
    'select public.fn_set_missing_expense_date(%L, %L, %L)',
    :'org_b', current_setting('test.locked_undated_expense'), '2026-08-06'),
  '42501', null, 'missing-date correction reveals nothing across organizations');
reset role;

select has_trigger('public', 'expenses', 'month_close_source_mutex',
  'expense writes join the per-org month-close mutex');
select has_trigger('public', 'sales', 'month_close_source_mutex',
  'sale writes join the per-org month-close mutex');
select has_trigger('public', 'sale_collections', 'month_close_source_mutex',
  'collection writes join the per-org month-close mutex');
select ok(not has_function_privilege('anon',
  'private.fn_lock_month_close_source_write()', 'EXECUTE'),
  'anon cannot execute the internal source-write mutex trigger');
select ok(not has_function_privilege('authenticated',
  'private.fn_lock_month_close_source_write()', 'EXECUTE'),
  'authenticated cannot execute the internal source-write mutex trigger');
select ok(
  not (select prosecdef from pg_proc
    where oid = 'private.fn_lock_month_close_source_write()'::regprocedure),
  'source-write mutex trigger is SECURITY INVOKER');
select is(
  (select proconfig from pg_proc
    where oid = 'private.fn_lock_month_close_source_write()'::regprocedure),
  array['search_path=""']::text[], 'source-write mutex trigger pins an empty search_path');
select ok(not has_function_privilege('public',
  'private.fn_reverse_expense_payment_after_month_close_lock(uuid,uuid,text,text,date)', 'EXECUTE'),
  'PUBLIC cannot bypass the month-close reversal wrapper');
select ok(not has_function_privilege('anon',
  'private.fn_reverse_expense_payment_after_month_close_lock(uuid,uuid,text,text,date)', 'EXECUTE'),
  'anon cannot bypass the month-close reversal wrapper');
select ok(not has_function_privilege('authenticated',
  'private.fn_reverse_expense_payment_after_month_close_lock(uuid,uuid,text,text,date)', 'EXECUTE'),
  'authenticated cannot bypass the month-close reversal wrapper');
select ok(
  position('pg_try_advisory_xact_lock_shared' in pg_get_functiondef(
    'public.fn_reverse_expense_payment(uuid,uuid,text,text,date)'::regprocedure)) > 0
  and position('pg_try_advisory_xact_lock_shared' in pg_get_functiondef(
    'public.fn_reverse_expense_payment(uuid,uuid,text,text,date)'::regprocedure))
    < position('private.fn_reverse_expense_payment_after_month_close_lock' in pg_get_functiondef(
      'public.fn_reverse_expense_payment(uuid,uuid,text,text,date)'::regprocedure)),
  'public reversal wrapper acquires the nonwaiting shared mutex before delegating');

-- Real atomicity race: a source write starts first and holds the shared org mutex. Close must
-- wait, then observe the committed blocker and fail 55000 without inserting a period or deadlocking.
create or replace function pg_temp.wait_for_advisory_wait(p_pid integer)
returns boolean language plpgsql as $$
begin
  for i in 1..500 loop
    if exists (
      select 1 from pg_catalog.pg_locks
       where pid = p_pid and locktype = 'advisory' and not granted
    ) then
      return true;
    end if;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  return false;
end $$;

select set_config('test.dsn', format(
  'host=%s port=%s dbname=%s user=%s',
  (select setting from pg_settings where name = 'unix_socket_directories'),
  (select setting from pg_settings where name = 'port'),
  current_database(), current_user
), false);

select dblink_connect('close_race_admin', current_setting('test.dsn'));
create or replace function pg_temp.reset_close_race_org(p_conn text, p_org uuid)
returns void language plpgsql as $$
begin
  perform dblink_exec(p_conn, format('delete from public.accounting_periods where org_id = %L', p_org));
  perform dblink_exec(p_conn, format('delete from public.expenses where org_id = %L', p_org));
  perform dblink_exec(p_conn, format('delete from public.organization_member where org_id = %L', p_org));
  perform dblink_exec(p_conn, format('delete from public.cost_centers where org_id = %L', p_org));
  perform dblink_exec(p_conn, format('delete from public.accounts where org_id = %L', p_org));
  perform dblink_exec(p_conn, format('delete from public.audit_log where org_id = %L', p_org));
  perform dblink_exec(p_conn, 'set session_replication_role = replica');
  perform dblink_exec(p_conn, format('delete from public.organization where id = %L', p_org));
  perform dblink_exec(p_conn, 'set session_replication_role = origin');
end;
$$;
select pg_temp.reset_close_race_org('close_race_admin', :'org_c');
select dblink_exec('close_race_admin',
  format('insert into public.organization(id, name) values (%L, %L)', :'org_c', 'month close race org'));
select dblink_exec('close_race_admin', format(
  'insert into public.organization_member(org_id, user_id, role) values (%L, %L::uuid, %L)',
  :'org_c', current_setting('test.owner'), 'owner'));

select dblink_connect('close_race_writer', current_setting('test.dsn'));
select dblink_connect('close_race_closer', current_setting('test.dsn'));
select dblink_exec('close_race_writer', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text));
select dblink_exec('close_race_closer', format('set request.jwt.claims = %L',
  json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text));
select dblink_exec('close_race_writer', 'set role authenticated');
select dblink_exec('close_race_closer', 'set role authenticated');
select set_config('test.close_race_pid', (
  select pid::text from dblink('close_race_closer', 'select pg_backend_pid()') as t(pid integer)
), false);

select dblink_exec('close_race_writer', 'begin');
select is(
  dblink_exec('close_race_writer', format(
    'insert into public.expenses(org_id, date, category, total) values (%L, %L, %L, 10)',
    :'org_c', '2026-07-02', 'committed blocker')),
  'INSERT 0 1', 'race writer commits a blocker while holding the shared source mutex');
select is(
  dblink_send_query('close_race_closer', format(
    'select public.fn_close_accounting_period(%L, %L, %L, %L)',
    :'org_c', '2026-07-01', '2026-08-05', 'race close')),
  1, 'race close is dispatched while the source writer remains open');
select ok(
  pg_temp.wait_for_advisory_wait(current_setting('test.close_race_pid')::integer),
  'race close waits on the source writer shared mutex instead of reading a stale snapshot');
select dblink_exec('close_race_writer', 'commit');

do $$
declare
  v_state text;
begin
  begin
    perform * from dblink_get_result('close_race_closer') as t(r uuid);
    perform set_config('test.close_race_state', 'no error', false);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    perform set_config('test.close_race_state', v_state, false);
  end;
  begin
    perform * from dblink_get_result('close_race_closer') as drained(r uuid);
  exception when others then null;
  end;
end $$;

select is(current_setting('test.close_race_state'), '55000',
  'race close sees the committed blocker and fails readiness after waiting');
select is(
  (select count(*) from public.accounting_periods where org_id = :'org_c'),
  0::bigint, 'race failure inserts no locked period');

select dblink_disconnect('close_race_writer');
select dblink_disconnect('close_race_closer');
select pg_temp.reset_close_race_org('close_race_admin', :'org_c');
select dblink_disconnect('close_race_admin');

select volatility_is('public', 'fn_month_close_summary', array['uuid','date','date'], 'stable',
  'summary is read-only STABLE');
select is_definer('public', 'fn_month_close_summary', array['uuid','date','date'],
  'summary is SECURITY DEFINER');
select is(
  (select proconfig from pg_proc where oid = 'public.fn_month_close_summary(uuid,date,date)'::regprocedure),
  array['search_path=""']::text[], 'summary pins an empty search_path');
select ok(not has_function_privilege('anon',
  'public.fn_month_close_summary(uuid,date,date)', 'EXECUTE'), 'anon cannot execute summary');
select ok(has_function_privilege('authenticated',
  'public.fn_month_close_summary(uuid,date,date)', 'EXECUTE'), 'authenticated can execute gated summary');
select volatility_is('public', 'fn_set_missing_expense_date', array['uuid','uuid','date'], 'volatile',
  'missing-date correction is a write RPC');
select is_definer('public', 'fn_set_missing_expense_date', array['uuid','uuid','date'],
  'missing-date correction is SECURITY DEFINER');
select is(
  (select proconfig from pg_proc
    where oid = 'public.fn_set_missing_expense_date(uuid,uuid,date)'::regprocedure),
  array['search_path=""']::text[], 'missing-date correction pins an empty search_path');
select ok(not has_function_privilege('anon',
  'public.fn_set_missing_expense_date(uuid,uuid,date)', 'EXECUTE'),
  'anon cannot execute missing-date correction');
select ok(has_function_privilege('authenticated',
  'public.fn_set_missing_expense_date(uuid,uuid,date)', 'EXECUTE'),
  'authenticated can execute the gated missing-date correction');

select * from finish();
rollback;
