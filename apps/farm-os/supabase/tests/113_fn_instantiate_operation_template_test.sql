-- 113 — SPEC-0019 P1-3 fn_instantiate_operation_template: instantiates a template's occurrences onto
-- a plan by calling the EXISTING fn_add_plan_operation_multi in a loop (no operation-creation logic
-- reimplemented). Covers: (a) correct NUMBER of operations + DISTINCT planned_at values (proving the
-- (plan_id,subtype,planned_at) dedup concern is genuinely handled, not silently collapsed), (b) a
-- repeat call with the SAME anchor date is dedup-safe (surfaces `deduped`, doesn't duplicate or
-- error), (c) the cross-org template guard, (d) plan.write role-gating, (e) anon EXECUTE lockdown.
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(12);

\set orgA     '00000000-0000-0000-0000-000000000001'
\set orgD     '11300000-0000-0000-0000-000000000113'
\set planA    'c1130000-0000-0000-0000-000000000001'
\set planD    'c1130000-0000-0000-0000-000000000002'
-- seeded (seed.sql): fertigation split template, 3 occurrences at offsets 0/61/153.
\set tplFert  '00000000-a001-5000-8000-000000000001'

-- ── grant lockdown ───────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon',
  'public.fn_instantiate_operation_template(uuid,uuid,date)', 'EXECUTE'),
  'anon cannot EXECUTE fn_instantiate_operation_template');
select ok(has_function_privilege('authenticated',
  'public.fn_instantiate_operation_template(uuid,uuid,date)', 'EXECUTE'),
  'authenticated CAN EXECUTE fn_instantiate_operation_template');

-- ── fixtures ─────────────────────────────────────────────────────────────────────────────────────
insert into public.plans (id, org_id, type, status, scope_type) values (:'planA', :'orgA', 'monthly', 'approved', 'sector');

insert into public.organization (id, name) values (:'orgD', 'مزرعة ١١٣ الاختبارية');
insert into public.plans (id, org_id, type, status, scope_type) values (:'planD', :'orgD', 'monthly', 'approved', 'sector');

select set_config('t.fm', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('t.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);
-- give the orgA farm_manager plan.write membership in orgD too, so the cross-org check below is
-- pinned on the TEMPLATE-vs-plan org mismatch specifically, not merely "not a member of orgD".
insert into public.organization_member (org_id, user_id, role)
  values (:'orgD', current_setting('t.fm')::uuid, 'farm_manager');

-- ── (a) success: instantiate the seeded fertigation template (3 occurrences) onto planA ──────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('t.res', public.fn_instantiate_operation_template(
  :'planA', :'tplFert', '2026-03-01'::date)::text, false);
reset role;

select is((current_setting('t.res')::jsonb)->>'created', '3',
  'instantiate: creates 3 operations (one per template occurrence)');
select is((current_setting('t.res')::jsonb)->>'deduped', '0',
  'instantiate: no dedup on the first (fresh) call');
select is(
  (select count(*) from public.plan_operations
     where plan_id = :'planA' and subtype = 'fertilization'),
  3::bigint, 'instantiate: exactly 3 plan_operations rows exist for this plan+subtype');
select is(
  (select count(distinct planned_at) from public.plan_operations
     where plan_id = :'planA' and subtype = 'fertilization'),
  3::bigint, 'instantiate: the 3 operations carry 3 DISTINCT planned_at values (dedup concern handled)');
select is(
  (select array_agg(planned_at order by planned_at) from public.plan_operations
     where plan_id = :'planA' and subtype = 'fertilization'),
  array['2026-03-01'::date, '2026-05-01'::date, '2026-08-01'::date],
  'instantiate: planned_at = anchor + each occurrence''s offset_days (0/61/153 -> Mar1/May1/Aug1)');

-- ── (b) repeat call, SAME anchor date: dedup-safe (not duplicated, not an error) ──────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('t.res2', public.fn_instantiate_operation_template(
  :'planA', :'tplFert', '2026-03-01'::date)::text, false);
reset role;

select is((current_setting('t.res2')::jsonb)->>'created', '0',
  'repeat instantiate (same anchor): creates 0 NEW operations');
select is((current_setting('t.res2')::jsonb)->>'deduped', '3',
  'repeat instantiate (same anchor): all 3 occurrences honestly reported as deduped');
select is(
  (select count(*) from public.plan_operations
     where plan_id = :'planA' and subtype = 'fertilization'),
  3::bigint, 'repeat instantiate (same anchor): still exactly 3 rows total (no duplicates created)');

-- ── (c) cross-org guard: an orgA template cannot be instantiated onto an orgD plan, even by a ─────
--     caller who legitimately holds plan.write IN orgD (pins the template-vs-plan org check itself,
--     not merely "not a member of the plan's org").
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_instantiate_operation_template('%s'::uuid, '%s'::uuid, '2026-03-01'::date) $$,
    :'planD', :'tplFert'),
  '42501', null, 'cross-org: an orgA template cannot be instantiated onto an orgD plan (42501)');
reset role;

-- ── (d) authz: a non-plan.write role (storekeeper) is refused ──────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_instantiate_operation_template('%s'::uuid, '%s'::uuid, '2026-04-01'::date) $$,
    :'planA', :'tplFert'),
  '42501', null, 'a storekeeper (no plan.write) is refused instantiating a template (42501)');
reset role;

select * from finish();
rollback;
