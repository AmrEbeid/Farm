-- 114 — SPEC-0006: `people.write` (owner/farm_manager) gates `people` writes; `labor.write`
-- (owner/farm_manager/supervisor) is the new permission for `labor_logs` (next test file). Before this
-- migration, `people`'s only policy was org-scoped with NO role gate — ANY authenticated org member
-- could insert/update a person. Impersonation via request.jwt.claims (same harness as 67/79).
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(8);

\set orgA '00000000-0000-0000-0000-000000000001'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('test.eng', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'agri_engineer' limit 1), false);
select set_config('test.sup', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'supervisor' limit 1), false);
select set_config('test.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ===== authorize() recognizes the two new permissions with the right role sets =====
select pg_temp.as_user(current_setting('test.manager'));
select is(public.authorize('people.write', :'orgA'), true, 'people.write: farm_manager HAS it');
select is(public.authorize('labor.write', :'orgA'), true, 'labor.write: farm_manager HAS it');
reset role;

select pg_temp.as_user(current_setting('test.sup'));
select is(public.authorize('people.write', :'orgA'), false, 'people.write: supervisor does NOT have it');
select is(public.authorize('labor.write', :'orgA'), true, 'labor.write: supervisor HAS it (day-to-day crews)');
reset role;

select pg_temp.as_user(current_setting('test.store'));
select is(public.authorize('labor.write', :'orgA'), false, 'labor.write: storekeeper does NOT have it');
reset role;

-- ===== a member WITHOUT people.write (agri_engineer) — write refused, read still allowed =====
select pg_temp.as_user(current_setting('test.eng'));
select throws_ok(
  format($$ insert into public.people (org_id, name) values (%L, 'عامل مهرّب') $$, :'orgA'),
  '42501', null,
  'people: a non-people.write member cannot CREATE a person');
select ok(
  (select count(*)::int from public.people where org_id = :'orgA') > 0,
  'people: a non-people.write member can still READ the directory (reads ungated)');
reset role;

-- ===== an owner (HAS people.write) — create allowed =====
select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  format($$ insert into public.people (org_id, name, position, employment_type, active)
            values (%L, 'عامل موسمي جديد', 'قطاف', 'seasonal', true) $$, :'orgA'),
  'people: an owner (people.write) CAN create a seasonal person');
reset role;

select * from finish();
rollback;
