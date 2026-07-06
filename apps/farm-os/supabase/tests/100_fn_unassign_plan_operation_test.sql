-- 100 — #398 follow-up: fn_unassign_plan_operation removes a person from a plan operation (migration
-- 20260701360000). Covers (a) a plan.write role can unassign, (b) a non-plan.write role (storekeeper) is
-- refused, (c) unassigning a person not actually assigned is a safe no-op (no error, removed:false — not
-- a confusing silent "success"), (d) the assignee row is actually gone, (e) fn_audit still fires a
-- DELETE audit_log row. Mirrors test 92's JWT-claim role simulation and grant-lockdown checks. Run via
-- supabase test db or test-shims/run-pgtap-local.sh.
begin;
select plan(9);

\set orgA '00000000-0000-0000-0000-000000000001'
\set plan 'ff100000-0000-0000-0000-000000000100'
\set op   'ff100001-0000-0000-0000-000000000100'
\set p1   'ff100002-0000-0000-0000-000000000100'
\set p2   'ff100003-0000-0000-0000-000000000100'

-- ── grant lockdown ───────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon',
  'public.fn_unassign_plan_operation(uuid,uuid)', 'EXECUTE'),
  '0100: anon cannot EXECUTE fn_unassign_plan_operation');
select ok(has_function_privilege('authenticated',
  'public.fn_unassign_plan_operation(uuid,uuid)', 'EXECUTE'),
  '0100: authenticated CAN EXECUTE fn_unassign_plan_operation');

-- ── fixtures (org 001, the seeded org with farm_manager/storekeeper members) ────────────────────────
insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'approved');
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status)
  values (:'op', :'orgA', :'plan', 'fertilization', date '2026-07-01', 'planned');
insert into public.people (id, org_id, name, active) values (:'p1', :'orgA', 'عامل ١', true);
insert into public.people (id, org_id, name, active) values (:'p2', :'orgA', 'عامل ٢', true);
insert into public.plan_operation_assignees (org_id, plan_op_id, person_id, is_lead)
  values (:'orgA', :'op', :'p1', true);

select set_config('t.fm', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('t.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);

-- ── (b) authz: a non-plan.write role (storekeeper) is refused — the assignee stays assigned ─────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_unassign_plan_operation('%s'::uuid, '%s'::uuid) $$, :'op', :'p1'),
  '42501', null, 'a storekeeper (no plan.write) is refused (42501)');
reset role;
select is(
  (select count(*) from public.plan_operation_assignees where plan_op_id = :'op' and person_id = :'p1'),
  1::bigint, 'the refused storekeeper call left the assignee row untouched');

-- ── (a) a plan.write role (farm_manager) unassigns the person ────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('t.res', public.fn_unassign_plan_operation(:'op'::uuid, :'p1'::uuid)::text, false);
reset role;
select is((current_setting('t.res')::jsonb)->>'removed', 'true',
  'a plan.write role (farm_manager) unassigns the person (removed:true)');

-- ── (d) the assignee row is actually gone ────────────────────────────────────────────────────────────
select is(
  (select count(*) from public.plan_operation_assignees where plan_op_id = :'op' and person_id = :'p1'),
  0::bigint, 'the assignee row is actually gone after the call');

-- ── (e) fn_audit still fires — a DELETE audit_log row exists for the removed assignee ─────────────────
select cmp_ok(
  (select count(*) from public.audit_log where entity_type = 'plan_operation_assignees' and action = 'DELETE'),
  '>=', 1::bigint,
  'fn_audit fired a DELETE audit_log row for the unassign');

-- ── (c) safe no-op: unassigning a person who is NOT actually assigned does not error ──────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  format($$ select public.fn_unassign_plan_operation('%s'::uuid, '%s'::uuid) $$, :'op', :'p2'),
  'unassigning a person not actually assigned does not raise (safe no-op)');
select set_config('t.noop', public.fn_unassign_plan_operation(:'op'::uuid, :'p2'::uuid)::text, false);
reset role;
select is((current_setting('t.noop')::jsonb)->>'removed', 'false',
  'no-op is honest: removed:false, not a confusing silent "success"');

select * from finish();
rollback;
