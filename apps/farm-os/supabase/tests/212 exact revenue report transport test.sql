-- Exact revenue/A-R report transport, fail-closed JSON conversion, and finance/tenant gates.
begin;
select plan(35);

\set org '00000000-0000-0000-0000-000000000001'
\set org_b '21200000-0000-0000-0000-0000000000b0'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'supervisor' limit 1), false);
select isnt(current_setting('test.owner'), '', 'fixture: owner exists');
select isnt(current_setting('test.accountant'), '', 'fixture: accountant exists');
select isnt(current_setting('test.supervisor'), '', 'fixture: supervisor exists');

insert into public.organization(id, name) values (:'org_b', 'Exact revenue foreign org')
on conflict (id) do nothing;

select ok(not has_function_privilege('anon',
  'public.fn_revenue_sales_report_exact(uuid, date, date, date)', 'EXECUTE'),
  'anon cannot execute the exact revenue report');
select ok(has_function_privilege('authenticated',
  'public.fn_revenue_sales_report_exact(uuid, date, date, date)', 'EXECUTE'),
  'authenticated receives execute before the in-function finance gate');
select ok(not has_function_privilege('authenticated',
  'private.fn_jsonb_numeric_keys_to_text(jsonb, text[])', 'EXECUTE'),
  'authenticated cannot execute the private object converter');
select ok(not has_function_privilege('anon',
  'private.fn_jsonb_array_numeric_keys_to_text(jsonb, text[])', 'EXECUTE'),
  'anon cannot execute the private array converter');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  format($$select set_config('test.buyer',
    (public.fn_save_buyer(null, %L, 'Exact revenue buyer', 'trader', null, true))->>'id', false)$$, :'org'),
  'owner creates the exact-report buyer');
select lives_ok(
  format($$select set_config('test.sale',
    (public.fn_save_sale(null, %L, date '2026-08-08', 'برحي', current_setting('test.buyer')::uuid,
      null, null, null, null, '2026', 100000000000000.01, 'كجم', date '2026-08-08',
      'exact report'))->>'id', false)$$, :'org'),
  'owner creates the exact-report finalized sale fixture');
select lives_ok(
  $$select public.fn_finalize_sale_price(current_setting('test.sale')::uuid, 1.00000000000000001)$$,
  'owner finalizes the exact-report sale');
select lives_ok(
  $$select public.fn_record_sale_collection(current_setting('test.sale')::uuid, 0.01,
      date '2026-08-08', null, 'exact report')$$,
  'owner records an exact small collection');
select lives_ok(
  format($$select set_config('test.pending_sale',
    (public.fn_save_sale(null, %L, date '2026-08-08', 'مجدول', current_setting('test.buyer')::uuid,
      null, null, null, null, '2026', 0.001, 'كجم', date '2026-08-08',
      'exact pending report'))->>'id', false)$$, :'org'),
  'owner creates a pending-price quantity fixture');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$select public.fn_revenue_sales_report_exact(%L,
    date '2026-08-01', date '2026-08-08', date '2026-08-08')$$, :'org'),
  'accountant can read the exact report');
select is(public.fn_revenue_sales_report_exact(:'org', date '2026-08-01', date '2026-08-08', date '2026-08-08')
    ->>'finalized_revenue', '100000000000000.01',
  'top-level finalized revenue remains exact text');
select is(jsonb_typeof(public.fn_revenue_sales_report_exact(:'org', date '2026-08-01', date '2026-08-08', date '2026-08-08')
    ->'finalized_revenue'), 'string',
  'top-level money is a JSON string');
select is(public.fn_revenue_sales_report_exact(:'org', date '2026-08-01', date '2026-08-08', date '2026-08-08')
    ->>'pending_qty', '0.001',
  'top-level pending quantity remains exact text');
select is(jsonb_typeof(public.fn_revenue_sales_report_exact(:'org', date '2026-08-01', date '2026-08-08', date '2026-08-08')
    ->'pending_qty'), 'string',
  'top-level quantity is a JSON string');
select is((select row->>'qty' from jsonb_array_elements(public.fn_revenue_sales_report_exact(
    :'org', date '2026-08-01', date '2026-08-08', date '2026-08-08')->'sales') row
    where row->>'sale_id' = current_setting('test.sale')), '100000000000000.01',
  'sale quantity remains exact text');
select is((select jsonb_typeof(row->'total') from jsonb_array_elements(public.fn_revenue_sales_report_exact(
    :'org', date '2026-08-01', date '2026-08-08', date '2026-08-08')->'sales') row
    where row->>'sale_id' = current_setting('test.sale')), 'string',
  'finalized sale total is a JSON string');
select is((select jsonb_typeof(row->'total') from jsonb_array_elements(public.fn_revenue_sales_report_exact(
    :'org', date '2026-08-01', date '2026-08-08', date '2026-08-08')->'sales') row
    where row->>'sale_id' = current_setting('test.pending_sale')), 'null',
  'pending-price sale total remains JSON null');
select is((select row->>'finalized_revenue' from jsonb_array_elements(public.fn_revenue_sales_report_exact(
    :'org', date '2026-08-01', date '2026-08-08', date '2026-08-08')->'by_buyer') row
    where row->>'buyer_id' = current_setting('test.buyer')), '100000000000000.01',
  'buyer revenue rollup remains exact text');
select is((select jsonb_typeof(row->'qty') from jsonb_array_elements(public.fn_revenue_sales_report_exact(
    :'org', date '2026-08-01', date '2026-08-08', date '2026-08-08')->'by_crop_season') row
    where row->>'crop' = 'برحي'), 'string',
  'crop quantity rollup is a JSON string');
select is((select row->>'outstanding' from jsonb_array_elements(public.fn_revenue_sales_report_exact(
    :'org', date '2026-08-01', date '2026-08-08', date '2026-08-08')->'ar_rows') row
    where row->>'sale_id' = current_setting('test.sale')), '100000000000000.00',
  'A/R outstanding remains exact text including its accounting scale');
select is((select row->>'amount' from jsonb_array_elements(public.fn_revenue_sales_report_exact(
    :'org', date '2026-08-01', date '2026-08-08', date '2026-08-08')->'collections') row
    where row->>'sale_id' = current_setting('test.sale')), '0.01',
  'collection amount remains exact text');
select is(jsonb_typeof(public.fn_revenue_sales_report_exact(:'org', date '2026-08-01', date '2026-08-08', date '2026-08-08')
    ->'pending_count'), 'number',
  'counts remain JSON numbers for safe integer handling');
select ok(not exists (
  select 1
  from (select public.fn_revenue_sales_report_exact(:'org', date '2026-08-01', date '2026-08-08', date '2026-08-08') report) exact,
       unnest(array['finalized_revenue', 'period_collections', 'outstanding_total', 'over_30_amount', 'pending_qty']) keys(key_name)
  where coalesce(jsonb_typeof(exact.report -> keys.key_name), 'missing') <> 'string'
), 'every top-level money and quantity key is exact JSON text');
select ok(not exists (
  select 1
  from jsonb_array_elements(public.fn_revenue_sales_report_exact(
         :'org', date '2026-08-01', date '2026-08-08', date '2026-08-08')->'sales') row,
       unnest(array['qty', 'unit_price', 'total', 'collected_to_as_of', 'collected_in_period', 'outstanding']) keys(key_name)
  where row->>'sale_id' = current_setting('test.sale')
    and coalesce(jsonb_typeof(row -> keys.key_name), 'missing') <> 'string'
), 'every finalized-sale money and quantity key is exact JSON text');
select ok(not exists (
  select 1
  from jsonb_array_elements(public.fn_revenue_sales_report_exact(
         :'org', date '2026-08-01', date '2026-08-08', date '2026-08-08')->'by_buyer') row,
       unnest(array['qty', 'finalized_revenue', 'collected_in_period', 'collected_to_as_of', 'outstanding']) keys(key_name)
  where row->>'buyer_id' = current_setting('test.buyer')
    and coalesce(jsonb_typeof(row -> keys.key_name), 'missing') <> 'string'
), 'every buyer-rollup money and quantity key is exact JSON text');
select ok(not exists (
  select 1
  from jsonb_array_elements(public.fn_revenue_sales_report_exact(
         :'org', date '2026-08-01', date '2026-08-08', date '2026-08-08')->'by_crop_season') row,
       unnest(array['qty', 'finalized_revenue', 'collected_in_period', 'outstanding']) keys(key_name)
  where row->>'crop' = 'برحي'
    and coalesce(jsonb_typeof(row -> keys.key_name), 'missing') <> 'string'
), 'every crop-rollup money and quantity key is exact JSON text');
select ok(not exists (
  select 1
  from jsonb_array_elements(public.fn_revenue_sales_report_exact(
         :'org', date '2026-08-01', date '2026-08-08', date '2026-08-08')->'ar_rows') row,
       unnest(array['total', 'collected_to_as_of', 'outstanding']) keys(key_name)
  where row->>'sale_id' = current_setting('test.sale')
    and coalesce(jsonb_typeof(row -> keys.key_name), 'missing') <> 'string'
), 'every A/R money key is exact JSON text');
select ok(not exists (
  select 1
  from jsonb_array_elements(public.fn_revenue_sales_report_exact(
         :'org', date '2026-08-01', date '2026-08-08', date '2026-08-08')->'collections') row
  where row->>'sale_id' = current_setting('test.sale')
    and coalesce(jsonb_typeof(row -> 'amount'), 'missing') <> 'string'
), 'every collection amount is exact JSON text');
select throws_ok(format($$select public.fn_revenue_sales_report_exact(%L,
    date '2026-08-01', date '2026-08-08', date '2026-08-08')$$, :'org_b'),
  '42501', null, 'accountant cannot read another organization exact report');
reset role;

select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$select public.fn_revenue_sales_report_exact(%L,
    date '2026-08-01', date '2026-08-08', date '2026-08-08')$$, :'org'),
  '42501', null, 'supervisor cannot read the exact finance report');
reset role;

select throws_ok(
  $$select private.fn_jsonb_numeric_keys_to_text('{"amount": 1}'::jsonb, array['missing'])$$,
  '22023', null, 'private converter fails closed when an expected key is missing');
select throws_ok(
  $$select private.fn_jsonb_numeric_keys_to_text('{"amount": "1"}'::jsonb, array['amount'])$$,
  '22023', null, 'private converter rejects an already-string or malformed source contract');

select * from finish();
rollback;
