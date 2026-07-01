-- 115 — `labor_logs` (SPEC-0006 slice 2, actual day-to-day attendance). Structure/CHECK assertions run
-- as the superuser/service path (RLS bypassed, mirrors test 91); the RLS role-gate + cross-org guard
-- assertions impersonate roles via request.jwt.claims (mirrors tests 67/79). Run via `supabase test db`
-- or test-shims/run-pgtap-local.sh.

begin;
select plan(14);

\set orgA '00000000-0000-0000-0000-000000000001'
\set orgB '00000000-0000-0000-0000-000000000002'
-- p1: a seeded agri_engineer person (orgA), used as the labor_logs.person_id fixture below.
\set p1   '51ed8286-fad7-53d1-a92d-01532fa78b43'

-- ── structure ──────────────────────────────────────────────────────────────────────────────────────
select has_table('public', 'labor_logs', 'labor_logs table exists');
select is(
  (select relforcerowsecurity from pg_class where relname = 'labor_logs'), true,
  'labor_logs: FORCE row level security is on');
select ok(
  not has_table_privilege('anon', 'public.labor_logs', 'SELECT')
  and not has_table_privilege('anon', 'public.labor_logs', 'INSERT'),
  'labor_logs: anon holds NO grant (authenticated-only)');
select ok(
  not has_table_privilege('authenticated', 'public.labor_logs', 'DELETE'),
  'labor_logs: authenticated holds NO delete grant (0027 delete-posture convention)');

-- ── person-or-team CHECK (superuser path, bypasses RLS but not table CHECKs) ─────────────────────────
select throws_ok(
  format($$ insert into public.labor_logs (org_id, work_date, hours) values (%L, current_date, 8) $$, :'orgA'),
  '23514', null,
  'labor_logs: neither person_id nor team_name set is rejected (CHECK)');
select throws_ok(
  format($$ insert into public.labor_logs (org_id, person_id, team_name, work_date, hours)
            values (%L, %L, 'فريق أ', current_date, 8) $$, :'orgA', :'p1'),
  '23514', null,
  'labor_logs: BOTH person_id and team_name set is rejected (CHECK)');
select lives_ok(
  format($$ insert into public.labor_logs (org_id, team_name, work_date, hours)
            values (%L, 'فريق التقليم', current_date, 6) $$, :'orgA'),
  'labor_logs: team_name-only (informal crew) is accepted');

-- ── hours CHECK ────────────────────────────────────────────────────────────────────────────────────
select throws_ok(
  format($$ insert into public.labor_logs (org_id, person_id, work_date, hours)
            values (%L, %L, current_date, 0) $$, :'orgA', :'p1'),
  '23514', null,
  'labor_logs: zero hours is rejected (CHECK hours > 0)');
select throws_ok(
  format($$ insert into public.labor_logs (org_id, person_id, work_date, hours)
            values (%L, %L, current_date, -3) $$, :'orgA', :'p1'),
  '23514', null,
  'labor_logs: negative hours is rejected (CHECK hours > 0)');

-- ── RLS role gate: labor.write (owner/farm_manager/supervisor) ───────────────────────────────────────
select set_config('test.eng', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'agri_engineer' limit 1), false);   -- NO labor.write
select set_config('test.manager', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);    -- HAS labor.write

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.eng'));
select throws_ok(
  format($$ insert into public.labor_logs (org_id, person_id, work_date, hours)
            values (%L, %L, current_date, 8) $$, :'orgA', :'p1'),
  '42501', null,
  'labor_logs: a non-labor.write member (agri_engineer) cannot log attendance');
select ok(
  (select count(*)::int from public.labor_logs where org_id = :'orgA') > 0,
  'labor_logs: a non-labor.write member can still READ logs (reads org-scoped, ungated)');
reset role;

-- ── cross-org person_id is rejected even for a labor.write role ─────────────────────────────────────
insert into public.organization (id, name) values (:'orgB', 'cross-org fixture');
insert into public.people (id, org_id, name) values
  ('9b000001-0000-0000-0000-000000000b09', :'orgB', 'شخص من مؤسسة أخرى');

select pg_temp.as_user(current_setting('test.manager'));
select throws_ok(
  format($$ insert into public.labor_logs (org_id, person_id, work_date, hours)
            values (%L, '9b000001-0000-0000-0000-000000000b09', current_date, 8) $$, :'orgA'),
  '42501', null,
  'labor_logs: a cross-org person_id is rejected even for a labor.write role');
select lives_ok(
  format($$ insert into public.labor_logs (org_id, person_id, work_date, hours, note)
            values (%L, %L, current_date, 8, 'يوم عادي') $$, :'orgA', :'p1'),
  'labor_logs: a farm_manager (labor.write) CAN log a same-org person''s attendance');
reset role;

-- ── audit ──────────────────────────────────────────────────────────────────────────────────────────
select isnt(
  (select count(*) from public.audit_log where entity_type = 'labor_logs'), 0::bigint,
  'labor_logs writes are recorded in the append-only audit_log');

select * from finish();
rollback;
