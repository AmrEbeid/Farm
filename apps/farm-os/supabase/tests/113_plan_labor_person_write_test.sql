-- 113 — labor cost basis, slice 2: fn_add_plan_operation_multi writes the optional
-- plan_labor_requirements.person_id (migration 20260701250100). Covers (a) a valid same-org active
-- person is accepted and stored, (b) a cross-org person is rejected (22023, whole op rolls back — same
-- atomicity guarantee as the existing material/assignee validation), (c) an inactive same-org person is
-- rejected too, (d) an omitted person_id still works (free-text-only, unchanged). Mirrors test 92's
-- JWT-claim role simulation and current_setting/format() convention. Run via supabase test db or
-- test-shims/run-pgtap-local.sh.
begin;
select plan(6);

\set orgA     '00000000-0000-0000-0000-000000000001'
\set orgB     '11300000-0000-0000-0000-0000000000b0'
\set plan     '11300001-0000-0000-0000-000000000113'
\set p1       '11300002-0000-0000-0000-000000000113'
\set persB    '11300003-0000-0000-0000-000000000113'
\set inactive '11300004-0000-0000-0000-000000000113'

insert into public.organization (id, name) values (:'orgB', 'مزرعة بعيدة');
insert into public.plans (id, org_id, type, status, scope_type) values (:'plan', :'orgA', 'monthly', 'approved', 'sector');
insert into public.people (id, org_id, name, active) values (:'p1', :'orgA', 'عامل ١', true);
insert into public.people (id, org_id, name, active) values (:'persB', :'orgB', 'موظف بعيد', true);
insert into public.people (id, org_id, name, active) values (:'inactive', :'orgA', 'موظف سابق', false);

select set_config('t.fm', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('t.plan', :'plan', false);
select set_config('t.persB', :'persB', false);
select set_config('t.inactive', :'inactive', false);

-- ── (a) a valid same-org active person is accepted and stored on the labour line ─────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('t.res', public.fn_add_plan_operation_multi(
  :'plan', 'fertilization', '2026-07-01'::date, null, 1000,
  '[]'::jsonb,
  format('[{"person_or_team":"عامل ١","count":2,"days":3,"person_id":"%s"}]', :'p1')::jsonb,
  null, null)::text, false);
reset role;
select is((current_setting('t.res')::jsonb)->>'labor', '1', 'creates 1 labour line');
select is(
  (select person_id from public.plan_labor_requirements
     where plan_op_id = ((current_setting('t.res')::jsonb)->>'operationId')::uuid),
  :'p1'::uuid, 'the labour line stores the given person_id');

-- ── (b) a cross-org person_id is rejected — the WHOLE op rolls back (atomicity, mirrors materials) ───
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_add_plan_operation_multi('%s'::uuid, 'irrigation', '2026-07-02'::date, null, 100,
    '[]'::jsonb, '[{"person_or_team":"x","count":1,"days":1,"person_id":"%s"}]'::jsonb, null, null) $$,
    current_setting('t.plan', true), current_setting('t.persB', true)),
  '22023', null, 'a labour line cannot reference a CROSS-ORG person (22023)');
reset role;
select is((select count(*) from public.plan_operations where plan_id = :'plan' and subtype = 'irrigation'),
  0::bigint, 'ATOMICITY: the rejected labour person_id rolled the op back — no orphan operation');

-- ── (c) an inactive same-org person is rejected too (mirrors the assignee active-membership rule) ─────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select public.fn_add_plan_operation_multi('%s'::uuid, 'pruning', '2026-07-03'::date, null, 100,
    '[]'::jsonb, '[{"person_or_team":"x","count":1,"days":1,"person_id":"%s"}]'::jsonb, null, null) $$,
    current_setting('t.plan', true), current_setting('t.inactive', true)),
  '22023', null, 'a labour line cannot reference an INACTIVE person (22023)');
reset role;

-- ── (d) an omitted person_id still works — free-text-only, unchanged from before this migration ──────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (public.fn_add_plan_operation_multi(:'plan', 'spraying', '2026-07-04'::date, null, 100,
    '[]'::jsonb, '[{"person_or_team":"عمالة يومية","count":4,"days":1}]'::jsonb, null, null) ->> 'labor'),
  '1', 'an omitted person_id still creates the labour line (free-text-only, unchanged)');
reset role;

select * from finish();
rollback;
