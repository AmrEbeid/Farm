-- 112 — labor cost basis: plan_labor_requirements.person_id (migration 20260701250000).
-- Validates: the column exists + is nullable, the FK enforces a real person, and the tenant_all
-- WITH CHECK re-emit adds the same-org guard for person_id (mirrors test 73's people_compensation
-- cross-org-person check and test 91's plan_operation_assignees pattern) without weakening the existing
-- org/plan.write/parent-op checks (0042). Run via supabase test db or test-shims/run-pgtap-local.sh.
begin;
select plan(8);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set orgB  '11200000-0000-0000-0000-0000000000b0'
\set plan  '11200001-0000-0000-0000-000000000112'
\set op    '11200002-0000-0000-0000-000000000112'
\set p1    '11200003-0000-0000-0000-000000000112'
\set persB '11200004-0000-0000-0000-000000000112'
\set bad   'deadbeef-0000-0000-0000-000000000112'

-- ── structure ──────────────────────────────────────────────────────────────────────────────────────
select has_column('public', 'plan_labor_requirements', 'person_id',
  'plan_labor_requirements.person_id column added');
select is(
  (select attnotnull from pg_attribute
     where attrelid = 'public.plan_labor_requirements'::regclass and attname = 'person_id'),
  false, 'person_id is nullable — the existing free-text-only flow keeps working');

-- ── fixtures ───────────────────────────────────────────────────────────────────────────────────────
insert into public.organization (id, name) values (:'orgB', 'مزرعة بعيدة');
insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'approved');
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status)
  values (:'op', :'orgA', :'plan', 'fertilization', date '2026-07-01', 'planned');
insert into public.people (id, org_id, name, active) values (:'p1', :'orgA', 'عامل ١', true);
insert into public.people (id, org_id, name, active) values (:'persB', :'orgB', 'موظف بعيد', true);

-- ── FK: a non-existent person is rejected (superuser path — exercises the FK, not RLS) ──────────────
select throws_ok(
  format($$insert into public.plan_labor_requirements (org_id, plan_op_id, person_or_team, count, days, person_id)
           values (%L, %L, 'فريق', 2, 1, %L)$$, :'orgA', :'op', :'bad'),
  '23503', null, 'a non-existent person_id is rejected (FK violation)');

-- ── FK: a real person is accepted, free-text-only (null person_id) still works ───────────────────────
select lives_ok(
  format($$insert into public.plan_labor_requirements (org_id, plan_op_id, person_or_team, count, days, person_id)
           values (%L, %L, 'فريق التسميد', 3, 2, %L)$$, :'orgA', :'op', :'p1'),
  'a same-org person_id is accepted');
select lives_ok(
  format($$insert into public.plan_labor_requirements (org_id, plan_op_id, person_or_team, count, days)
           values (%L, %L, 'عمالة يومية', 5, 1)$$, :'orgA', :'op'),
  'a free-text-only line (no person_id) still works — additive, not a breaking change');

-- ── RLS WITH CHECK: cross-org person_id is rejected for a plan.write member ──────────────────────────
select set_config('t.fm', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$insert into public.plan_labor_requirements (org_id, plan_op_id, person_or_team, count, days, person_id)
           values (%L, %L, 'فريق', 1, 1, %L)$$, :'orgA', :'op', :'persB'),
  '42501', null, 'a labor line cannot reference a CROSS-ORG person (WITH CHECK)');
-- ...but a same-org person is fine under the same role/plan.write
select lives_ok(
  format($$insert into public.plan_labor_requirements (org_id, plan_op_id, person_or_team, count, days, person_id)
           values (%L, %L, 'فريق', 1, 1, %L)$$, :'orgA', :'op', :'p1'),
  'a same-org person_id is accepted under plan.write (farm_manager)');
reset role;

-- ── the existing plan.write gate is preserved (a non-plan.write role is still refused) ───────────────
select set_config('t.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$insert into public.plan_labor_requirements (org_id, plan_op_id, person_or_team, count, days)
           values (%L, %L, 'فريق', 1, 1)$$, :'orgA', :'op'),
  '42501', null, 'a storekeeper (no plan.write) is still refused — 0042 gate preserved');
reset role;

select * from finish();
rollback;
