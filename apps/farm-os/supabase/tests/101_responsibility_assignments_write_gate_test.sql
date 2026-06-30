-- 101 — #314: responsibility_assignments writes are owner/farm_manager-gated.
--
-- The table stores accountability/routing labels, not permissions. `authorize()` still derives actual
-- app permissions only from organization_member.role. This test pins the governance hardening: org
-- members can still read same-org assignments, but direct REST insert/update needs responsibility.write
-- (owner/farm_manager) and still rejects cross-org people.

begin;
select plan(13);

\set orgA '00000000-0000-0000-0000-000000000001'
\set orgB '10100000-0000-0000-0000-0000000000b0'
\set persB '10100000-0000-0000-0000-0000000000b1'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);
select set_config('test.mgr', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('test.sup', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'supervisor' limit 1), false);
select set_config('test.sk', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);
select set_config('test.person', (select id::text from public.people
  where org_id = :'orgA' order by id limit 1), false);

insert into public.organization (id, name) values (:'orgB', 'مزرعة مسؤوليات بعيدة');
insert into public.people (id, org_id, name) values (:'persB', :'orgB', 'مسؤول بعيد');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.owner'));
select is(public.authorize('responsibility.write', :'orgA'), true,
  'responsibility.write: owner HAS it');
reset role;

select pg_temp.as_user(current_setting('test.mgr'));
select is(public.authorize('responsibility.write', :'orgA'), true,
  'responsibility.write: farm_manager HAS it');
reset role;

select pg_temp.as_user(current_setting('test.sk'));
select is(public.authorize('responsibility.write', :'orgA'), false,
  'responsibility.write: storekeeper does NOT');
reset role;

select pg_temp.as_user(current_setting('test.sup'));
select is(public.authorize('responsibility.write', :'orgA'), false,
  'responsibility.write: supervisor does NOT');
reset role;

select pg_temp.as_user(current_setting('test.sk'));
select isnt((select count(*) from public.responsibility_assignments where org_id = :'orgA'), 0::bigint,
  '#314: non-manager org members can still READ same-org responsibility labels');

select throws_ok(
  format($$ insert into public.responsibility_assignments (org_id, person_id, scope_type, responsibility_type)
            values (%L, %L, 'farm', 'daily_supervisor') $$,
         :'orgA', current_setting('test.person')),
  '42501', null,
  '#314: storekeeper cannot direct-insert a same-org responsibility assignment');

select throws_ok(
  $$ update public.responsibility_assignments
       set responsibility_type = 'inventory_responsible'
       where org_id = '00000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  '#314: storekeeper cannot direct-update responsibility labels');
reset role;

select pg_temp.as_user(current_setting('test.mgr'));
select lives_ok(
  format($$ insert into public.responsibility_assignments (org_id, person_id, scope_type, responsibility_type)
            values (%L, %L, 'farm', 'daily_supervisor') $$,
         :'orgA', current_setting('test.person')),
  '#314: farm_manager can direct-insert a same-org responsibility assignment');

select lives_ok(
  $$ update public.responsibility_assignments
       set responsibility_type = 'accountable_manager'
       where org_id = '00000000-0000-0000-0000-000000000001'
         and scope_type = 'farm'
         and responsibility_type = 'daily_supervisor' $$,
  '#314: farm_manager can update same-org responsibility labels');

select throws_ok(
  format($$ insert into public.responsibility_assignments (org_id, person_id, scope_type, responsibility_type)
            values (%L, %L, 'farm', 'daily_supervisor') $$,
         :'orgA', :'persB'),
  '42501', null,
  '#314: responsibility assignment still cannot point at a CROSS-ORG person');
reset role;

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename = 'responsibility_assignments'
      and policyname = 'tenant_all'
      and with_check ilike '%authorize%responsibility.write%'
      and with_check ilike '%people pe%'),
  1,
  '#314: responsibility_assignments WITH CHECK carries responsibility.write and same-org person guard');

select is(
  (select count(*)::int
     from regexp_matches(
       pg_get_functiondef('public.authorize(text, uuid)'::regprocedure),
       'responsibility\.write',
       'g')),
  1,
  '#314: authorize() carries exactly one responsibility.write arm');

select is(
  (select count(*)::int
     from unnest(array[
       'pr.approve', 'plan.write', 'op.execute', 'inventory.write', 'budget.write',
       'payroll.read', 'structure.write', 'academy.write', 'export.write', 'responsibility.write',
       'finance.read', 'custody.write', 'request.prepare', 'request.approve.op', 'request.approve.final'
     ]) as perm
     where position(perm in pg_get_functiondef('public.authorize(text, uuid)'::regprocedure)) = 0),
  0,
  '#314: authorize() preserves the full in-flight permission union');

select * from finish();
rollback;
