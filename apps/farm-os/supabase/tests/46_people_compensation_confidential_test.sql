-- 43 — PII-1 (#173), WAGE slice: wages are CONFIDENTIAL (owner/accountant only).
--
-- Before migration 0046, `people.rate` (wages) sat on `public.people`, whose only policy is the
-- org-scoped `tenant_all` (no role gate) — so ANY org member could read everyone's pay. Migration
-- 0043 adds a `payroll.read` permission (owner/accountant), moves wages into the role-gated
-- `people_compensation` table (force RLS, policy comp_rw gates SELECT+write on payroll.read), backfills
-- it, and DROPs people.rate.
--
-- This pins: (a) authorize('payroll.read') is true ONLY for owner+accountant (the other 4 seeded roles
-- get false); (b) impersonating an accountant, people_compensation returns wage rows, while a
-- supervisor sees ZERO (RLS hides wages); (c) people.rate is gone; (d) the data was preserved.
-- JWT-impersonation harness identical to tests 10/24/36. authorize() and user_org_ids() are SECURITY
-- DEFINER (read auth.uid() from the JWT GUC), so the assertions reflect the real RBAC decision.
-- NOTE: the RLS read assertions require `set role authenticated` — a LOCAL SUPERUSER bypasses RLS
-- (incl. force), so the rows-vs-zero contrast only materialises under the non-superuser client role.

begin;
select plan(10);

\set orgA '00000000-0000-0000-0000-000000000001'

-- resolve the seeded user id behind each role (RLS-bypassing, as the superuser test role)
select set_config('test.owner', (select user_id::text from public.organization_member where org_id=:'orgA' and role='owner'), false);
select set_config('test.acct',  (select user_id::text from public.organization_member where org_id=:'orgA' and role='accountant'), false);
select set_config('test.fm',    (select user_id::text from public.organization_member where org_id=:'orgA' and role='farm_manager'), false);
select set_config('test.eng',   (select user_id::text from public.organization_member where org_id=:'orgA' and role='agri_engineer'), false);
select set_config('test.sup',   (select user_id::text from public.organization_member where org_id=:'orgA' and role='supervisor'), false);
select set_config('test.store', (select user_id::text from public.organization_member where org_id=:'orgA' and role='storekeeper'), false);

-- ===== (c) people.rate is gone — wages no longer live on the org-wide people table =====
select hasnt_column('public','people','rate',
  'PII-1: people.rate column was dropped (wages off the org-wide people table)');

-- ===== (d) data migration / seed preserved every rate — one comp row per seeded person =====
select is((select count(*) from public.people_compensation where org_id=:'orgA'), 6::bigint,
  'PII-1: people_compensation holds one rate per seeded person (all 6 preserved)');

-- ===== (a) authorize('payroll.read', orgA): owner+accountant TRUE, the other 4 roles FALSE =====
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.owner'), 'role','authenticated')::text, true);
select is(public.authorize('payroll.read', :'orgA'), true,  'payroll.read: owner = true');

select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.acct'), 'role','authenticated')::text, true);
select is(public.authorize('payroll.read', :'orgA'), true,  'payroll.read: accountant = true');

select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.fm'), 'role','authenticated')::text, true);
select is(public.authorize('payroll.read', :'orgA'), false, 'payroll.read: farm_manager = false (wages hidden)');

select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.eng'), 'role','authenticated')::text, true);
select is(public.authorize('payroll.read', :'orgA'), false, 'payroll.read: agri_engineer = false (wages hidden)');

select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.sup'), 'role','authenticated')::text, true);
select is(public.authorize('payroll.read', :'orgA'), false, 'payroll.read: supervisor = false (wages hidden)');

select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.store'), 'role','authenticated')::text, true);
select is(public.authorize('payroll.read', :'orgA'), false, 'payroll.read: storekeeper = false (wages hidden)');

-- ===== (b) RLS: accountant SEES wage rows; supervisor sees ZERO =====
-- accountant (payroll.read) — rows visible
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.acct'), 'role','authenticated')::text, true);
set role authenticated;
select isnt((select count(*) from public.people_compensation), 0::bigint,
  'RLS: impersonating an accountant, people_compensation returns wage rows');
reset role;

-- supervisor (NO payroll.read) — RLS filters every row away
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.sup'), 'role','authenticated')::text, true);
set role authenticated;
select is((select count(*) from public.people_compensation), 0::bigint,
  'RLS: impersonating a supervisor, people_compensation returns ZERO rows (wages hidden)');
reset role;

select * from finish();
rollback;
