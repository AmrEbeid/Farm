-- 92 — #398 slice 2: fn_add_plan_operation_multi authors an op + N materials + N labour + N assignees
-- + ends_on in ONE transaction. Covers (a) multi-line success, (b) atomicity rollback on a bad line,
-- (c) multi-day validation, (d) plan.write authz refusal, (e) anon EXECUTE lockdown. Mirrors test 38's
-- JWT-claim role simulation. Run via supabase test db or test-shims/run-pgtap-local.sh.
begin;
select plan(12);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set plan  'c9200000-0000-0000-0000-000000000092'
\set item1 'c9200001-0000-0000-0000-000000000092'
\set item2 'c9200002-0000-0000-0000-000000000092'
\set bad   'deadbeef-0000-0000-0000-000000000092'
\set p1    'c9200003-0000-0000-0000-000000000092'
\set p2    'c9200004-0000-0000-0000-000000000092'

-- ── grant lockdown ───────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon',
  'public.fn_add_plan_operation_multi(uuid,text,date,date,numeric,jsonb,jsonb,uuid[],uuid)', 'EXECUTE'),
  '0093: anon cannot EXECUTE fn_add_plan_operation_multi');
select ok(has_function_privilege('authenticated',
  'public.fn_add_plan_operation_multi(uuid,text,date,date,numeric,jsonb,jsonb,uuid[],uuid)', 'EXECUTE'),
  '0093: authenticated CAN EXECUTE fn_add_plan_operation_multi');

-- ── fixtures (org 001) ───────────────────────────────────────────────────────────────────────────
insert into public.plans (id, org_id, type, status, scope_type) values (:'plan', :'orgA', 'monthly', 'approved', 'sector');
insert into public.inventory_items (id, org_id, name, unit) values (:'item1', :'orgA', 'سماد ١', 'kg');
insert into public.inventory_items (id, org_id, name, unit) values (:'item2', :'orgA', 'وقود', 'L');
insert into public.people (id, org_id, name, active) values (:'p1', :'orgA', 'عامل ١', true);
insert into public.people (id, org_id, name, active) values (:'p2', :'orgA', 'عامل ٢', true);

select set_config('t.fm', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('t.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);
select set_config('t.plan', :'plan', false);
select set_config('t.bad', :'bad', false);

-- ── (a) multi-line success: 2 materials + 1 labour + 2 assignees + a 3-day span ────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('t.res', public.fn_add_plan_operation_multi(
  :'plan', 'fertilization', '2026-07-01'::date, '2026-07-03'::date, 5000,
  format('[{"item_id":"%s","qty":500,"unit":"kg"},{"item_id":"%s","qty":40,"unit":"L"}]', :'item1', :'item2')::jsonb,
  '[{"person_or_team":"فريق التسميد","count":3,"days":2}]'::jsonb,
  array[:'p1', :'p2']::uuid[], :'p1'::uuid)::text, false);
reset role;

select is((current_setting('t.res')::jsonb)->>'materials', '2', 'creates 2 material lines');
select is((current_setting('t.res')::jsonb)->>'labor', '1', 'creates 1 labour line');
select is((current_setting('t.res')::jsonb)->>'assignees', '2', 'assigns 2 employees');
select is(
  (select ends_on from public.plan_operations
     where id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid),
  '2026-07-03'::date, 'multi-day: ends_on is set (3-day span)');
select is(
  (select count(*) from public.plan_operation_assignees
     where plan_op_id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid and is_lead),
  1::bigint, 'exactly one assignee is flagged lead');

-- ── (a2) CREATE-2 dedup: a second identical call (same plan+subtype+planned_at) returns deduped, no 2nd op
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (public.fn_add_plan_operation_multi(:'plan', 'fertilization', '2026-07-01'::date, null, 1000,
    '[]'::jsonb, '[]'::jsonb, null, null) ->> 'deduped'), 'true',
  'dedup: a second identical (plan+subtype+planned_at) call is deduped, not duplicated');
reset role;

-- ── (b) atomicity: a cross-org/non-existent material item rolls the WHOLE op back ──────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_add_plan_operation_multi('%s'::uuid, 'irrigation', '2026-07-05'::date, null, 100,
    '[{"item_id":"%s","qty":10,"unit":"kg"}]'::jsonb, '[]'::jsonb, null, null) $$,
    current_setting('t.plan', true), current_setting('t.bad', true)),
  '22023', null, 'a material item not in the org is rejected (22023)');
reset role;
select is((select count(*) from public.plan_operations where plan_id = :'plan' and subtype = 'irrigation'),
  0::bigint, 'ATOMICITY: the rejected material rolled the op back — no orphan operation');

-- ── (c) multi-day validation: ends_on before planned_at is rejected ────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_add_plan_operation_multi('%s'::uuid, 'pruning', '2026-07-10'::date, '2026-07-01'::date, 100,
    '[]'::jsonb, '[]'::jsonb, null, null) $$, current_setting('t.plan', true)),
  '22023', null, 'ends_on before planned_at is rejected (22023)');
reset role;

-- ── (d) authz: a non-plan.write role (storekeeper) is refused ──────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_add_plan_operation_multi('%s'::uuid, 'spraying', '2026-07-12'::date, null, 100,
    '[]'::jsonb, '[]'::jsonb, null, null) $$, current_setting('t.plan', true)),
  '42501', null, 'a storekeeper (no plan.write) is refused (42501)');
reset role;

select * from finish();
rollback;
