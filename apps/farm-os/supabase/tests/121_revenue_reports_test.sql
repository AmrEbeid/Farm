-- 121 — SPEC-0024 S-10b / SPEC-0018-EXT §4: revenue reports + A/R aging.
-- Verifies the finance-read-only report derives period sales, collections, pending-price rows,
-- outstanding receivables, and aging buckets from the revenue/A-R backend without posting or changing data.
begin;
select plan(27);

\set org '00000000-0000-0000-0000-000000000001'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'supervisor' limit 1), false);

select isnt(current_setting('test.owner'), '', 'fixture: an owner exists in orgA');
select isnt(current_setting('test.accountant'), '', 'fixture: an accountant exists in orgA');
select ok(
  not has_function_privilege('anon', 'public.fn_revenue_sales_report(uuid, date, date, date)', 'EXECUTE'),
  'anon cannot EXECUTE fn_revenue_sales_report');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  format($$ select set_config('test.buyer', (public.fn_save_buyer(null, %L, 'تاجر تقرير الإيراد 121', 'trader', '0100', true))->>'id', false) $$, :'org'),
  'owner creates a buyer for the revenue report fixture');
select lives_ok(
  format($$ select set_config('test.sale_july',
    (public.fn_save_sale(null, %L, date '2026-07-05', 'برحي', current_setting('test.buyer')::uuid, null, null, null, null, '2026', 100, 'كجم', date '2026-07-05', 'بيع يوليو'))->>'id', false) $$, :'org'),
  'owner records a July pending-price sale');
select lives_ok(
  $$ select public.fn_finalize_sale_price(current_setting('test.sale_july')::uuid, 50) $$,
  'owner finalizes the July sale price');
select lives_ok(
  $$ select public.fn_record_sale_collection(current_setting('test.sale_july')::uuid, 2000, date '2026-07-10', 'المحاسب', 'تحصيل جزئي') $$,
  'owner records a partial July collection');
select lives_ok(
  format($$ select set_config('test.sale_pending',
    (public.fn_save_sale(null, %L, date '2026-07-06', 'موالح', current_setting('test.buyer')::uuid, null, null, null, null, '2026', 30, 'كجم', date '2026-07-06', 'تسليم بدون سعر'))->>'id', false) $$, :'org'),
  'owner records a July sale that remains pending-price');
select lives_ok(
  format($$ select set_config('test.sale_old',
    (public.fn_save_sale(null, %L, date '2026-06-01', 'برحي', current_setting('test.buyer')::uuid, null, null, null, null, '2026', 20, 'كجم', date '2026-06-01', 'ذمم قديمة'))->>'id', false) $$, :'org'),
  'owner records an older pending-price sale');
select lives_ok(
  $$ select public.fn_finalize_sale_price(current_setting('test.sale_old')::uuid, 100) $$,
  'owner finalizes the older sale price');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(
  format($$ select public.fn_revenue_sales_report(%L, date '2026-07-01', date '2026-07-31', date '2026-07-31') $$, :'org'),
  'accountant can call revenue sales report');
select is(
  (public.fn_revenue_sales_report(:'org', date '2026-07-01', date '2026-07-31', date '2026-07-31')->>'finalized_revenue')::numeric,
  5000::numeric,
  'period finalized revenue includes priced July sales only');
select is(
  (public.fn_revenue_sales_report(:'org', date '2026-07-01', date '2026-07-31', date '2026-07-31')->>'period_collections')::numeric,
  2000::numeric,
  'period collections include July customer receipts');
select is(
  (public.fn_revenue_sales_report(:'org', date '2026-07-01', date '2026-07-31', date '2026-07-31')->>'outstanding_total')::numeric,
  5000::numeric,
  'outstanding A/R includes the partly collected July sale plus the older unpaid sale');
select is(
  (public.fn_revenue_sales_report(:'org', date '2026-07-01', date '2026-07-31', date '2026-07-31')->>'over_30_amount')::numeric,
  2000::numeric,
  '30+ A/R amount includes the older unpaid sale only');
select is(
  (public.fn_revenue_sales_report(:'org', date '2026-07-01', date '2026-07-31', date '2026-07-31')->>'over_30_count')::int,
  1,
  '30+ A/R count is one older receivable');
select is(
  (public.fn_revenue_sales_report(:'org', date '2026-07-01', date '2026-07-31', date '2026-07-31')->>'pending_count')::int,
  1,
  'pending-price deliveries are counted separately');
select is(
  (public.fn_revenue_sales_report(:'org', date '2026-07-01', date '2026-07-31', date '2026-07-31')->>'pending_qty')::numeric,
  30::numeric,
  'pending quantity is surfaced without pretending it has revenue');
select is(
  jsonb_array_length(public.fn_revenue_sales_report(:'org', date '2026-07-01', date '2026-07-31', date '2026-07-31')->'sales'),
  2,
  'period sales list includes the finalized sale and the pending-price delivery');
select is(
  (select row->>'total'
     from jsonb_array_elements(public.fn_revenue_sales_report(:'org', date '2026-07-01', date '2026-07-31', date '2026-07-31')->'sales') row
    where row->>'sale_id' = current_setting('test.sale_pending')),
  null,
  'pending-price sale keeps total as JSON null in the report');
select is(
  (select (row->>'finalized_revenue')::numeric
     from jsonb_array_elements(public.fn_revenue_sales_report(:'org', date '2026-07-01', date '2026-07-31', date '2026-07-31')->'by_buyer') row
    where row->>'buyer_id' = current_setting('test.buyer')),
  5000::numeric,
  'buyer rollup totals finalized period revenue');
select is(
  (select (row->>'qty')::numeric
     from jsonb_array_elements(public.fn_revenue_sales_report(:'org', date '2026-07-01', date '2026-07-31', date '2026-07-31')->'by_crop_season') row
    where row->>'crop' = 'برحي'),
  100::numeric,
  'crop/season rollup uses period sales only');
select is(
  jsonb_array_length(public.fn_revenue_sales_report(:'org', date '2026-07-01', date '2026-07-31', date '2026-07-31')->'ar_rows'),
  2,
  'A/R aging lists both open finalized receivables as of the report date');
select is(
  (select row->>'aging_bucket'
     from jsonb_array_elements(public.fn_revenue_sales_report(:'org', date '2026-07-01', date '2026-07-31', date '2026-07-31')->'ar_rows') row
    where row->>'sale_id' = current_setting('test.sale_old')),
  '60+',
  'the older receivable falls into the 60+ aging bucket as of 2026-07-31');
select is(
  (select (row->>'amount')::numeric
     from jsonb_array_elements(public.fn_revenue_sales_report(:'org', date '2026-07-01', date '2026-07-31', date '2026-07-31')->'collections') row
    where row->>'sale_id' = current_setting('test.sale_july')),
  2000::numeric,
  'collections list carries the July receipt amount');
select throws_ok(
  format($$ select public.fn_revenue_sales_report(%L, date '2026-08-01', date '2026-07-31', date '2026-07-31') $$, :'org'),
  '22023', null, 'revenue report rejects an inverted period');
reset role;

select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(
  format($$ select public.fn_revenue_sales_report(%L, date '2026-07-01', date '2026-07-31', date '2026-07-31') $$, :'org'),
  '42501', null, 'supervisor cannot call revenue sales report');
reset role;

select * from finish();
rollback;
