-- fn_expense_register_summary: exact expense-register summary for /expenses (migration
-- 20260730140000). Pins: exact counts over the FULL register (not the 200-row page cap) — counts
-- include every payment_status, no lifecycle exclusion; exact current-month non-drawing/drawing
-- MONEY sums — non-drawing means EVERY non-drawing kind (operating AND capex), never
-- operating-only, matching the page's "بدون مسحوبات" KPI — that exclude cancelled/historical_reversed
-- (matching the merged cost-center exact summary) while still including historical_treasury;
-- explicit unknown-amount counts (never a fabricated zero, and never counting a void/reversed
-- unknown); owner/accountant/farm_manager visibility parity with the existing expenses RLS, drawing
-- figures withheld (not zeroed) from a caller without finance.read, cross-org/role/date-bound
-- rejection, and grants.
begin;
select plan(26);

\set org '00000000-0000-0000-0000-000000000001'
\set org_b '14600000-0000-0000-0000-0000000000b0'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.farm_manager', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'farm_manager' limit 1), false);
select set_config('test.storekeeper', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'storekeeper' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

insert into public.organization (id, name) values (:'org_b', 'مزرعة أخرى 146');

insert into public.accounts(org_id, code, name_ar, account_type, normal_balance, kind, active)
values (:'org', 'EXP-146', 'حساب اختبار', 'expense', 'debit', 'operating', true)
returning set_config('test.account', id::text, false);

insert into public.accounts(org_id, code, name_ar, account_type, normal_balance, kind, active)
values (:'org', 'DRW-146', 'حساب مسحوبات اختبار', 'expense', 'debit', 'drawing', true)
returning set_config('test.drawing_account', id::text, false);

insert into public.accounts(org_id, code, name_ar, account_type, normal_balance, kind, active)
values (:'org', 'CPX-146', 'حساب رأسمالي اختبار', 'expense', 'debit', 'capex', true)
returning set_config('test.capex_account', id::text, false);

insert into public.cost_centers(org_id, code, name_ar, active)
values (:'org', 'CC-146', 'مركز اختبار السجل', true)
returning set_config('test.cc', id::text, false);

-- July 2026 fixture (month bounds are supplied by the caller, never current_date). Row COUNTS
-- (expense_count/month_count/operating_count/drawing_count/unrouted_count/unclassified_count/
-- uncentered_count) count every row below regardless of payment_status. The MONEY fields
-- (month_non_drawing_total/_unknown_count, month_drawing_total/_unknown_count) exclude
-- 'cancelled'/'historical_reversed' and include 'historical_treasury':
--   R1  operating, in-month, known amount, fully classified/centered/routed
--   R2  operating, in-month, UNKNOWN amount (total is null)
--   R3  operating, PREVIOUS month (June) — must not enter month figures, still in all-time counts
--   R4  operating, in-month, unrouted (payment_status null) + unclassified (account_id null)
--   R5  operating, in-month, uncentered (cost_center_id null)
--   R6  operating, in-month, 'cancelled', known amount — counted in month_count/operating_count,
--       EXCLUDED from month_non_drawing_total (void money is not real cash)
--   R7  drawing,   in-month, known amount — owner/accountant-only
--   R8  drawing,   in-month, UNKNOWN amount — owner/accountant-only
--   R9  drawing,   PREVIOUS-previous month (May) — must not enter month figures
--   R10 capex,     in-month, known amount — enters the non-drawing month total (regression pin for
--       the bug where the RPC wrongly filtered the month KPI to kind='operating' and silently
--       dropped capex); MUST NOT enter operating_count
--   R11 capex,     in-month, UNKNOWN amount — enters the non-drawing unknown-amount count
--   R12 operating, in-month, 'historical_reversed', known amount — EXCLUDED from the non-drawing total
--   R13 operating, in-month, 'cancelled', UNKNOWN amount — counted (not null-total-only) in
--       month_count, but EXCLUDED from month_non_drawing_unknown_count (a void row's missing amount
--       is not a real unknown)
--   R14 operating, in-month, 'historical_reversed', UNKNOWN amount — EXCLUDED from the unknown count
--   R15 operating, in-month, 'historical_treasury', known amount — INCLUDED in the non-drawing total
--       (historical_treasury is real settled cash, unlike cancelled/historical_reversed)
--   R16 operating, in-month, 'historical_treasury', UNKNOWN amount — INCLUDED in the unknown count
--   R17 drawing,   in-month, 'cancelled', known amount — EXCLUDED from the drawing total
--   R18 drawing,   in-month, 'historical_reversed', known amount — EXCLUDED from the drawing total
--   R19 drawing,   in-month, 'cancelled', UNKNOWN amount — EXCLUDED from the drawing unknown count
--   R20 drawing,   in-month, 'historical_reversed', UNKNOWN amount — EXCLUDED from the drawing unknown count
--   R21 drawing,   in-month, 'historical_treasury', known amount — INCLUDED in the drawing total
--   R22 drawing,   in-month, 'historical_treasury', UNKNOWN amount — INCLUDED in the drawing unknown count
insert into public.expenses(org_id, date, category, total, kind, account_id, cost_center_id, payment_status)
values
  (:'org', '2026-07-05', 'عادي', 100, 'operating', current_setting('test.account')::uuid, current_setting('test.cc')::uuid, 'paid_from_custody'),
  (:'org', '2026-07-10', 'مبلغ مجهول', null, 'operating', current_setting('test.account')::uuid, current_setting('test.cc')::uuid, 'paid_from_custody'),
  (:'org', '2026-06-15', 'شهر سابق', 500, 'operating', current_setting('test.account')::uuid, current_setting('test.cc')::uuid, 'paid_from_custody'),
  (:'org', '2026-07-20', 'غير موجّه وبدون حساب', 50, 'operating', null, current_setting('test.cc')::uuid, null),
  (:'org', '2026-07-22', 'بدون مركز تكلفة', 30, 'operating', current_setting('test.account')::uuid, null, 'post_paid_unpaid'),
  (:'org', '2026-07-25', 'ملغى', 999, 'operating', current_setting('test.account')::uuid, current_setting('test.cc')::uuid, 'cancelled'),
  (:'org', '2026-07-26', 'مسحوبات', 200, 'drawing', current_setting('test.drawing_account')::uuid, current_setting('test.cc')::uuid, 'paid_by_owner'),
  (:'org', '2026-07-27', 'مسحوبات مبلغ مجهول', null, 'drawing', current_setting('test.drawing_account')::uuid, current_setting('test.cc')::uuid, 'paid_by_owner'),
  (:'org', '2026-05-01', 'مسحوبات شهر سابق', 1000, 'drawing', current_setting('test.drawing_account')::uuid, current_setting('test.cc')::uuid, 'paid_by_owner'),
  (:'org', '2026-07-28', 'رأسمالي', 400, 'capex', current_setting('test.capex_account')::uuid, current_setting('test.cc')::uuid, 'paid_from_custody'),
  (:'org', '2026-07-29', 'رأسمالي مبلغ مجهول', null, 'capex', current_setting('test.capex_account')::uuid, current_setting('test.cc')::uuid, 'paid_from_custody'),
  (:'org', '2026-07-24', 'عادي معكوس', 777, 'operating', current_setting('test.account')::uuid, current_setting('test.cc')::uuid, 'historical_reversed'),
  (:'org', '2026-07-23', 'عادي ملغى مبلغ مجهول', null, 'operating', current_setting('test.account')::uuid, current_setting('test.cc')::uuid, 'cancelled'),
  (:'org', '2026-07-21', 'عادي معكوس مبلغ مجهول', null, 'operating', current_setting('test.account')::uuid, current_setting('test.cc')::uuid, 'historical_reversed'),
  (:'org', '2026-07-19', 'عادي تاريخي مثبت', 333, 'operating', current_setting('test.account')::uuid, current_setting('test.cc')::uuid, 'historical_treasury'),
  (:'org', '2026-07-18', 'عادي تاريخي مثبت مبلغ مجهول', null, 'operating', current_setting('test.account')::uuid, current_setting('test.cc')::uuid, 'historical_treasury'),
  (:'org', '2026-07-17', 'مسحوبات ملغاة', 888, 'drawing', current_setting('test.drawing_account')::uuid, current_setting('test.cc')::uuid, 'cancelled'),
  (:'org', '2026-07-16', 'مسحوبات معكوسة', 666, 'drawing', current_setting('test.drawing_account')::uuid, current_setting('test.cc')::uuid, 'historical_reversed'),
  (:'org', '2026-07-15', 'مسحوبات ملغاة مبلغ مجهول', null, 'drawing', current_setting('test.drawing_account')::uuid, current_setting('test.cc')::uuid, 'cancelled'),
  (:'org', '2026-07-14', 'مسحوبات معكوسة مبلغ مجهول', null, 'drawing', current_setting('test.drawing_account')::uuid, current_setting('test.cc')::uuid, 'historical_reversed'),
  (:'org', '2026-07-13', 'مسحوبات تاريخي مثبت', 444, 'drawing', current_setting('test.drawing_account')::uuid, current_setting('test.cc')::uuid, 'historical_treasury'),
  (:'org', '2026-07-12', 'مسحوبات تاريخي مثبت مبلغ مجهول', null, 'drawing', current_setting('test.drawing_account')::uuid, current_setting('test.cc')::uuid, 'historical_treasury');

select pg_temp.as_user(current_setting('test.owner'));

select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'expense_count')::int,
  22, 'owner sees the full register including drawings, capex, and every lifecycle status');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'month_count')::int,
  20, 'owner month count includes every in-month row regardless of payment_status');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'operating_count')::int,
  11, 'operating count is all-time, role-independent, unfiltered by lifecycle, and excludes capex/drawings');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'drawing_count')::int,
  9, 'owner sees the exact all-time drawing count, unfiltered by lifecycle');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'unrouted_count')::int,
  1, 'unrouted count matches the single null payment_status row');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'unclassified_count')::int,
  1, 'unclassified count matches the single null account_id row');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'uncentered_count')::int,
  1, 'uncentered count matches the single null cost_center_id row');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'month_non_drawing_total')::numeric,
  913::numeric, 'exact current-month non-drawing total = R1(100)+R4(50)+R5(30)+R10(400)+R15(333); INCLUDES capex and historical_treasury, EXCLUDES the cancelled (999) and historical_reversed (777) rows and both unknown-amount rows');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'month_non_drawing_unknown_count')::int,
  3, 'unknown-amount count = R2 + R11(capex) + R16(historical_treasury); the null-amount cancelled (R13) and historical_reversed (R14) rows are void, not a real unknown');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'month_drawing_total')::numeric,
  644::numeric, 'exact current-month drawing total = R7(200)+R21(444, historical_treasury); EXCLUDES the cancelled (888) and historical_reversed (666) drawing rows');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'month_drawing_unknown_count')::int,
  2, 'drawing unknown-amount count = R8 + R22(historical_treasury); the null-amount cancelled (R19) and historical_reversed (R20) drawing rows are void, not a real unknown');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'expense_count')::int,
  22, 'accountant has the same full-register visibility as owner');
reset role;

select pg_temp.as_user(current_setting('test.farm_manager'));
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'expense_count')::int,
  13, 'farm_manager visibility excludes all 9 drawing rows but includes capex and every lifecycle status');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'month_count')::int,
  12, 'farm_manager month count also excludes the 8 in-month drawing rows but includes capex');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'unclassified_count')::int,
  1, 'farm_manager still sees the non-confidential unclassified count');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'month_non_drawing_total')::numeric,
  913::numeric, 'farm_manager sees the same non-drawing total as owner — it is not confidential like the drawing figures');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'month_non_drawing_unknown_count')::int,
  3, 'farm_manager sees the same non-drawing unknown-amount count as owner');
select ok(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->'drawing_count') = 'null'::jsonb,
  'farm_manager never receives a drawing count — null, not a fabricated zero');
select ok(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->'month_drawing_total') = 'null'::jsonb,
  'farm_manager never receives a drawing amount');
select ok(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->'month_drawing_unknown_count') = 'null'::jsonb,
  'farm_manager never receives a drawing unknown-count');
reset role;

select pg_temp.as_user(current_setting('test.storekeeper'));
select throws_ok(
  format('select public.fn_expense_register_summary(%L, %L, %L)', :'org', '2026-07-01', '2026-08-01'),
  '42501', null, 'storekeeper is outside the expenses-page role set and is rejected');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(
  format('select public.fn_expense_register_summary(%L, %L, %L)', :'org_b', '2026-07-01', '2026-08-01'),
  '42501', null, 'cross-org request is rejected');
select throws_ok(
  'select public.fn_expense_register_summary(null, ''2026-07-01''::date, ''2026-08-01''::date)',
  '23502', null, 'null org is rejected');
select throws_ok(
  format('select public.fn_expense_register_summary(%L, %L, %L)', :'org', '2026-08-01', '2026-07-01'),
  '22023', null, 'month end before month start is rejected');
reset role;

select ok(not has_function_privilege('anon',
  'public.fn_expense_register_summary(uuid, date, date)', 'EXECUTE'), 'anon cannot execute summary');
select ok(has_function_privilege('authenticated',
  'public.fn_expense_register_summary(uuid, date, date)', 'EXECUTE'), 'authenticated can execute gated summary');

select * from finish();
rollback;
