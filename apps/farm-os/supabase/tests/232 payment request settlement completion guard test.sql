-- Settlement cannot confirm a payout or close while approved owner funding remains outstanding.
begin;
select plan(22);

\set org '00000000-0000-0000-0000-000000000001'
\set account '23200000-0000-4000-8000-000000000001'
\set partialRequest '23200000-0000-4000-8000-000000000002'
\set partialClose '23200000-0000-4000-8000-000000000003'
\set fundedRequest '23200000-0000-4000-8000-000000000004'
\set partialExpense '23200000-0000-4000-8000-000000000005'
\set fundedExpense '23200000-0000-4000-8000-000000000006'
\set adminRequest '23200000-0000-4000-8000-000000000007'
\set raceAccount '23200000-0000-4000-8000-000000000008'
\set raceRequest '23200000-0000-4000-8000-000000000009'

insert into public.custody_accounts (id, org_id, holder_label, target_float)
values (:'account', :'org', 'عهدة اختبار إكمال طلب الصرف', 0);

insert into public.custody_movements (
  org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out
) values (:'org', :'account', current_date, 'رصيد اختبار', 200, 0);

insert into public.expenses (
  id, org_id, date, category, description, total, status, payment_status, kind, account_id
) values
  (:'partialExpense', :'org', current_date, 'اختبار', 'بند طلب غير ممول بالكامل', 10, 'approved', 'post_paid_unpaid', 'operating',
   (select id from public.accounts where org_id = :'org' and code = '5110')),
  (:'fundedExpense', :'org', current_date, 'اختبار', 'بند طلب ممول بالكامل', 10, 'approved', 'post_paid_unpaid', 'operating',
   (select id from public.accounts where org_id = :'org' and code = '5110'));

insert into public.payment_requests (
  id, org_id, request_no, status, custody_account_id, approved_net_request
) values
  (:'partialRequest', :'org', (select coalesce(max(request_no), 0) + 232 from public.payment_requests where org_id = :'org'), 'paid', :'account', 100),
  (:'partialClose', :'org', (select coalesce(max(request_no), 0) + 233 from public.payment_requests where org_id = :'org'), 'paid', :'account', 100),
  (:'fundedRequest', :'org', (select coalesce(max(request_no), 0) + 234 from public.payment_requests where org_id = :'org'), 'paid', :'account', 100),
  (:'adminRequest', :'org', (select coalesce(max(request_no), 0) + 235 from public.payment_requests where org_id = :'org'), 'paid', :'account', 100);

insert into public.payment_request_lines (org_id, payment_request_id, expense_id)
values
  (:'org', :'partialRequest', :'partialExpense'),
  (:'org', :'fundedRequest', :'fundedExpense');

insert into public.payment_request_fundings (
  org_id, payment_request_id, custody_account_id, occurred_at, amount
) values
  (:'org', :'fundedRequest', :'account', current_date, 100),
  (:'org', :'adminRequest', :'account', current_date, 100);

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select user_id::text from public.organization_member where org_id = :'org' and role = 'owner' limit 1),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select has_function('public', 'fn_guard_payment_request_line_fully_funded', array[]::text[],
  'line completion guard exists');
select has_function('public', 'fn_payment_request_remaining_to_fund_guard', array['uuid'],
  'actor-independent remaining-funding guard exists');
select ok(not has_function_privilege('public',
  'public.fn_payment_request_remaining_to_fund_guard(uuid)', 'EXECUTE'),
  'PUBLIC cannot invoke the internal remaining-funding guard');
select ok(not has_function_privilege('authenticated',
  'public.fn_payment_request_remaining_to_fund_guard(uuid)', 'EXECUTE'),
  'authenticated users cannot invoke the internal remaining-funding guard directly');
select has_trigger('public', 'payment_request_lines', 'payment_request_line_requires_full_funding',
  'line completion guard is attached');
select has_trigger('public', 'payment_requests', 'payment_request_close_requires_full_funding',
  'close completion guard is attached');

select throws_ok(
  format($$ select public.fn_confirm_request_expense_paid(%L, %L, %L, current_date, 'المحاسب', null) $$,
    :'partialRequest', :'partialExpense', :'account'),
  '22023', null,
  'partially funded request cannot confirm a payout'
);
select is((select payment_status from public.expenses where id = :'partialExpense'), 'post_paid_unpaid',
  'blocked confirmation rolls back the expense status');
select is((select paid_at from public.payment_request_lines where payment_request_id = :'partialRequest'), null::timestamptz,
  'blocked confirmation leaves the request line unpaid');
select is((select count(*)::int from public.custody_movements where payment_request_id = :'partialRequest'), 0,
  'blocked confirmation leaves no custody movement');

select throws_ok(
  format($$ select public.fn_close_payment_request(%L) $$, :'partialClose'),
  '22023', null,
  'partially funded request cannot close'
);
select is((select status from public.payment_requests where id = :'partialClose'), 'paid',
  'blocked close keeps the request open');

select lives_ok(
  format($$ select public.fn_confirm_request_expense_paid(%L, %L, %L, current_date, 'المحاسب', null) $$,
    :'fundedRequest', :'fundedExpense', :'account'),
  'fully funded request can confirm a payout'
);
select isnt((select paid_at from public.payment_request_lines where payment_request_id = :'fundedRequest'), null::timestamptz,
  'fully funded request line records payment');
select lives_ok(format($$ select public.fn_close_payment_request(%L) $$, :'fundedRequest'),
  'fully funded request with no unpaid lines can close');
select is((select status from public.payment_requests where id = :'fundedRequest'), 'closed',
  'fully funded request reaches closed only after payment confirmation');

reset role;
select set_config('request.jwt.claims', '{}'::text, true);
select lives_ok(
  format($$ update public.payment_requests set status = 'closed' where id = %L $$, :'adminRequest'),
  'service-role style settlement succeeds without a user JWT when fully funded'
);
select is((select status from public.payment_requests where id = :'adminRequest'), 'closed',
  'null-auth admin settlement reaches closed');

-- A genuine second backend must wait on the exact request row before evaluating funding.
create extension if not exists dblink;
create or replace function pg_temp.wait_for_payment_request_row_lock(p_pid integer, p_request uuid)
returns boolean language plpgsql as $$
declare v_ctid tid;
begin
  select r.ctid into v_ctid from public.payment_requests r where r.id = p_request;
  for attempt in 1..1000 loop
    perform pg_stat_clear_snapshot();
    if exists (
      select 1
        from pg_stat_activity sa
        join pg_locks l on l.pid = sa.pid
       where sa.pid = p_pid
         and sa.wait_event_type = 'Lock'
         and l.locktype = 'tuple'
         and l.relation = 'public.payment_requests'::regclass
         and l.page = (v_ctid::text::point)[0]::integer
         and l.tuple = (v_ctid::text::point)[1]::smallint
    ) then return true;
    end if;
    perform pg_sleep(0.01);
  end loop;
  return false;
end $$;

select set_config('test.settlement_dsn', format(
  'host=%s port=%s dbname=%s user=%s',
  (select setting from pg_settings where name = 'unix_socket_directories'),
  (select setting from pg_settings where name = 'port'),
  current_database(), current_user
), false);
select dblink_connect('settlement_setup', current_setting('test.settlement_dsn'));
select dblink_exec('settlement_setup', format($sql$
  insert into public.custody_accounts(id, org_id, holder_label, target_float)
  values (%L, %L, 'settlement concurrency account', 0);
  insert into public.payment_requests(
    id, org_id, request_no, status, custody_account_id, approved_net_request
  ) values (
    %L, %L,
    (select coalesce(max(request_no), 0) + 2320 from public.payment_requests where org_id = %L),
    'paid', %L, 100
  );
  insert into public.payment_request_fundings(
    org_id, payment_request_id, custody_account_id, occurred_at, amount
  ) values (%L, %L, %L, current_date, 100)
$sql$, :'raceAccount', :'org', :'raceRequest', :'org', :'org', :'raceAccount',
       :'org', :'raceRequest', :'raceAccount'));
select dblink_disconnect('settlement_setup');

select dblink_connect('settlement_a', current_setting('test.settlement_dsn'));
select dblink_connect('settlement_b', current_setting('test.settlement_dsn'));
select set_config('test.settlement_pid_b', (
  select pid::text from dblink('settlement_b', 'select pg_backend_pid()') as backend(pid integer)
), false);
select dblink_exec('settlement_a', 'begin');
select id from dblink('settlement_a', format(
  'select id::text from public.payment_requests where id = %L for update', :'raceRequest'
)) as locked(id text);
select is(dblink_send_query('settlement_b', format(
  'update public.payment_requests set status = ''closed'' where id = %L returning status', :'raceRequest'
)), 1, 'concurrent settlement is dispatched on a second backend');
select ok(pg_temp.wait_for_payment_request_row_lock(
  current_setting('test.settlement_pid_b')::integer, :'raceRequest'
), 'concurrent settlement waits on the exact payment-request row');
select dblink_exec('settlement_a', 'commit');
select is((
  select status from dblink_get_result('settlement_b') as result(status text)
), 'closed', 'concurrent settlement proceeds from a fully funded committed state');
select * from dblink_get_result('settlement_b') as drained(status text);
select dblink_exec('settlement_b', format($sql$
  delete from public.payment_request_fundings where payment_request_id = %L;
  delete from public.payment_requests where id = %L;
  delete from public.custody_accounts where id = %L
$sql$, :'raceRequest', :'raceRequest', :'raceAccount'));
select dblink_disconnect('settlement_a');
select dblink_disconnect('settlement_b');
select is((select count(*)::integer from public.payment_requests where id = :'raceRequest'), 0,
  'committed concurrency fixture is removed');

select * from finish();
rollback;
