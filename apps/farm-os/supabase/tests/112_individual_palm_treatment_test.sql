-- 112 — individual-palm rescue/exception treatments (migration 20260701340000).
-- Covers: (a) fn_get_or_create_individual_treatment_plan find-or-create + at-most-one-per-org +
-- authz/cross-org gates; (b) fn_add_plan_operation_multi's new optional palm-target override
-- (accepts a valid palm, rejects a cross-org/non-palm target, both-or-neither validation);
-- (c) grant lockdown on the resolver RPC. Mirrors test 84 (plan builder) and test 92 (multi RPC)
-- JWT-claim role simulation. Run via supabase test db or test-shims/run-pgtap-local.sh.
begin;
select plan(14);

\set orgA   '00000000-0000-0000-0000-000000000001'
\set orgB   'c9200000-0000-0000-0000-0000000000b0'
\set plan   'c9200000-0000-0000-0000-000000000112'
\set palm1  'c9200001-0000-0000-0000-000000000112'
\set palm2  'c9200002-0000-0000-0000-000000000112'
\set palmB  'c9200003-0000-0000-0000-000000000112'
\set notpalm 'c9200004-0000-0000-0000-000000000112'

-- ── grant lockdown on the resolver RPC ──────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon',
  'public.fn_get_or_create_individual_treatment_plan(uuid)', 'EXECUTE'),
  'anon cannot EXECUTE fn_get_or_create_individual_treatment_plan');
select ok(has_function_privilege('authenticated',
  'public.fn_get_or_create_individual_treatment_plan(uuid)', 'EXECUTE'),
  'authenticated CAN EXECUTE fn_get_or_create_individual_treatment_plan');

-- ── fixtures (org 001 + a palm; org B = a different org for cross-org checks) ────────────────────
insert into public.organization (id, name) values (:'orgB', 'مزرعة اختبار بعيدة');
insert into public.plans (id, org_id, type, status, scope_type) values (:'plan', :'orgA', 'monthly', 'approved', 'sector');
insert into public.assets (id, org_id, type, name, status) values (:'palm1', :'orgA', 'palm', 'نخلة ١', 'sick');
insert into public.assets (id, org_id, type, name, status) values (:'palm2', :'orgA', 'palm', 'نخلة ٢', 'watch');
insert into public.assets (id, org_id, type, name, status) values (:'palmB', :'orgB', 'palm', 'نخلة أخرى', 'active');
insert into public.assets (id, org_id, type, name, status) values (:'notpalm', :'orgA', 'line', 'خط ١', 'active');

select set_config('t.fm', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('t.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);

-- ── (a) authz: a non-plan.write role (storekeeper) is refused ───────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_get_or_create_individual_treatment_plan('%s'::uuid) $$, :'orgA'),
  '42501', null, 'a storekeeper (no plan.write) is refused (42501)');
reset role;

-- ── (b) find-or-create: first call (farm_manager) creates exactly one implicit plan for orgA ────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('t.itplan', public.fn_get_or_create_individual_treatment_plan(:'orgA')::text, false);
reset role;

select is(
  (select count(*) from public.plans where org_id = :'orgA' and is_individual_treatment_plan),
  1::bigint, 'exactly one implicit individual-treatment plan exists for orgA');

-- ── (c) idempotent: a second call returns the SAME plan, no second row created ───────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  public.fn_get_or_create_individual_treatment_plan(:'orgA')::text,
  current_setting('t.itplan'), 'a second call returns the same implicit plan id');
reset role;
select is(
  (select count(*) from public.plans where org_id = :'orgA' and is_individual_treatment_plan),
  1::bigint, 'still exactly one implicit plan for orgA (no duplicate)');

-- ── (d) cross-org: resolving a plan for an org the caller is not a member of is refused ──────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_get_or_create_individual_treatment_plan('%s'::uuid) $$, :'orgB'),
  '42501', null, 'a farm_manager of orgA cannot resolve/create an individual-treatment plan for orgB');
reset role;

-- ── (e) fn_add_plan_operation_multi: a valid palm target overrides the plan-derived scope ────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('t.res', public.fn_add_plan_operation_multi(
  :'plan', 'inspection', '2026-07-05'::date, null, 0,
  '[]'::jsonb, '[]'::jsonb, null, null, 'palm', :'palm1', 'نخلة ضعيفة - معالجة بمنشط جذور')::text, false);
reset role;

select is(
  (select target_type from public.plan_operations
     where id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid),
  'palm', 'palm-target override: the operation''s target_type is ''palm'' (not the plan''s sector scope)');
select is(
  (select target_id from public.plan_operations
     where id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid),
  :'palm1'::uuid, 'palm-target override: the operation''s target_id is the given palm');
select is(
  (select note from public.plan_operations
     where id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid),
  'نخلة ضعيفة - معالجة بمنشط جذور', 'the free-text treatment note is persisted on plan_operations.note');

-- ── (f) omitting target_type/target_id preserves the OLD behaviour (plan-scope-derived target) ───
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('t.res2', public.fn_add_plan_operation_multi(
  :'plan', 'irrigation', '2026-07-06'::date, null, 0,
  '[]'::jsonb, '[]'::jsonb, null, null)::text, false);
reset role;
select is(
  (select target_type from public.plan_operations
     where id = ((current_setting('t.res2')::jsonb)->>'operationId')::uuid),
  'sector', 'omitted target params: falls back to the plan''s own scope_type (backward-compatible)');

-- ── (g) a cross-org palm target is rejected (22023), no orphan op created ─────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_add_plan_operation_multi('%s'::uuid, 'fertilization', '2026-07-07'::date, null, 0,
    '[]'::jsonb, '[]'::jsonb, null, null, 'palm', '%s'::uuid) $$, :'plan', :'palmB'),
  '22023', null, 'a palm from a different org is rejected (22023)');
reset role;

-- ── (h) a target_id that is not type=''palm'' is rejected ─────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_add_plan_operation_multi('%s'::uuid, 'fertilization', '2026-07-08'::date, null, 0,
    '[]'::jsonb, '[]'::jsonb, null, null, 'palm', '%s'::uuid) $$, :'plan', :'notpalm'),
  '22023', null, 'a target_id that is not an asset of type ''palm'' is rejected (22023)');
reset role;

-- ── (i) target_type without target_id (or vice versa) is rejected ────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_add_plan_operation_multi('%s'::uuid, 'fertilization', '2026-07-09'::date, null, 0,
    '[]'::jsonb, '[]'::jsonb, null, null, 'palm', null) $$, :'plan'),
  '22023', null, 'target_type=''palm'' with a null target_id is rejected (22023)');
reset role;

select * from finish();
rollback;
