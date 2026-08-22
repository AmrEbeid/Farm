-- Exact, one-statement unified transactions snapshot with finance and tenant gates.
begin;
select plan(59);

\set org '00000000-0000-0000-0000-000000000001'
\set org_b '21400000-0000-0000-0000-0000000000b0'

select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'supervisor' limit 1), false);
select isnt(current_setting('test.owner'), '', 'fixture: owner exists');
select isnt(current_setting('test.accountant'), '', 'fixture: accountant exists');
select isnt(current_setting('test.supervisor'), '', 'fixture: supervisor exists');

insert into public.organization(id, name) values (:'org_b', 'Exact transactions foreign org')
on conflict (id) do nothing;

select ok(not has_function_privilege('anon',
  'public.fn_transactions_snapshot(uuid, integer)', 'EXECUTE'),
  'anon cannot execute the transactions snapshot');
select ok(has_function_privilege('authenticated',
  'public.fn_transactions_snapshot(uuid, integer)', 'EXECUTE'),
  'authenticated receives execute before the in-function finance gate');

select has_index('public', 'expenses', 'transactions_expenses_org_date_idx',
  'transactions expense date read has a covering order index');
select has_index('public', 'sales', 'transactions_sales_org_date_idx',
  'transactions sale date read has a covering order index');
select has_index('public', 'sale_collections', 'transactions_collections_org_date_idx',
  'transactions collection date read has a covering order index');
select has_index('public', 'custody_movements', 'transactions_custody_org_date_idx',
  'transactions custody date read has a covering order index');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.baseline', public.fn_transactions_snapshot(:'org', 400)::text, false);
reset role;

insert into public.suppliers(id, org_id, name) values
  ('21400000-0000-0000-0000-000000000001', :'org', 'مورد اللقطة الدقيق'),
  ('21400000-0000-0000-0000-000000000002', :'org_b', 'Foreign supplier');
insert into public.buyers(id, org_id, name) values
  ('21400000-0000-0000-0000-000000000003', :'org', 'مشتري اللقطة الدقيق'),
  ('21400000-0000-0000-0000-000000000004', :'org_b', 'Foreign buyer');
insert into public.custody_accounts(id, org_id, holder_label, target_float) values
  ('21400000-0000-0000-0000-000000000005', :'org', 'عهدة اللقطة', 0),
  ('21400000-0000-0000-0000-000000000006', :'org_b', 'Foreign custody', 0);

insert into public.expenses(id, org_id, date, category, description, supplier_id, total, kind, payment_status)
values
  ('21400000-0000-0000-0000-000000000010', :'org', date '2099-01-01', 'تشغيل', 'مصروف دقيق',
   '21400000-0000-0000-0000-000000000001', 100000000000000.01, 'operating', null),
  ('21400000-0000-0000-0000-000000000011', :'org', date '2099-01-02', 'تشغيل', 'مصروف ملغي',
   null, 9.99, 'operating', 'cancelled');
insert into public.sales(
  id, org_id, sale_date, crop, buyer_id, qty, unit, unit_price, total, price_status, payment_status)
values
  ('21400000-0000-0000-0000-000000000020', :'org', date '2099-01-03', 'برحي',
   '21400000-0000-0000-0000-000000000003', 1, 'كجم', 900000000000000.02, 900000000000000.02,
   'finalized', 'unpaid'),
  ('21400000-0000-0000-0000-000000000021', :'org', date '2099-01-04', 'برحي',
   null, 0.123456789, 'كجم', null, null, 'pending', 'unpaid');
insert into public.sale_collections(id, org_id, sale_id, amount, occurred_at, collected_by)
values ('21400000-0000-0000-0000-000000000030', :'org',
  '21400000-0000-0000-0000-000000000020', 0.02, date '2099-01-05', 'المحاسب');
insert into public.custody_movements(
  id, org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out, note)
values ('21400000-0000-0000-0000-000000000040', :'org',
  '21400000-0000-0000-0000-000000000005', date '2099-01-06', 'استلام عهدة', 0.03, 0, 'حركة دقيقة');

-- Reversed historical rows are impossible to create through a business path without their full
-- reconciliation evidence. Bypass triggers only for these read-filter fixtures; constraints remain.
set local session_replication_role = replica;
insert into public.expenses(id, org_id, date, category, description, total, kind, payment_status)
values ('21400000-0000-0000-0000-000000000012', :'org', date '2099-01-07', 'تاريخي',
  'مصروف معكوس تاريخياً', 7.77, 'operating', 'historical_reversed');
insert into public.sales(
  id, org_id, sale_date, crop, qty, unit, unit_price, total, price_status, payment_status)
values ('21400000-0000-0000-0000-000000000022', :'org', date '2099-01-08', 'برحي',
  1, 'كجم', null, null, 'pending', 'historical_reversed');
set local session_replication_role = origin;

select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(format($$select public.fn_transactions_snapshot(%L, 400)$$, :'org'),
  'owner can read the exact transactions snapshot');
select is(public.fn_transactions_snapshot(:'org', 400)->>'version',
  'farm-os.transactions.v1', 'snapshot version is pinned');
select is(public.fn_transactions_snapshot(:'org', 400)->>'org_id', :'org',
  'snapshot binds the requested organization');
select is((public.fn_transactions_snapshot(:'org', 400)->>'row_limit')::integer, 400,
  'snapshot echoes the bounded row limit');
select is((public.fn_transactions_snapshot(:'org', 400)->>'party_mismatch_count')::integer, 0,
  'same-organization party references pass the database integrity gate');
select is(
  (public.fn_transactions_snapshot(:'org', 400)->'counts'->>'expense')::bigint
    - (current_setting('test.baseline')::jsonb->'counts'->>'expense')::bigint,
  1::bigint, 'cancelled expenses are excluded from the exact visible count');
select is(
  (public.fn_transactions_snapshot(:'org', 400)->'counts'->>'sale')::bigint
    - (current_setting('test.baseline')::jsonb->'counts'->>'sale')::bigint,
  2::bigint, 'finalized and pending sales are counted');
select is(
  (public.fn_transactions_snapshot(:'org', 400)->'counts'->>'collection')::bigint
    - (current_setting('test.baseline')::jsonb->'counts'->>'collection')::bigint,
  1::bigint, 'collection exact count increments once');
select is(
  (public.fn_transactions_snapshot(:'org', 400)->'counts'->>'custody')::bigint
    - (current_setting('test.baseline')::jsonb->'counts'->>'custody')::bigint,
  1::bigint, 'custody exact count increments once');
select is(
  (public.fn_transactions_snapshot(:'org', 400)->'counts'->>'pending_price')::bigint
    - (current_setting('test.baseline')::jsonb->'counts'->>'pending_price')::bigint,
  1::bigint, 'pending-price count uses the visible-sale lifecycle');
select is((select row->>'amount' from jsonb_array_elements(
    public.fn_transactions_snapshot(:'org', 400)->'rows') row
    where row->>'id' = '21400000-0000-0000-0000-000000000010'),
  '100000000000000.01', 'expense money remains exact text');
select is((select jsonb_typeof(row->'amount') from jsonb_array_elements(
    public.fn_transactions_snapshot(:'org', 400)->'rows') row
    where row->>'id' = '21400000-0000-0000-0000-000000000010'),
  'string', 'expense money is a JSON string');
select is((select row->>'amount' from jsonb_array_elements(
    public.fn_transactions_snapshot(:'org', 400)->'rows') row
    where row->>'id' = '21400000-0000-0000-0000-000000000020'),
  '900000000000000.02', 'finalized-sale money remains exact text');
select is((select row->>'quantity' from jsonb_array_elements(
    public.fn_transactions_snapshot(:'org', 400)->'rows') row
    where row->>'id' = '21400000-0000-0000-0000-000000000021'),
  '0.123456789', 'pending-sale quantity remains exact text');
select is((select row->>'amount' from jsonb_array_elements(
    public.fn_transactions_snapshot(:'org', 400)->'rows') row
    where row->>'id' = '21400000-0000-0000-0000-000000000021'),
  null, 'pending sale keeps an honest null amount');
select is((select row->>'pending_price' from jsonb_array_elements(
    public.fn_transactions_snapshot(:'org', 400)->'rows') row
    where row->>'id' = '21400000-0000-0000-0000-000000000021'),
  'true', 'pending sale carries its explicit state');
select is((select row->>'amount' from jsonb_array_elements(
    public.fn_transactions_snapshot(:'org', 400)->'rows') row
    where row->>'id' = '21400000-0000-0000-0000-000000000030'),
  '0.02', 'collection money remains exact text');
select is((select row->>'amount' from jsonb_array_elements(
    public.fn_transactions_snapshot(:'org', 400)->'rows') row
    where row->>'id' = '21400000-0000-0000-0000-000000000040'),
  '0.03', 'custody money remains exact text');
select is((select row->>'direction' from jsonb_array_elements(
    public.fn_transactions_snapshot(:'org', 400)->'rows') row
    where row->>'id' = '21400000-0000-0000-0000-000000000040'),
  'in', 'custody direction is derived in PostgreSQL');
select is((select row->>'party_name' from jsonb_array_elements(
    public.fn_transactions_snapshot(:'org', 400)->'rows') row
    where row->>'id' = '21400000-0000-0000-0000-000000000010'),
  'مورد اللقطة الدقيق', 'expense supplier is resolved inside the snapshot');
select is((select row->>'party_name' from jsonb_array_elements(
    public.fn_transactions_snapshot(:'org', 400)->'rows') row
    where row->>'id' = '21400000-0000-0000-0000-000000000020'),
  'مشتري اللقطة الدقيق', 'sale buyer is resolved inside the snapshot');
select is((select row->>'party_name' from jsonb_array_elements(
    public.fn_transactions_snapshot(:'org', 400)->'rows') row
    where row->>'id' = '21400000-0000-0000-0000-000000000040'),
  'عهدة اللقطة', 'custody holder is resolved inside the snapshot');
select is((select count(*)::integer from jsonb_array_elements(
    public.fn_transactions_snapshot(:'org', 400)->'rows') row
    where row->>'id' = '21400000-0000-0000-0000-000000000011'),
  0, 'cancelled expense is absent from the returned rows');
select is((select count(*)::integer from jsonb_array_elements(
    public.fn_transactions_snapshot(:'org', 400)->'rows') row
    where row->>'id' = '21400000-0000-0000-0000-000000000012'),
  0, 'historically reversed expense is absent from the returned rows');
select is((select count(*)::integer from jsonb_array_elements(
    public.fn_transactions_snapshot(:'org', 400)->'rows') row
    where row->>'id' = '21400000-0000-0000-0000-000000000022'),
  0, 'historically reversed sale is absent from the returned rows');
select ok(position(
  'coalesce(e.payment_status, '''') not in (''cancelled'', ''historical_reversed'')'
  in pg_get_functiondef('public.fn_transactions_snapshot(uuid, integer)'::regprocedure)) > 0,
  'expense lifecycle filter is pinned in the database function');
select ok(position(
  's.payment_status <> ''historical_reversed'''
  in pg_get_functiondef('public.fn_transactions_snapshot(uuid, integer)'::regprocedure)) > 0,
  'sale lifecycle filter is pinned in the database function');
select is(jsonb_array_length(public.fn_transactions_snapshot(:'org', 1)->'rows'), 4,
  'a limit of one returns one row from each implemented source');
select throws_ok(format($$select public.fn_transactions_snapshot(%L, 0)$$, :'org'),
  '22023', null, 'invalid row limit fails closed');
select throws_ok($$select public.fn_transactions_snapshot(null, 400)$$,
  '23502', null, 'null organization fails closed');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$select public.fn_transactions_snapshot(%L, 400)$$, :'org'),
  'accountant can read the same-organization transactions snapshot');
select throws_ok(format($$select public.fn_transactions_snapshot(%L, 400)$$, :'org_b'),
  '42501', null, 'accountant cannot read another organization snapshot');
reset role;

select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$select public.fn_transactions_snapshot(%L, 400)$$, :'org'),
  '42501', null, 'supervisor cannot read the finance snapshot');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.before_cap', public.fn_transactions_snapshot(:'org', 400)::text, false);
reset role;

insert into public.expenses(id, org_id, date, category, description, total, kind, payment_status)
select ('21410000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
  :'org', date '2100-01-01' + g, 'اختبار الحد', 'مصروف ' || g, 1, 'operating', null
from generate_series(1, 401) g;
insert into public.sales(
  id, org_id, sale_date, crop, qty, unit, unit_price, total, price_status, payment_status)
select ('21420000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
  :'org', date '2100-01-01' + g, 'برحي', 1, 'كجم', 1, 1, 'finalized', 'unpaid'
from generate_series(1, 401) g;
insert into public.sale_collections(id, org_id, sale_id, amount, occurred_at, collected_by)
select ('21430000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
  :'org', ('21420000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
  0.01, date '2100-01-01' + g, 'اختبار الحد'
from generate_series(1, 401) g;
insert into public.custody_movements(
  id, org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out, note)
select ('21440000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
  :'org', '21400000-0000-0000-0000-000000000005', date '2100-01-01' + g,
  'استلام عهدة', 0.01, 0, 'حركة ' || g
from generate_series(1, 401) g;

select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.cap_snapshot', public.fn_transactions_snapshot(:'org', 400)::text, false);
select is((current_setting('test.cap_snapshot')::jsonb->'counts'->>'expense')::bigint
    - (current_setting('test.before_cap')::jsonb->'counts'->>'expense')::bigint,
  401::bigint, 'expense exact count includes all 401 rows beyond the sample cap');
select is((current_setting('test.cap_snapshot')::jsonb->'counts'->>'sale')::bigint
    - (current_setting('test.before_cap')::jsonb->'counts'->>'sale')::bigint,
  401::bigint, 'sale exact count includes all 401 rows beyond the sample cap');
select is((current_setting('test.cap_snapshot')::jsonb->'counts'->>'collection')::bigint
    - (current_setting('test.before_cap')::jsonb->'counts'->>'collection')::bigint,
  401::bigint, 'collection exact count includes all 401 rows beyond the sample cap');
select is((current_setting('test.cap_snapshot')::jsonb->'counts'->>'custody')::bigint
    - (current_setting('test.before_cap')::jsonb->'counts'->>'custody')::bigint,
  401::bigint, 'custody exact count includes all 401 rows beyond the sample cap');
select is((select count(*)::integer from jsonb_array_elements(
    current_setting('test.cap_snapshot')::jsonb->'rows') row where row->>'type' = 'expense'),
  400, 'expense sample is capped at exactly 400 rows');
select is((select count(*)::integer from jsonb_array_elements(
    current_setting('test.cap_snapshot')::jsonb->'rows') row where row->>'type' = 'sale'),
  400, 'sale sample is capped at exactly 400 rows');
select is((select count(*)::integer from jsonb_array_elements(
    current_setting('test.cap_snapshot')::jsonb->'rows') row where row->>'type' = 'collection'),
  400, 'collection sample is capped at exactly 400 rows');
select is((select count(*)::integer from jsonb_array_elements(
    current_setting('test.cap_snapshot')::jsonb->'rows') row where row->>'type' = 'custody'),
  400, 'custody sample is capped at exactly 400 rows');
select is((select row->>'id' from jsonb_array_elements(
    current_setting('test.cap_snapshot')::jsonb->'rows') row where row->>'type' = 'expense' limit 1),
  '21410000-0000-0000-0000-000000000401', 'expense sample is newest-first');
select is((select row->>'id' from jsonb_array_elements(
    current_setting('test.cap_snapshot')::jsonb->'rows') row where row->>'type' = 'sale' limit 1),
  '21420000-0000-0000-0000-000000000401', 'sale sample is newest-first');
select is((select row->>'id' from jsonb_array_elements(
    current_setting('test.cap_snapshot')::jsonb->'rows') row where row->>'type' = 'collection' limit 1),
  '21430000-0000-0000-0000-000000000401', 'collection sample is newest-first');
select is((select row->>'id' from jsonb_array_elements(
    current_setting('test.cap_snapshot')::jsonb->'rows') row where row->>'type' = 'custody' limit 1),
  '21440000-0000-0000-0000-000000000401', 'custody sample is newest-first');
select is((select count(*)::integer from jsonb_array_elements(
    current_setting('test.cap_snapshot')::jsonb->'rows') row
    where row->>'id' = '21410000-0000-0000-0000-000000000001'),
  0, 'expense sample excludes its 401st oldest row');
select is((select count(*)::integer from jsonb_array_elements(
    current_setting('test.cap_snapshot')::jsonb->'rows') row
    where row->>'id' = '21420000-0000-0000-0000-000000000001'),
  0, 'sale sample excludes its 401st oldest row');
select is((select count(*)::integer from jsonb_array_elements(
    current_setting('test.cap_snapshot')::jsonb->'rows') row
    where row->>'id' = '21430000-0000-0000-0000-000000000001'),
  0, 'collection sample excludes its 401st oldest row');
select is((select count(*)::integer from jsonb_array_elements(
    current_setting('test.cap_snapshot')::jsonb->'rows') row
    where row->>'id' = '21440000-0000-0000-0000-000000000001'),
  0, 'custody sample excludes its 401st oldest row');
reset role;

insert into public.expenses(id, org_id, date, category, supplier_id, total, kind, payment_status)
values ('21400000-0000-0000-0000-000000000050', :'org', date '2200-01-01', 'Cross tenant',
  '21400000-0000-0000-0000-000000000002', 1, 'operating', null);
insert into public.sales(
  id, org_id, sale_date, crop, buyer_id, qty, unit, unit_price, total, price_status, payment_status)
values ('21400000-0000-0000-0000-000000000051', :'org', date '2200-01-02', 'Cross tenant',
  '21400000-0000-0000-0000-000000000004', 1, 'كجم', 1, 1, 'finalized', 'unpaid');
insert into public.custody_movements(
  id, org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out)
values ('21400000-0000-0000-0000-000000000052', :'org',
  '21400000-0000-0000-0000-000000000006', date '2200-01-03', 'Cross tenant', 1, 0);

select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_transactions_snapshot(%L, 400)$$, :'org'),
  '23514', 'transactions snapshot party mismatch',
  'foreign supplier, buyer, and custody names never leave the database function');
reset role;

select * from finish();
rollback;
