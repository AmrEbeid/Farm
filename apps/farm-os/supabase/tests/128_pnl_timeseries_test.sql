-- 128 — fn_pnl_timeseries (GL-backed P&L time series, migration 20260705140000, SPEC-0029 Phase 0).
-- Pins: a per-period (monthly) revenue/expenses/operating/net strip from the POSTED journal, signed by
-- account_type; reversed entries excluded (posted-only); owner drawings (equity) excluded (#6); the
-- operating_expenses subset (kind='operating'); cumulative_net_income carry-forward (for the J-curve); and
-- the guards (anon lockdown, cross-org, grain + inverted-period validation, finance.read). The seed carries
-- NO journal activity, so the entries below are the only ledger data → fully deterministic. Impersonation via
-- request.jwt.claims (tests 112/127). Run via test-shims/run-pgtap-local.sh.
begin;
select plan(11);

\set org '00000000-0000-0000-0000-000000000001'
\set orgB 'c1280000-0000-0000-0000-00000000000b'
\set ca 'c1280000-0000-0000-0000-0000000000ca'
\set ra 'c1280000-0000-0000-0000-0000000000a0'
\set ea 'c1280000-0000-0000-0000-0000000000e1'
\set eb 'c1280000-0000-0000-0000-0000000000e2'
\set da 'c1280000-0000-0000-0000-0000000000d0'

-- Accounts (superuser, RLS-bypassed): a cash asset (balancing leg, excluded from P&L), a revenue account,
-- two expense accounts (one operating / one non-operating), and an owner-drawings EQUITY account.
insert into public.accounts (id, org_id, code, name_ar, account_type, normal_balance, kind, active) values
  (:'ca', :'org', 'T830', 'نقدية اختبار',        'asset',   'debit',  null,        true),
  (:'ra', :'org', 'T800', 'إيراد اختبار',          'revenue', 'credit', null,        true),
  (:'ea', :'org', 'T810', 'مصروف تشغيلي اختبار',   'expense', 'debit',  'operating', true),
  (:'eb', :'org', 'T811', 'مصروف رأسمالي اختبار',  'expense', 'debit',  'capex',     true),
  (:'da', :'org', 'T820', 'مسحوبات مالك اختبار',   'equity',  'debit',  'drawing',   true);

-- Balanced posted entries. Jan: revenue 5,000; operating exp 2,000; non-op exp 1,000; a DRAWING 4,000 (must
-- not touch expenses); plus a REVERSED revenue 9,999 (must be excluded). Feb: revenue 8,000; operating 3,000.
insert into public.journal_entries (id, org_id, entry_date, source_type, source_id, description, status) values
  ('c1280000-0000-0000-0000-000000000001', :'org', '2026-01-15', 'test_ts', 'c1280000-0000-0000-0000-000000000001', 'إيراد يناير', 'posted'),
  ('c1280000-0000-0000-0000-000000000002', :'org', '2026-01-20', 'test_ts', 'c1280000-0000-0000-0000-000000000002', 'مصروف تشغيلي يناير', 'posted'),
  ('c1280000-0000-0000-0000-000000000003', :'org', '2026-01-25', 'test_ts', 'c1280000-0000-0000-0000-000000000003', 'مصروف رأسمالي يناير', 'posted'),
  ('c1280000-0000-0000-0000-000000000004', :'org', '2026-01-22', 'test_ts', 'c1280000-0000-0000-0000-000000000004', 'سحب مالك يناير', 'posted'),
  ('c1280000-0000-0000-0000-000000000005', :'org', '2026-01-18', 'test_ts', 'c1280000-0000-0000-0000-000000000005', 'قيد ملغى (معكوس)', 'reversed'),
  ('c1280000-0000-0000-0000-000000000006', :'org', '2026-02-10', 'test_ts', 'c1280000-0000-0000-0000-000000000006', 'إيراد فبراير', 'posted'),
  ('c1280000-0000-0000-0000-000000000007', :'org', '2026-02-15', 'test_ts', 'c1280000-0000-0000-0000-000000000007', 'مصروف تشغيلي فبراير', 'posted');

insert into public.journal_lines (org_id, journal_entry_id, account_id, debit, credit) values
  (:'org', 'c1280000-0000-0000-0000-000000000001', :'ca', 5000, 0), (:'org', 'c1280000-0000-0000-0000-000000000001', :'ra', 0, 5000),
  (:'org', 'c1280000-0000-0000-0000-000000000002', :'ea', 2000, 0), (:'org', 'c1280000-0000-0000-0000-000000000002', :'ca', 0, 2000),
  (:'org', 'c1280000-0000-0000-0000-000000000003', :'eb', 1000, 0), (:'org', 'c1280000-0000-0000-0000-000000000003', :'ca', 0, 1000),
  (:'org', 'c1280000-0000-0000-0000-000000000004', :'da', 4000, 0), (:'org', 'c1280000-0000-0000-0000-000000000004', :'ca', 0, 4000),
  (:'org', 'c1280000-0000-0000-0000-000000000005', :'ca', 9999, 0), (:'org', 'c1280000-0000-0000-0000-000000000005', :'ra', 0, 9999),
  (:'org', 'c1280000-0000-0000-0000-000000000006', :'ca', 8000, 0), (:'org', 'c1280000-0000-0000-0000-000000000006', :'ra', 0, 8000),
  (:'org', 'c1280000-0000-0000-0000-000000000007', :'ea', 3000, 0), (:'org', 'c1280000-0000-0000-0000-000000000007', :'ca', 0, 3000);

insert into public.organization (id, name) values (:'orgB', 'مزرعة اختبار السلاسل الزمنية');

select set_config('test.owner',
  (select user_id::text from public.organization_member where org_id = :'org' and role = 'owner' limit 1), false);
create or replace function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- 1) anon EXECUTE lockdown
select ok(not has_function_privilege('anon', 'public.fn_pnl_timeseries(uuid, text, date, date)', 'EXECUTE'),
  'anon cannot EXECUTE fn_pnl_timeseries');

select pg_temp.as_owner();

-- helper: pull a scalar field for a given period from the result
-- 2) two monthly periods are returned
select is(
  jsonb_array_length(public.fn_pnl_timeseries(:'org', 'month', '2026-01-01', '2026-02-28')->'periods'),
  2, 'monthly grain over Jan–Feb returns 2 periods');

-- 3) Jan revenue = 5,000 — the REVERSED 9,999 entry is excluded (posted-only)
select is(
  (select (p->>'revenue')::numeric from jsonb_array_elements(public.fn_pnl_timeseries(:'org','month','2026-01-01','2026-02-28')->'periods') p where p->>'period' = '2026-01'),
  5000::numeric, 'Jan revenue = 5,000 (reversed entry excluded)');

-- 4) Jan expenses = 3,000 — the owner DRAWING (equity) is excluded (#6)
select is(
  (select (p->>'expenses')::numeric from jsonb_array_elements(public.fn_pnl_timeseries(:'org','month','2026-01-01','2026-02-28')->'periods') p where p->>'period' = '2026-01'),
  3000::numeric, 'Jan expenses = 3,000 (owner drawing excluded)');

-- 5) Jan operating_expenses = 2,000 — the non-operating (capex-kind) expense is NOT in the operating subset
select is(
  (select (p->>'operating_expenses')::numeric from jsonb_array_elements(public.fn_pnl_timeseries(:'org','month','2026-01-01','2026-02-28')->'periods') p where p->>'period' = '2026-01'),
  2000::numeric, 'Jan operating_expenses = 2,000 (subset by kind=operating)');

-- 6) Jan net = 2,000 (5,000 − 3,000)
select is(
  (select (p->>'net_income')::numeric from jsonb_array_elements(public.fn_pnl_timeseries(:'org','month','2026-01-01','2026-02-28')->'periods') p where p->>'period' = '2026-01'),
  2000::numeric, 'Jan net_income = 2,000');

-- 7) Feb net = 5,000 (8,000 − 3,000)
select is(
  (select (p->>'net_income')::numeric from jsonb_array_elements(public.fn_pnl_timeseries(:'org','month','2026-01-01','2026-02-28')->'periods') p where p->>'period' = '2026-02'),
  5000::numeric, 'Feb net_income = 5,000');

-- 8) cumulative carry-forward: Feb cumulative = 2,000 + 5,000 = 7,000
select is(
  (select (p->>'cumulative_net_income')::numeric from jsonb_array_elements(public.fn_pnl_timeseries(:'org','month','2026-01-01','2026-02-28')->'periods') p where p->>'period' = '2026-02'),
  7000::numeric, 'Feb cumulative_net_income = 7,000 (running sum)');

-- 9) invalid grain rejected
select throws_ok(
  format($$ select public.fn_pnl_timeseries(%L, 'week', '2026-01-01', '2026-02-28') $$, :'org'),
  '22023', null, 'reject grain other than month/year');

-- 10) inverted period rejected
select throws_ok(
  format($$ select public.fn_pnl_timeseries(%L, 'month', '2026-02-28', '2026-01-01') $$, :'org'),
  '22023', null, 'reject an inverted period (from > to)');

-- 11) cross-org rejection
select throws_ok(
  format($$ select public.fn_pnl_timeseries(%L, 'month', '2026-01-01', '2026-02-28') $$, :'orgB'),
  '42501', null, 'owner of org A cannot pull org B timeseries');
reset role;

select * from finish();
