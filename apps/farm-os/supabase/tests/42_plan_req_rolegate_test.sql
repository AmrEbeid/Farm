-- 42 — RLS role-gate for plan_*_requirements (#235): writing engine-demand requirements requires
-- plan.write, not just org membership. Before migration 0042 these child tables carried only the
-- org-scoped tenant_all policy (0010) with NO role gate, so any authenticated org member without
-- plan.write (supervisor/agri_engineer/accountant/storekeeper) could INSERT/UPDATE a requirement
-- directly via PostgREST — and since fn_stock_coverage reads sum(qty) as demand, zeroing it can MASK
-- a shortage. 0042 adds `authorize('plan.write', org_id)` to the WITH CHECK (USING stays org-only so
-- engine reads are unaffected; the RLS-H1 parent-org EXISTS is preserved). The app path is the gated
-- definer RPC fn_add_plan_operation (0038), which bypasses RLS — this closes the direct-REST hole.
-- plan.write = owner / farm_manager (migration 0001). Impersonation via request.jwt.claims (tests 10/24/25/36).
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(9);

-- resolve real engine-demand fixtures + role members in orgA
select set_config('test.planop', (select id::text from public.plan_operations
  where org_id = '00000000-0000-0000-0000-000000000001' order by id limit 1), false);
-- a kg item: the requirement inserts below use unit 'kg', which the #216 reconcile trigger validates
-- against the item's canonical unit (order-by-id alone picks the L item — a real mismatch).
select set_config('test.item', (select id::text from public.inventory_items
  where org_id = '00000000-0000-0000-0000-000000000001' and unit = 'kg' order by id limit 1), false);
select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = '00000000-0000-0000-0000-000000000001' and role = 'owner' limit 1), false);
select set_config('test.skA', (select user_id::text from public.organization_member
  where org_id = '00000000-0000-0000-0000-000000000001' and role = 'storekeeper' limit 1), false);

select isnt(current_setting('test.planop'), '', 'fixture: a plan_operation exists in orgA');
select isnt(current_setting('test.skA'),    '', 'fixture: a storekeeper member exists in orgA');

-- ===== as a NON-plan.write member (storekeeper) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.skA'), 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  format($$ insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
            values ('00000000-0000-0000-0000-000000000001', %L, %L, 500, 'kg') $$,
         current_setting('test.planop'), current_setting('test.item')),
  '42501', null,
  '#235: a storekeeper (no plan.write) cannot INSERT a plan_material_requirement (inject engine demand)');

select lives_ok(
  $$ select count(*) from public.plan_material_requirements
       where org_id = '00000000-0000-0000-0000-000000000001' $$,
  '#235: a storekeeper can still READ requirements (USING unchanged — fn_stock_coverage unaffected)');

select throws_ok(
  format($$ insert into public.plan_labor_requirements (org_id, plan_op_id, person_or_team, count, days)
            values ('00000000-0000-0000-0000-000000000001', %L, 'فريق', 3, 2) $$,
         current_setting('test.planop')),
  '42501', null,
  '#235: a storekeeper cannot INSERT a plan_labor_requirement');

reset role;

-- ===== as a plan.write member (owner) — the legitimate path is unaffected =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  format($$ insert into public.plan_material_requirements (org_id, plan_op_id, item_id, qty, unit)
            values ('00000000-0000-0000-0000-000000000001', %L, %L, 500, 'kg') $$,
         current_setting('test.planop'), current_setting('test.item')),
  '#235: an owner (plan.write) CAN INSERT a plan_material_requirement (legit path works)');

select lives_ok(
  format($$ insert into public.plan_labor_requirements (org_id, plan_op_id, person_or_team, count, days)
            values ('00000000-0000-0000-0000-000000000001', %L, 'فريق', 3, 2) $$,
         current_setting('test.planop')),
  '#235: an owner CAN INSERT a plan_labor_requirement');

reset role;

-- ===== the shortage-mask vector: a non-planner cannot UPDATE qty -> 0 to hide demand =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.skA'), 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ update public.plan_material_requirements set qty = 0
       where org_id = '00000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  '#235: a storekeeper cannot UPDATE a requirement qty (the shortage-mask vector is closed)');

reset role;

-- ===== structural invariant: the gate is present (caught if a future migration drops it) =====
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'plan_material_requirements'
       and with_check like '%authorize%plan.write%'),
  1,
  '#235: plan_material_requirements WITH CHECK carries the authorize(plan.write) gate');

select * from finish();
rollback;
