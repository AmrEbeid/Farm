-- 130 — owner drawings are finance-confidential at the expenses table RLS layer.
--
-- Managers still need ordinary expense visibility for budget workflows, but `kind='drawing'`
-- represents owner withdrawals and must be visible only to roles with finance.read (owner/accountant).
-- Run via `supabase test db` or `supabase/test-shims/run-pgtap-local.sh`.

begin;
select plan(10);

\set org '00000000-0000-0000-0000-000000000001'

insert into public.expenses (id, org_id, date, category, description, total, status, kind)
  values ('b0300000-0000-0000-0000-000000000001', :'org', current_date, 'تشغيل', 'تشغيلي ظاهر للمدير', 100, 'approved', 'operating');
insert into public.expenses (id, org_id, date, category, description, total, status, kind)
  values ('b0300000-0000-0000-0000-000000000002', :'org', current_date, 'مسحوبات', 'مسحوبات مالك خاصة', 200, 'approved', 'drawing');
insert into public.expenses (id, org_id, date, category, description, total, status, kind)
  values ('b0300000-0000-0000-0000-000000000003', :'org', current_date, 'معدات', 'رأسمالي ظاهر للمدير', 300, 'approved', 'capex');

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'farm_manager' limit 1), false);
select set_config('test.storekeeper', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'storekeeper' limit 1), false);

select isnt(current_setting('test.manager'), '', 'fixture: a farm_manager member exists in org');
select isnt(current_setting('test.accountant'), '', 'fixture: an accountant member exists in org');
select isnt(current_setting('test.storekeeper'), '', 'fixture: a storekeeper member exists in org');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.owner'));
select is((select count(*)::int from public.expenses where id = 'b0300000-0000-0000-0000-000000000002'), 1,
  'owner can read drawing expense rows');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select is((select count(*)::int from public.expenses where id = 'b0300000-0000-0000-0000-000000000002'), 1,
  'accountant can read drawing expense rows');
reset role;

select pg_temp.as_user(current_setting('test.manager'));
select is(public.authorize('finance.read', :'org'), false, 'farm_manager does not have finance.read');
select is((select count(*)::int from public.expenses where id = 'b0300000-0000-0000-0000-000000000002'), 0,
  'farm_manager cannot read drawing expense rows');
select is((select count(*)::int from public.expenses where id in (
  'b0300000-0000-0000-0000-000000000001',
  'b0300000-0000-0000-0000-000000000003'
)), 2, 'farm_manager can still read non-drawing expense rows');
reset role;

select pg_temp.as_user(current_setting('test.storekeeper'));
select is((select count(*)::int from public.expenses where id = 'b0300000-0000-0000-0000-000000000002'), 0,
  'other org members without finance.read also cannot read drawing rows');
reset role;

select is(
  (select count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'expenses'
       and qual like '%finance.read%'
       and qual like '%kind <> ''drawing''%'),
  1,
  'expenses USING policy keeps drawing rows behind finance.read');

select * from finish();
rollback;
