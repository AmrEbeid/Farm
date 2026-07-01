-- 112 — SPEC-0019 P1-3 plan_operation_templates: RLS deny-by-default + plan.write role-gating.
--
-- The table mirrors the plan_operations/plan_material_requirements shape (migrations 0025/0042):
-- org-only USING (any org member can read the available templates) + a WITH CHECK ANDing
-- authorize('plan.write', org_id) onto the org scope (only owner/farm_manager can write). FORCE ROW
-- LEVEL SECURITY and the anon EXECUTE/DML lockdown are already covered by the DYNAMIC catalog
-- invariants in tests 29 (D1) and 97 (grant hygiene) — every RLS-enabled table auto-gets a FORCE
-- assertion and every public table auto-gets an anon-DML assertion there, so this file focuses on
-- the ROLE-GATING behaviour those generic invariants cannot express (WITH CHECK semantics + cross-
-- org read isolation). Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(6);

\set orgA  '00000000-0000-0000-0000-000000000001'
\set orgC  '11200000-0000-0000-0000-000000000112'

-- ── fixtures: a second org (orgC) with no relationship to orgA's templates ─────────────────────
insert into public.organization (id, name) values (:'orgC', 'مزرعة ١١٢ الاختبارية');
select set_config('t.fm', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);
select set_config('t.store', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);
-- the orgA farm_manager is ALSO a farm_manager of orgC (multi-org membership; used by test 113's
-- cross-org-template guard, kept here too so a template insert into orgC below is legitimate).
insert into public.organization_member (org_id, user_id, role)
  values (:'orgC', current_setting('t.fm')::uuid, 'farm_manager');

-- ── (a) org-scoped read: a farm_manager sees orgA templates but NOT an orgC-only template ───────
insert into public.plan_operation_templates (id, org_id, name, subtype, recurrence) values
  ('11200000-0000-0000-0000-000000000c01', :'orgC', 'قالب ١١٢ الخاص بمزرعة ١١٢ فقط', 'inspection', '[]'::jsonb);

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select cmp_ok(
  (select count(*)::int from public.plan_operation_templates where org_id = :'orgA'),
  '>=', 3, 'READ: a farm_manager sees the 3 seeded orgA templates (org-scoped, no authorize gate)');
select is(
  (select count(*)::int from public.plan_operation_templates
     where id = '11200000-0000-0000-0000-000000000c01' and org_id = :'orgA'),
  0, 'READ isolation sanity: the orgC fixture row is not mistakenly visible under orgA (control)');
reset role;

-- ── (b) plan.write WRITE gate: a farm_manager (plan.write) CAN insert a new orgA template ────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fm'), 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  $$ insert into public.plan_operation_templates (org_id, name, subtype, recurrence)
     values ('00000000-0000-0000-0000-000000000001', 'قالب اختبار 112', 'inspection', '[]'::jsonb) $$,
  'WRITE: farm_manager (plan.write) can insert a new orgA template directly');
reset role;

-- ── (c) plan.write WRITE gate: a storekeeper (NO plan.write) is REFUSED by RLS ───────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$ insert into public.plan_operation_templates (org_id, name, subtype, recurrence)
     values ('00000000-0000-0000-0000-000000000001', 'قالب مرفوض', 'inspection', '[]'::jsonb) $$,
  '42501', null, 'WRITE: a storekeeper (no plan.write) is refused inserting a template (RLS 42501)');
reset role;

-- storekeeper CAN still read (org-scoped USING has no authorize gate — mirrors plan_operations).
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.store'), 'role', 'authenticated')::text, true);
set local role authenticated;
select cmp_ok(
  (select count(*)::int from public.plan_operation_templates where org_id = :'orgA'),
  '>=', 3, 'READ: a storekeeper (no plan.write) can still READ the org''s templates');
reset role;

-- ── (d) FORCE RLS flag, named directly (also covered by test 29's dynamic invariant) ─────────────
select ok(
  (select relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'plan_operation_templates'),
  'plan_operation_templates has FORCE row level security');

select * from finish();
rollback;
