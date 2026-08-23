-- SPEC-0033 R4i: exact, posted-only, active-organization Chart of Accounts snapshot.
begin;
select plan(27);

\set org '00000000-0000-0000-0000-000000000001'
\set org_b '23300000-0000-0000-0000-0000000000b0'
\set root '23300000-0000-0000-0000-000000000001'
\set leaf '23300000-0000-0000-0000-000000000002'
\set posted '23300000-0000-0000-0000-000000000003'
\set reversed '23300000-0000-0000-0000-000000000004'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'supervisor' limit 1), false);
select isnt(current_setting('test.owner'), '', 'fixture: owner exists');
select isnt(current_setting('test.accountant'), '', 'fixture: accountant exists');
select isnt(current_setting('test.supervisor'), '', 'fixture: supervisor exists');

insert into public.organization(id, name) values (:'org_b', 'Chart snapshot foreign org')
on conflict (id) do nothing;
insert into public.accounts(
  id, org_id, parent_id, code, name_ar, account_type, normal_balance, kind, active, is_system, sort_order
) values
  (:'root', :'org', null, '5980', 'جذر تشغيلي دقيق', 'expense', 'debit', 'operating', true, false, 980),
  (:'leaf', :'org', :'root', '5981', 'فرع تشغيلي دقيق', 'expense', 'debit', 'operating', true, false, 981);

insert into public.journal_entries(id, org_id, entry_date, source_type, source_id, description, status)
values
  (:'posted', :'org', current_date, 'chart_snapshot_posted', :'posted', 'posted exact amount', 'posted'),
  (:'reversed', :'org', current_date, 'chart_snapshot_reversed', :'reversed', 'excluded reversed amount', 'reversed');
insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit)
values
  (:'org', :'posted', :'leaf', 100000000000000.01, 0),
  (:'org', :'posted', (select id from public.accounts where org_id = :'org' and code = '3000'), 0, 100000000000000.01),
  (:'org', :'reversed', :'leaf', 7, 0),
  (:'org', :'reversed', (select id from public.accounts where org_id = :'org' and code = '3000'), 0, 7);

select ok(not has_function_privilege('anon',
  'public.fn_chart_of_accounts_snapshot(uuid)', 'EXECUTE'), 'anon cannot execute snapshot');
select ok(has_function_privilege('authenticated',
  'public.fn_chart_of_accounts_snapshot(uuid)', 'EXECUTE'), 'authenticated receives execute before finance gate');
select is((select provolatile from pg_proc where oid = 'public.fn_chart_of_accounts_snapshot(uuid)'::regprocedure),
  's', 'snapshot is stable');
select is((select prosecdef from pg_proc where oid = 'public.fn_chart_of_accounts_snapshot(uuid)'::regprocedure),
  true, 'snapshot is security definer');
select is((select proconfig[1] from pg_proc where oid = 'public.fn_chart_of_accounts_snapshot(uuid)'::regprocedure),
  'search_path=""', 'snapshot has an empty search path');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(format($$select public.fn_chart_of_accounts_snapshot(%L)$$, :'org'),
  'owner can read same-organization snapshot');
select is(public.fn_chart_of_accounts_snapshot(:'org')->>'version', 'farm-os.chart-of-accounts.v1',
  'snapshot version is pinned');
select is(public.fn_chart_of_accounts_snapshot(:'org')->>'org_id', :'org',
  'snapshot binds the organization');
select is(public.fn_chart_of_accounts_snapshot(:'org')->>'can_write', 'true',
  'owner write capability is explicit');
select is((select row->>'debit' from jsonb_array_elements(
  public.fn_chart_of_accounts_snapshot(:'org')->'accounts') row where row->>'id' = :'root'),
  '100000000000000.01', 'root rollup preserves exact posted debit text');
select is((select jsonb_typeof(row->'debit') from jsonb_array_elements(
  public.fn_chart_of_accounts_snapshot(:'org')->'accounts') row where row->>'id' = :'root'),
  'string', 'money is a JSON string');
select is((select row->>'posting_count' from jsonb_array_elements(
  public.fn_chart_of_accounts_snapshot(:'org')->'accounts') row where row->>'id' = :'root'),
  '1', 'reversed journal lines are excluded from posting count');
select is((select row->>'child_count' from jsonb_array_elements(
  public.fn_chart_of_accounts_snapshot(:'org')->'accounts') row where row->>'id' = :'root'),
  '1', 'root publishes its exact child count');
select is((select row->>'active_child_count' from jsonb_array_elements(
  public.fn_chart_of_accounts_snapshot(:'org')->'accounts') row where row->>'id' = :'root'),
  '1', 'root publishes its exact active-child count');
select is(public.fn_chart_of_accounts_snapshot(:'org')->'totals'->>'account_count',
  (select count(*)::text from public.accounts where org_id = :'org'), 'total account count is exact');
select is(public.fn_chart_of_accounts_snapshot(:'org')->'totals'->>'active_count',
  (select count(*)::text from public.accounts where org_id = :'org' and active), 'active count is exact');
select is(public.fn_chart_of_accounts_snapshot(:'org')->'totals'->>'archived_count',
  (select count(*)::text from public.accounts where org_id = :'org' and not active), 'archived count is exact');
select throws_ok($$select public.fn_chart_of_accounts_snapshot(null)$$,
  '23502', null, 'null organization fails closed');
select throws_ok(format($$select public.fn_chart_of_accounts_snapshot(%L)$$, :'org_b'),
  '42501', null, 'owner cannot read another organization');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$select public.fn_chart_of_accounts_snapshot(%L)$$, :'org'),
  'accountant can read same-organization snapshot');
reset role;

select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$select public.fn_chart_of_accounts_snapshot(%L)$$, :'org'),
  '42501', null, 'supervisor cannot read finance snapshot');
reset role;

insert into public.accounts(
  id, org_id, code, name_ar, account_type, normal_balance, active, is_system
) values ('23300000-0000-0000-0000-0000000000f0', :'org_b', 'F001', 'Foreign parent', 'asset', 'debit', true, false);
update public.accounts set parent_id = '23300000-0000-0000-0000-0000000000f0'
where id = :'leaf';
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_chart_of_accounts_snapshot(%L)$$, :'org'),
  '23514', null, 'cross-organization parent relationship fails closed');
reset role;

update public.accounts set parent_id = :'root' where id = :'leaf';
update public.accounts set kind = 'drawing' where id = :'leaf';
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_chart_of_accounts_snapshot(%L)$$, :'org'),
  '23514', null, 'parent and child accounting classifications must match');
reset role;

update public.accounts set kind = 'operating' where id = :'leaf';
update public.journal_lines set org_id = :'org_b'
where journal_entry_id = :'posted' and account_id = :'leaf';
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_chart_of_accounts_snapshot(%L)$$, :'org'),
  '23514', null, 'cross-organization journal line relationship fails closed from either direction');
reset role;

select * from finish();
rollback;
