begin;
select plan(42);

\set org '00000000-0000-0000-0000-000000000001'
\set org_b '22100000-0000-0000-0000-0000000000b0'
\set center '22100000-0000-0000-0000-0000000000c0'
\set unalloc_child '22100000-0000-0000-0000-0000000000c1'
\set zero_center '22100000-0000-0000-0000-0000000000c2'
\set depth_1 '22100000-0000-0000-0000-0000000000f1'
\set depth_2 '22100000-0000-0000-0000-0000000000f2'
\set depth_3 '22100000-0000-0000-0000-0000000000f3'
\set depth_4 '22100000-0000-0000-0000-0000000000f4'
\set depth_5 '22100000-0000-0000-0000-0000000000f5'
\set expense '22100000-0000-0000-0000-0000000000e0'
\set revenue '22100000-0000-0000-0000-0000000000d0'
\set expense_b '22100000-0000-0000-0000-0000000000eb'
\set posted '22100000-0000-0000-0000-000000002025'
\set reversed '22100000-0000-0000-0000-00000000bad0'
\set corrupt '22100000-0000-0000-0000-00000000bad1'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'supervisor' limit 1), false);

select public.fn_seed_cost_center_defaults(:'org');
insert into public.cost_centers(id, org_id, code, name_ar, parent_id, active, sort_order) values
  (:'center', :'org', 'CC-221', 'مركز لقطة التقرير', null, true, -1),
  (:'unalloc_child', :'org', 'CC-221-UNALLOC-CHILD', 'فرع غير موزع',
    (select id from public.cost_centers where org_id = :'org' and code = 'CC-UNALLOC'), true, 222),
  (:'zero_center', :'org', 'CC-221-ZERO', 'مركز حركة متعادلة', null, true, 223);

insert into public.organization(id, name) values (:'org_b', 'Foreign report organization');
insert into public.accounts(id, org_id, code, name_ar, account_type, normal_balance, active) values
  (:'expense', :'org', 'T221-E', 'مصروف دقيق', 'expense', 'debit', true),
  (:'revenue', :'org', 'T221-R', 'إيراد دقيق', 'revenue', 'credit', true),
  (:'expense_b', :'org_b', 'T221-B', 'مصروف بعيد', 'expense', 'debit', true);

insert into public.journal_entries(id, org_id, entry_date, source_type, source_id, description, status) values
  (:'posted', :'org', '2025-01-01', 'test_cc_snapshot', :'posted', 'قيد دقيق', 'posted'),
  (:'reversed', :'org', '2025-02-01', 'test_cc_snapshot', :'reversed', 'قيد معكوس', 'reversed');
insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit, cost_center_id) values
  (:'org', :'posted', :'expense', 100000000000000.01, 0, :'center'),
  (:'org', :'posted', :'revenue', 0, 200000000000000.03, :'center'),
  (:'org', :'posted', :'expense', 0, 5, :'center'),
  (:'org', :'posted', :'revenue', 7, 0, :'center'),
  (:'org', :'posted', :'expense', 11, 0, :'zero_center'),
  (:'org', :'posted', :'expense', 0, 11, :'zero_center'),
  (:'org', :'posted', :'expense', 3.03, 0, null),
  (:'org', :'reversed', :'expense', 999, 0, :'center');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select has_function('public', 'fn_cost_center_reports_snapshot', array['uuid', 'boolean'],
  'exact cost-center reports snapshot exists');
select ok(not has_function_privilege('anon',
  'public.fn_cost_center_reports_snapshot(uuid, boolean)', 'EXECUTE'),
  'anon cannot execute the cost-center reports snapshot');
select ok(has_function_privilege('authenticated',
  'public.fn_cost_center_reports_snapshot(uuid, boolean)', 'EXECUTE'),
  'authenticated receives execute before the in-function finance gate');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'fn_cost_center_reports_snapshot'
      and pg_get_function_identity_arguments(p.oid) = 'p_org uuid, p_include_history boolean'),
  1, 'the authenticated RPC name has exactly the pinned signature');

select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(format($$select public.fn_cost_center_reports_snapshot(%L, true)$$, :'org'),
  'owner can read one exact report snapshot');
select is(public.fn_cost_center_reports_snapshot(:'org', true)->>'version',
  'farm-os.cost-center-reports.v1', 'snapshot version is pinned');
select is(public.fn_cost_center_reports_snapshot(:'org', true)->>'org_id', :'org',
  'snapshot binds the requested organization');
select is(public.fn_cost_center_reports_snapshot(:'org', true)->>'history_included', 'true',
  'snapshot echoes the requested history mode');
select is((public.fn_cost_center_reports_snapshot(:'org', true)->>'rollup_count')::integer,
  jsonb_array_length(public.fn_cost_center_reports_snapshot(:'org', true)->'rollup'),
  'rollup count proves the complete array');
select is((public.fn_cost_center_reports_snapshot(:'org', true)->>'rollup_count')::integer,
  (select count(*)::integer from public.cost_centers where org_id = :'org'),
  'rollup contains every organization cost center');
select is((public.fn_cost_center_reports_snapshot(:'org', true)->>'flag_count')::integer,
  jsonb_array_length(public.fn_cost_center_reports_snapshot(:'org', true)->'flags'),
  'flag count proves the complete array');
select is((public.fn_cost_center_reports_snapshot(:'org', true)->>'history_count')::integer,
  jsonb_array_length(public.fn_cost_center_reports_snapshot(:'org', true)->'history'),
  'history count proves the complete array');
select is(public.fn_cost_center_reports_snapshot(:'org', true)->>'expense_total',
  '99999999999998.04', 'expense total normalizes expense contra credits');
select is(public.fn_cost_center_reports_snapshot(:'org', true)->>'revenue_total',
  '199999999999993.03', 'revenue total normalizes revenue contra debits');
select is(public.fn_cost_center_reports_snapshot(:'org', true)->>'profit',
  '99999999999994.99', 'profit is the exact revenue-minus-expense result');
select is(jsonb_typeof(public.fn_cost_center_reports_snapshot(:'org', true)->'expense_total'),
  'string', 'top-level money is a JSON string');
select is((select row->>'expense' from jsonb_array_elements(
    public.fn_cost_center_reports_snapshot(:'org', true)->'rollup') row where row->>'code' = 'CC-221'),
  '99999999999995.01', 'center expense normalizes contra credits as exact text');
select is((select row->>'revenue' from jsonb_array_elements(
    public.fn_cost_center_reports_snapshot(:'org', true)->'rollup') row where row->>'code' = 'CC-221'),
  '199999999999993.03', 'center revenue normalizes contra debits as exact text');
select is((select row->>'net' from jsonb_array_elements(
    public.fn_cost_center_reports_snapshot(:'org', true)->'rollup') row where row->>'code' = 'CC-221'),
  '99999999999998.02', 'center net uses the same revenue-minus-expense sign as operating profit');
select is((select row->>'line_count' from jsonb_array_elements(
    public.fn_cost_center_reports_snapshot(:'org', true)->'rollup') row where row->>'code' = 'CC-221'),
  '4', 'center activity count includes all posted expense and revenue lines');
select is((select row->>'sort_order' from jsonb_array_elements(
    public.fn_cost_center_reports_snapshot(:'org', true)->'rollup') row where row->>'code' = 'CC-221'),
  '-1', 'signed sort order remains a valid report value');
select ok(not exists(select 1 from jsonb_array_elements(public.fn_cost_center_reports_snapshot(:'org', true)->'rollup') row
    where row->>'expense' = '100000000000994.01'),
  'reversed entries do not inflate center debit');
select is((public.fn_cost_center_reports_snapshot(:'org', true)->>'unallocated_line_count')::integer,
  1, 'unallocated count covers posted expense/revenue lines exactly');
select is((select row->>'expense' from jsonb_array_elements(
    public.fn_cost_center_reports_snapshot(:'org', true)->'rollup') row where row->>'code' = 'CC-UNALLOC'),
  '3.03', 'unallocated lines are counted once even when the system center has a child');
select is((select row->>'line_count' from jsonb_array_elements(
    public.fn_cost_center_reports_snapshot(:'org', true)->'rollup') row where row->>'code' = 'CC-221-UNALLOC-CHILD'),
  '0', 'the unallocated child does not inherit the null-centered line');
select is((select row->>'line_count' from jsonb_array_elements(
    public.fn_cost_center_reports_snapshot(:'org', true)->'rollup') row where row->>'code' = 'CC-221-ZERO'),
  '2', 'fully offset activity remains distinguishable from no activity');
select is((select row->>'net' from jsonb_array_elements(
    public.fn_cost_center_reports_snapshot(:'org', true)->'rollup') row where row->>'code' = 'CC-221-ZERO'),
  '0', 'fully offset activity keeps its truthful zero net');
select is((select row->>'amount' from jsonb_array_elements(
    public.fn_cost_center_reports_snapshot(:'org', true)->'history') row
    where row->>'account_code' = 'T221-E' and row->>'center_code' = 'CC-221'),
  '99999999999995.01', 'annual history remains exact, contra-normalized, and center-scoped');
select is((select jsonb_typeof(row->'amount') from jsonb_array_elements(
    public.fn_cost_center_reports_snapshot(:'org', true)->'history') row
    where row->>'account_code' = 'T221-E' and row->>'center_code' = 'CC-221'),
  'string', 'annual history money is a JSON string');
select is(public.fn_cost_center_reports_snapshot(:'org', false)->>'history_included', 'false',
  'overview snapshot declares history absent');
select is(jsonb_array_length(public.fn_cost_center_reports_snapshot(:'org', false)->'history'), 0,
  'overview snapshot transfers no annual history rows');
select ok(exists(select 1 from jsonb_array_elements(
    public.fn_cost_center_reports_snapshot(:'org', false)->'flags') row
    where row->>'cost_center_id' = :'center' and row->>'flag_code' = 'missing_sector_link'),
  'review flags are included in the same snapshot');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$select public.fn_cost_center_reports_snapshot(%L, false)$$, :'org'),
  'accountant can read the same-organization snapshot');
reset role;

select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$select public.fn_cost_center_reports_snapshot(%L, false)$$, :'org'),
  '42501', null, 'non-finance role cannot read the report snapshot');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_cost_center_reports_snapshot(%L, false)$$, :'org_b'),
  '42501', null, 'owner cannot read another organization snapshot');
select throws_ok($$select public.fn_cost_center_reports_snapshot(null, false)$$,
  '23502', null, 'null organization fails closed');
select throws_ok(format($$select public.fn_cost_center_reports_snapshot(%L, null)$$, :'org'),
  '23502', null, 'null history mode fails closed');
reset role;

insert into public.journal_entries(id, org_id, entry_date, source_type, source_id, description, status)
values (:'corrupt', :'org', '2025-03-01', 'test_cc_snapshot', :'corrupt', 'قيد تالف', 'posted');
insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit, cost_center_id)
values (:'org', :'corrupt', :'expense_b', 1, 0, null);

select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_cost_center_reports_snapshot(%L, false)$$, :'org'),
  '55000', null, 'cross-organization journal relationships fail before a payload leaves PostgreSQL');
reset role;

delete from public.journal_lines where journal_entry_id = :'corrupt';
delete from public.journal_entries where id = :'corrupt';
update public.cost_centers set parent_id = id where id = :'center';
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_cost_center_reports_snapshot(%L, false)$$, :'org'),
  '55000', null, 'damaged same-tenant hierarchy cycles fail closed before recursive rollup');
reset role;

update public.cost_centers set parent_id = null where id = :'center';
update public.cost_centers set is_system = false where org_id = :'org' and code = 'CC-UNALLOC';
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_cost_center_reports_snapshot(%L, false)$$, :'org'),
  '55000', null, 'a missing or invalid unallocated system center fails closed');
reset role;

update public.cost_centers set is_system = true where org_id = :'org' and code = 'CC-UNALLOC';
insert into public.cost_centers(id, org_id, parent_id, code, name_ar, active) values
  (:'depth_1', :'org', null, 'CC-221-D1', 'عمق 1', true),
  (:'depth_2', :'org', :'depth_1', 'CC-221-D2', 'عمق 2', true),
  (:'depth_3', :'org', :'depth_2', 'CC-221-D3', 'عمق 3', true),
  (:'depth_4', :'org', :'depth_3', 'CC-221-D4', 'عمق 4', true),
  (:'depth_5', :'org', :'depth_4', 'CC-221-D5', 'عمق 5', true);
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_cost_center_reports_snapshot(%L, false)$$, :'org'),
  '55000', null, 'privileged depth corruption beyond four levels fails in a bounded precheck');
reset role;
delete from public.cost_centers where id in (:'depth_5', :'depth_4', :'depth_3', :'depth_2', :'depth_1');

create or replace function public.fn_cost_center_history_summary(p_org uuid)
returns jsonb language sql stable security definer set search_path = '' as $$ select null::jsonb $$;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_cost_center_reports_snapshot(%L, true)$$, :'org'),
  '55000', null, 'a null nested history payload fails inside PostgreSQL');
reset role;

select * from finish();
rollback;
