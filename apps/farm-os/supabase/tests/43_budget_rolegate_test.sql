-- 43 — RLS role-gate for budgets + budget_lines (#235): writing financial limits requires
-- budget.write, not just org membership. Before migration 0043 these tables carried only the
-- org-scoped tenant_all policy (0007/0010) with NO role gate, so any authenticated org member without
-- budget.write (supervisor/agri_engineer/storekeeper, even farm_manager) could INSERT/UPDATE budget
-- limits directly via PostgREST. 0043 adds `authorize('budget.write', org_id)` to the WITH CHECK
-- (USING stays org-only so reads are unaffected; budget_lines' parent-org EXISTS is preserved; DELETE
-- already revoked in 0027). No app code writes these (.select only). budget.write = owner/accountant
-- (migration 0001). Impersonation via request.jwt.claims (tests 10/24/25/36/42).
--
-- Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(9);

select set_config('test.budget', (select id::text from public.budgets
  where org_id = '00000000-0000-0000-0000-000000000001' order by id limit 1), false);
select set_config('test.ownerA', (select user_id::text from public.organization_member
  where org_id = '00000000-0000-0000-0000-000000000001' and role = 'owner' limit 1), false);
select set_config('test.skA', (select user_id::text from public.organization_member
  where org_id = '00000000-0000-0000-0000-000000000001' and role = 'storekeeper' limit 1), false);

select isnt(current_setting('test.budget'), '', 'fixture: a budget exists in orgA');
select isnt(current_setting('test.skA'),    '', 'fixture: a storekeeper member exists in orgA');

-- ===== as a NON-budget.write member (storekeeper) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.skA'), 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ insert into public.budgets (org_id, name, approved) values
       ('00000000-0000-0000-0000-000000000001', 'ميزانية مزيفة', 999999) $$,
  '42501', null,
  '#235: a storekeeper (no budget.write) cannot INSERT a budget');

select throws_ok(
  $$ update public.budgets set approved = 999999
       where org_id = '00000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  '#235: a storekeeper cannot UPDATE a budget limit (the alter-financial-controls vector is closed)');

select throws_ok(
  format($$ insert into public.budget_lines (org_id, budget_id, category, approved)
            values ('00000000-0000-0000-0000-000000000001', %L, 'أسمدة', 999999) $$,
         current_setting('test.budget')),
  '42501', null,
  '#235: a storekeeper cannot INSERT a budget_line');

select lives_ok(
  $$ select count(*) from public.budgets where org_id = '00000000-0000-0000-0000-000000000001' $$,
  '#235: a storekeeper can still READ budgets (USING unchanged — budget pages/dashboards unaffected)');

reset role;

-- ===== as a budget.write member (owner) — the legitimate path is unaffected =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.ownerA'), 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$ insert into public.budgets (org_id, name, approved) values
       ('00000000-0000-0000-0000-000000000001', 'ميزانية اختبار', 5000) $$,
  '#235: an owner (budget.write) CAN INSERT a budget (legit path works)');

select lives_ok(
  format($$ update public.budget_lines set approved = approved
              where org_id = '00000000-0000-0000-0000-000000000001' and budget_id = %L $$,
         current_setting('test.budget')),
  '#235: an owner CAN UPDATE a budget_line (legit path works)');

reset role;

-- ===== structural invariant: the gate is present on both tables =====
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'public' and tablename in ('budgets','budget_lines')
       and with_check like '%authorize%budget.write%'),
  2,
  '#235: budgets AND budget_lines WITH CHECK both carry the authorize(budget.write) gate');

select * from finish();
rollback;
