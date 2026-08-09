-- Signed payment-request totals must cross PostgREST as strings so JavaScript cannot round numeric values.
begin;
select plan(26);

\set org '00000000-0000-0000-0000-000000000001'
\set orgB '00000000-0000-0000-0000-000000000002'
\set req '20900000-0000-0000-0000-000000000001'
\set expense '20900000-0000-0000-0000-000000000002'
\set acct '20900000-0000-0000-0000-000000000003'
\set acctB '20900000-0000-0000-0000-000000000004'
\set badAcctReq '20900000-0000-0000-0000-000000000010'
\set badLineReq '20900000-0000-0000-0000-000000000011'
\set expenseB '20900000-0000-0000-0000-000000000012'
\set badFundingReq '20900000-0000-0000-0000-000000000013'

insert into public.organization (id, name) values (:'orgB', 'مؤسسة اختبار العزل');

insert into public.custody_accounts (id, org_id, holder_label, target_float) values
  (:'acct', :'org', 'عهدة اختبار الدقة', 0),
  (:'acctB', :'orgB', 'عهدة مؤسسة أخرى', 0);

insert into public.expenses (
  id, org_id, date, category, description, total, status, payment_status, kind, account_id
) values (
  :'expense', :'org', current_date, 'اختبار الدقة', 'مبلغ يتجاوز دقة JavaScript',
  9007199254740993.123456789012345678, 'approved', 'post_paid_unpaid', 'operating',
  (select id from public.accounts where org_id = :'org' and code = '5110')
);

insert into public.payment_requests (
  id, org_id, request_no, status, custody_account_id,
  approved_post_paid_total, approved_custody_top_up, approved_net_request
)
values (
  :'req', :'org',
  (select coalesce(max(request_no), 0) + 209 from public.payment_requests where org_id = :'org'),
  'approved_final', :'acct',
  9007199254740993.123456789012345678, 0, 9007199254740993.123456789012345678
);

insert into public.payment_request_lines (org_id, payment_request_id, expense_id)
values (:'org', :'req', :'expense');

insert into public.payment_requests (id, org_id, request_no, status, custody_account_id)
values (
  :'badAcctReq', :'org',
  (select coalesce(max(request_no), 0) + 209 from public.payment_requests where org_id = :'org'),
  'draft', :'acctB'
);

insert into public.expenses (
  id, org_id, date, category, description, total, status, payment_status, kind, account_id
) values (
  :'expenseB', :'orgB', current_date, 'اختبار العزل', 'مصروف مؤسسة أخرى', 1,
  'approved', 'post_paid_unpaid', 'operating',
  (select id from public.accounts where org_id = :'orgB' and code = '5110')
);
insert into public.payment_requests (id, org_id, request_no, status)
values (
  :'badLineReq', :'org',
  (select coalesce(max(request_no), 0) + 209 from public.payment_requests where org_id = :'org'),
  'draft'
);
insert into public.payment_request_lines (org_id, payment_request_id, expense_id)
values (:'org', :'badLineReq', :'expenseB');

insert into public.payment_requests (id, org_id, request_no, status)
values (
  :'badFundingReq', :'org',
  (select coalesce(max(request_no), 0) + 209 from public.payment_requests where org_id = :'org'),
  'approved_final'
);
insert into public.payment_request_fundings (
  org_id, payment_request_id, custody_account_id, amount
) values (:'orgB', :'badFundingReq', :'acctB', 1);

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select user_id::text from public.organization_member where org_id = :'org' and role = 'owner' limit 1),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select is(
  jsonb_typeof(public.fn_payment_request_totals(:'req') -> key),
  'string',
  format('totals: %s crosses the API boundary as exact text', key)
)
from unnest(array[
  'operating_unpaid',
  'capex_unpaid',
  'drawing_unpaid',
  'post_paid_unpaid',
  'target_float',
  'current_custody',
  'custody_top_up',
  'gross_request',
  'approved_post_paid_total',
  'approved_custody_top_up',
  'approved_net_request',
  'owner_funding_received',
  'request_cash_out',
  'remaining_to_fund',
  'net_request'
]) as keys(key);

select is(
  public.fn_payment_request_totals(:'req') ->> 'operating_unpaid',
  '9007199254740993.123456789012345678',
  'operating total preserves every recorded digit beyond JavaScript safe integer precision'
);
select is(
  public.fn_payment_request_totals(:'req') ->> 'gross_request',
  '9007199254740993.123456789012345678',
  'gross request preserves every recorded digit'
);
select is(
  public.fn_payment_request_totals(:'req') ->> 'remaining_to_fund',
  '9007199254740993.123456789012345678',
  'remaining funding preserves every recorded digit'
);

select lives_ok(
  format(
    $$ select public.fn_record_payment_request_funding(%L, %L, %L) $$,
    :'req', :'acct', '0.123456789012345678'
  ),
  'high-precision funding passes through the numeric RPC write path'
);
select is(
  (select amount from public.payment_request_fundings where payment_request_id = :'req'),
  0.123456789012345678::numeric,
  'funding row preserves every submitted digit'
);
select is(
  (select amount_in from public.custody_movements where payment_request_id = :'req'),
  0.123456789012345678::numeric,
  'custody movement preserves every submitted digit'
);
select is(
  (
    select max(greatest(debit, credit))
    from public.journal_lines
    where journal_entry_id = (
      select journal_entry_id from public.payment_request_fundings where payment_request_id = :'req'
    )
  ),
  0.123456789012345678::numeric,
  'journal mirrors preserve every submitted digit'
);
select is(
  (public.fn_payment_request_totals(:'req') ->> 'remaining_to_fund')::numeric,
  9007199254740993::numeric,
  'remaining total subtracts high-precision funding exactly'
);

select throws_ok(
  format($$ select public.fn_payment_request_totals(%L) $$, :'badAcctReq'),
  '42501', null,
  'totals fail closed on a cross-org request custody account'
);
select throws_ok(
  format($$ select public.fn_payment_request_totals(%L) $$, :'badLineReq'),
  '42501', null,
  'totals fail closed on a cross-org expense line'
);
select throws_ok(
  format($$ select public.fn_payment_request_totals(%L) $$, :'badFundingReq'),
  '42501', null,
  'totals fail closed on a cross-org funding row'
);

reset role;
select * from finish();
rollback;
