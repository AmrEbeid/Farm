-- Data authority status: tenant isolation, owner-only mutation, fail-closed absence.
begin;
select plan(13);

\set orgA '00000000-0000-0000-0000-000000000001'
\set orgB '20300000-0000-0000-0000-000000000001'

insert into public.organization (id, name)
values (:'orgB', 'authority test org');
insert into public.data_authority_status (org_id, domain, status)
select :'orgA', domain, status
from (values
  ('finance_ledger', 'partial'),
  ('palm_registry', 'unverified'),
  ('offshoots', 'blocked'),
  ('budgets', 'blocked'),
  ('payroll', 'blocked'),
  ('inventory', 'partial'),
  ('operations', 'partial')
) as fixture(domain, status)
on conflict (org_id, domain) do nothing;
insert into public.data_authority_status (org_id, domain, status, source_label, record_count, notes)
values (:'orgB', 'budgets', 'verified', 'test source', 1, 'test evidence');

select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);
select set_config('test.managerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);

select has_table('public', 'data_authority_status', 'authority table exists');
select col_is_unique('public', 'data_authority_status', array['org_id', 'domain'],
  'one authority row per org and domain');
select is((select count(*)::int from public.data_authority_status where org_id = :'orgA'), 7,
  'canonical org has seven explicit domain states');
select is((select count(*)::int from public.data_authority_status
  where org_id = :'orgA' and domain = 'budgets' and status = 'blocked'), 1,
  'canonical budget data starts blocked');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role', 'authenticated')::text, true);
set role authenticated;

select is((select count(*)::int from public.data_authority_status), 7,
  'owner reads only own-org authority rows');
select lives_ok(
  $$ select public.fn_set_data_authority_status(
       '00000000-0000-0000-0000-000000000001', 'budgets', 'partial',
       'owner-reviewed source', null, 3, 'still incomplete') $$,
  'owner can update own-org authority status');
select is((select status from public.data_authority_status
  where org_id = :'orgA' and domain = 'budgets'), 'partial',
  'owner update is stored');
select throws_ok(
  $$ select public.fn_set_data_authority_status(
       '00000000-0000-0000-0000-000000000001', 'budgets', 'verified') $$,
  '23514', null, 'verified status requires provenance evidence');
select lives_ok(
  $$ select public.fn_set_data_authority_status(
       '00000000-0000-0000-0000-000000000001', 'budgets', 'verified',
       'owner-reviewed budget', null, 3, 'three source rows reconciled') $$,
  'owner can verify with source label, record count, and evidence notes');
select throws_ok(
  $$ select public.fn_set_data_authority_status(
       '20300000-0000-0000-0000-000000000001', 'budgets', 'verified') $$,
  '42501', null, 'owner cannot mutate another org');

reset role;
insert into public.organization_member (org_id, user_id, role)
values (:'orgB', current_setting('test.ownerA')::uuid, 'owner');
select set_config('request.jwt.claims',
  json_build_object(
    'sub', current_setting('test.ownerA'),
    'role', 'authenticated',
    'active_org_id', :'orgA'
  )::text, true);
set role authenticated;

select throws_ok(
  $$ select public.fn_set_data_authority_status(
       '20300000-0000-0000-0000-000000000001', 'budgets', 'verified') $$,
  '42501', null, 'owner cannot mutate an inactive org');

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.managerA'), 'role', 'authenticated')::text, true);
set role authenticated;

select throws_ok(
  $$ select public.fn_set_data_authority_status(
       '00000000-0000-0000-0000-000000000001', 'budgets', 'verified') $$,
  '42501', null, 'non-owner cannot change authority status');
select is((select count(*)::int from public.data_authority_status
  where org_id = :'orgA' and domain = 'weather'), 0,
  'missing domain has no implicit verified row');

select * from finish();
rollback;
