-- 112 — cash-method accounting for custody payment requests.
-- Verifies owner funding is recorded as custody before payout, confirmed payouts post from a selected custody
-- source into the accounting ledger, and non-finance users cannot read the accounting surface.
begin;
select plan(39);

\set org '00000000-0000-0000-0000-000000000001'
\set acct 'c1120000-0000-0000-0000-0000000000c0'
\set zeroAcct 'c1120000-0000-0000-0000-0000000000d0'
\set expA 'c1120000-0000-0000-0000-0000000000a1'
\set expB 'c1120000-0000-0000-0000-0000000000b2'
\set zeroExp 'c1120000-0000-0000-0000-0000000000d1'

insert into public.custody_accounts (id, org_id, holder_label, target_float)
  values
    (:'acct', :'org', 'مدير المزرعة', 30000),
    (:'zeroAcct', :'org', 'حساب تسوية بلا تغذية', 0);
insert into public.expenses (id, org_id, date, category, description, total, status, payment_status, kind, account_id)
  values
    (:'expA', :'org', current_date, 'تسميد', 'مصروف آجل أ', 5000, 'approved', 'post_paid_unpaid', 'operating',
      (select id from public.accounts where org_id = :'org' and code = '5110')),
    (:'expB', :'org', current_date, 'صيانة', 'مصروف آجل ب', 2000, 'approved', 'post_paid_unpaid', 'operating',
      (select id from public.accounts where org_id = :'org' and code = '5440')),
    (:'zeroExp', :'org', current_date, 'صيانة', 'مصروف مدفوع بلا تغذية', 100, 'approved', 'post_paid_unpaid', 'operating',
      (select id from public.accounts where org_id = :'org' and code = '5440'));

select set_config('test.org', :'org', false);
select set_config('test.acct', :'acct', false);
select set_config('test.zero_acct', :'zeroAcct', false);
select set_config('test.expA', :'expA', false);
select set_config('test.expB', :'expB', false);
select set_config('test.zero_exp', :'zeroExp', false);
select set_config('test.accountant', (select user_id::text from public.organization_member where org_id=:'org' and role='accountant' limit 1), false);
select set_config('test.owner', (select user_id::text from public.organization_member where org_id=:'org' and role='owner' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member where org_id=:'org' and role='supervisor' limit 1), false);

select ok(not has_function_privilege('anon','public.fn_record_payment_request_funding(uuid, uuid, numeric, date, text)','EXECUTE'),
  'anon cannot EXECUTE fn_record_payment_request_funding');
select ok(not has_function_privilege('anon','public.fn_confirm_request_expense_paid(uuid, uuid, uuid, date, text, text)','EXECUTE'),
  'anon cannot EXECUTE fn_confirm_request_expense_paid');
select ok(not has_function_privilege('anon','public.fn_accounting_trial_balance(uuid)','EXECUTE'),
  'anon cannot EXECUTE fn_accounting_trial_balance');
select ok(not has_table_privilege('authenticated', 'public.journal_entries', 'INSERT'),
  'authenticated has no direct INSERT privilege on journal_entries');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$ select public.fn_record_custody_movement(%L,'استلام عهدة من المالك',30000,0) $$, current_setting('test.acct')),
  'accountant records the standing 30,000 custody float');
select is((select count(*)::int from public.journal_entries where source_type = 'custody_owner_funding'), 1,
  'standing owner custody float posts one owner-funding journal entry');
select lives_ok(format($$ select set_config('test.req', public.fn_create_payment_request(%L, null, null, %L, 'طلب تسوية نقدية')::text, false) $$, current_setting('test.org'), current_setting('test.acct')),
  'accountant creates payment request');
select lives_ok(format($$ select public.fn_add_expense_to_request(%L, %L) $$, current_setting('test.req'), current_setting('test.expA')),
  'accountant adds first unpaid expense');
select lives_ok(format($$ select public.fn_add_expense_to_request(%L, %L) $$, current_setting('test.req'), current_setting('test.expB')),
  'accountant adds second unpaid expense');
select lives_ok(format($$ select public.fn_submit_payment_request(%L) $$, current_setting('test.req')),
  'accountant submits request');
select throws_ok(format($$ select public.fn_record_payment_request_funding(%L, %L, 7000) $$, current_setting('test.req'), current_setting('test.acct')),
  '22023', null, 'cannot record owner funding before final approval');
select lives_ok(format($$ select public.fn_approve_request_operational(%L) $$, current_setting('test.req')),
  'accountant operationally approves request');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(format($$ select public.fn_approve_request_final(%L) $$, current_setting('test.req')),
  'owner finally approves and snapshots request amount');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select is((public.fn_payment_request_totals(current_setting('test.req')::uuid) ->> 'net_request')::numeric, 7000::numeric,
  'before funding, net_request is the two unpaid expenses with no top-up');
select lives_ok(format($$ select set_config('test.funding', public.fn_record_payment_request_funding(%L, %L, 7000)::text, false) $$, current_setting('test.req'), current_setting('test.acct')),
  'accountant records owner funding as custody first');
select is((select status from public.payment_requests where id = current_setting('test.req')::uuid), 'paid',
  'request becomes paid after full owner funding is recorded');
select is((select coalesce(sum(amount_in),0) from public.custody_movements where payment_request_id = current_setting('test.req')::uuid), 7000::numeric,
  'owner funding created a custody-in movement linked to the request');
select is((select count(*)::int from public.payment_request_fundings where payment_request_id = current_setting('test.req')::uuid), 1,
  'one funding row links request, custody movement, and journal');
select is((select count(*)::int from public.journal_entries where source_type = 'payment_request_funding'), 1,
  'owner funding posted one journal entry');
select throws_ok(format($$ select public.fn_record_payment_request_funding(%L, %L, 1) $$, current_setting('test.req'), current_setting('test.acct')),
  '22023', null, 'reject over-funding after the approved amount is fully received');

select lives_ok(format($$ select public.fn_confirm_request_expense_paid(%L, %L, %L, current_date, 'المحاسب', 'سداد من العهدة') $$, current_setting('test.req'), current_setting('test.expA'), current_setting('test.acct')),
  'accountant confirms first expense paid from selected custody source');
select is((select payment_status from public.expenses where id = current_setting('test.expA')::uuid), 'paid_from_custody',
  'confirmed expense is now paid_from_custody');
select is((select count(*)::int from public.journal_entries where source_type = 'expense_payment'), 1,
  'confirmed payout posted an expense-payment journal entry');
select is((select (row->>'net')::numeric from jsonb_array_elements(public.fn_accounting_trial_balance(:'org')) row where row->>'code' = '1000'), 32000::numeric,
  'trial balance custody cash net is 32,000 after standing float, request funding, and first payout');
select throws_ok(format($$ select public.fn_close_payment_request(%L) $$, current_setting('test.req')),
  '22023', null, 'cannot close while one request line is still unpaid');
select lives_ok(format($$ select public.fn_confirm_request_expense_paid(%L, %L, %L, current_date, 'المحاسب', 'سداد من العهدة') $$, current_setting('test.req'), current_setting('test.expB'), current_setting('test.acct')),
  'accountant confirms second expense paid from selected custody source');
select lives_ok(format($$ select public.fn_close_payment_request(%L) $$, current_setting('test.req')),
  'close succeeds after all lines are paid');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$ select public.fn_record_custody_movement(%L,'استلام عهدة من المالك',100,0) $$, current_setting('test.zero_acct')),
  'zero-funding setup records exactly enough custody cash');
select lives_ok(format($$ select public.fn_set_expense_payment_status(%L,'paid_from_custody',%L,'المحاسب') $$, current_setting('test.zero_exp'), current_setting('test.zero_acct')),
  'zero-funding setup pays the expense from custody');
select lives_ok(format($$ select set_config('test.zero_req', public.fn_create_payment_request(%L, null, null, %L, 'طلب بلا تمويل إضافي')::text, false) $$, current_setting('test.org'), current_setting('test.zero_acct')),
  'accountant creates zero-funding replenishment request');
select lives_ok(format($$ select public.fn_add_expense_to_request(%L, %L) $$, current_setting('test.zero_req'), current_setting('test.zero_exp')),
  'accountant adds the already-paid expense to the zero-funding request');
select is((public.fn_payment_request_totals(current_setting('test.zero_req')::uuid) ->> 'gross_request')::numeric, 0::numeric,
  'zero-funding request has no unpaid lines and no top-up');
select lives_ok(format($$ select public.fn_submit_payment_request(%L) $$, current_setting('test.zero_req')),
  'accountant submits zero-funding request');
select lives_ok(format($$ select public.fn_approve_request_operational(%L) $$, current_setting('test.zero_req')),
  'accountant operationally approves zero-funding request');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(format($$ select public.fn_approve_request_final(%L) $$, current_setting('test.zero_req')),
  'owner final approval auto-funds a zero-funding request');
select is((select status from public.payment_requests where id = current_setting('test.zero_req')::uuid), 'paid',
  'zero-funding request moves directly to paid');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$ select public.fn_close_payment_request(%L) $$, current_setting('test.zero_req')),
  'zero-funding request can be closed after final approval');
reset role;

select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$ select public.fn_accounting_trial_balance(%L) $$, current_setting('test.org')),
  '42501', null, 'supervisor cannot call accounting trial balance');
select is((select count(*)::int from public.journal_entries), 0,
  'supervisor cannot read journal_entries rows');
reset role;

select * from finish();
rollback;
