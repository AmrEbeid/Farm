-- 120 — SPEC-0018-EXT slices 3/4: custody report RPCs.
-- Verifies the accountant-facing reports for custody ledger, custody-paid expenses, unpaid obligations,
-- and owner funding/replenishment are finance.read-gated and derive figures from existing records.
begin;
select plan(28);

\set org '00000000-0000-0000-0000-000000000001'
\set managerAcct 'c1200000-0000-0000-0000-0000000000f0'
\set accountantAcct 'c1200000-0000-0000-0000-0000000000a0'
\set cashExp 'c1200000-0000-0000-0000-0000000000e1'
\set unpaidOld 'c1200000-0000-0000-0000-0000000000e2'
\set unpaidNew 'c1200000-0000-0000-0000-0000000000e3'
\set requestId 'c1200000-0000-0000-0000-0000000000b1'
\set fundingMovement 'c1200000-0000-0000-0000-0000000000c1'
\set fundingId 'c1200000-0000-0000-0000-0000000000f1'
\set transferGroup 'c1200000-0000-0000-0000-0000000000aa'

insert into public.custody_accounts (id, org_id, holder_label, target_float)
  values
    (:'managerAcct', :'org', 'مدير المزرعة', 30000),
    (:'accountantAcct', :'org', 'المحاسب', 0);

insert into public.expenses (id, org_id, date, category, description, total, status, payment_status, kind, account_id)
  values
    (:'cashExp', :'org', date '2026-07-05', 'وقود', 'مصروف نقدي من عهدة المدير', 1500, 'approved', 'paid_from_custody', 'operating',
      (select id from public.accounts where org_id = :'org' and code = '5110')),
    (:'unpaidOld', :'org', date '2026-06-01', 'عمالة', 'مصروف آجل قديم', 900, 'approved', 'post_paid_unpaid', 'operating',
      (select id from public.accounts where org_id = :'org' and code = '5440')),
    (:'unpaidNew', :'org', date '2026-07-10', 'مسحوبات', 'مسحوبات مالك آجلة', 400, 'approved', 'post_paid_unpaid', 'drawing',
      (select id from public.accounts where org_id = :'org' and code = '3100'));

insert into public.payment_requests (
  id, org_id, request_no, period_start, period_end, status, custody_account_id,
  approved_post_paid_total, approved_custody_top_up, approved_net_request
) values (
  :'requestId', :'org',
  (select coalesce(max(request_no), 0) + 1200 from public.payment_requests where org_id = :'org'),
  date '2026-07-01', date '2026-07-31', 'paid', :'accountantAcct',
  7000, 0, 7000
);

insert into public.custody_movements (
  id, org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out,
  expense_id, payment_request_id, transfer_group_id, note
) values
  (gen_random_uuid(), :'org', :'managerAcct', date '2026-06-20', 'استلام عهدة من المالك', 30000, 0, null, null, null, 'رصيد افتتاحي'),
  (gen_random_uuid(), :'org', :'managerAcct', date '2026-07-05', 'صرف نقدي', 0, 1500, :'cashExp', null, null, 'مصروف نقدي'),
  (gen_random_uuid(), :'org', :'managerAcct', date '2026-07-08', 'تحويل عهدة', 0, 5000, null, null, :'transferGroup', 'تسليم للمحاسب'),
  (gen_random_uuid(), :'org', :'accountantAcct', date '2026-07-08', 'تحويل عهدة', 5000, 0, null, null, :'transferGroup', 'استلام من المدير'),
  (:'fundingMovement', :'org', :'accountantAcct', date '2026-07-15', 'تمويل طلب صرف من المالك', 7000, 0, null, :'requestId', null, 'تمويل المالك');

insert into public.payment_request_fundings (
  id, org_id, payment_request_id, custody_account_id, custody_movement_id, occurred_at, amount, note
) values (
  :'fundingId', :'org', :'requestId', :'accountantAcct', :'fundingMovement', date '2026-07-15', 7000, 'تمويل طلب يوليو'
);

select set_config('test.org', :'org', false);
select set_config('test.manager_acct', :'managerAcct', false);
select set_config('test.accountant_acct', :'accountantAcct', false);
select set_config('test.cash_exp', :'cashExp', false);
select set_config('test.unpaid_old', :'unpaidOld', false);
select set_config('test.request_id', :'requestId', false);
select set_config('test.accountant', (select user_id::text from public.organization_member where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member where org_id = :'org' and role = 'supervisor' limit 1), false);

select ok(not has_function_privilege('anon', 'public.fn_custody_ledger_report(uuid, date, date)', 'EXECUTE'),
  'anon cannot EXECUTE fn_custody_ledger_report');
select ok(not has_function_privilege('anon', 'public.fn_custody_cash_expense_report(uuid, date, date)', 'EXECUTE'),
  'anon cannot EXECUTE fn_custody_cash_expense_report');
select ok(not has_function_privilege('anon', 'public.fn_unpaid_obligations_report(uuid, date)', 'EXECUTE'),
  'anon cannot EXECUTE fn_unpaid_obligations_report');
select ok(not has_function_privilege('anon', 'public.fn_owner_funding_report(uuid, date, date)', 'EXECUTE'),
  'anon cannot EXECUTE fn_owner_funding_report');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$ select public.fn_custody_ledger_report(%L, date '2026-07-01', date '2026-07-31') $$, current_setting('test.org')),
  'accountant can call custody ledger report');
select is(
  (select (holder->>'opening_balance')::numeric
     from jsonb_array_elements(public.fn_custody_ledger_report(:'org', date '2026-07-01', date '2026-07-31')->'holders') holder
    where holder->>'custody_account_id' = :'managerAcct'),
  30000::numeric,
  'manager report opening balance is the pre-period custody float');
select is(
  (select (holder->>'amount_out')::numeric
     from jsonb_array_elements(public.fn_custody_ledger_report(:'org', date '2026-07-01', date '2026-07-31')->'holders') holder
    where holder->>'custody_account_id' = :'managerAcct'),
  6500::numeric,
  'manager period outflow includes cash expense plus transfer to accountant');
select is(
  (select (holder->>'closing_balance')::numeric
     from jsonb_array_elements(public.fn_custody_ledger_report(:'org', date '2026-07-01', date '2026-07-31')->'holders') holder
    where holder->>'custody_account_id' = :'accountantAcct'),
  12000::numeric,
  'accountant closing balance includes transferred custody plus owner funding');
select is(
  jsonb_array_length(public.fn_custody_ledger_report(:'org', date '2026-07-01', date '2026-07-31')->'movements'),
  4,
  'ledger report lists the four period custody movements');

select lives_ok(format($$ select public.fn_custody_cash_expense_report(%L, date '2026-07-01', date '2026-07-31') $$, current_setting('test.org')),
  'accountant can call custody cash-expense report');
select is((public.fn_custody_cash_expense_report(:'org', date '2026-07-01', date '2026-07-31')->>'total_amount')::numeric, 1500::numeric,
  'cash-expense report totals custody-paid expenses in the period');
select is(
  (select row->>'holder_label'
     from jsonb_array_elements(public.fn_custody_cash_expense_report(:'org', date '2026-07-01', date '2026-07-31')->'rows') row
    where row->>'expense_id' = :'cashExp'),
  'مدير المزرعة',
  'cash-expense report splits expense by custody holder');
select is((public.fn_custody_cash_expense_report(:'org', date '2026-07-01', date '2026-07-31')->>'missing_movement_count')::int, 0,
  'cash-expense report exposes missing movement count and it is zero for clean data');

select lives_ok(format($$ select public.fn_unpaid_obligations_report(%L, date '2026-07-31') $$, current_setting('test.org')),
  'accountant can call unpaid-obligations report');
select is((public.fn_unpaid_obligations_report(:'org', date '2026-07-31')->>'total_amount')::numeric, 1300::numeric,
  'unpaid-obligations report totals only post_paid_unpaid expenses');
select is((public.fn_unpaid_obligations_report(:'org', date '2026-07-31')->>'over_30_amount')::numeric, 900::numeric,
  'unpaid-obligations report separates 30+ day obligations');
select is(
  (select row->>'aging_bucket'
     from jsonb_array_elements(public.fn_unpaid_obligations_report(:'org', date '2026-07-31')->'rows') row
    where row->>'expense_id' = :'unpaidOld'),
  '60+',
  'old unpaid obligation is aged into the 60+ bucket');

select lives_ok(format($$ select public.fn_owner_funding_report(%L, date '2026-07-01', date '2026-07-31') $$, current_setting('test.org')),
  'accountant can call owner funding report');
select is((public.fn_owner_funding_report(:'org', date '2026-07-01', date '2026-07-31')->>'total_funding')::numeric, 7000::numeric,
  'owner funding report totals owner funds received into custody');
select is(
  (select (row->>'remaining_to_fund')::numeric
     from jsonb_array_elements(public.fn_owner_funding_report(:'org', date '2026-07-01', date '2026-07-31')->'rows') row
    where row->>'payment_request_id' = :'requestId'),
  0::numeric,
  'owner funding report carries current remaining-to-fund from request totals');
select is(
  (select row->>'holder_label'
     from jsonb_array_elements(public.fn_owner_funding_report(:'org', date '2026-07-01', date '2026-07-31')->'rows') row
    where row->>'payment_request_id' = :'requestId'),
  'المحاسب',
  'owner funding report shows the custody account that received the funds');
reset role;

select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$ select public.fn_custody_ledger_report(%L, date '2026-07-01', date '2026-07-31') $$, current_setting('test.org')),
  '42501', null, 'supervisor cannot call custody ledger report');
select throws_ok(format($$ select public.fn_custody_cash_expense_report(%L, date '2026-07-01', date '2026-07-31') $$, current_setting('test.org')),
  '42501', null, 'supervisor cannot call cash-expense report');
select throws_ok(format($$ select public.fn_unpaid_obligations_report(%L, date '2026-07-31') $$, current_setting('test.org')),
  '42501', null, 'supervisor cannot call unpaid-obligations report');
select throws_ok(format($$ select public.fn_owner_funding_report(%L, date '2026-07-01', date '2026-07-31') $$, current_setting('test.org')),
  '42501', null, 'supervisor cannot call owner funding report');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select throws_ok(format($$ select public.fn_custody_ledger_report(%L, date '2026-08-01', date '2026-07-31') $$, current_setting('test.org')),
  '22023', null, 'ledger report rejects an inverted period');
select throws_ok(format($$ select public.fn_custody_cash_expense_report(%L, date '2026-08-01', date '2026-07-31') $$, current_setting('test.org')),
  '22023', null, 'cash-expense report rejects an inverted period');
select throws_ok(format($$ select public.fn_owner_funding_report(%L, date '2026-08-01', date '2026-07-31') $$, current_setting('test.org')),
  '22023', null, 'owner funding report rejects an inverted period');
reset role;

select * from finish();
rollback;
