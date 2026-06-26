-- 48 — PII-1 (#173), CONTACT slice: staff phone/email are CONFIDENTIAL (deny-by-default).
--
-- Before migration 0048, `people.phone` and `people.email` sat on `public.people`, whose only policy
-- is the org-scoped `tenant_all` (no role gate) — so ANY org member could `select phone, email from
-- people` and read every colleague's contact details. Migration 0048 revokes the table-level SELECT
-- grant from `authenticated` and re-grants SELECT on every column EXCEPT phone/email (a bare
-- column-level revoke is defeated by the 0009 table-wide grant — the 0045 lockdown pattern).
--
-- This pins: (a) phone/email columns STILL EXIST on people (kept as the service-role demo-linking key,
-- NOT moved/dropped); (b) impersonating an authenticated member, `select phone`/`select email` is
-- denied with 42501 insufficient_privilege; (c) the same member can still `select id, name` (non-PII
-- columns) and gets rows; (d) a grant/RLS-bypassing context (superuser, standing in for service_role)
-- can still read phone — demo-linking is unaffected.
--
-- JWT-impersonation harness identical to tests 10/24/46. NOTE: column-SELECT grants are enforced for
-- the `authenticated` role but BYPASSED by a LOCAL SUPERUSER, so the deny assertions only materialise
-- under `set role authenticated` (same caveat as test 46's RLS assertions).

begin;
select plan(6);

\set orgA '00000000-0000-0000-0000-000000000001'

-- (a) the columns must remain on people (service-role linking key — NOT moved or dropped)
select has_column('public','people','phone',
  'PII-1 contact: people.phone column is RETAINED (service-role demo-linking key)');
select has_column('public','people','email',
  'PII-1 contact: people.email column is RETAINED');

-- resolve a seeded ordinary member (supervisor) to impersonate (RLS-bypassing, as the superuser role)
select set_config('test.sup', (select user_id::text from public.organization_member where org_id=:'orgA' and role='supervisor'), false);

-- (b) member cannot read phone/email — denied with 42501 insufficient_privilege
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.sup'), 'role','authenticated')::text, true);
set role authenticated;

select throws_ok(
  'select phone from public.people',
  '42501',
  null,
  'PII-1 contact: member SELECT of people.phone is denied (42501 insufficient_privilege)');

select throws_ok(
  'select email from public.people',
  '42501',
  null,
  'PII-1 contact: member SELECT of people.email is denied (42501 insufficient_privilege)');

-- (c) the same member can still read the non-PII columns and gets rows (lockdown is column-scoped)
select isnt(
  (select count(*) from public.people),
  0::bigint,
  'PII-1 contact: member can still SELECT id,name from people (non-PII still readable, returns rows)');

reset role;

-- (d) a grant-bypassing context (superuser here, standing in for service_role) still reads phone —
-- demo-linking via seed-auth / e2e global-setup is unaffected.
select lives_ok(
  'select phone from public.people',
  'PII-1 contact: a grant-bypassing context (service_role/superuser) can still read people.phone (linking unaffected)');

select * from finish();
rollback;
