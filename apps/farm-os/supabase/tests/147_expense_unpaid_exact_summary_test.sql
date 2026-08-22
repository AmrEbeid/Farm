-- Exact all-ledger post-paid obligations added by migration 20260822140000.
begin;
select plan(21);

\set org '00000000-0000-0000-0000-000000000001'
\set org_b '14700000-0000-0000-0000-0000000000b0'

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

insert into public.organization (id, name) values (:'org_b', 'مزرعة أخرى 147');

insert into public.expenses(org_id, date, category, total, kind, payment_status)
values
  (:'org', '2026-07-01', 'تشغيلي معلوم', 100, 'operating', 'post_paid_unpaid'),
  (:'org', '2026-07-02', 'تشغيلي مجهول', null, 'operating', 'post_paid_unpaid'),
  (:'org', '2026-07-03', 'رأسمالي معلوم', 200, 'capex', 'post_paid_unpaid'),
  (:'org', '2026-07-04', 'رأسمالي مجهول', null, 'capex', 'post_paid_unpaid'),
  (:'org', '2026-07-05', 'مسحوبات معلومة', 300, 'drawing', 'post_paid_unpaid'),
  (:'org', '2026-07-06', 'مسحوبات مجهولة', null, 'drawing', 'post_paid_unpaid'),
  (:'org', '2026-07-07', 'ليست آجلة', 999, 'operating', 'paid_from_custody'),
  (:'org_b', '2026-07-08', 'آجل في منظمة أخرى', 900, 'operating', 'post_paid_unpaid');

select pg_temp.as_user(current_setting('test.owner'));
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'unpaid_operating_count')::int,
  2, 'owner receives the exact operating unpaid row count');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'unpaid_operating_total')::numeric,
  100::numeric, 'operating unpaid total includes known money only and excludes the other organization');
select is(
  jsonb_typeof(public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->'unpaid_operating_total'),
  'string', 'money crosses the JSON boundary as exact decimal text');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'unpaid_operating_unknown_count')::int,
  1, 'operating unknown amount is explicit');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'unpaid_capex_count')::int,
  2, 'owner receives the exact capex unpaid row count');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'unpaid_capex_total')::numeric,
  200::numeric, 'capex unpaid total includes known money only');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'unpaid_capex_unknown_count')::int,
  1, 'capex unknown amount is explicit');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'unpaid_drawing_count')::int,
  2, 'owner receives the exact confidential drawing unpaid row count');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'unpaid_drawing_total')::numeric,
  300::numeric, 'drawing unpaid total includes known money only');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'unpaid_drawing_unknown_count')::int,
  1, 'drawing unknown amount is explicit');
select is(
  (
    (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'unpaid_operating_count')::int +
    (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'unpaid_capex_count')::int +
    (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'unpaid_drawing_count')::int
  ),
  6, 'the exact unpaid register contains all six current-organization rows');
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'month_non_drawing_total')::numeric,
  1299::numeric, 'the prior month summary contract remains intact');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'unpaid_drawing_total')::numeric,
  300::numeric, 'accountant receives the same finance-authorized drawing total as owner');
reset role;

select pg_temp.as_user(current_setting('test.farm_manager'));
select is(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->>'unpaid_operating_total')::numeric,
  100::numeric, 'farm manager may see the non-confidential operating unpaid total');
select ok(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->'unpaid_drawing_count') = 'null'::jsonb,
  'farm manager receives null, not a fabricated drawing count');
select ok(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->'unpaid_drawing_total') = 'null'::jsonb,
  'farm manager receives no drawing money');
select ok(
  (public.fn_expense_register_summary(:'org', '2026-07-01', '2026-08-01')->'unpaid_drawing_unknown_count') = 'null'::jsonb,
  'farm manager receives no drawing unknown count');
reset role;

select pg_temp.as_user(current_setting('test.storekeeper'));
select throws_ok(
  format('select public.fn_expense_register_summary(%L, %L, %L)', :'org', '2026-07-01', '2026-08-01'),
  '42501', null, 'storekeeper remains outside the summary role set');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(
  format('select public.fn_expense_register_summary(%L, %L, %L)', :'org_b', '2026-07-01', '2026-08-01'),
  '42501', null, 'cross-org summary remains forbidden');
reset role;

select ok(not has_function_privilege(
  'anon', 'public.fn_expense_register_summary(uuid, date, date)', 'EXECUTE'),
  'anon cannot execute the summary');
select ok(has_function_privilege(
  'authenticated', 'public.fn_expense_register_summary(uuid, date, date)', 'EXECUTE'),
  'authenticated may execute the internally role-gated summary');

select * from finish();
rollback;
