-- 127 — trusted income statement / P&L from the GL (SPEC-0004 Slice A, migration 20260705120000).
-- Proves: finance.read gating + cross-org denial; period totals (revenue/expense/operating/net_income); owner
-- drawings EXCLUDED from the P&L (#6, by account_type); period scoping (out-of-range entry excluded); posted-only
-- (reversed entry drops out); and the tie — income-statement net_income == balance-sheet net_income for the window.
-- Org 000…001 starts with ZERO journal activity, so absolute figures are deterministic.
begin;
select plan(15);

\set org '00000000-0000-0000-0000-000000000001'
\set otherOrg '00000000-0000-0000-0000-0000000000ff'

select set_config('test.org', :'org', false);
select set_config('test.asset',   (select id::text from public.accounts where org_id=:'org' and code='1000'), false);
select set_config('test.revenue', (select id::text from public.accounts where org_id=:'org' and code='4000'), false);
select set_config('test.expense', (select id::text from public.accounts where org_id=:'org' and code='5000'), false);
select set_config('test.drawing', (select id::text from public.accounts where org_id=:'org' and code='3100'), false);
select set_config('test.owner',      (select user_id::text from public.organization_member where org_id=:'org' and role='owner'      limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member where org_id=:'org' and role='accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member where org_id=:'org' and role='supervisor' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ── gating ────────────────────────────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon','public.fn_accounting_income_statement(uuid, date, date)','EXECUTE'),
  'anon cannot EXECUTE fn_accounting_income_statement');
select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$ select public.fn_accounting_income_statement(%L,'2026-03-01'::date,'2026-03-31'::date) $$, current_setting('test.org')),
  '42501', null, 'a supervisor (no finance.read) is denied the income statement');
reset role;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$ select public.fn_accounting_income_statement(%L,'2026-03-01'::date,'2026-03-31'::date) $$, :'otherOrg'),
  '42501', null, 'cross-org income statement is denied');
reset role;

-- ── post entries (superuser): revenue, expense, a drawing, and an out-of-period expense ──────────────────────
select lives_ok(format($$ select public.fn_post_two_line_journal(%L,'2026-03-10'::date,'is_rev',gen_random_uuid(),'بيع',%L,%L,5000) $$,
    current_setting('test.org'), current_setting('test.asset'), current_setting('test.revenue')),
  'post revenue: Dr cash / Cr revenue 5,000 @2026-03-10');
select lives_ok(format($$ select set_config('test.e_exp', public.fn_post_two_line_journal(%L,'2026-03-05'::date,'is_exp',gen_random_uuid(),'مصروف',%L,%L,3000)::text, false) $$,
    current_setting('test.org'), current_setting('test.expense'), current_setting('test.asset')),
  'post expense: Dr expense / Cr cash 3,000 @2026-03-05');
select lives_ok(format($$ select public.fn_post_two_line_journal(%L,'2026-03-15'::date,'is_draw',gen_random_uuid(),'مسحوبات',%L,%L,2000) $$,
    current_setting('test.org'), current_setting('test.drawing'), current_setting('test.asset')),
  'post owner drawing: Dr drawings / Cr cash 2,000 @2026-03-15 (must NOT hit the P&L)');
select lives_ok(format($$ select public.fn_post_two_line_journal(%L,'2026-06-01'::date,'is_exp_out',gen_random_uuid(),'مصروف خارج الفترة',%L,%L,1000) $$,
    current_setting('test.org'), current_setting('test.expense'), current_setting('test.asset')),
  'post an out-of-period expense 1,000 @2026-06-01 (excluded by the date window)');

-- ── income statement for March 2026 ──────────────────────────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('test.accountant'));
select set_config('test.is31', public.fn_accounting_income_statement(current_setting('test.org')::uuid, '2026-03-01'::date, '2026-03-31'::date)::text, false);
reset role;
select is((current_setting('test.is31')::jsonb ->> 'revenue_total')::numeric, 5000::numeric, 'revenue_total = 5000');
select is((current_setting('test.is31')::jsonb ->> 'expenses_total')::numeric, 3000::numeric, 'expenses_total = 3000 (out-of-period 1,000 excluded; drawing excluded)');
select is((current_setting('test.is31')::jsonb ->> 'operating_expenses')::numeric, 3000::numeric, 'operating_expenses = 3000 (5000 is kind=operating)');
select is((current_setting('test.is31')::jsonb ->> 'net_income')::numeric, 2000::numeric, 'net_income = revenue - expense = 2000');
select is(
  (select count(*)::int from jsonb_array_elements(current_setting('test.is31')::jsonb -> 'expenses') e where e ->> 'code' = '3100'),
  0, 'owner drawings account (3100) never appears in the P&L expenses (#6)');

-- ── the tie: income-statement net_income == balance-sheet net_income for the same window ─────────────────────
select pg_temp.as_user(current_setting('test.accountant'));
select is(
  (public.fn_accounting_income_statement(current_setting('test.org')::uuid, '2000-01-01'::date, '2026-03-31'::date) ->> 'net_income')::numeric,
  (public.fn_accounting_balance_sheet(current_setting('test.org')::uuid, '2026-03-31'::date) ->> 'net_income')::numeric,
  'income-statement net_income ties to balance-sheet net_income');
reset role;

-- ── posted-only: reversing the expense drops it from the P&L ─────────────────────────────────────────────────
update public.journal_entries set status = 'reversed' where id = current_setting('test.e_exp')::uuid;
select pg_temp.as_user(current_setting('test.accountant'));
select set_config('test.is31b', public.fn_accounting_income_statement(current_setting('test.org')::uuid, '2026-03-01'::date, '2026-03-31'::date)::text, false);
reset role;
select is((current_setting('test.is31b')::jsonb ->> 'expenses_total')::numeric, 0::numeric, 'reversed expense excluded: expenses_total = 0');
select is((current_setting('test.is31b')::jsonb ->> 'net_income')::numeric, 5000::numeric, 'after reversal net_income = 5000 (revenue only)');

select finish();
rollback;
