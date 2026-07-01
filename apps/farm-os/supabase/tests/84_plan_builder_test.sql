-- 52 — STAGE 4 (SPEC-0011): planning-workspace remainder. Verifies migration 0055 — fn_create_plan,
-- fn_set_plan_status, fn_assign_plan_operation, fn_add_plan_labor, and the plans direct-REST plan.write
-- gate. plan.write = owner/farm_manager (0001); supervisor/storekeeper lack it. Impersonation via JWT.

begin;
select plan(17);

\set org '00000000-0000-0000-0000-000000000001'
select set_config('test.mgr', (select user_id::text from public.organization_member where org_id = :'org' and role = 'farm_manager' limit 1), false);
select set_config('test.sup', (select user_id::text from public.organization_member where org_id = :'org' and role = 'supervisor' limit 1), false);
select set_config('test.person', (select id::text from public.people where org_id = :'org' order by id limit 1), false);
-- a kg item: fn_add_plan_operation below passes unit 'kg', which the #216 reconcile trigger validates
-- against the item's canonical unit (order-by-id alone picks the L item — a real mismatch).
select set_config('test.item', (select id::text from public.inventory_items where org_id = :'org' and unit = 'kg' order by id limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ===== create a plan as a farm_manager (plan.write) =====
select pg_temp.as_user(current_setting('test.mgr'));
select lives_ok(
  $$ select set_config('test.plan',
    (public.fn_create_plan('weekly', '2025-07-01', '2025-07-07', 'farm', null))->>'id', false) $$,
  'fn_create_plan: a farm_manager (plan.write) can create a plan');
reset role;
select is((select status from public.plans where id = current_setting('test.plan')::uuid),
  'draft', 'a new plan starts in draft');
select is((select org_id::text from public.plans where id = current_setting('test.plan')::uuid),
  :'org', 'the plan is in the caller''s org');

-- ===== a non-plan.write role (supervisor) cannot create =====
select pg_temp.as_user(current_setting('test.sup'));
select throws_ok(
  $$ select public.fn_create_plan('weekly', '2025-07-01', '2025-07-07', 'farm', null) $$,
  '42501', null, 'fn_create_plan: a supervisor (no plan.write) is FORBIDDEN');
-- direct-REST is gated too (the new plans WITH CHECK)
select throws_ok(
  format($$ insert into public.plans(org_id, type, status) values (%L, 'weekly', 'draft') $$, :'org'),
  '42501', null, 'direct-REST: a supervisor cannot INSERT a plan (plan.write RLS gate)');
reset role;

-- ===== validation =====
select pg_temp.as_user(current_setting('test.mgr'));
select throws_ok(
  $$ select public.fn_create_plan('fortnightly', null, null, 'farm', null) $$,
  '22023', null, 'fn_create_plan: an invalid plan type is rejected');

-- ===== status transition =====
select lives_ok(
  format($$ select public.fn_set_plan_status(%L, 'active') $$, current_setting('test.plan')),
  'fn_set_plan_status: draft → active');
reset role;
select is((select status from public.plans where id = current_setting('test.plan')::uuid),
  'active', 'the plan status changed to active');
select pg_temp.as_user(current_setting('test.mgr'));
select throws_ok(
  format($$ select public.fn_set_plan_status(%L, 'nonsense') $$, current_setting('test.plan')),
  '22023', null, 'fn_set_plan_status: an invalid status is rejected');

-- ===== add an operation (existing RPC), then assign + labor (new) =====
select lives_ok(
  format($$ select set_config('test.op',
    (public.fn_add_plan_operation(%L, 'fertilization', '2025-07-03', 1000, %L, 10, 'kg'))->>'operationId', false) $$,
    current_setting('test.plan'), current_setting('test.item')),
  'fn_add_plan_operation: add an operation to the new plan (create→add chain works)');

select lives_ok(
  format($$ select public.fn_assign_plan_operation(%L, %L) $$, current_setting('test.op'), current_setting('test.person')),
  'fn_assign_plan_operation: assign a responsible person');
reset role;
select is((select responsible_person_id::text from public.plan_operations where id = current_setting('test.op')::uuid),
  current_setting('test.person'), 'the responsible person was set');

select pg_temp.as_user(current_setting('test.mgr'));
select throws_ok(
  format($$ select public.fn_assign_plan_operation(%L, gen_random_uuid()) $$, current_setting('test.op')),
  '22023', null, 'fn_assign_plan_operation: a person not in the org is rejected');
reset role;
select pg_temp.as_user(current_setting('test.sup'));
select throws_ok(
  format($$ select public.fn_assign_plan_operation(%L, %L) $$, current_setting('test.op'), current_setting('test.person')),
  '42501', null, 'fn_assign_plan_operation: a supervisor (no plan.write) is FORBIDDEN');
reset role;

select pg_temp.as_user(current_setting('test.mgr'));
select lives_ok(
  format($$ select public.fn_add_plan_labor(%L, 'فريق الحصاد', 4, 2) $$, current_setting('test.op')),
  'fn_add_plan_labor: add a labor requirement');
select is(
  (select count(*)::int from public.plan_labor_requirements where plan_op_id = current_setting('test.op')::uuid),
  1, 'the labor requirement row exists');
select throws_ok(
  format($$ select public.fn_add_plan_labor(%L, 'فريق', -1, 2) $$, current_setting('test.op')),
  '22023', null, 'fn_add_plan_labor: a negative count is rejected');
reset role;

select * from finish();
rollback;
