-- 91 — #398 slice 1 schema: multi-day operations + multi-employee assignment (migration 0090).
-- Validates the ends_on CHECK, the assignees join table (unique, audit, FORCE RLS, anon lockdown).
-- Runs as the superuser/service path (RLS bypassed) — so this exercises CHECK/unique/audit/grant, NOT
-- the plan.write RLS gate (that belongs to the slice-2 assign-RPC role-gate test). Run via
-- supabase test db or test-shims/run-pgtap-local.sh.
begin;
select plan(9);

\set orgA '00000000-0000-0000-0000-000000000001'
\set plan '9a900001-0000-0000-0000-0000000000a9'
\set op   '9a900002-0000-0000-0000-0000000000a9'
\set p1   '9a900003-0000-0000-0000-0000000000a9'
\set p2   '9a900004-0000-0000-0000-0000000000a9'

-- ── structure ──────────────────────────────────────────────────────────────────────────────────────
select has_column('public', 'plan_operations', 'ends_on', 'plan_operations.ends_on column added');
select has_table('public', 'plan_operation_assignees', 'plan_operation_assignees table exists');
select is(
  (select relforcerowsecurity from pg_class where relname = 'plan_operation_assignees'), true,
  'assignees: FORCE row level security is on');
select ok(
  not has_table_privilege('anon', 'public.plan_operation_assignees', 'SELECT')
  and not has_table_privilege('anon', 'public.plan_operation_assignees', 'INSERT'),
  'assignees: anon holds NO grant (authenticated-only)');

-- ── fixtures ───────────────────────────────────────────────────────────────────────────────────────
insert into public.plans (id, org_id, type, status) values (:'plan', :'orgA', 'monthly', 'approved');
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status)
  values (:'op', :'orgA', :'plan', 'fertilization', date '2026-07-01', 'planned');
insert into public.people (id, org_id, name) values (:'p1', :'orgA', 'عامل ١');
insert into public.people (id, org_id, name) values (:'p2', :'orgA', 'عامل ٢');

-- ── multi-day CHECK ────────────────────────────────────────────────────────────────────────────────
select throws_ok(
  format($$update public.plan_operations set ends_on = date '2026-06-01' where id = %L$$, :'op'),
  '23514', null, 'ends_on before planned_at is rejected (CHECK)');
select lives_ok(
  format($$update public.plan_operations set ends_on = date '2026-07-05' where id = %L$$, :'op'),
  'ends_on on/after planned_at is accepted (multi-day op)');

-- ── assignees: one-or-more, no duplicate ─────────────────────────────────────────────────────────────
insert into public.plan_operation_assignees (org_id, plan_op_id, person_id, is_lead)
  values (:'orgA', :'op', :'p1', true);
select lives_ok(
  format($$insert into public.plan_operation_assignees (org_id, plan_op_id, person_id)
           values (%L, %L, %L)$$, :'orgA', :'op', :'p2'),
  'a second distinct employee can be assigned to the same operation');
select throws_ok(
  format($$insert into public.plan_operation_assignees (org_id, plan_op_id, person_id)
           values (%L, %L, %L)$$, :'orgA', :'op', :'p1'),
  '23505', null, 'the same employee cannot be assigned twice (unique)');

-- ── audit ──────────────────────────────────────────────────────────────────────────────────────────
select isnt(
  (select count(*) from public.audit_log where entity_type = 'plan_operation_assignees'), 0::bigint,
  'assignee writes are recorded in the append-only audit_log');

select * from finish();
rollback;
