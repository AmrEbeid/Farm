-- Atomic custody dashboard summary: exact text money, tenant isolation, and finance.read gate.
begin;
select no_plan();

\set org '00000000-0000-0000-0000-000000000001'
\set org_b 'c2080000-0000-0000-0000-00000000000b'
\set account 'c2080000-0000-0000-0000-000000000001'

insert into public.organization(id, name) values (:'org_b', 'مزرعة أخرى لاختبار ملخص العهدة');
insert into public.custody_accounts(id, org_id, holder_label, target_float)
values (:'account', :'org', 'عهدة الملخص الذري', 20000.125);
insert into public.custody_movements(
  org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out
) values
  (:'org', :'account', current_date, 'اختبار دقة الملخص', 123.00000000000000001, 0);

select set_config('test.org', :'org', false);
select set_config('test.org_b', :'org_b', false);
select set_config('test.account', :'account', false);
select set_config('test.accountant', (
  select user_id::text from public.organization_member
   where org_id = :'org' and role = 'accountant' limit 1
), false);
select set_config('test.supervisor', (
  select user_id::text from public.organization_member
   where org_id = :'org' and role = 'supervisor' limit 1
), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select ok(not has_function_privilege('public',
  'public.fn_custody_dashboard_summary(uuid)', 'EXECUTE'),
  'PUBLIC cannot execute the custody dashboard summary');
select ok(not has_function_privilege('anon',
  'public.fn_custody_dashboard_summary(uuid)', 'EXECUTE'),
  'anon cannot execute the custody dashboard summary');
select ok(has_function_privilege('authenticated',
  'public.fn_custody_dashboard_summary(uuid)', 'EXECUTE'),
  'authenticated reaches the RPC; the function enforces finance.read');

select pg_temp.as_user(current_setting('test.accountant'));
select is(public.fn_custody_dashboard_summary(:'org')->>'version',
  'farm-os.custody-dashboard.v1', 'summary exposes its pinned version');
select is(
  (select jsonb_typeof(account->'closing_balance')
     from jsonb_array_elements(public.fn_custody_dashboard_summary(:'org')->'accounts') account
    where account->>'id' = :'account'),
  'string', 'closing balance crosses JSON as text');
select is(
  (select account->>'closing_balance'
     from jsonb_array_elements(public.fn_custody_dashboard_summary(:'org')->'accounts') account
    where account->>'id' = :'account'),
  '123.00000000000000001', 'closing balance keeps every decimal digit');
select is(
  (select account->>'target_float'
     from jsonb_array_elements(public.fn_custody_dashboard_summary(:'org')->'accounts') account
    where account->>'id' = :'account'),
  '20000.125', 'target float also crosses JSON as exact text');
select throws_ok(format(
  $$select public.fn_custody_dashboard_summary(%L)$$, current_setting('test.org_b')),
  '42501', null, 'accountant cannot read a foreign organization summary');
reset role;

select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format(
  $$select public.fn_custody_dashboard_summary(%L)$$, current_setting('test.org')),
  '42501', null, 'non-finance role cannot read the custody dashboard summary');
reset role;

select * from finish();
rollback;
