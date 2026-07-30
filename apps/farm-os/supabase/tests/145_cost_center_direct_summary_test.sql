begin;
select plan(14);

\set org '00000000-0000-0000-0000-000000000001'
\set org_b '14500000-0000-0000-0000-0000000000b0'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.storekeeper', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'storekeeper' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

insert into public.organization (id, name) values (:'org_b', 'مزرعة أخرى');
insert into public.cost_centers(org_id, code, name_ar, active)
values (:'org_b', 'CC-145-FAR', 'مركز بعيد', true)
returning set_config('test.cc_b', id::text, false);

select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.cc',
  (public.fn_save_cost_center(null, :'org', null, 'CC-145', 'مركز اختبار الإجمالي', null, 'عام', 20, 1, true))->>'id',
  false);
reset role;

insert into public.expenses(org_id, category, total, kind, cost_center_id)
select :'org', 'اختبار', 10, 'operating', current_setting('test.cc')::uuid
from generate_series(1, 250);
insert into public.expenses(org_id, category, total, kind, cost_center_id, payment_status)
values
  (:'org', 'ملغى', 999, 'operating', current_setting('test.cc')::uuid, 'cancelled'),
  (:'org', 'معكوس', 777, 'operating', current_setting('test.cc')::uuid, 'historical_reversed');
insert into public.expenses(org_id, category, total, kind, cost_center_id)
values (:'org', 'مبلغ مجهول', null, 'operating', current_setting('test.cc')::uuid);

-- Historical lifecycle rows can only be created by the reconciliation executor in production. Disable
-- the insert guard narrowly inside this rolled-back fixture so the summary's include/exclude contract is
-- pinned without staging and executing a separate reconciliation batch.
alter table public.expenses disable trigger guard_historical_treasury_expense;
insert into public.expenses(org_id, category, total, kind, cost_center_id, payment_status)
values (:'org', 'تاريخي مثبت', 333, 'operating', current_setting('test.cc')::uuid, 'historical_treasury');
alter table public.expenses enable trigger guard_historical_treasury_expense;

insert into public.sales(org_id, sale_date, crop, cost_center_id, qty, unit, unit_price, total, price_status)
values (:'org', current_date, 'برحي', current_setting('test.cc')::uuid, 100, 'كجم', 50, 5000, 'finalized')
returning set_config('test.sale_a', id::text, false);
insert into public.journal_entries(org_id, entry_date, source_type, source_id, status, description)
values (:'org', current_date, 'sale', current_setting('test.sale_a')::uuid, 'posted', 'إيراد بيع A');

insert into public.sales(org_id, sale_date, crop, cost_center_id, qty, unit, unit_price, total, price_status)
values (:'org', current_date, 'برحي', current_setting('test.cc')::uuid, 60, 'كجم', 50, 3000, 'finalized')
returning set_config('test.sale_b', id::text, false);
insert into public.journal_entries(org_id, entry_date, source_type, source_id, status, description)
values (:'org', current_date, 'sale', current_setting('test.sale_b')::uuid, 'posted', 'إيراد بيع B');

insert into public.sales(org_id, sale_date, crop, cost_center_id, qty, unit, unit_price, total, price_status)
values (:'org', current_date, 'برحي', current_setting('test.cc')::uuid, 70, 'كجم', 100, 7000, 'finalized')
returning set_config('test.sale_reversed', id::text, false);
insert into public.journal_entries(org_id, entry_date, source_type, source_id, status, description)
values (:'org', current_date, 'sale', current_setting('test.sale_reversed')::uuid, 'reversed', 'إيراد معكوس');

insert into public.sales(org_id, sale_date, crop, cost_center_id, qty, unit, price_status)
select :'org', current_date, 'برحي', current_setting('test.cc')::uuid, 5, 'كجم', 'pending'
from generate_series(1, 201);

alter table public.sales disable trigger guard_historical_treasury_sale;
insert into public.sales(
  org_id, sale_date, crop, cost_center_id, qty, unit, unit_price, total, price_status, payment_status)
values (
  :'org', current_date, 'بيع تاريخي مثبت', current_setting('test.cc')::uuid,
  40, 'كجم', 100, 4000, 'finalized', 'historical_treasury')
returning set_config('test.sale_historical', id::text, false);
insert into public.journal_entries(org_id, entry_date, source_type, source_id, status, description)
values (
  :'org', current_date, 'sale', current_setting('test.sale_historical')::uuid,
  'posted', 'إيراد تاريخي مثبت');

insert into public.sales(
  org_id, sale_date, crop, cost_center_id, qty, unit, unit_price, total, price_status, payment_status)
values (
  :'org', current_date, 'بيع تاريخي معكوس', current_setting('test.cc')::uuid,
  60, 'كجم', 100, 6000, 'finalized', 'historical_reversed')
returning set_config('test.sale_historical_reversed', id::text, false);
insert into public.journal_entries(org_id, entry_date, source_type, source_id, status, description)
values (
  :'org', current_date, 'sale', current_setting('test.sale_historical_reversed')::uuid,
  'reversed', 'إيراد تاريخي معكوس');
alter table public.sales enable trigger guard_historical_treasury_sale;

select pg_temp.as_user(current_setting('test.owner'));
select is(
  (public.fn_cost_center_direct_summary(:'org', current_setting('test.cc')::uuid)->>'direct_expense_total')::numeric,
  2833::numeric, 'exact expense total exceeds the cap, includes historical treasury, and excludes void/reversed rows');
select is(
  (public.fn_cost_center_direct_summary(:'org', current_setting('test.cc')::uuid)->>'direct_expense_count')::int,
  252, 'direct expense count includes known, unknown, and historical treasury eligible rows');
select is(
  (public.fn_cost_center_direct_summary(:'org', current_setting('test.cc')::uuid)->>'unknown_expense_count')::int,
  1, 'unknown expense amount is disclosed instead of silently represented as zero');
select is(
  (public.fn_cost_center_direct_summary(:'org', current_setting('test.cc')::uuid)->>'expense_count')::int,
  254, 'expense count covers the full detail register, including excluded history rows');
select is(
  (public.fn_cost_center_direct_summary(:'org', current_setting('test.cc')::uuid)->>'direct_sale_revenue')::numeric,
  12000::numeric, 'sale revenue includes posted operational and historical-treasury sales only');
select is(
  (public.fn_cost_center_direct_summary(:'org', current_setting('test.cc')::uuid)->>'finalized_sale_count')::int,
  3, 'finalized count includes historical treasury and excludes reversed journals');
select is(
  (public.fn_cost_center_direct_summary(:'org', current_setting('test.cc')::uuid)->>'pending_sale_count')::int,
  201, 'pending count covers the full register');
select is(
  (public.fn_cost_center_direct_summary(:'org', current_setting('test.cc')::uuid)->>'sale_count')::int,
  205, 'sale count includes historical treasury and excludes historical reversed');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select is(
  (public.fn_cost_center_direct_summary(:'org', current_setting('test.cc')::uuid)->>'direct_expense_total')::numeric,
  2833::numeric, 'accountant can read the summary');
reset role;

select pg_temp.as_user(current_setting('test.storekeeper'));
select throws_ok(
  format('select public.fn_cost_center_direct_summary(%L, %L)', :'org', current_setting('test.cc')),
  '42501', null, 'storekeeper without finance.read is rejected');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(
  format('select public.fn_cost_center_direct_summary(%L, %L)', :'org_b', current_setting('test.cc_b')),
  '42501', null, 'cross-org request is rejected');
select throws_ok(
  format('select public.fn_cost_center_direct_summary(%L, %L)', :'org', current_setting('test.cc_b')),
  '42501', null, 'wrong-org cost center is rejected');
reset role;

select ok(not has_function_privilege('anon',
  'public.fn_cost_center_direct_summary(uuid, uuid)', 'EXECUTE'), 'anon cannot execute summary');
select ok(has_function_privilege('authenticated',
  'public.fn_cost_center_direct_summary(uuid, uuid)', 'EXECUTE'), 'authenticated can execute gated summary');

select * from finish();
rollback;
