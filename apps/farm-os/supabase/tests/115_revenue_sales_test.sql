-- 115 — SPEC-0024 S-10 / SPEC-0018-EXT §4: revenue (buyers + sales + collections). Verifies migration
-- 20260701500000: the budget.write gate, the delivery-before-price mechanic (pending sale posts NOTHING and
-- keeps total NULL — never a fabricated 0, #1), fn_finalize_sale_price posting Dr ذمم مدينة / Cr إيرادات,
-- collections clearing A-R + refreshing payment_status from collections, the Σ(collections) ≤ total guard, cross-org guards,
-- and anon lockdown. budget.write = owner/accountant (migration 0001; reused, no sale.write / no authorize change).
--
-- Local shim runs as superuser (bypasses RLS); authorize() exercised via jwt impersonation (tests 44/82/85/114).

begin;
select plan(24);

\set org '00000000-0000-0000-0000-000000000001'
\set orgB '11500000-0000-0000-0000-0000000000b0'
\set farmB '11500000-0000-0000-0000-0000000000f0'
select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.sk', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'storekeeper' limit 1), false);
select isnt(current_setting('test.owner'), '', 'fixture: an owner exists in orgA');

insert into public.organization (id, name) values (:'orgB', 'مزرعة مبيعات بعيدة') on conflict (id) do nothing;
insert into public.farms (id, org_id, name, code) values (:'farmB', :'orgB', 'مزرعة مبيعات ب', 'RSB')
on conflict (id) do nothing;

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- 1) budget.write gate on sale creation
select pg_temp.as_user(current_setting('test.sk'));
select throws_ok(
  format($$ select public.fn_save_sale(null, %L, current_date, 'برحي') $$, :'org'),
  '42501', null, 'storekeeper (no budget.write) cannot create a sale');
reset role;

-- 2) buyer + pending sale (owner)
select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  format($$ select set_config('test.buyer', (public.fn_save_buyer(null, %L, 'تاجر التمور', 'trader', '0100', true))->>'id', false) $$, :'org'),
  'owner creates a trader buyer');
select throws_ok(
  format($$ select public.fn_save_sale(null, %L, current_date, '') $$, :'org'),
  '23502', null, 'crop is mandatory on a sale (#595 reporting dimension)');
select lives_ok(
  format($$ select set_config('test.sale',
    (public.fn_save_sale(null, %L, current_date, 'برحي', current_setting('test.buyer')::uuid, null, null, null, null, '2025', 100, 'كجم', current_date, null))->>'id', false) $$, :'org'),
  'owner records a delivery as a PENDING sale (qty + crop, no price)');
select throws_ok(
  format($$ select public.fn_save_sale(null, %L, current_date, 'برحي', null, null, %L, null, null, '2025', 10, 'كجم', current_date, null) $$, :'org', :'farmB'),
  '42501', null, 'cross-org farm dimension is rejected on a sale');
reset role;

-- 3) pending mechanic: total is NULL (honest, never 0) and nothing posted to the ledger
select is(
  (select total from public.sales where id = current_setting('test.sale')::uuid),
  null, 'a pending sale keeps total NULL (honest-null #1, never a fabricated 0)');
select is(
  (select price_status from public.sales where id = current_setting('test.sale')::uuid),
  'pending', 'the sale is pending until the price is finalized');
select is(
  (select count(*)::int from public.journal_entries where org_id = :'org' and source_type = 'sale' and source_id = current_setting('test.sale')::uuid),
  0, 'a pending-price sale posts NOTHING to the ledger');

-- 4) finalize price → posts Dr ذمم مدينة / Cr إيرادات المبيعات
select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  $$ select public.fn_finalize_sale_price(current_setting('test.sale')::uuid, 50) $$,
  'owner finalizes the price at 50/kg');
reset role;
select is(
  (select total from public.sales where id = current_setting('test.sale')::uuid),
  5000::numeric, 'finalized total = qty × unit_price = 100 × 50 = 5000');
select is(
  (select price_status from public.sales where id = current_setting('test.sale')::uuid),
  'finalized', 'price_status flipped to finalized');
select is(
  (select jl.debit from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id
     join public.accounts a on a.id = jl.account_id
    where je.source_type = 'sale' and je.source_id = current_setting('test.sale')::uuid and a.code = '1200'),
  5000::numeric, 'the sale journal DEBITs ذمم مدينة (1200) by the total');
select is(
  (select jl.credit from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id
     join public.accounts a on a.id = jl.account_id
    where je.source_type = 'sale' and je.source_id = current_setting('test.sale')::uuid and a.code = '4000'),
  5000::numeric, 'the sale journal CREDITs إيرادات المبيعات (4000) by the total');

-- 5) cannot finalize twice
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(
  $$ select public.fn_finalize_sale_price(current_setting('test.sale')::uuid, 60) $$,
  '22023', null, 'a finalized sale cannot be re-priced');
reset role;

-- 6) collections clear A-R + derive payment_status; Σ ≤ total
select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  $$ select public.fn_record_sale_collection(current_setting('test.sale')::uuid, 2000, current_date, 'المحاسب', null) $$,
  'owner records a partial collection of 2000');
reset role;
select is(
  (select payment_status from public.sales where id = current_setting('test.sale')::uuid),
  'partially_collected', 'payment_status refreshes to partially_collected after 2000 of 5000');
select is(
  (select jl.debit from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id
     join public.accounts a on a.id = jl.account_id
    where je.source_type = 'sale_collection' and a.code = '1100' and jl.debit > 0 limit 1),
  2000::numeric, 'the collection journal DEBITs نقدية المبيعات (1100)');
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(
  $$ select public.fn_record_sale_collection(current_setting('test.sale')::uuid, 4000, current_date, null, null) $$,
  '22023', null, 'a collection that would exceed the receivable is rejected');
select lives_ok(
  $$ select public.fn_record_sale_collection(current_setting('test.sale')::uuid, 3000, current_date, null, null) $$,
  'the remaining 3000 collects');
reset role;
select is(
  (select payment_status from public.sales where id = current_setting('test.sale')::uuid),
  'collected', 'payment_status refreshes to collected once Σ(collections) = total');

-- 7) cannot collect on a pending sale
select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.sale2', (public.fn_save_sale(null, :'org', current_date, 'موالح', null, null, null, null, null, null, 10, 'كجم', null, null))->>'id', false);
select throws_ok(
  $$ select public.fn_record_sale_collection(current_setting('test.sale2')::uuid, 100, current_date, null, null) $$,
  '22023', null, 'cannot collect on a pending-price sale');
reset role;

-- 8) anon lockdown
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('fn_save_buyer','fn_save_sale','fn_finalize_sale_price','fn_record_sale_collection')
       and has_function_privilege('anon', p.oid, 'EXECUTE')),
  'none of the new revenue RPCs are EXECUTE-able by anon');

select pg_temp.as_user(current_setting('test.sk'));
select is((select count(*)::int from public.sales where org_id = :'org'), 0,
  'storekeeper cannot read revenue rows through RLS');
reset role;

select * from finish();
rollback;
