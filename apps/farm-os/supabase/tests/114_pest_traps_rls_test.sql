-- 114 — RPW-1: tenant isolation on the new pest-scouting tables (pest_traps / pest_trap_catches /
-- pest_incidents). Mirrors 01_rls_isolation_test.sql's strategy: create org B + a member inline (as the
-- RLS-bypassing superuser), impersonate org-A and org-B members, assert org A cannot see/insert org B
-- rows and vice versa, and that a guessed foreign org id / foreign-org FK reference is rejected.

begin;
select plan(9);

\set orgA '00000000-0000-0000-0000-000000000001'
\set sectorA '5248f695-6ca1-5fc3-9af1-3a0fda800f51'

select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='owner'), false);

-- org B + a member + one trap, created as the superuser (bypasses RLS).
insert into public.organization (id, name) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','مزرعة أخرى (RPW)');
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc',
          '00000000-0000-0000-0000-000000000000','authenticated','authenticated', now(), now());
insert into public.organization_member (org_id, user_id, role) values
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-cccccccccccc','owner');
insert into public.pest_traps (id, org_id, code, label, installed_at) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','TRP-B1','مصيدة ب1','2026-01-01');

-- ===== Impersonate org-A owner =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role','authenticated')::text, true);
set role authenticated;

-- 1. org A can register a trap via the RPC.
select isnt(public.fn_save_trap(:'orgA', 'TRP-A1', 'مصيدة ٣ - قطاع أ', '2026-01-01', :'sectorA'), null,
  'org A owner can register a trap via fn_save_trap');

-- 2. no org-B trap rows leak through a direct select.
select is((select count(*) from public.pest_traps where org_id <> :'orgA'), 0::bigint,
  'no foreign-org pest_traps leak to org A');

-- 3. a guessed org-B id returns zero rows (TI-1 core assertion).
select is((select count(*) from public.pest_traps
  where org_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 0::bigint,
  'guessed org B id returns zero pest_traps rows');

-- 4. org A cannot direct-insert a trap tagged with org B (WITH CHECK denies it).
select throws_ok($$
  insert into public.pest_traps (org_id, code, label, installed_at)
  values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','TRP-LEAK','محاولة تسرب','2026-01-01')
$$, '42501', null, 'insert into foreign org denied by pest_traps WITH CHECK');

-- 5. org A cannot log a catch against org B's trap (RPC resolves org from the trap → cross-org denied).
select throws_ok($$ select public.fn_log_trap_catch('dddddddd-dddd-dddd-dddd-dddddddddddd', '2026-01-08', 3) $$,
  '42501', null, 'org A cannot log a catch against a foreign-org trap');

-- 6. org A cannot report an incident anchored to org B's trap.
select throws_ok($$
  select public.fn_report_pest_incident('2026-01-08', 'suspected', 'dddddddd-dddd-dddd-dddd-dddddddddddd')
$$, '42501', null, 'org A cannot report an incident against a foreign-org trap');

-- 7. a trap with no location succeeds (location is optional — a trap need not be pinned to a node yet).
-- NOTE: psql does NOT interpolate `:'var'` inside dollar-quoted ($$...$$) strings (it is a documented
-- exception, mirrored by every other pgTAP file in this suite) — hardcode the literal org id here.
select lives_ok($$
  select public.fn_save_trap('00000000-0000-0000-0000-000000000001', 'TRP-A2', 'مصيدة بلا موقع', '2026-01-01')
$$, 'a trap with no sector/hawsha/line succeeds (location is optional)');

reset role;

-- ===== Impersonate org-B owner =====
select set_config('request.jwt.claims',
  json_build_object('sub','cccccccc-cccc-cccc-cccc-cccccccccccc','role','authenticated')::text, true);
set role authenticated;

-- 8. org B owner sees only their own trap.
select is((select count(*) from public.pest_traps
  where id='dddddddd-dddd-dddd-dddd-dddddddddddd'), 1::bigint,
  'org B owner sees their own pest_traps row');
select is((select count(*) from public.pest_traps where org_id = :'orgA'), 0::bigint,
  'org B owner sees zero org A pest_traps rows');

reset role;
select * from finish();
rollback;
