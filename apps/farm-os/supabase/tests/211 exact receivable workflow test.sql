-- Exact pricing/collection transport, bounded picker reads, and role/tenant gates.
begin;
select plan(29);

\set org '00000000-0000-0000-0000-000000000001'
\set org_b '21100000-0000-0000-0000-0000000000b0'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'supervisor' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select isnt(current_setting('test.owner'), '', 'fixture: owner exists');

insert into public.organization(id, name) values (:'org_b', 'Exact receivable foreign org')
on conflict (id) do nothing;

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.buyer', (
  public.fn_save_buyer(null, :'org', 'Exact receivable buyer', 'trader', null, true)->>'id'
), false);
select set_config('test.sale', (
  public.fn_save_sale(
    null, :'org', date '2026-08-08', 'برحي', current_setting('test.buyer')::uuid,
    null, null, null, null, '2026', 100000000000000.01, 'كجم', date '2026-08-08', 'exact workflow'
  )->>'id'
), false);

select is(
  (select row->>'qty' from jsonb_array_elements(public.fn_pending_sale_pricing(:'org', 200)) row
   where row->>'id' = current_setting('test.sale')),
  '100000000000000.01',
  'pending pricing transports quantity as exact text');
select is(
  jsonb_typeof((select row->'qty' from jsonb_array_elements(public.fn_pending_sale_pricing(:'org', 200)) row
   where row->>'id' = current_setting('test.sale'))),
  'string',
  'pending quantity is a JSON string');
select is(jsonb_array_length(public.fn_pending_sale_pricing(:'org', 1)), 1,
  'pending pricing applies its row limit in the database');

select set_config('test.tiny_sale', (
  public.fn_save_sale(
    null, :'org', date '2026-08-08', 'برحي', current_setting('test.buyer')::uuid,
    null, null, null, null, '2026', 0.001, 'كجم', date '2026-08-08', 'zero-rounding guard'
  )->>'id'
), false);
select throws_ok(
  $$select public.fn_finalize_sale_price(current_setting('test.tiny_sale')::uuid, 0.001)$$,
  '22023', null, 'a positive price that rounds the total to zero is rejected');
select is((select price_status from public.sales where id = current_setting('test.tiny_sale')::uuid),
  'pending', 'zero-rounded rejection leaves the sale pending');
select is((select count(*)::int from public.journal_entries
  where source_type = 'sale' and source_id = current_setting('test.tiny_sale')::uuid),
  0, 'zero-rounded rejection posts no journal');

select set_config('test.finalize', public.fn_finalize_sale_price(
  current_setting('test.sale')::uuid, 1.00000000000000001
)::text, false);
select is(current_setting('test.finalize')::jsonb->>'total', '100000000000000.01',
  'finalize response preserves exact rounded total text');
select is(jsonb_typeof(current_setting('test.finalize')::jsonb->'total'), 'string',
  'finalize total is a JSON string');
select is((select total from public.sales where id = current_setting('test.sale')::uuid),
  100000000000000.01::numeric, 'sale stores the exact total');
select is((select jl.debit from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  join public.accounts a on a.id = jl.account_id
  where je.source_type = 'sale' and je.source_id = current_setting('test.sale')::uuid and a.code = '1200'),
  100000000000000.01::numeric, 'receivable journal stores the exact total');

select set_config('test.collection', public.fn_record_sale_collection(
  current_setting('test.sale')::uuid, 0.01, date '2026-08-08', null, null
)::text, false);
select is(current_setting('test.collection')::jsonb->>'collected_total', '0.01',
  'collection response preserves exact collected total text');
select is(jsonb_typeof(current_setting('test.collection')::jsonb->'collected_total'), 'string',
  'collected total is a JSON string');
select is((select amount from public.sale_collections where sale_id = current_setting('test.sale')::uuid),
  0.01::numeric, 'collection row stores the exact amount');
select is((select jl.debit from public.journal_lines jl
  join public.journal_entries je on je.id = jl.journal_entry_id
  join public.accounts a on a.id = jl.account_id
  where je.source_type = 'sale_collection' and je.source_id = (current_setting('test.collection')::jsonb->>'id')::uuid and a.code = '1100'),
  0.01::numeric, 'collection journal stores the exact amount');

select is((select row->>'total' from jsonb_array_elements(public.fn_open_sale_receivables(:'org', 200)) row
  where row->>'id' = current_setting('test.sale')), '100000000000000.01',
  'open receivable total is exact text');
select is((select row->>'collected' from jsonb_array_elements(public.fn_open_sale_receivables(:'org', 200)) row
  where row->>'id' = current_setting('test.sale')), '0.01',
  'open receivable collected amount is exact text');
select is((select row->>'remaining' from jsonb_array_elements(public.fn_open_sale_receivables(:'org', 200)) row
  where row->>'id' = current_setting('test.sale')), '100000000000000.00',
  'open receivable remaining amount is exact text');
select is(jsonb_typeof((select row->'remaining' from jsonb_array_elements(public.fn_open_sale_receivables(:'org', 200)) row
  where row->>'id' = current_setting('test.sale'))), 'string',
  'open remaining amount is a JSON string');
select is(jsonb_array_length(public.fn_open_sale_receivables(:'org', 1)), 1,
  'open receivables applies its row limit after database aggregation');
select ok(
  pg_get_functiondef('public.fn_record_sale_collection(uuid,numeric,date,text,text)'::regprocedure)
    like '%Africa/Cairo%',
  'collection RPC defaults omitted dates on the Cairo farm calendar');

select throws_ok($$select public.fn_pending_sale_pricing(current_setting('test.sale')::uuid, 0)$$,
  '22023', null, 'pending picker rejects an invalid limit');
select throws_ok(format($$select public.fn_open_sale_receivables(%L, 200)$$, :'org_b'),
  '42501', null, 'owner cannot read another organization receivables');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$select public.fn_pending_sale_pricing(%L, 200)$$, :'org'),
  'accountant can read pending pricing');
select lives_ok(format($$select public.fn_open_sale_receivables(%L, 200)$$, :'org'),
  'accountant can read open receivables');
reset role;

select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$select public.fn_pending_sale_pricing(%L, 200)$$, :'org'),
  '42501', null, 'supervisor cannot read pending pricing');
select throws_ok(format($$select public.fn_open_sale_receivables(%L, 200)$$, :'org'),
  '42501', null, 'supervisor cannot read open receivables');
reset role;

select ok(not has_function_privilege('anon', 'public.fn_pending_sale_pricing(uuid, integer)', 'EXECUTE'),
  'anon cannot execute pending pricing');
select ok(not has_function_privilege('anon', 'public.fn_open_sale_receivables(uuid, integer)', 'EXECUTE'),
  'anon cannot execute open receivables');

select * from finish();
rollback;
