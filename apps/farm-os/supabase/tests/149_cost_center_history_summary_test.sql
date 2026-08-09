begin;
select plan(17);

\set org '00000000-0000-0000-0000-000000000001'
\set org_b '14900000-0000-0000-0000-0000000000b0'
\set cc '14900000-0000-0000-0000-0000000000c0'
\set cc_b '14900000-0000-0000-0000-0000000000cb'
\set expense '14900000-0000-0000-0000-0000000000e0'
\set archived_expense '14900000-0000-0000-0000-0000000000ea'
\set revenue '14900000-0000-0000-0000-0000000000d0'
\set asset '14900000-0000-0000-0000-0000000000a0'
\set expense_b '14900000-0000-0000-0000-0000000000eb'
\set je_2024 '14900000-0000-0000-0000-000000002024'
\set je_2025 '14900000-0000-0000-0000-000000002025'
\set je_reversed '14900000-0000-0000-0000-00000000bad0'
\set je_b '14900000-0000-0000-0000-0000000000b1'

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

select public.fn_seed_cost_center_defaults(:'org');
insert into public.cost_centers(id, org_id, code, name_ar, active)
values (:'cc', :'org', 'CC-149', 'مركز التقرير السنوي', true);

insert into public.organization(id, name) values (:'org_b', 'مزرعة أخرى');
insert into public.cost_centers(id, org_id, code, name_ar, active)
values (:'cc_b', :'org_b', 'CC-149-B', 'مركز بعيد', true);

insert into public.accounts(id, org_id, code, name_ar, account_type, normal_balance, active) values
  (:'expense', :'org', 'T149-E', 'مصروف سنوي', 'expense', 'debit', true),
  (:'archived_expense', :'org', 'T149-EA', 'مصروف مؤرشف', 'expense', 'debit', false),
  (:'revenue', :'org', 'T149-R', 'إيراد سنوي', 'revenue', 'credit', true),
  (:'asset', :'org', 'T149-A', 'أصل غير داخل التقرير', 'asset', 'debit', true),
  (:'expense_b', :'org_b', 'T149-B', 'مصروف بعيد', 'expense', 'debit', true);

insert into public.journal_entries(id, org_id, entry_date, source_type, source_id, description, status) values
  (:'je_2024', :'org', '2024-12-31', 'test_cc_history', :'je_2024', 'قيود 2024', 'posted'),
  (:'je_2025', :'org', '2025-01-01', 'test_cc_history', :'je_2025', 'قيود 2025', 'posted'),
  (:'je_reversed', :'org', '2025-02-01', 'test_cc_history', :'je_reversed', 'قيد معكوس', 'reversed'),
  (:'je_b', :'org_b', '2024-12-31', 'test_cc_history', :'je_b', 'قيد بعيد', 'posted');

insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit, cost_center_id)
select :'org', :'je_2024', :'expense', 1, 0, :'cc' from generate_series(1, 250);
insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit, cost_center_id) values
  (:'org', :'je_2024', :'expense', 100, 0, :'cc'),
  (:'org', :'je_2024', :'expense', 0, 10, :'cc'),
  (:'org', :'je_2024', :'revenue', 0, 200, :'cc'),
  (:'org', :'je_2024', :'revenue', 5, 0, :'cc'),
  (:'org', :'je_2024', :'asset', 1000, 0, :'cc'),
  (:'org', :'je_2025', :'expense', 60, 0, null),
  (:'org', :'je_2025', :'archived_expense', 40, 0, :'cc'),
  (:'org', :'je_reversed', :'expense', 999, 0, :'cc'),
  (:'org_b', :'je_b', :'expense_b', 777, 0, :'cc_b');

select has_function(
  'public', 'fn_cost_center_history_summary', array['uuid'],
  'annual cost-center summary RPC exists');

select pg_temp.as_user(current_setting('test.owner'));
select is(
  public.fn_cost_center_history_summary(:'org')->>'version',
  'farm-os.cost-center-history.v1', 'payload version is pinned');
select is(
  jsonb_array_length(public.fn_cost_center_history_summary(:'org')->'rows'),
  4, '256 relevant raw lines collapse to four annual account-center groups');
select is(
  (select (row->>'amount')::numeric from jsonb_array_elements(public.fn_cost_center_history_summary(:'org')->'rows') row
    where row->>'year' = '2024' and row->>'account_code' = 'T149-E'),
  340::numeric, 'expense amount preserves debit minus counter-normal credit');
select is(
  (select jsonb_typeof(row->'amount') from jsonb_array_elements(public.fn_cost_center_history_summary(:'org')->'rows') row
    where row->>'year' = '2024' and row->>'account_code' = 'T149-E'),
  'string', 'annual-history money crosses the JSON boundary as exact decimal text');
select is(
  (select (row->>'amount')::numeric from jsonb_array_elements(public.fn_cost_center_history_summary(:'org')->'rows') row
    where row->>'year' = '2024' and row->>'account_code' = 'T149-R'),
  195::numeric, 'revenue amount preserves credit minus counter-normal debit');
select is(
  (select row->>'center_code' from jsonb_array_elements(public.fn_cost_center_history_summary(:'org')->'rows') row
    where row->>'year' = '2025' and row->>'account_code' = 'T149-E'),
  'CC-UNALLOC', 'null-center activity maps to the organization system center');
select is(
  (select (row->>'amount')::numeric from jsonb_array_elements(public.fn_cost_center_history_summary(:'org')->'rows') row
    where row->>'account_code' = 'T149-EA'),
  40::numeric, 'archived accounts with posted history remain visible');
select ok(
  not exists (select 1 from jsonb_array_elements(public.fn_cost_center_history_summary(:'org')->'rows') row
    where (row->>'amount')::numeric = 999),
  'reversed journal entries are excluded');
select ok(
  not exists (select 1 from jsonb_array_elements(public.fn_cost_center_history_summary(:'org')->'rows') row
    where row->>'account_code' = 'T149-A'),
  'asset lines are excluded from the expense/revenue report');
select ok(
  not exists (select 1 from jsonb_array_elements(public.fn_cost_center_history_summary(:'org')->'rows') row
    where row->>'account_code' = 'T149-B'),
  'another organization never enters the payload');
select is(
  (public.fn_cost_center_history_summary(:'org')->'rows'->0->>'year'),
  '2024', 'aggregate rows have deterministic chronological ordering');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select is(jsonb_array_length(public.fn_cost_center_history_summary(:'org')->'rows'), 4,
  'accountant can read the annual aggregate');
reset role;

select pg_temp.as_user(current_setting('test.storekeeper'));
select throws_ok(format('select public.fn_cost_center_history_summary(%L)', :'org'),
  '42501', null, 'storekeeper without finance.read is rejected');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format('select public.fn_cost_center_history_summary(%L)', :'org_b'),
  '42501', null, 'cross-org request is rejected');
reset role;

select ok(not has_function_privilege('anon',
  'public.fn_cost_center_history_summary(uuid)', 'EXECUTE'), 'anon cannot execute the summary');
select ok(has_function_privilege('authenticated',
  'public.fn_cost_center_history_summary(uuid)', 'EXECUTE'), 'authenticated can execute the gated summary');

select * from finish();
rollback;
