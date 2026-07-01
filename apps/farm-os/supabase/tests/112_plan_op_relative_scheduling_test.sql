-- 112 — relative operation scheduling (owner finding, 2026-07-01): plan_operations.depends_on_op_id +
-- depends_on_offset_days (migration 20260701350000). An operation may OPTIONALLY be scheduled RELATIVE
-- TO another operation ("spray after tilting completes") instead of (or alongside) an absolute date.
-- Both columns are nullable and additive — this test covers:
--   (a) columns exist, both nullable (an op with neither set behaves exactly as before);
--   (b) self-reference is rejected (CHECK: id <> depends_on_op_id);
--   (c) a same-plan dependency is accepted (trigger allows it);
--   (d) a DIFFERENT-PLAN dependency (same org) is rejected (trigger: same-plan required);
--   (e) a cross-org dependency is rejected too (same-plan implies same-org, but assert directly);
--   (f) clearing the dependency (set back to null) is allowed;
--   (g) RLS: the new columns are writable/readable via the EXISTING plan_operations tenant_all policy
--       (plan.write-gated, org-scoped, migration 0070) — no new policy was added, so this just confirms
--       the existing gate still covers writes that touch the new columns.
-- Impersonation via request.jwt.claims + `set local role authenticated` (same harness as 39/49/79).
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.
begin;
select plan(10);

\set orgA   '00000000-0000-0000-0000-000000000001'
\set orgB   '00000000-0000-0000-0000-000000000002'
\set planA1 'e1200001-0000-0000-0000-000000000112'
\set planA2 'e1200002-0000-0000-0000-000000000112'
\set planB1 'e1200003-0000-0000-0000-000000000112'
\set opA1   'e1200011-0000-0000-0000-000000000112'
\set opA2   'e1200012-0000-0000-0000-000000000112'
\set opA3   'e1200013-0000-0000-0000-000000000112'
\set opB1   'e1200014-0000-0000-0000-000000000112'

-- ── structure ──────────────────────────────────────────────────────────────────────────────────────
select has_column('public', 'plan_operations', 'depends_on_op_id', 'plan_operations.depends_on_op_id column added');
select has_column('public', 'plan_operations', 'depends_on_offset_days', 'plan_operations.depends_on_offset_days column added');

-- ── fixtures ───────────────────────────────────────────────────────────────────────────────────────
insert into public.organization (id, name) values (:'orgB', 'cross-org fixture') on conflict (id) do nothing;
insert into public.plans (id, org_id, type, status) values (:'planA1', :'orgA', 'monthly', 'approved');
insert into public.plans (id, org_id, type, status) values (:'planA2', :'orgA', 'monthly', 'approved');
insert into public.plans (id, org_id, type, status) values (:'planB1', :'orgB', 'monthly', 'approved');
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status)
  values (:'opA1', :'orgA', :'planA1', 'fertilization', date '2026-07-01', 'planned');
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status)
  values (:'opA2', :'orgA', :'planA1', 'irrigation', date '2026-07-04', 'planned');
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status)
  values (:'opA3', :'orgA', :'planA2', 'spraying', date '2026-07-05', 'planned');
insert into public.plan_operations (id, org_id, plan_id, subtype, planned_at, status)
  values (:'opB1', :'orgB', :'planB1', 'spraying', date '2026-07-05', 'planned');

select set_config('t.fmA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'farm_manager' limit 1), false);

-- ── (b) self-reference rejected (CHECK, superuser context — exercises the constraint itself) ────────
select throws_ok(
  format($$update public.plan_operations set depends_on_op_id = %L where id = %L$$, :'opA1', :'opA1'),
  '23514', null, 'an operation cannot depend on itself (CHECK plan_operations_no_self_dependency)');

-- ── (c) same-plan dependency accepted, via the authenticated role (plan.write) ───────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fmA'), 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  format($$update public.plan_operations set depends_on_op_id = %L, depends_on_offset_days = 3 where id = %L$$,
    :'opA1', :'opA2'),
  'a same-plan dependency is accepted (opA2 depends on opA1, both in planA1)');
reset role;

-- ── (d) different-plan (same org) dependency rejected by the trigger ─────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fmA'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$update public.plan_operations set depends_on_op_id = %L, depends_on_offset_days = 1 where id = %L$$,
    :'opA3', :'opA1'),
  '42501', null, 'a dependency in a DIFFERENT plan (same org) is rejected (same-plan trigger)');
reset role;

-- ── (e) cross-org dependency rejected too ────────────────────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fmA'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$update public.plan_operations set depends_on_op_id = %L, depends_on_offset_days = 1 where id = %L$$,
    :'opB1', :'opA1'),
  '42501', null, 'a CROSS-ORG dependency is rejected (same-plan trigger, which implies same-org)');
reset role;

-- ── (f) clearing the dependency (back to null) is allowed ────────────────────────────────────────────
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.fmA'), 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  format($$update public.plan_operations set depends_on_op_id = null, depends_on_offset_days = null where id = %L$$,
    :'opA2'),
  'clearing depends_on_op_id back to null is allowed');
reset role;

-- ── (g) RLS: a non-plan.write role (storekeeper) is still refused on a write touching these columns ──
select set_config('t.storeA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role = 'storekeeper' limit 1), false);
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.storeA'), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$update public.plan_operations set depends_on_op_id = %L, depends_on_offset_days = 2 where id = %L$$,
    :'opA1', :'opA2'),
  '42501', null, 'a storekeeper (no plan.write) is refused when setting a dependency (existing tenant_all RLS)');
reset role;

-- ── additive sanity: an operation with neither column set is untouched (no accidental default) ──────
select is(
  (select depends_on_op_id from public.plan_operations where id = :'opA3'), null,
  'an operation that never sets a dependency stays null (purely additive)');
select is(
  (select depends_on_offset_days from public.plan_operations where id = :'opA3'), null,
  'depends_on_offset_days likewise stays null when unset');

select * from finish();
rollback;
