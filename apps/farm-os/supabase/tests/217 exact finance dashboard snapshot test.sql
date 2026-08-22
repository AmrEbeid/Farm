-- Exact, atomic, role-aware finance-dashboard snapshot.
begin;
select no_plan();

\set org '21700000-0000-0000-0000-0000000000a0'
\set org_b '21700000-0000-0000-0000-0000000000b0'
\set supplier '21700000-0000-0000-0000-000000000001'
\set supplier_b '21700000-0000-0000-0000-000000000002'
\set custody '21700000-0000-0000-0000-000000000003'
\set custody_b '21700000-0000-0000-0000-000000000004'

select set_config('test.today', ((pg_catalog.now() at time zone 'Africa/Cairo')::date)::text, false);
select set_config('test.month_start', date_trunc('month', current_setting('test.today')::date)::date::text, false);
select set_config('test.month_end', (date_trunc('month', current_setting('test.today')::date) + interval '1 month')::date::text, false);
select set_config('test.owner', (select user_id::text from public.organization_member where role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member where role = 'accountant' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member where role = 'supervisor' limit 1), false);
select set_config('test.denied', (select user_id::text from public.organization_member where role = 'storekeeper' limit 1), false);

insert into public.organization(id, name) values
  (:'org', 'Exact finance dashboard org'),
  (:'org_b', 'Exact finance dashboard foreign org');
insert into public.organization_member(org_id, user_id, role) values
  (:'org', current_setting('test.owner')::uuid, 'owner'),
  (:'org', current_setting('test.accountant')::uuid, 'accountant'),
  (:'org', current_setting('test.manager')::uuid, 'farm_manager'),
  (:'org', current_setting('test.denied')::uuid, 'storekeeper');

insert into public.data_authority_status(
  org_id, domain, status, source_label, record_count, notes, verified_at, verified_by
) values (
  :'org', 'budgets', 'verified', 'Dashboard fixture', 9, 'Exact test evidence', pg_catalog.now(),
  current_setting('test.owner')::uuid
);

insert into public.suppliers(id, org_id, name) values
  (:'supplier', :'org', 'مورد اللوحة'),
  (:'supplier_b', :'org_b', 'مورد أجنبي');

insert into public.budgets(id, org_id, name, category, approved, committed, actual)
select
  ('21700000-0000-0000-0000-' || lpad((100 + i)::text, 12, '0'))::uuid,
  :'org', 'موازنة ' || i, case when i <= 5 then 'تشغيل' else 'حصاد' end,
  case when i = 1 then 9007199254740993.123456789::numeric else 10::numeric end,
  case when i = 1 then 0.02::numeric else 1::numeric end,
  case when i = 1 then 0.01::numeric else 2::numeric end
from generate_series(1, 9) i;

insert into public.expenses(
  id, org_id, date, category, description, supplier_id, total, status, payment_status, kind, account_id
) values
  ('21700000-0000-0000-0000-000000000201', :'org', current_setting('test.today')::date,
   'تشغيل', 'مصروف دقيق', :'supplier', 9007199254740993.123456789, 'approved', 'post_paid_unpaid', 'operating', null),
  ('21700000-0000-0000-0000-000000000202', :'org', current_setting('test.today')::date - 1,
   'مسحوبات', 'مبلغ غير معروف', null, null, 'approved', null, 'drawing', null),
  ('21700000-0000-0000-0000-000000000203', :'org', null,
   'رأسمالي', 'مصروف بلا تاريخ', null, 5, 'approved', null, 'capex', null);

insert into public.purchase_requests(id, org_id, code, status, needed_by, reason) values
  ('21700000-0000-0000-0000-000000000301', :'org', 'PR-217-A', 'submitted',
   current_setting('test.today')::date + 1, 'قريب'),
  ('21700000-0000-0000-0000-000000000302', :'org', 'PR-217-B', 'approved',
   current_setting('test.today')::date + 8, 'بعيد');

insert into public.custody_accounts(id, org_id, holder_label, holder_user_id, target_float) values
  (:'custody', :'org', 'المحاسب', current_setting('test.accountant')::uuid, 100),
  (:'custody_b', :'org_b', 'عهدة أجنبية', null, 0);
insert into public.custody_movements(
  id, org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out
) values (
  '21700000-0000-0000-0000-000000000401', :'org', :'custody', current_setting('test.today')::date,
  'تمويل', 90.01, 0
);

insert into public.payment_requests(
  id, org_id, request_no, period_start, period_end, status, custody_account_id,
  approved_post_paid_total, approved_custody_top_up, approved_net_request
) values
  ('21700000-0000-0000-0000-000000000501', :'org', 1,
   current_setting('test.month_start')::date, current_setting('test.today')::date,
   'approved_final', :'custody', 9007199254740993.123456789, 0, 9007199254740993.123456789),
  ('21700000-0000-0000-0000-000000000502', :'org', 2,
   current_setting('test.month_start')::date, current_setting('test.today')::date,
   'submitted', :'custody', null, null, null);

set local session_replication_role = replica;
insert into public.journal_entries(id, org_id, entry_date, source_type, source_id, description, status)
values (
  '21700000-0000-0000-0000-000000000601', :'org', current_setting('test.today')::date,
  'expense', '21700000-0000-0000-0000-000000000201', 'قيد حديث', 'posted'
);
set local session_replication_role = origin;

select ok(not has_function_privilege('public',
  'public.fn_finance_dashboard_snapshot(uuid,date,date,date,integer,integer)', 'EXECUTE'),
  'PUBLIC cannot execute the finance dashboard snapshot');
select ok(not has_function_privilege('anon',
  'public.fn_finance_dashboard_snapshot(uuid,date,date,date,integer,integer)', 'EXECUTE'),
  'anon cannot execute the finance dashboard snapshot');
select ok(has_function_privilege('authenticated',
  'public.fn_finance_dashboard_snapshot(uuid,date,date,date,integer,integer)', 'EXECUTE'),
  'authenticated reaches the role gate inside the snapshot');
select ok((select prosecdef from pg_proc
  where oid = 'public.fn_finance_dashboard_snapshot(uuid,date,date,date,integer,integer)'::regprocedure),
  'finance dashboard snapshot is security definer');
select is((select provolatile::text from pg_proc
  where oid = 'public.fn_finance_dashboard_snapshot(uuid,date,date,date,integer,integer)'::regprocedure),
  's', 'finance dashboard snapshot is stable');
select has_index('public', 'purchase_requests', 'finance_dashboard_pr_followup_idx',
  'purchase request follow-up has a matching partial index');
select has_index('public', 'payment_requests', 'finance_dashboard_payment_followup_idx',
  'payment request follow-up has a matching partial index');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.snapshot', public.fn_finance_dashboard_snapshot(
  :'org', current_setting('test.month_start')::date, current_setting('test.month_end')::date,
  current_setting('test.today')::date, 2, 1)::text, false);
select is(current_setting('test.snapshot')::jsonb->>'version', 'farm-os.finance-dashboard.v1',
  'snapshot version is pinned');
select is(current_setting('test.snapshot')::jsonb->>'org_id', :'org',
  'snapshot binds the requested organization');
select is(current_setting('test.snapshot')::jsonb->>'role', 'owner',
  'owner role is echoed from the membership');
select is((current_setting('test.snapshot')::jsonb->>'can_see_accounting')::boolean, true,
  'owner receives private accounting');
select is(current_setting('test.snapshot')::jsonb->>'budget_authority_status', 'verified',
  'budget authority is returned atomically');
select is((current_setting('test.snapshot')::jsonb->'budget_summary'->>'budget_count')::integer, 9,
  'budget count is exact across the full table');
select is(current_setting('test.snapshot')::jsonb->'budget_summary'->>'approved',
  '9007199254741073.123456789', 'full budget total remains exact decimal text');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'budgets'), 8,
  'budget pressure detail is explicitly bounded to eight rows');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'expenses'), 2,
  'expense detail obeys the requested row limit');
select is((current_setting('test.snapshot')::jsonb->'expense_sample_summary'->>'row_count')::integer, 2,
  'expense sample count matches its bounded rows');
select is(current_setting('test.snapshot')::jsonb->'expense_sample_summary'->>'drawing_total',
  '0', 'owner receives the exact known drawing subtotal');
select is((current_setting('test.snapshot')::jsonb->'expense_sample_summary'->>'drawing_unknown_count')::integer,
  1, 'unknown drawing amount is explicit');
select is((current_setting('test.snapshot')::jsonb->'purchase_request_sample_summary'->>'submitted_count')::integer,
  1, 'submitted count is tied to the displayed PR sample');
select is((current_setting('test.snapshot')::jsonb->'purchase_request_sample_summary'->>'near_due_count')::integer,
  1, 'near-due count uses the supplied Cairo as-of date');
select is((current_setting('test.snapshot')::jsonb->'private'->>'open_payment_count')::integer,
  2, 'open payment request count is exact');
select is((current_setting('test.snapshot')::jsonb->'private'->>'ready_payment_count')::integer,
  1, 'ready-to-pay count is exact');
select is(current_setting('test.snapshot')::jsonb->'private'->'payment_requests'->0->>'approved_net_request',
  null, 'newest submitted payment request keeps an honest null approved amount');
select is((select row->>'approved_net_request' from jsonb_array_elements(
  current_setting('test.snapshot')::jsonb->'private'->'payment_requests') row
  where row->>'id' = '21700000-0000-0000-0000-000000000501'),
  '9007199254740993.123456789', 'approved request money remains exact text');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'private'->'journal_entries'),
  1, 'journal detail obeys its independent limit');
select is((current_setting('test.snapshot')::jsonb->'private'->>'journal_count')::integer,
  1, 'journal count is exact independently from bounded detail');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$select public.fn_finance_dashboard_snapshot(
  %L, %L::date, %L::date, %L::date, 12, 8)$$, :'org', current_setting('test.month_start'),
  current_setting('test.month_end'), current_setting('test.today')),
  'accountant can read the private finance dashboard');
reset role;

update public.data_authority_status
   set status = 'blocked'
 where org_id = :'org' and domain = 'budgets';
select pg_temp.as_user(current_setting('test.manager'));
select set_config('test.manager_snapshot', public.fn_finance_dashboard_snapshot(
  :'org', current_setting('test.month_start')::date, current_setting('test.month_end')::date,
  current_setting('test.today')::date, 12, 8)::text, false);
select is(current_setting('test.manager_snapshot')::jsonb->>'role', 'farm_manager',
  'farm manager receives the shared dashboard role');
select is(jsonb_typeof(current_setting('test.manager_snapshot')::jsonb->'private'), 'null',
  'farm manager receives no private finance payload');
select is(jsonb_typeof(current_setting('test.manager_snapshot')::jsonb->'expense_sample_summary'->'drawing_total'), 'null',
  'farm manager receives no drawing subtotal');
select is((current_setting('test.manager_snapshot')::jsonb->'budget_summary'->>'budget_count')::integer,
  0, 'blocked budget authority withholds the budget count');
select is(current_setting('test.manager_snapshot')::jsonb->'budget_summary'->>'approved',
  '0', 'blocked budget authority withholds budget money');
select is(jsonb_array_length(current_setting('test.manager_snapshot')::jsonb->'budget_categories'),
  0, 'blocked budget authority withholds budget categories');
select is(jsonb_array_length(current_setting('test.manager_snapshot')::jsonb->'budgets'),
  0, 'blocked budget authority withholds bounded budget rows');
select is((select count(*)::integer from jsonb_array_elements(
  current_setting('test.manager_snapshot')::jsonb->'expenses') row where row->>'kind' = 'drawing'),
  0, 'farm manager expense sample contains no owner drawing');
reset role;

select pg_temp.as_user(current_setting('test.denied'));
select throws_ok(format($$select public.fn_finance_dashboard_snapshot(
  %L, %L::date, %L::date, %L::date, 12, 8)$$, :'org', current_setting('test.month_start'),
  current_setting('test.month_end'), current_setting('test.today')),
  '42501', null, 'non-dashboard role is rejected');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_finance_dashboard_snapshot(
  %L, %L::date, %L::date, %L::date, 12, 8)$$, :'org_b', current_setting('test.month_start'),
  current_setting('test.month_end'), current_setting('test.today')),
  '42501', null, 'cross-organization dashboard request is rejected');
select throws_ok(format($$select public.fn_finance_dashboard_snapshot(
  %L, %L::date, %L::date, %L::date, 51, 8)$$, :'org', current_setting('test.month_start'),
  current_setting('test.month_end'), current_setting('test.today')),
  '22023', null, 'detail limit above the contract is rejected');
select throws_ok(format($$select public.fn_finance_dashboard_snapshot(
  %L, %L::date, %L::date, %L::date, 12, 21)$$, :'org', current_setting('test.month_start'),
  current_setting('test.month_end'), current_setting('test.today')),
  '22023', null, 'journal limit above the contract is rejected');
select throws_ok(format($$select public.fn_finance_dashboard_snapshot(
  %L, %L::date, %L::date, %L::date, 12, 8)$$, :'org', current_setting('test.month_start'),
  current_setting('test.month_end'), (current_setting('test.today')::date - 1)::text),
  '22007', null, 'stale as-of date is rejected');
select throws_ok(format($$select public.fn_finance_dashboard_snapshot(
  %L, (%L::date - interval '1 month')::date, %L::date, %L::date, 12, 8)$$,
  :'org', current_setting('test.month_start'), current_setting('test.month_end'), current_setting('test.today')),
  '22007', null, 'month bounds outside the Cairo as-of month are rejected');
reset role;

set local session_replication_role = replica;
update public.expenses set supplier_id = :'supplier_b'
where id = '21700000-0000-0000-0000-000000000201';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_finance_dashboard_snapshot(
  %L, %L::date, %L::date, %L::date, 12, 8)$$, :'org', current_setting('test.month_start'),
  current_setting('test.month_end'), current_setting('test.today')),
  '23514', null, 'cross-organization supplier corruption fails closed');
reset role;

set local session_replication_role = replica;
update public.expenses set supplier_id = :'supplier'
where id = '21700000-0000-0000-0000-000000000201';
insert into public.custody_movements(
  id, org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out
) values (
  '21700000-0000-0000-0000-000000000402', :'org', :'custody_b',
  current_setting('test.today')::date, 'فساد عابر للمزرعة', 1, 0
);
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_finance_dashboard_snapshot(
  %L, %L::date, %L::date, %L::date, 12, 8)$$, :'org', current_setting('test.month_start'),
  current_setting('test.month_end'), current_setting('test.today')),
  '23514', null, 'cross-organization custody corruption fails closed');
reset role;

select * from finish();
rollback;
