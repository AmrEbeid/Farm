-- 72 — #306: people.reports_to_person_id must reference a SAME-ORG person (the self-referential FK 0070
-- deferred to a trigger, since RLS WITH CHECK can't express a self-ref org check). A cross-org manager is
-- refused; a same-org manager (or null) is allowed. Impersonation via request.jwt.claims; orgB + its
-- person and an orgA manager are seeded as superuser.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(4);

\set orgA   '00000000-0000-0000-0000-000000000001'
\set orgB   '07200000-0000-0000-0000-0000000000b0'
\set persB  '07200000-0000-0000-0000-0000000000b3'
\set mgrA   '07200000-0000-0000-0000-0000000000a3'

select set_config('test.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);

insert into public.organization (id, name) values (:'orgB', 'مزرعة سابعة');
insert into public.people (id, org_id, name) values
  (:'persB', :'orgB', 'مدير بعيد'),
  (:'mgrA',  :'orgA', 'مدير محلي');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.store'), 'role', 'authenticated')::text, true);
set local role authenticated;

-- a cross-org manager is refused (the trigger)
select throws_ok(
  format($$ insert into public.people (org_id, name, reports_to_person_id)
            values (%L, 'تابع', %L) $$, :'orgA', :'persB'),
  '42501', null, '#306: a person cannot report to a CROSS-ORG manager (trigger)');

-- a same-org manager is allowed
select lives_ok(
  format($$ insert into public.people (org_id, name, reports_to_person_id)
            values (%L, 'تابع محلي', %L) $$, :'orgA', :'mgrA'),
  '#306: a person CAN report to a same-org manager');

-- a null manager is allowed (top of the chart)
select lives_ok(
  format($$ insert into public.people (org_id, name, reports_to_person_id)
            values (%L, 'بدون مدير', null) $$, :'orgA'),
  '#306: a person with no manager (null) is allowed');

reset role;

-- structural: the trigger is wired
select is(
  (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'people' and t.tgname = 'people_reports_to_same_org' and not t.tgisinternal),
  1,
  '#306: the people_reports_to_same_org trigger is present');

select * from finish();
rollback;
