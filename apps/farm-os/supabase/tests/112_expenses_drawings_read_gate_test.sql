-- 112 — READ-side privacy gate for expenses.kind='drawing' (independent security + product review,
-- 2026-07-01). Non-negotiable #6: owner drawings (مسحوبات) must be visible only to owner/accountant.
-- Migration 0044 gated WRITES on budget.write but left READS org-only; 20260701220000 tightens the
-- tenant_all USING clause so a non-finance member cannot read kind='drawing' rows via direct REST, while
-- still reading operating/capex rows (today's app surface for farm_manager). WITH CHECK (writes) is
-- untouched — this test only exercises reads. Impersonation via request.jwt.claims (tests 10/24/25/36/42/43,
-- reused by 44/102). Run via `supabase test db` or test-shims/run-pgtap-local.sh.

begin;
select plan(9);

\set org '00000000-0000-0000-0000-000000000001'
\set expDrawing 'a0e10000-0000-0000-0000-0000000000d1'
\set expOperating 'a0e10000-0000-0000-0000-0000000000d2'
\set expCapex 'a0e10000-0000-0000-0000-0000000000d3'

-- fixtures (superuser, RLS-bypassed): one row per kind in the same org.
insert into public.expenses (id, org_id, date, category, description, total, kind)
  values (:'expDrawing', :'org', current_date, 'مسحوبات', 'سحب شخصي للمالك', 20000, 'drawing');
insert into public.expenses (id, org_id, date, category, description, total, kind)
  values (:'expOperating', :'org', current_date, 'أسمدة', 'بند تشغيلي', 1500, 'operating');
insert into public.expenses (id, org_id, date, category, description, total, kind)
  values (:'expCapex', :'org', current_date, 'معدات', 'بند رأسمالي', 8000, 'capex');

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'farm_manager' limit 1), false);

select isnt(current_setting('test.manager'), '', 'fixture: a farm_manager member exists in orgA');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ===== farm_manager: CANNOT read the drawing row, CAN still read operating/capex =====
select pg_temp.as_user(current_setting('test.manager'));

select is(
  (select count(*)::int from public.expenses where id = :'expDrawing'),
  0, 'farm_manager cannot SELECT a kind=drawing expense row');
select is(
  (select count(*)::int from public.expenses where id = :'expOperating'),
  1, 'farm_manager CAN still SELECT a kind=operating expense row');
select is(
  (select count(*)::int from public.expenses where id = :'expCapex'),
  1, 'farm_manager CAN still SELECT a kind=capex expense row');
select is(
  (select count(*)::int from public.expenses where org_id = :'org' and kind = 'drawing'),
  0, 'farm_manager sees zero drawing rows in an org-wide scan (no leak via aggregate/count)');

reset role;

-- ===== accountant: CAN read all three kinds, incl. drawing =====
select pg_temp.as_user(current_setting('test.accountant'));

select is(
  (select count(*)::int from public.expenses where id = :'expDrawing'),
  1, 'accountant CAN SELECT the kind=drawing expense row');
select is(
  (select count(*)::int from public.expenses where id in (:'expOperating', :'expCapex')),
  2, 'accountant CAN still SELECT operating/capex rows');

reset role;

-- ===== owner: CAN read all three kinds, incl. drawing =====
select pg_temp.as_user(current_setting('test.owner'));

select is(
  (select count(*)::int from public.expenses where id = :'expDrawing'),
  1, 'owner CAN SELECT the kind=drawing expense row');

reset role;

-- ===== structural invariant: the read gate is present (caught if a future re-emit drops it) =====
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'expenses'
       and qual like '%kind%drawing%' and qual like '%finance.read%'),
  1,
  'the expenses USING clause carries the kind=drawing / finance.read read-gate');

select * from finish();
rollback;
