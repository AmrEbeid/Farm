-- Exact, atomic daily expense workspace: role visibility, decimal transport, bounds, and tenant integrity.
begin;
select no_plan();

\set org '21900000-0000-0000-0000-0000000000a0'
\set org_b '21900000-0000-0000-0000-0000000000b0'
\set supplier '21900000-0000-0000-0000-000000000001'
\set supplier_b '21900000-0000-0000-0000-000000000002'
\set account '21900000-0000-0000-0000-000000000003'
\set account_b '21900000-0000-0000-0000-000000000004'
\set cost_center_b '21900000-0000-0000-0000-000000000005'

select set_config('test.today', ((pg_catalog.now() at time zone 'Africa/Cairo')::date)::text, false);
select set_config('test.month_start', date_trunc('month', current_setting('test.today')::date)::date::text, false);
select set_config('test.month_end', (date_trunc('month', current_setting('test.today')::date) + interval '1 month')::date::text, false);
select set_config('test.owner', (select user_id::text from public.organization_member where role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member where role = 'accountant' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member where role = 'farm_manager' limit 1), false);
select set_config('test.denied', (select user_id::text from public.organization_member where role = 'storekeeper' limit 1), false);

insert into public.organization(id, name) values
  (:'org', 'Exact expense daily org'),
  (:'org_b', 'Exact expense daily foreign org');
insert into public.organization_member(org_id, user_id, role) values
  (:'org', current_setting('test.owner')::uuid, 'owner'),
  (:'org', current_setting('test.accountant')::uuid, 'accountant'),
  (:'org', current_setting('test.manager')::uuid, 'farm_manager'),
  (:'org', current_setting('test.denied')::uuid, 'storekeeper');
insert into public.suppliers(id, org_id, name) values
  (:'supplier', :'org', 'Local supplier'),
  (:'supplier_b', :'org_b', 'Foreign supplier');
insert into public.accounts(id, org_id, code, name_ar, account_type, normal_balance, kind) values
  (:'account', :'org', '2190', 'تشغيل دقيق', 'expense', 'debit', 'operating'),
  (:'account_b', :'org_b', '2191', 'حساب أجنبي', 'expense', 'debit', 'operating');
insert into public.cost_centers(id, org_id, code, name_ar) values
  (:'cost_center_b', :'org_b', 'CC-219-B', 'مركز أجنبي');
insert into public.expenses(
  id, org_id, date, category, description, supplier_id, total, status, payment_status, kind, account_id
) values
  ('21900000-0000-0000-0000-000000000101', :'org', current_setting('test.today')::date,
   'تشغيل', 'قيمة دقيقة', :'supplier', 9007199254740993.123456789, 'approved', null, 'operating', :'account'),
  ('21900000-0000-0000-0000-000000000102', :'org', null,
   'بدون تاريخ', null, null, 2.50, 'approved', null, 'operating', :'account'),
  ('21900000-0000-0000-0000-000000000103', :'org', current_setting('test.today')::date,
   'مسحوبات', null, null, 3.75, 'approved', 'paid_by_owner', 'drawing', null);

select ok(not has_function_privilege('public',
  'public.fn_expense_daily_snapshot(uuid,text,date,date,integer)', 'EXECUTE'),
  'PUBLIC cannot execute the expense daily snapshot');
select ok(not has_function_privilege('anon',
  'public.fn_expense_daily_snapshot(uuid,text,date,date,integer)', 'EXECUTE'),
  'anon cannot execute the expense daily snapshot');
select ok(has_function_privilege('authenticated',
  'public.fn_expense_daily_snapshot(uuid,text,date,date,integer)', 'EXECUTE'),
  'authenticated reaches the role gate inside the snapshot');
select ok((select prosecdef from pg_proc
  where oid = 'public.fn_expense_daily_snapshot(uuid,text,date,date,integer)'::regprocedure),
  'expense daily snapshot is security definer');
select is((select provolatile::text from pg_proc
  where oid = 'public.fn_expense_daily_snapshot(uuid,text,date,date,integer)'::regprocedure),
  's', 'expense daily snapshot is stable');
select ok(to_regclass('public.expenses_org_date_id_all_idx') is not null,
  'expense daily snapshot has an all-row organization/date/id ordering index');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.snapshot', public.fn_expense_daily_snapshot(
  :'org', 'all', current_setting('test.month_start')::date, current_setting('test.month_end')::date, 1
)::text, false);
select is(current_setting('test.snapshot')::jsonb->>'version', 'farm-os.expense-daily.v1',
  'snapshot version is pinned');
select is(current_setting('test.snapshot')::jsonb->>'org_id', :'org',
  'snapshot binds the requested organization');
select is((current_setting('test.snapshot')::jsonb->>'matching_count')::integer, 3,
  'owner exact count covers the full selected register');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'expenses'), 1,
  'expense detail obeys its requested bound');
select is(current_setting('test.snapshot')::jsonb->'expenses'->0->>'id',
  '21900000-0000-0000-0000-000000000103', 'same-day rows use descending ID after date');
select is(current_setting('test.snapshot')::jsonb->'summary'->>'month_non_drawing_total',
  '9007199254740993.123456789', 'summary money remains exact decimal text');
select is((current_setting('test.snapshot')::jsonb->>'row_limit')::integer, 1,
  'snapshot echoes the bounded row limit');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'suppliers'), 1,
  'supplier picker data is organization scoped');
select ok(jsonb_path_exists(
  current_setting('test.snapshot')::jsonb->'accounts', '$[*] ? (@.code == "2190")'
), 'account picker data includes the organization account');
select set_config('test.operating', public.fn_expense_daily_snapshot(
  :'org', 'operating', current_setting('test.month_start')::date, current_setting('test.month_end')::date, 200
)::text, false);
select is((current_setting('test.operating')::jsonb->>'matching_count')::integer, 2,
  'operating filter count is exact');
select is(current_setting('test.operating')::jsonb->'expenses'->0->>'total',
  '9007199254740993.123456789', 'expense row money remains exact decimal text');
select set_config('test.undated', public.fn_expense_daily_snapshot(
  :'org', 'undated', current_setting('test.month_start')::date, current_setting('test.month_end')::date, 200
)::text, false);
select is((current_setting('test.undated')::jsonb->>'matching_count')::integer, 1,
  'undated filter count is exact');
select throws_ok(format($$select public.fn_expense_daily_snapshot(
  %L, 'invalid', %L::date, %L::date, 200)$$,
  :'org', current_setting('test.month_start'), current_setting('test.month_end')),
  '22023', null, 'unknown expense filter is rejected');
select throws_ok(format($$select public.fn_expense_daily_snapshot(
  %L, 'all', %L::date, %L::date, 0)$$,
  :'org', current_setting('test.month_start'), current_setting('test.month_end')),
  '22023', null, 'zero row limit is rejected');
select throws_ok(format($$select public.fn_expense_daily_snapshot(
  %L, 'all', %L::date, %L::date, 200)$$,
  :'org_b', current_setting('test.month_start'), current_setting('test.month_end')),
  '42501', null, 'cross-organization snapshot is rejected');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$select public.fn_expense_daily_snapshot(
  %L, 'all', %L::date, %L::date, 200)$$,
  :'org', current_setting('test.month_start'), current_setting('test.month_end')),
  'accountant can read the expense daily snapshot');
reset role;

select pg_temp.as_user(current_setting('test.manager'));
select set_config('test.manager_snapshot', public.fn_expense_daily_snapshot(
  :'org', 'all', current_setting('test.month_start')::date, current_setting('test.month_end')::date, 200
)::text, false);
select is((current_setting('test.manager_snapshot')::jsonb->>'matching_count')::integer, 2,
  'farm manager does not receive owner drawings');
select is(current_setting('test.manager_snapshot')::jsonb->'summary'->>'drawing_count', null,
  'farm manager summary withholds drawing count');
select is(jsonb_array_length(current_setting('test.manager_snapshot')::jsonb->'accounts'), 0,
  'farm manager does not receive finance-private chart-of-accounts data');
select throws_ok(format($$select public.fn_expense_daily_snapshot(
  %L, 'drawing', %L::date, %L::date, 200)$$,
  :'org', current_setting('test.month_start'), current_setting('test.month_end')),
  '42501', null, 'farm manager cannot request the drawing filter');
reset role;

select pg_temp.as_user(current_setting('test.denied'));
select throws_ok(format($$select public.fn_expense_daily_snapshot(
  %L, 'all', %L::date, %L::date, 200)$$,
  :'org', current_setting('test.month_start'), current_setting('test.month_end')),
  '42501', null, 'unapproved role cannot read the expense daily snapshot');
reset role;

insert into public.expenses(
  id, org_id, date, category, supplier_id, total, status, kind, account_id
) values (
  '21900000-0000-0000-0000-000000000104', :'org', current_setting('test.today')::date,
  'مرجع أجنبي', :'supplier_b', 1, 'approved', 'operating', :'account'
);
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_expense_daily_snapshot(
  %L, 'all', %L::date, %L::date, 200)$$,
  :'org', current_setting('test.month_start'), current_setting('test.month_end')),
  '23514', null, 'cross-organization expense supplier corruption fails closed');
reset role;

set local session_replication_role = replica;
update public.expenses
   set supplier_id = :'supplier', account_id = :'account_b'
 where id = '21900000-0000-0000-0000-000000000104';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_expense_daily_snapshot(
  %L, 'all', %L::date, %L::date, 200)$$,
  :'org', current_setting('test.month_start'), current_setting('test.month_end')),
  '23514', null, 'cross-organization expense account corruption fails closed');
reset role;

set local session_replication_role = replica;
update public.expenses
   set account_id = :'account', cost_center_id = :'cost_center_b'
 where id = '21900000-0000-0000-0000-000000000104';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_expense_daily_snapshot(
  %L, 'all', %L::date, %L::date, 200)$$,
  :'org', current_setting('test.month_start'), current_setting('test.month_end')),
  '23514', null, 'cross-organization expense cost-center corruption fails closed');
reset role;

select * from finish();
rollback;
