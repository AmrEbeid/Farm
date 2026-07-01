-- 112 — fn_owner_pnl_summary (owner P&L period summary, migration 20260701270000).
-- Verifies: real SUM() totals by expenses.kind for a given org+period; anon EXECUTE lockdown;
-- cross-org rejection; invalid-period rejection; and — the specific privacy property this task is
-- about — a farm_manager (no finance.read) is REJECTED (42501) and never receives the owner-drawings
-- figure, matching the intent of the closed-but-unmerged #540 privacy fix. Impersonation via
-- request.jwt.claims (the harness used by tests 36/82/102). Run via test-shims/run-pgtap-local.sh.
begin;
select plan(13);

\set org '00000000-0000-0000-0000-000000000001'
\set orgB 'c1020000-0000-0000-0000-00000000000c'

-- fixtures (superuser, RLS-bypassed): one expense of each kind inside the period, one outside it.
insert into public.expenses (id, org_id, date, category, description, total, status, kind)
  values ('a0e00000-0000-0000-0000-0000000000f1', :'org', '2026-03-01', 'تسميد', 'تشغيلي داخل الفترة', 1000, 'approved', 'operating');
insert into public.expenses (id, org_id, date, category, description, total, status, kind)
  values ('a0e00000-0000-0000-0000-0000000000f2', :'org', '2026-04-01', 'مسحوبات', 'سحب مالك داخل الفترة', 5000, 'approved', 'drawing');
insert into public.expenses (id, org_id, date, category, description, total, status, kind)
  values ('a0e00000-0000-0000-0000-0000000000f3', :'org', '2026-05-01', 'معدات', 'رأسمالي داخل الفترة', 20000, 'approved', 'capex');
insert into public.expenses (id, org_id, date, category, description, total, status, kind)
  values ('a0e00000-0000-0000-0000-0000000000f4', :'org', '2020-01-01', 'تسميد', 'تشغيلي خارج الفترة', 999999, 'approved', 'operating');

insert into public.organization (id, name) values (:'orgB', 'مزرعة اختبار P&L');

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'farm_manager' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'supervisor' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- 1) anon EXECUTE lockdown
select ok(not has_function_privilege('anon', 'public.fn_owner_pnl_summary(uuid, date, date)', 'EXECUTE'),
  'anon cannot EXECUTE fn_owner_pnl_summary');

-- 2) owner: real period totals, split correctly by kind (the 2020 row is excluded)
select pg_temp.as_user(current_setting('test.owner'));
select is(
  (public.fn_owner_pnl_summary(:'org', '2026-01-01', '2026-12-31')->>'operating_expenses')::numeric,
  1000::numeric, 'owner: operating total = 1,000 (period-scoped, real SUM)');
select is(
  (public.fn_owner_pnl_summary(:'org', '2026-01-01', '2026-12-31')->>'owner_drawings')::numeric,
  5000::numeric, 'owner: owner_drawings total = 5,000');
select is(
  (public.fn_owner_pnl_summary(:'org', '2026-01-01', '2026-12-31')->>'capex')::numeric,
  20000::numeric, 'owner: capex total = 20,000');
reset role;

-- 3) accountant: same figures (finance.read carries both roles)
select pg_temp.as_user(current_setting('test.accountant'));
select is(
  (public.fn_owner_pnl_summary(:'org', '2026-01-01', '2026-12-31')->>'owner_drawings')::numeric,
  5000::numeric, 'accountant: owner_drawings total = 5,000');
reset role;

-- 4) the cardinal property this task is about: farm_manager (no finance.read) is REJECTED, not
--    handed a zeroed/placeholder figure.
select pg_temp.as_user(current_setting('test.manager'));
select throws_ok(
  format($$ select public.fn_owner_pnl_summary(%L, '2026-01-01', '2026-12-31') $$, :'org'),
  '42501', null, 'farm_manager without finance.read cannot call fn_owner_pnl_summary (drawings hidden)');
reset role;

-- 5) supervisor likewise rejected
select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(
  format($$ select public.fn_owner_pnl_summary(%L, '2026-01-01', '2026-12-31') $$, :'org'),
  '42501', null, 'supervisor without finance.read cannot call fn_owner_pnl_summary');
reset role;

-- 6) cross-org rejection: owner of org A cannot pull org B's P&L
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(
  format($$ select public.fn_owner_pnl_summary(%L, '2026-01-01', '2026-12-31') $$, :'orgB'),
  '42501', null, 'owner of org A cannot call fn_owner_pnl_summary for org B');

-- 7) invalid period rejection (from > to)
select throws_ok(
  format($$ select public.fn_owner_pnl_summary(%L, '2026-12-31', '2026-01-01') $$, :'org'),
  '22023', null, 'reject an inverted period (from > to)');

-- 8) a narrower period excludes rows outside it (real query, not a cached total)
select is(
  (public.fn_owner_pnl_summary(:'org', '2026-04-01', '2026-04-30')->>'operating_expenses')::numeric,
  0::numeric, 'narrower period: no operating expenses in April alone');
select is(
  (public.fn_owner_pnl_summary(:'org', '2026-04-01', '2026-04-30')->>'owner_drawings')::numeric,
  5000::numeric, 'narrower period: April drawings still 5,000');
reset role;

-- 9) function is STABLE/definer-owned and schema-qualified (search_path hardening) — sanity check via
--    pg_proc rather than re-deriving the whole functiondef.
select is(
  (select p.provolatile from pg_proc p where p.oid = 'public.fn_owner_pnl_summary(uuid, date, date)'::regprocedure),
  's', 'fn_owner_pnl_summary is STABLE');
select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.fn_owner_pnl_summary(uuid, date, date)'::regprocedure),
  true, 'fn_owner_pnl_summary is SECURITY DEFINER');

select * from finish();
