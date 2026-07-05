-- 126 — trusted balance-sheet report RPC (SPEC-0004 Slice A, migration 20260705110000).
-- Proves: finance.read gating + cross-org denial; the double-entry identity Assets = Liabilities + Equity +
-- NetIncome (the `balanced` flag); net income = revenue − expense; as-of date scoping; and posted-only (a reversed
-- entry drops out of totals). Org 000…001 starts with ZERO journal activity (the seed posts none), so absolute
-- figures are deterministic.
begin;
select plan(31);

\set org '00000000-0000-0000-0000-000000000001'
\set otherOrg '00000000-0000-0000-0000-0000000000ff'

select set_config('test.org', :'org', false);
select set_config('test.asset',   (select id::text from public.accounts where org_id=:'org' and code='1000'), false); -- عهدة نقدية (asset)
select set_config('test.equity',  (select id::text from public.accounts where org_id=:'org' and code='3000'), false); -- تمويل المالك (equity)
select set_config('test.expense', (select id::text from public.accounts where org_id=:'org' and code='5000'), false); -- مصروفات تشغيلية (expense)
select set_config('test.revenue', (select id::text from public.accounts where org_id=:'org' and code='4000'), false); -- إيرادات (revenue)
select set_config('test.drawing', (select id::text from public.accounts where org_id=:'org' and code='3100'), false); -- مسحوبات المالك (equity, kind=drawing)
select set_config('test.owner',      (select user_id::text from public.organization_member where org_id=:'org' and role='owner'      limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member where org_id=:'org' and role='accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member where org_id=:'org' and role='supervisor' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ── gating ────────────────────────────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('anon','public.fn_accounting_balance_sheet(uuid, date)','EXECUTE'),
  'anon cannot EXECUTE fn_accounting_balance_sheet');

select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$ select public.fn_accounting_balance_sheet(%L, current_date) $$, current_setting('test.org')),
  '42501', null, 'a supervisor (no finance.read) is denied the balance sheet');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$ select public.fn_accounting_balance_sheet(%L, current_date) $$, :'otherOrg'),
  '42501', null, 'cross-org balance sheet is denied');
reset role;

-- ── baseline: zero activity → empty but balanced ─────────────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('test.accountant'));
select set_config('test.bs0', public.fn_accounting_balance_sheet(current_setting('test.org')::uuid, '2026-03-31'::date)::text, false);
reset role;
select is((current_setting('test.bs0')::jsonb ->> 'balanced')::boolean, true, 'baseline (no entries) is balanced');
select is((current_setting('test.bs0')::jsonb ->> 'assets_total')::numeric, 0::numeric, 'baseline assets_total is 0');
select is((current_setting('test.bs0')::jsonb ->> 'net_income')::numeric, 0::numeric, 'baseline net_income is 0');

-- ── post three balanced entries (via the internal posting RPC, as superuser) ─────────────────────────────────
select lives_ok(format($$ select set_config('test.e1', public.fn_post_two_line_journal(%L,'2026-03-01'::date,'bs_fund',gen_random_uuid(),'تمويل',%L,%L,10000)::text, false) $$,
    current_setting('test.org'), current_setting('test.asset'), current_setting('test.equity')),
  'post owner funding: Dr cash / Cr equity 10,000 @2026-03-01');
select lives_ok(format($$ select public.fn_post_two_line_journal(%L,'2026-03-05'::date,'bs_exp',gen_random_uuid(),'مصروف',%L,%L,3000) $$,
    current_setting('test.org'), current_setting('test.expense'), current_setting('test.asset')),
  'post expense: Dr expense / Cr cash 3,000 @2026-03-05');
select lives_ok(format($$ select public.fn_post_two_line_journal(%L,'2026-03-10'::date,'bs_rev',gen_random_uuid(),'إيراد',%L,%L,5000) $$,
    current_setting('test.org'), current_setting('test.asset'), current_setting('test.revenue')),
  'post cash sale: Dr cash / Cr revenue 5,000 @2026-03-10');

-- ── as-of 2026-03-31: all three counted ──────────────────────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('test.accountant'));
select set_config('test.bs31', public.fn_accounting_balance_sheet(current_setting('test.org')::uuid, '2026-03-31'::date)::text, false);
reset role;
select is((current_setting('test.bs31')::jsonb ->> 'balanced')::boolean, true, 'as-of 03-31 is balanced (Assets = L + E + NetIncome)');
select is((current_setting('test.bs31')::jsonb ->> 'assets_total')::numeric, 12000::numeric, 'assets_total = 10000 - 3000 + 5000 = 12000');
select is((current_setting('test.bs31')::jsonb ->> 'equity_total')::numeric, 10000::numeric, 'equity_total = 10000 (owner funding)');
select is((current_setting('test.bs31')::jsonb ->> 'revenue_total')::numeric, 5000::numeric, 'revenue_total = 5000');
select is((current_setting('test.bs31')::jsonb ->> 'expense_total')::numeric, 3000::numeric, 'expense_total = 3000');
select is((current_setting('test.bs31')::jsonb ->> 'net_income')::numeric, 2000::numeric, 'net_income = revenue - expense = 2000');
select is((current_setting('test.bs31')::jsonb ->> 'liabilities_total')::numeric, 0::numeric, 'liabilities_total = 0');
select is((current_setting('test.bs31')::jsonb ->> 'liabilities_plus_equity')::numeric, 12000::numeric, 'L + E + NetIncome = 12000 = assets_total');

-- ── as-of 2026-03-04: only the funding entry counted ─────────────────────────────────────────────────────────
select pg_temp.as_user(current_setting('test.accountant'));
select set_config('test.bs04', public.fn_accounting_balance_sheet(current_setting('test.org')::uuid, '2026-03-04'::date)::text, false);
reset role;
select is((current_setting('test.bs04')::jsonb ->> 'assets_total')::numeric, 10000::numeric, 'as-of 03-04 excludes later entries: assets_total = 10000');
select is((current_setting('test.bs04')::jsonb ->> 'equity_total')::numeric, 10000::numeric, 'as-of 03-04 equity_total = 10000');
select is((current_setting('test.bs04')::jsonb ->> 'net_income')::numeric, 0::numeric, 'as-of 03-04 net_income = 0 (no revenue/expense yet)');
select is((current_setting('test.bs04')::jsonb ->> 'balanced')::boolean, true, 'as-of 03-04 is balanced');

-- ── posted-only: reversing the funding entry drops it from totals ────────────────────────────────────────────
update public.journal_entries set status = 'reversed' where id = current_setting('test.e1')::uuid;
select pg_temp.as_user(current_setting('test.accountant'));
select set_config('test.bsR', public.fn_accounting_balance_sheet(current_setting('test.org')::uuid, '2026-03-31'::date)::text, false);
reset role;
select is((current_setting('test.bsR')::jsonb ->> 'assets_total')::numeric, 2000::numeric, 'reversed funding excluded: assets_total = -3000 + 5000 = 2000');
select is((current_setting('test.bsR')::jsonb ->> 'equity_total')::numeric, 0::numeric, 'reversed funding excluded: equity_total = 0');
select is((current_setting('test.bsR')::jsonb ->> 'balanced')::boolean, true, 'still balanced after excluding the reversed entry');

-- ── owner drawings (#6): a drawing posts as a positive drawings_total, netted into equity_total ───────────────
-- State here: e1 reversed → assets 2000, equity 0, revenue 5000, expense 3000, net_income 2000.
select lives_ok(format($$ select public.fn_post_two_line_journal(%L,'2026-03-20'::date,'bs_draw',gen_random_uuid(),'مسحوبات',%L,%L,2000) $$,
    current_setting('test.org'), current_setting('test.drawing'), current_setting('test.asset')),
  'post owner drawing: Dr drawings / Cr cash 2,000 @2026-03-20');
select pg_temp.as_user(current_setting('test.accountant'));
select set_config('test.bsD', public.fn_accounting_balance_sheet(current_setting('test.org')::uuid, '2026-03-31'::date)::text, false);
reset role;
select is((current_setting('test.bsD')::jsonb ->> 'drawings_total')::numeric, 2000::numeric, 'drawings_total is a POSITIVE magnitude (#6)');
select is((current_setting('test.bsD')::jsonb ->> 'equity_total')::numeric, (-2000)::numeric, 'equity_total nets the drawing negatively (0 funding - 2000 drawn)');
select is((current_setting('test.bsD')::jsonb ->> 'assets_total')::numeric, 0::numeric, 'assets_total = 2000 - 2000 (cash out for the drawing) = 0');
select is((current_setting('test.bsD')::jsonb ->> 'balanced')::boolean, true, 'still balanced after the drawing');

-- ── regression: an ARCHIVED (active=false) account must still count toward totals (historical statement) ───────
update public.accounts set active = false where org_id = current_setting('test.org')::uuid and code = '4000';
select pg_temp.as_user(current_setting('test.accountant'));
select set_config('test.bsA', public.fn_accounting_balance_sheet(current_setting('test.org')::uuid, '2026-03-31'::date)::text, false);
reset role;
select is((current_setting('test.bsA')::jsonb ->> 'revenue_total')::numeric, 5000::numeric,
  'revenue on an ARCHIVED account still counts (no active-filter balance drop)');
select is((current_setting('test.bsA')::jsonb ->> 'balanced')::boolean, true,
  'balanced identity holds even with an archived account carrying historical activity');

select finish();
rollback;
