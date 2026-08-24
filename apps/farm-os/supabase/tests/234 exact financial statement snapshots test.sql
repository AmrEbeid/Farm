-- SPEC-0033 R4k: exact financial-statement transport and tenant fail-closed behavior.
begin;
select plan(29);

\set org '00000000-0000-0000-0000-000000000001'
\set org_b '23400000-0000-0000-0000-0000000000b0'
\set entry_revenue '23400000-0000-0000-0000-000000000001'
\set entry_expense '23400000-0000-0000-0000-000000000002'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'supervisor' limit 1), false);
select isnt(current_setting('test.owner'), '', 'fixture: owner exists');
select isnt(current_setting('test.accountant'), '', 'fixture: accountant exists');
select isnt(current_setting('test.supervisor'), '', 'fixture: supervisor exists');

insert into public.organization(id, name) values (:'org_b', 'Statement snapshot foreign org')
on conflict (id) do nothing;

insert into public.journal_entries(id, org_id, entry_date, source_type, source_id, description, status)
values
  (:'entry_revenue', :'org', date '2026-09-15', 'statement_snapshot_revenue', :'entry_revenue', 'exact revenue', 'posted'),
  (:'entry_expense', :'org', date '2026-09-16', 'statement_snapshot_expense', :'entry_expense', 'exact expense', 'posted');

insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit)
values
  (:'org', :'entry_revenue', (select id from public.accounts where org_id = :'org' and code = '1000'), 9007199254740993.01, 0),
  (:'org', :'entry_revenue', (select id from public.accounts where org_id = :'org' and code = '4000'), 0, 9007199254740993.01),
  (:'org', :'entry_expense', (select id from public.accounts where org_id = :'org' and code = '5000'), 0.01, 0),
  (:'org', :'entry_expense', (select id from public.accounts where org_id = :'org' and code = '1000'), 0, 0.01);

select ok(not has_function_privilege('anon',
  'public.fn_accounting_balance_sheet_snapshot(uuid,date)', 'EXECUTE'),
  'anon cannot execute balance-sheet snapshot');
select ok(not has_function_privilege('anon',
  'public.fn_accounting_income_statement_snapshot(uuid,date,date)', 'EXECUTE'),
  'anon cannot execute income-statement snapshot');
select ok(has_function_privilege('authenticated',
  'public.fn_accounting_balance_sheet_snapshot(uuid,date)', 'EXECUTE'),
  'authenticated receives balance execute before finance gate');
select ok(has_function_privilege('authenticated',
  'public.fn_accounting_income_statement_snapshot(uuid,date,date)', 'EXECUTE'),
  'authenticated receives income execute before finance gate');
select is((select provolatile from pg_proc where oid =
  'public.fn_accounting_balance_sheet_snapshot(uuid,date)'::regprocedure), 's',
  'balance snapshot is stable');
select is((select provolatile from pg_proc where oid =
  'public.fn_accounting_income_statement_snapshot(uuid,date,date)'::regprocedure), 's',
  'income snapshot is stable');
select is((select prosecdef from pg_proc where oid =
  'public.fn_accounting_balance_sheet_snapshot(uuid,date)'::regprocedure), true,
  'balance snapshot is security definer');
select is((select prosecdef from pg_proc where oid =
  'public.fn_accounting_income_statement_snapshot(uuid,date,date)'::regprocedure), true,
  'income snapshot is security definer');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid =
  'public.fn_accounting_balance_sheet_snapshot(uuid,date)'::regprocedure),
  'balance snapshot has an empty search path');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid =
  'public.fn_accounting_income_statement_snapshot(uuid,date,date)'::regprocedure),
  'income snapshot has an empty search path');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(format($$select public.fn_accounting_balance_sheet_snapshot(%L, date '2026-09-30')$$, :'org'),
  'owner can read exact balance-sheet snapshot');
select lives_ok(format($$select public.fn_accounting_income_statement_snapshot(%L, date '2026-09-01', date '2026-09-30')$$, :'org'),
  'owner can read exact income-statement snapshot');
select is(public.fn_accounting_balance_sheet_snapshot(:'org', date '2026-09-30')->>'version',
  'farm-os.balance-sheet.v1', 'balance snapshot version is pinned');
select is(public.fn_accounting_income_statement_snapshot(:'org', date '2026-09-01', date '2026-09-30')->>'version',
  'farm-os.income-statement.v1', 'income snapshot version is pinned');
select is(public.fn_accounting_balance_sheet_snapshot(:'org', date '2026-09-30')->>'org_id', :'org',
  'balance snapshot binds the organization');
select is(public.fn_accounting_income_statement_snapshot(:'org', date '2026-09-01', date '2026-09-30')->>'org_id', :'org',
  'income snapshot binds the organization');
select is(jsonb_typeof(public.fn_accounting_balance_sheet_snapshot(:'org', date '2026-09-30')->'assets_total'),
  'string', 'balance total is transported as decimal text');
select is(jsonb_typeof(public.fn_accounting_income_statement_snapshot(:'org', date '2026-09-01', date '2026-09-30')->'revenue_total'),
  'string', 'income total is transported as decimal text');
select is(
  public.fn_accounting_income_statement_snapshot(:'org', date '2026-09-01', date '2026-09-30')->>'net_income',
  public.fn_accounting_income_statement(:'org', date '2026-09-01', date '2026-09-30')->>'net_income',
  'exact income wrapper preserves the trusted statement result');
select is(
  public.fn_accounting_balance_sheet_snapshot(:'org', date '2026-09-30')->>'liabilities_plus_equity',
  public.fn_accounting_balance_sheet(:'org', date '2026-09-30')->>'liabilities_plus_equity',
  'exact balance wrapper preserves the trusted statement result');
select throws_ok($$select public.fn_accounting_balance_sheet_snapshot(null, current_date)$$,
  '23502', null, 'null organization fails closed');
select throws_ok(format($$select public.fn_accounting_income_statement_snapshot(%L, date '2026-09-01', date '2026-09-30')$$, :'org_b'),
  '42501', null, 'cross-organization income read fails closed');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$select public.fn_accounting_income_statement_snapshot(%L, date '2026-09-01', date '2026-09-30')$$, :'org'),
  'accountant can read same-organization income statement');
reset role;

select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$select public.fn_accounting_balance_sheet_snapshot(%L, date '2026-09-30')$$, :'org'),
  '42501', null, 'supervisor cannot read financial statements');
reset role;

update public.journal_lines set org_id = :'org_b'
where journal_entry_id = :'entry_revenue'
  and account_id = (select id from public.accounts where org_id = :'org' and code = '4000');
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_accounting_income_statement_snapshot(%L, date '2026-09-01', date '2026-09-30')$$, :'org'),
  '23514', null, 'income statement fails closed on cross-organization journal relationships');
reset role;

update public.journal_lines set org_id = :'org'
where journal_entry_id = :'entry_revenue';
update public.journal_entries set org_id = :'org_b'
where id = :'entry_expense';
update public.journal_lines set org_id = :'org_b'
where journal_entry_id = :'entry_expense';
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_accounting_balance_sheet_snapshot(%L, date '2026-09-30')$$, :'org'),
  '23514', null, 'balance sheet fails closed when foreign entry and lines use an in-scope account');
reset role;

select * from finish();
rollback;
