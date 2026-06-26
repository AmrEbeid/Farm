-- 73 — #306: people_compensation.person_id must reference a SAME-ORG person. comp_rw gates write on
-- payroll.read but didn't validate the person's org, so a payroll member could attach a wage record to a
-- CROSS-ORG person. 0072 adds the person-org EXISTS. An owner holds payroll.read. A foreign org (orgB) +
-- its person, and a fresh orgA person (no existing comp), are seeded as superuser. Impersonation via
-- request.jwt.claims (tests 45/53/...).
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(3);

\set orgA   '00000000-0000-0000-0000-000000000001'
\set orgB   '07300000-0000-0000-0000-0000000000b0'
\set persB  '07300000-0000-0000-0000-0000000000b3'
\set persA  '07300000-0000-0000-0000-0000000000a3'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);

insert into public.organization (id, name) values (:'orgB', 'مزرعة ثامنة');
insert into public.people (id, org_id, name) values
  (:'persB', :'orgB', 'موظف بعيد'),
  (:'persA', :'orgA', 'موظف محلي');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

-- a payroll member cannot attach a wage to a CROSS-ORG person
select throws_ok(
  format($$ insert into public.people_compensation (org_id, person_id, rate)
            values (%L, %L, 100) $$, :'orgA', :'persB'),
  '42501', null, '#306: people_compensation cannot reference a CROSS-ORG person');

-- ...but a same-org person is fine
select lives_ok(
  format($$ insert into public.people_compensation (org_id, person_id, rate)
            values (%L, %L, 100) $$, :'orgA', :'persA'),
  '#306: people_compensation CAN reference a same-org person');

reset role;

select is(
  (select count(*)::int from pg_policies
     where schemaname='public' and tablename='people_compensation' and policyname='comp_rw'
       and with_check ilike '%people pe%'),
  1,
  '#306: comp_rw gates person_id to the same org');

select * from finish();
rollback;
