-- 44 — RLS role-gate for expenses (#235): recording/editing financial expense records requires
-- budget.write, not just org membership. Before migration 0044 expenses carried only the org-scoped
-- tenant_all policy (0012, with RLS-H1 multi-scope EXISTS) with NO role gate, so any authenticated
-- org member could insert/edit expenses directly via PostgREST. 0044 adds `authorize('budget.write',
-- org_id)` to the WITH CHECK (USING stays org-only; all five RLS-H1 EXISTS preserved; DELETE already
-- revoked, 0027). No app code writes expenses (.select only). budget.write = owner/accountant (0001).
-- Impersonation via request.jwt.claims (tests 10/24/25/36/42/43).
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(7);

select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = '00000000-0000-0000-0000-000000000001' and role = 'owner' limit 1), false);
select set_config('test.skA', (select user_id::text from public.organization_member
  where org_id = '00000000-0000-0000-0000-000000000001' and role = 'storekeeper' limit 1), false);

select isnt(current_setting('test.skA'), '', 'fixture: a storekeeper member exists in orgA');

-- ===== as a budget.write member (owner): the legitimate path works + seeds a row to target =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$ insert into public.expenses (org_id, category, total) values
       ('00000000-0000-0000-0000-000000000001', 'أسمدة', 1000) $$,
  '#235: an owner (budget.write) CAN INSERT an expense (legit path works)');

reset role;

-- ===== as a NON-budget.write member (storekeeper) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.skA'), 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ insert into public.expenses (org_id, category, total) values
       ('00000000-0000-0000-0000-000000000001', 'مزيف', 999999) $$,
  '42501', null,
  '#235: a storekeeper (no budget.write) cannot INSERT an expense (financial-data integrity)');

select is(
  (with u as (update public.expenses set total = 1
              where org_id = '00000000-0000-0000-0000-000000000001' returning 1)
   select count(*)::int from u),
  0,
  '#235: a storekeeper UPDATE affects 0 rows — the expense is invisible (reads now budget.write-gated)');

select is(
  (select count(*)::int from public.expenses where org_id = '00000000-0000-0000-0000-000000000001'),
  0,
  '#235: a storekeeper now sees 0 expenses — reads gated on budget.write (symmetric with sales, 0097)');

reset role;

-- ===== owner UPDATE still works (legit path) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$ update public.expenses set total = 1200 where org_id = '00000000-0000-0000-0000-000000000001' $$,
  '#235: an owner CAN UPDATE an expense (legit path works)');

reset role;

-- ===== structural invariant: the gate is present (caught if a future migration drops it) =====
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'expenses'
       and with_check like '%authorize%budget.write%'),
  1,
  '#235: the expenses WITH CHECK carries the authorize(budget.write) gate');

select * from finish();
rollback;
