-- 36 — AUTHZ-2 (#181): public.authorize(perm, p_org) is ORG-SCOPED.
--
-- The original 1-arg authorize(perm) checked membership with NO org predicate, so a user who held a
-- permitted role in ANY org passed the check for a write scoped to ANOTHER org. This pins the fix: the
-- 2-arg overload ANDs `m.org_id = p_org`, so a permission earned in org A no longer authorizes a
-- write in org B.
--
-- Fixture: the seeded org-A OWNER (full rights in A) is also added to a NEW org B as a `supervisor`
-- (op.execute only — NOT pr.approve, NOT plan.write). Impersonated via request.jwt.claims, exactly the
-- JWT harness used by tests 10 and 24. authorize() is SECURITY DEFINER (reads auth.uid() from the JWT
-- GUC, bypasses RLS on organization_member), so the assertions reflect the real RBAC decision.

begin;
select plan(7);

\set orgA '00000000-0000-0000-0000-000000000001'
\set orgB 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

-- ===== fixtures (as the superuser test role, RLS-bypassing) =====
-- A second org, and the org-A OWNER joined to it with a LOW role (supervisor: op.execute only).
insert into public.organization (id, name) values (:'orgB', 'مزرعة ب');

select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='owner'), false);
select set_config('test.fmA', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='farm_manager'), false);

insert into public.organization_member (org_id, user_id, role)
  values (:'orgB', current_setting('test.ownerA')::uuid, 'supervisor');

-- ===== impersonate the MULTI-ORG user (owner in A, supervisor in B) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role','authenticated')::text, true);
set role authenticated;

-- pr.approve (owner-only): granted in A, but NOT in B where the user is only a supervisor.
select is( public.authorize('pr.approve', :'orgB'), false,
  'AUTHZ-2: owner-in-A is NOT pr.approve in org B (low role there) — the bug is closed');
select is( public.authorize('pr.approve', :'orgA'), true,
  'AUTHZ-2: owner-in-A IS pr.approve in org A');

-- plan.write (owner/farm_manager): same story across the two orgs.
select is( public.authorize('plan.write', :'orgB'), false,
  'AUTHZ-2: owner-in-A is NOT plan.write in org B');
select is( public.authorize('plan.write', :'orgA'), true,
  'AUTHZ-2: owner-in-A IS plan.write in org A');

-- op.execute (incl. supervisor): the overload is NOT a blanket org-B deny — the user genuinely holds
-- the role B grants, so it returns true precisely there. Proves scoping is per-org, not "always false".
select is( public.authorize('op.execute', :'orgB'), true,
  'AUTHZ-2: scoping is precise — the user DOES have op.execute in org B (their real role)');

reset role;

-- ===== single-org member retains access (no over-gating regression) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.fmA'), 'role','authenticated')::text, true);
set role authenticated;

select is( public.authorize('plan.write', :'orgA'), true,
  'no over-gating: a single-org farm_manager still has plan.write in their own org');
select is( public.authorize('plan.write', :'orgB'), false,
  'a single-org farm_manager has no rights in an org they do not belong to');

reset role;
select * from finish();
rollback;
