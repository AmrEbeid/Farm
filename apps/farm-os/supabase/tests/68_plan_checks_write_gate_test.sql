-- 68 — plan_checks WRITES require plan.write (owner/farm_manager); a member without it (storekeeper)
-- cannot forge a check result (which would mask a stock/budget warning on the plan/dashboard, non-neg #1).
-- READS stay org-only. Matches the app-layer gate (runPlanChecks requires plan.write) as defense-in-depth.
-- Impersonation via request.jwt.claims. A draft plan in orgA is seeded for the plan-org FK.
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(5);

\set orgA   '00000000-0000-0000-0000-000000000001'
\set plan   '06800000-0000-0000-0000-0000000000c2'

select set_config('test.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);
select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'owner' limit 1), false);

insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'draft');
-- seed an existing check (as superuser) so the read test has a row
insert into public.plan_checks (org_id, plan_id, kind, result) values (:'orgA', :'plan', 'budget', 'warn');

-- ===== a member WITHOUT plan.write (storekeeper) — cannot forge a check, can read =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.store'), 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  format($$ insert into public.plan_checks (org_id, plan_id, kind, result)
            values (%L, %L, 'stock', 'ok') $$, :'orgA', :'plan'),
  '42501', null,
  'plan_checks: a non-plan.write member cannot forge a check result (shortage-mask blocked)');

select is(
  (select count(*)::int from public.plan_checks where plan_id = :'plan'),
  1,
  'plan_checks: a non-plan.write member can still READ the plan''s checks (reads ungated)');

reset role;

-- ===== an owner (HAS plan.write) — write allowed =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  format($$ insert into public.plan_checks (org_id, plan_id, kind, result)
            values (%L, %L, 'stock', 'ok') $$, :'orgA', :'plan'),
  'plan_checks: an owner (plan.write) CAN write a check');

reset role;

select is(
  (select count(*)::int from pg_policies
     where schemaname='public' and tablename='plan_checks' and policyname='tenant_all'
       and with_check ilike '%plan.write%'),
  1,
  'plan_checks: tenant_all gates writes on plan.write');

-- the 0063 plan-org FK clause is still present (not dropped by the re-emit)
select is(
  (select count(*)::int from pg_policies
     where schemaname='public' and tablename='plan_checks' and policyname='tenant_all'
       and with_check ilike '%plans p%'),
  1,
  'plan_checks: the cross-org plan-org FK clause is preserved');

select * from finish();
rollback;
