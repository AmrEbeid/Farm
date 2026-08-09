-- Exact, one-statement accounting ledger snapshot with finance and tenant gates.
begin;
select plan(30);

\set org '00000000-0000-0000-0000-000000000001'
\set org_b '21300000-0000-0000-0000-0000000000b0'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'supervisor' limit 1), false);
select isnt(current_setting('test.owner'), '', 'fixture: owner exists');
select isnt(current_setting('test.accountant'), '', 'fixture: accountant exists');
select isnt(current_setting('test.supervisor'), '', 'fixture: supervisor exists');

insert into public.organization(id, name) values (:'org_b', 'Exact accounting snapshot foreign org')
on conflict (id) do nothing;

select ok(not has_function_privilege('anon',
  'public.fn_accounting_ledger_snapshot(uuid, integer)', 'EXECUTE'),
  'anon cannot execute the accounting ledger snapshot');
select ok(has_function_privilege('authenticated',
  'public.fn_accounting_ledger_snapshot(uuid, integer)', 'EXECUTE'),
  'authenticated receives execute before the in-function finance gate');

select set_config('test.debit_account', public.fn_ensure_account(
  :'org', '9981', 'اختبار مدين دقيق', 'asset', 'debit')::text, false);
select set_config('test.credit_account', public.fn_ensure_account(
  :'org', '9982', 'اختبار دائن دقيق', 'equity', 'credit')::text, false);
select set_config('test.tree_root', public.fn_ensure_account(
  :'org', '9970', 'جذر اختبار الشجرة', 'asset', 'debit')::text, false);
select set_config('test.tree_middle', public.fn_ensure_account(
  :'org', '9971', 'وسيط مؤرشف', 'asset', 'debit')::text, false);
select set_config('test.tree_leaf', public.fn_ensure_account(
  :'org', '9972', 'فرع مؤرشف له رصيد', 'asset', 'debit')::text, false);
update public.accounts set parent_id = current_setting('test.tree_root')::uuid
  where id = current_setting('test.tree_middle')::uuid;
update public.accounts set parent_id = current_setting('test.tree_middle')::uuid
  where id = current_setting('test.tree_leaf')::uuid;
select set_config('test.entry', public.fn_post_two_line_journal(
  :'org', date '2099-01-01', 'exact_accounting_snapshot',
  '21300000-0000-0000-0000-000000000001'::uuid, 'exact accounting snapshot',
  current_setting('test.debit_account')::uuid, current_setting('test.credit_account')::uuid,
  100000000000000.01::numeric)::text, false);
select set_config('test.tree_entry', public.fn_post_two_line_journal(
  :'org', date '2098-01-01', 'exact_accounting_tree',
  '21300000-0000-0000-0000-000000000002'::uuid, 'exact archived tree',
  current_setting('test.tree_leaf')::uuid, current_setting('test.credit_account')::uuid,
  0.02::numeric)::text, false);
update public.accounts set active = false where id = current_setting('test.debit_account')::uuid;
update public.accounts set active = false
  where id in (current_setting('test.tree_middle')::uuid, current_setting('test.tree_leaf')::uuid);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(format($$select public.fn_accounting_ledger_snapshot(%L, 1)$$, :'org'),
  'owner can read the exact accounting snapshot');
select is(public.fn_accounting_ledger_snapshot(:'org', 1)->>'version',
  'farm-os.accounting-ledger.v1', 'snapshot version is pinned');
select is(public.fn_accounting_ledger_snapshot(:'org', 1)->>'org_id', :'org',
  'snapshot binds the requested organization');
select is((public.fn_accounting_ledger_snapshot(:'org', 1)->>'entry_limit')::integer, 1,
  'snapshot echoes the bounded entry limit');
select is((public.fn_accounting_ledger_snapshot(:'org', 1)->>'line_limit')::integer, 500,
  'snapshot declares its detail bound');
select is((public.fn_accounting_ledger_snapshot(:'org', 1)->>'line_count')::integer, 2,
  'snapshot returns the exact recent-line count');
select is((public.fn_accounting_ledger_snapshot(:'org', 1)->>'account_mismatch_count')::integer, 0,
  'snapshot proves every journal line account belongs to the organization');
select is(jsonb_array_length(public.fn_accounting_ledger_snapshot(:'org', 1)->'recent_lines'), 2,
  'both lines for the displayed entry are returned');
select is((select row->>'debit' from jsonb_array_elements(
    public.fn_accounting_ledger_snapshot(:'org', 1)->'trial_balance') row
    where row->>'code' = '9981'), '100000000000000.01',
  'trial-balance money remains exact text');
select is((select jsonb_typeof(row->'debit') from jsonb_array_elements(
    public.fn_accounting_ledger_snapshot(:'org', 1)->'trial_balance') row
    where row->>'code' = '9981'), 'string',
  'trial-balance money is a JSON string');
select is((select row->>'amount' from jsonb_array_elements(
    public.fn_accounting_ledger_snapshot(:'org', 1)->'recent_entries') row),
  '100000000000000.01', 'recent-entry amount remains exact text');
select is((select jsonb_typeof(row->'amount') from jsonb_array_elements(
    public.fn_accounting_ledger_snapshot(:'org', 1)->'recent_entries') row),
  'string', 'recent-entry amount is a JSON string');
select is(jsonb_array_length(public.fn_accounting_ledger_snapshot(:'org', 1)->'recent_entries'), 1,
  'entry count obeys the requested limit');
select is((select row->>'debit' from jsonb_array_elements(
    public.fn_accounting_ledger_snapshot(:'org', 1)->'recent_lines') row
    where row->>'account_code' = '9981'), '100000000000000.01',
  'recent-line money remains exact text');
select ok(exists(select 1 from jsonb_array_elements(
    public.fn_accounting_ledger_snapshot(:'org', 1)->'trial_balance') row
    where row->>'code' = '9981'),
  'an archived account with posted money remains visible');
select is((select row->>'has_postings' from jsonb_array_elements(
    public.fn_accounting_ledger_snapshot(:'org', 1)->'trial_balance') row
    where row->>'code' = '9971'), 'false',
  'an archived zero-balance intermediary remains in the account tree');
select is((select row->>'has_postings' from jsonb_array_elements(
    public.fn_accounting_ledger_snapshot(:'org', 1)->'trial_balance') row
    where row->>'code' = '9972'), 'true',
  'an archived descendant retains its posted-balance marker');
select is((select row->>'debit' from jsonb_array_elements(
    public.fn_accounting_ledger_snapshot(:'org', 1)->'trial_balance') row
    where row->>'code' = '9972'), '0.02',
  'the archived descendant retains exact money through its full ancestor chain');
select ok(not exists(select 1 from jsonb_array_elements(
    public.fn_accounting_ledger_snapshot(:'org', 1)->'trial_balance') row
    where row->>'org_id' <> :'org'),
  'snapshot contains no account from another organization');
select throws_ok(format($$select public.fn_accounting_ledger_snapshot(%L, 0)$$, :'org'),
  '22023', null, 'invalid entry limit fails closed');
select throws_ok($$select public.fn_accounting_ledger_snapshot(null, 20)$$,
  '23502', null, 'null organization fails closed');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$select public.fn_accounting_ledger_snapshot(%L, 20)$$, :'org'),
  'accountant can read the same-organization exact snapshot');
select throws_ok(format($$select public.fn_accounting_ledger_snapshot(%L, 20)$$, :'org_b'),
  '42501', null, 'accountant cannot read another organization snapshot');
reset role;

select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$select public.fn_accounting_ledger_snapshot(%L, 20)$$, :'org'),
  '42501', null, 'supervisor cannot read the finance snapshot');
reset role;

select set_config('test.foreign_debit', public.fn_ensure_account(
  :'org_b', '9961', 'Foreign debit', 'asset', 'debit')::text, false);
select set_config('test.foreign_credit', public.fn_ensure_account(
  :'org_b', '9962', 'Foreign credit', 'equity', 'credit')::text, false);
insert into public.journal_entries(id, org_id, entry_date, source_type, source_id, description)
values (
  '21300000-0000-0000-0000-000000000010', :'org', date '2100-01-01',
  'cross_tenant_snapshot_a', '21300000-0000-0000-0000-000000000011', 'entry org differs from lines'
), (
  '21300000-0000-0000-0000-000000000020', :'org_b', date '2101-01-01',
  'cross_tenant_snapshot_b', '21300000-0000-0000-0000-000000000021', 'line org differs from entry'
);
insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit)
values
  (:'org_b', '21300000-0000-0000-0000-000000000010', current_setting('test.foreign_debit')::uuid, 1, 0),
  (:'org_b', '21300000-0000-0000-0000-000000000010', current_setting('test.foreign_credit')::uuid, 0, 1),
  (:'org', '21300000-0000-0000-0000-000000000020', current_setting('test.debit_account')::uuid, 1, 0),
  (:'org', '21300000-0000-0000-0000-000000000020', current_setting('test.credit_account')::uuid, 0, 1);

select pg_temp.as_user(current_setting('test.owner'));
select is((public.fn_accounting_ledger_snapshot(:'org', 20)->>'account_mismatch_count')::integer, 4,
  'snapshot exposes line-entry-account tenant disagreement from either side of the link');
reset role;

select * from finish();
rollback;
