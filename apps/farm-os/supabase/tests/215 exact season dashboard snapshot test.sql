-- Exact, one-statement harvest/revenue season cockpit with finance and tenant gates.
begin;
select plan(70);

\set org '21500000-0000-0000-0000-0000000000a0'
\set org_b '21500000-0000-0000-0000-0000000000b0'

select set_config('test.owner', (select user_id::text from public.organization_member
  where role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where role = 'accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member
  where role = 'supervisor' limit 1), false);
select isnt(current_setting('test.owner'), '', 'fixture: owner exists');
select isnt(current_setting('test.accountant'), '', 'fixture: accountant exists');
select isnt(current_setting('test.supervisor'), '', 'fixture: supervisor exists');

insert into public.organization(id, name) values
  (:'org', 'Exact season org'),
  (:'org_b', 'Exact season foreign org');
insert into public.organization_member(org_id, user_id, role) values
  (:'org', current_setting('test.owner')::uuid, 'owner'),
  (:'org', current_setting('test.accountant')::uuid, 'accountant'),
  (:'org', current_setting('test.supervisor')::uuid, 'supervisor');

select ok(not has_function_privilege('anon',
  'public.fn_season_dashboard_snapshot(uuid, date, date, integer)', 'EXECUTE'),
  'anon cannot execute the season snapshot');
select ok(has_function_privilege('authenticated',
  'public.fn_season_dashboard_snapshot(uuid, date, date, integer)', 'EXECUTE'),
  'authenticated receives execute before the in-function finance gate');
select has_index('public', 'sales', 'season_sales_org_event_date_idx',
  'season sales range and newest-first sample have a matching index');
select ok((select prosecdef from pg_proc
  where oid = 'public.fn_season_dashboard_snapshot(uuid,date,date,integer)'::regprocedure),
  'season snapshot is security definer');
select is((select provolatile::text from pg_proc
  where oid = 'public.fn_season_dashboard_snapshot(uuid,date,date,integer)'::regprocedure),
  's', 'season snapshot is stable');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

insert into public.buyers(id, org_id, name) values
  ('21500000-0000-0000-0000-000000000001', :'org', 'تاجر الموسم'),
  ('21500000-0000-0000-0000-000000000002', :'org_b', 'Foreign buyer');
insert into public.cost_centers(id, org_id, code, name_ar, area_feddan, active) values
  ('21500000-0000-0000-0000-000000000003', :'org', 'SEASON-A', 'حوش الموسم', 2.5, true),
  ('21500000-0000-0000-0000-000000000004', :'org_b', 'SEASON-B', 'Foreign center', 3, true);

insert into public.sales(
  id, org_id, sale_date, delivery_date, created_at, crop, buyer_id, cost_center_id,
  qty, unit, unit_price, total, price_status, payment_status, delivery_note_no, crates)
values
  ('21500000-0000-0000-0000-000000000010', :'org', date '2026-08-02', date '2026-08-02',
   timestamptz '2026-08-02 10:00:00+03', 'برحي', '21500000-0000-0000-0000-000000000001',
   '21500000-0000-0000-0000-000000000003', 100000000000000.123456789, 'كجم',
   9, 900000000000000.02, 'finalized', 'partially_collected', 1, 10.5),
  ('21500000-0000-0000-0000-000000000011', :'org', null, date '2026-08-03',
   timestamptz '2026-08-03 10:00:00+03', 'برحي', null,
   '21500000-0000-0000-0000-000000000003', 0.5, 'كجم',
   null, null, 'pending', 'unpaid', 2, 2),
  ('21500000-0000-0000-0000-000000000012', :'org', null, date '2026-08-04',
   timestamptz '2026-08-04 10:00:00+03', 'برحي', null,
   '21500000-0000-0000-0000-000000000003', null, 'كجم',
   null, null, 'pending', 'unpaid', 3, null),
  ('21500000-0000-0000-0000-000000000013', :'org', date '2026-07-31', date '2026-07-31',
   timestamptz '2026-08-01 10:00:00+03', 'برحي', null, null, 99, 'كجم',
   null, null, 'pending', 'unpaid', 4, 1),
  ('21500000-0000-0000-0000-000000000014', :'org', date '2026-08-09', date '2026-08-09',
   timestamptz '2026-08-08 10:00:00+03', 'برحي', null, null, 99, 'كجم',
   null, null, 'pending', 'unpaid', 5, 1);
select public.fn_post_two_line_journal(
  :'org', date '2026-08-02', 'sale', '21500000-0000-0000-0000-000000000010',
  'Season fixture revenue',
  public.fn_ensure_account(:'org', '1200', 'ذمم مدينة (عملاء)', 'asset', 'debit'),
  public.fn_ensure_account(:'org', '4000', 'إيرادات المبيعات', 'revenue', 'credit'),
  900000000000000.02, 'Receivable', 'Revenue', null, null, null, null);
insert into public.sale_collections(id, org_id, sale_id, amount, occurred_at, collected_by)
values ('21500000-0000-0000-0000-000000000020', :'org',
  '21500000-0000-0000-0000-000000000010', 0.02, date '2026-08-05', 'المحاسب');
insert into public.harvest_days(id, org_id, day, cost_center_id, crop, crates_picked)
values ('21500000-0000-0000-0000-000000000030', :'org', date '2026-08-04',
  '21500000-0000-0000-0000-000000000003', 'برحي', 12.5);

set local session_replication_role = replica;
insert into public.sales(
  id, org_id, sale_date, delivery_date, created_at, crop, qty, unit, unit_price, total,
  price_status, payment_status)
values
  ('21500000-0000-0000-0000-000000000015', :'org', date '2020-01-01', date '2020-01-01',
   timestamptz '2026-08-05 10:00:00+03', 'برحي', 7, 'كجم', 1, 7,
   'finalized', 'historical_treasury'),
  ('21500000-0000-0000-0000-000000000016', :'org', date '2020-01-01', date '2020-01-01',
   timestamptz '2026-08-06 10:00:00+03', 'برحي', 8, 'كجم', 1, 8,
   'finalized', 'historical_reversed');
set local session_replication_role = origin;

select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.snapshot', public.fn_season_dashboard_snapshot(
  :'org', date '2026-08-01', date '2026-08-08', 400)::text, false);
select lives_ok(format($$select public.fn_season_dashboard_snapshot(%L, date '2026-08-01', date '2026-08-08', 400)$$, :'org'),
  'owner can read the exact season snapshot');
select is(current_setting('test.snapshot')::jsonb->>'version', 'farm-os.season-dashboard.v1',
  'snapshot version is pinned');
select is(current_setting('test.snapshot')::jsonb->>'org_id', :'org',
  'snapshot binds the requested organization');
select is(current_setting('test.snapshot')::jsonb->>'from', '2026-08-01',
  'snapshot echoes the season start');
select is(current_setting('test.snapshot')::jsonb->>'as_of', '2026-08-08',
  'snapshot echoes the Cairo as-of date');
select is((current_setting('test.snapshot')::jsonb->>'row_limit')::integer, 400,
  'snapshot echoes the row limit');
select is((current_setting('test.snapshot')::jsonb->>'party_mismatch_count')::integer, 0,
  'same-organization party references pass the database gate');
select is((current_setting('test.snapshot')::jsonb->'summary'->>'delivery_count')::integer, 3,
  'only visible in-window deliveries are counted');
select is((current_setting('test.snapshot')::jsonb->'summary'->>'trader_count')::integer, 1,
  'distinct named traders are exact');
select is((current_setting('test.snapshot')::jsonb->'summary'->>'unnamed_count')::integer, 2,
  'unnamed delivery count is exact');
select is((current_setting('test.snapshot')::jsonb->'summary'->>'unknown_qty_count')::integer, 1,
  'null quantity remains an explicit unknown');
select is((current_setting('test.snapshot')::jsonb->'summary'->>'pending_count')::integer, 2,
  'pending-price count is exact');
select is((current_setting('test.snapshot')::jsonb->'summary'->>'pending_unknown_qty_count')::integer, 1,
  'pending delivery with null quantity is explicit');
select is(current_setting('test.snapshot')::jsonb->'summary'->>'delivered_qty',
  '100000000000000.623456789', 'delivered quantity remains exact text');
select is(current_setting('test.snapshot')::jsonb->'summary'->>'pending_qty',
  '0.5', 'pending quantity remains exact text');
select is(current_setting('test.snapshot')::jsonb->'summary'->>'finalized_total',
  '900000000000000.02', 'finalized revenue remains exact text');
select is(current_setting('test.snapshot')::jsonb->'summary'->>'collected_total',
  '0.02', 'collections remain exact text');
select is((current_setting('test.snapshot')::jsonb->'summary'->>'outstanding_total')::numeric,
  900000000000000::numeric, 'outstanding is computed exactly in PostgreSQL');
select is(current_setting('test.snapshot')::jsonb->'summary'->>'picked_crates',
  '12.5', 'field-picked crates remain exact text');
select is(current_setting('test.snapshot')::jsonb->'summary'->>'delivered_crates',
  '12.5', 'delivered crates reconcile only crops counted in the field');
select is((select row->>'amount' from jsonb_array_elements(
    current_setting('test.snapshot')::jsonb->'rows') row
    where row->>'id' = '21500000-0000-0000-0000-000000000010'),
  '900000000000000.02', 'delivery money is JSON text without precision loss');
select is((select jsonb_typeof(row->'amount') from jsonb_array_elements(
    current_setting('test.snapshot')::jsonb->'rows') row
    where row->>'id' = '21500000-0000-0000-0000-000000000010'),
  'string', 'delivery money is encoded as a JSON string');
select is((select row->>'quantity' from jsonb_array_elements(
    current_setting('test.snapshot')::jsonb->'rows') row
    where row->>'id' = '21500000-0000-0000-0000-000000000010'),
  '100000000000000.123456789', 'delivery quantity is exact text');
select is((select row->>'amount' from jsonb_array_elements(
    current_setting('test.snapshot')::jsonb->'rows') row
    where row->>'id' = '21500000-0000-0000-0000-000000000011'),
  null, 'pending delivery keeps an honest null amount');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'centers'), 1,
  'center summary returns the one referenced center');
select is((current_setting('test.snapshot')::jsonb->'centers'->0->>'delivery_count')::integer, 3,
  'center delivery count includes all visible center-linked rows');
select is((current_setting('test.snapshot')::jsonb->'centers'->0->>'unknown_qty_count')::integer, 1,
  'center summary discloses its unknown quantity');
select is(current_setting('test.snapshot')::jsonb->'centers'->0->>'quantity',
  '100000000000000.623456789', 'center quantity remains exact');
select is(current_setting('test.snapshot')::jsonb->'centers'->0->>'quantity_per_feddan',
  null, 'per-feddan quantity is withheld when a center quantity is unknown');
select is(current_setting('test.snapshot')::jsonb->'centers'->0->>'finalized_total',
  '900000000000000.02', 'center finalized revenue remains exact');
select is((select count(*)::integer from jsonb_array_elements(
    current_setting('test.snapshot')::jsonb->'rows') row
    where row->>'id' in (
      '21500000-0000-0000-0000-000000000013',
      '21500000-0000-0000-0000-000000000014',
      '21500000-0000-0000-0000-000000000015',
      '21500000-0000-0000-0000-000000000016')),
  0, 'out-of-window and historical deliveries are absent from rows');
select is(jsonb_array_length(public.fn_season_dashboard_snapshot(
    :'org', date '2026-08-01', date '2026-08-08', 1)->'rows'),
  1, 'row limit one returns one newest delivery');
reset role;
insert into public.sales(
  id, org_id, sale_date, delivery_date, created_at, crop, qty, unit, unit_price, total,
  price_status, payment_status)
values ('21500000-0000-0000-0000-000000000017', :'org', date '2026-08-05', date '2026-08-05',
  timestamptz '2026-08-05 11:00:00+03', 'برحي', 1, 'كجم', 10, 10,
  'finalized', 'unpaid');
select public.fn_post_two_line_journal(
  :'org', date '2026-08-05', 'sale', '21500000-0000-0000-0000-000000000017',
  'Reversed season fixture revenue',
  public.fn_ensure_account(:'org', '1200', 'ذمم مدينة (عملاء)', 'asset', 'debit'),
  public.fn_ensure_account(:'org', '4000', 'إيرادات المبيعات', 'revenue', 'credit'),
  10, 'Receivable', 'Revenue', null, null, null, null);
set local session_replication_role = replica;
update public.journal_entries
set status = 'reversed'
where org_id = :'org' and source_type = 'sale'
  and source_id = '21500000-0000-0000-0000-000000000017';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.reversed_snapshot', public.fn_season_dashboard_snapshot(
  :'org', date '2026-08-01', date '2026-08-08', 400)::text, false);
select is((current_setting('test.reversed_snapshot')::jsonb->'summary'->>'delivery_count')::integer,
  4, 'reversed revenue does not hide the physical delivery');
select is((current_setting('test.reversed_snapshot')::jsonb->'summary'->>'invalid_revenue_count')::integer,
  1, 'reversed revenue remains an explicit season exception');
select is(current_setting('test.reversed_snapshot')::jsonb->'summary'->>'finalized_total',
  '900000000000000.02', 'reversed revenue does not inflate booked season revenue');
select is((select row->>'amount' from jsonb_array_elements(
    current_setting('test.reversed_snapshot')::jsonb->'rows') row
    where row->>'id' = '21500000-0000-0000-0000-000000000017'),
  null, 'reversed revenue amount is withheld from the delivery row');
select is((select (row->>'revenue_posted')::boolean from jsonb_array_elements(
    current_setting('test.reversed_snapshot')::jsonb->'rows') row
    where row->>'id' = '21500000-0000-0000-0000-000000000017'),
  false, 'reversed delivery is labelled as not posted');
reset role;
insert into public.sales(
  id, org_id, sale_date, delivery_date, created_at, crop, cost_center_id, qty, unit,
  unit_price, total, price_status, payment_status)
values
  ('21500000-0000-0000-0000-000000000018', :'org', date '2026-08-06', date '2026-08-06',
   timestamptz '2026-08-06 11:00:00+03', 'برحي', '21500000-0000-0000-0000-000000000003',
   2, 'كجم', 10, 20, 'finalized', 'partially_collected'),
  ('21500000-0000-0000-0000-000000000019', :'org', date '2026-08-06', date '2026-08-06',
   timestamptz '2026-08-06 12:00:00+03', 'برحي', null,
   3, 'كجم', 10, 30, 'finalized', 'unpaid');
select public.fn_post_two_line_journal(
  :'org', date '2026-08-06', 'sale', '21500000-0000-0000-0000-000000000018',
  'Malformed season fixture revenue',
  public.fn_ensure_account(:'org', '1200', 'ذمم مدينة (عملاء)', 'asset', 'debit'),
  public.fn_ensure_account(:'org', '4000', 'إيرادات المبيعات', 'revenue', 'credit'),
  20, 'Receivable', 'Revenue', null, null, null, null);
set local session_replication_role = replica;
insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit, description)
select :'org', je.id,
  public.fn_ensure_account(:'org', '1200', 'ذمم مدينة (عملاء)', 'asset', 'debit'),
  1, 0, 'Malformed extra line'
from public.journal_entries je
where je.org_id = :'org' and je.source_type = 'sale'
  and je.source_id = '21500000-0000-0000-0000-000000000018';
set local session_replication_role = origin;
insert into public.sale_collections(id, org_id, sale_id, amount, occurred_at, collected_by)
values ('21500000-0000-0000-0000-000000000021', :'org',
  '21500000-0000-0000-0000-000000000018', 5, date '2026-08-06', 'المحاسب');
select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.invalid_snapshot', public.fn_season_dashboard_snapshot(
  :'org', date '2026-08-01', date '2026-08-08', 400)::text, false);
select is((current_setting('test.invalid_snapshot')::jsonb->'summary'->>'delivery_count')::integer,
  6, 'missing and malformed journals do not hide physical deliveries');
select is((current_setting('test.invalid_snapshot')::jsonb->'summary'->>'invalid_revenue_count')::integer,
  3, 'reversed, missing, and malformed revenue journals are all explicit exceptions');
select is(current_setting('test.invalid_snapshot')::jsonb->'summary'->>'finalized_total',
  '900000000000000.02', 'missing and malformed journals cannot inflate booked revenue');
select is(current_setting('test.invalid_snapshot')::jsonb->'summary'->>'collected_total',
  '0.02', 'collections attached to invalid revenue are excluded');
select is((current_setting('test.invalid_snapshot')::jsonb->'summary'->>'outstanding_total')::numeric,
  900000000000000::numeric, 'invalid revenue and its collections cannot distort outstanding');
select is(current_setting('test.invalid_snapshot')::jsonb->'centers'->0->>'finalized_total',
  '900000000000000.02', 'malformed center revenue is excluded from the center total');
select is((select row->>'amount' from jsonb_array_elements(
    current_setting('test.invalid_snapshot')::jsonb->'rows') row
    where row->>'id' = '21500000-0000-0000-0000-000000000018'),
  null, 'malformed journal revenue amount is withheld from the row');
select throws_ok($$select public.fn_season_dashboard_snapshot(null, date '2026-08-01', date '2026-08-08', 400)$$,
  '23502', null, 'null organization fails closed');
select throws_ok(format($$select public.fn_season_dashboard_snapshot(%L, date '2026-08-09', date '2026-08-08', 400)$$, :'org'),
  '22007', null, 'reversed season window fails closed');
select throws_ok(format($$select public.fn_season_dashboard_snapshot(%L, date '2026-08-01', date '2999-01-01', 400)$$, :'org'),
  '22007', null, 'future as-of date fails closed');
select throws_ok(format($$select public.fn_season_dashboard_snapshot(%L, date '2026-08-01', date '2026-08-08', 0)$$, :'org'),
  '22023', null, 'invalid row limit fails closed');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$select public.fn_season_dashboard_snapshot(%L, date '2026-08-01', date '2026-08-08', 400)$$, :'org'),
  'accountant can read the same-organization season snapshot');
select throws_ok(format($$select public.fn_season_dashboard_snapshot(%L, date '2026-08-01', date '2026-08-08', 400)$$, :'org_b'),
  '42501', null, 'accountant cannot read another organization snapshot');
reset role;

select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$select public.fn_season_dashboard_snapshot(%L, date '2026-08-01', date '2026-08-08', 400)$$, :'org'),
  '42501', null, 'supervisor cannot read the finance snapshot');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.before_cap', public.fn_season_dashboard_snapshot(
  :'org', date '2026-08-01', date '2026-08-08', 400)::text, false);
reset role;
insert into public.sales(
  id, org_id, sale_date, delivery_date, created_at, crop, qty, unit,
  unit_price, total, price_status, payment_status, delivery_note_no)
select ('21510000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
  :'org', date '2026-08-07', date '2026-08-07',
  timestamptz '2026-08-07 00:00:00+03' + g * interval '1 second',
  'برحي', 1, 'كجم', null, null, 'pending', 'unpaid', 1000 + g
from generate_series(1, 401) g;
select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.cap_snapshot', public.fn_season_dashboard_snapshot(
  :'org', date '2026-08-01', date '2026-08-08', 400)::text, false);
select is((current_setting('test.cap_snapshot')::jsonb->'summary'->>'delivery_count')::bigint
    - (current_setting('test.before_cap')::jsonb->'summary'->>'delivery_count')::bigint,
  401::bigint, 'exact delivery count includes all 401 rows beyond the sample cap');
select is(jsonb_array_length(current_setting('test.cap_snapshot')::jsonb->'rows'),
  400, 'delivery sample is capped at exactly 400 rows');
select is(current_setting('test.cap_snapshot')::jsonb->'rows'->0->>'id',
  '21510000-0000-0000-0000-000000000401', 'delivery sample is newest-first');
select is((select count(*)::integer from jsonb_array_elements(
    current_setting('test.cap_snapshot')::jsonb->'rows') row
    where row->>'id' = '21510000-0000-0000-0000-000000000001'),
  0, 'delivery sample excludes its 401st oldest bulk row');
select is((current_setting('test.cap_snapshot')::jsonb->'summary'->>'pending_count')::bigint
    - (current_setting('test.before_cap')::jsonb->'summary'->>'pending_count')::bigint,
  401::bigint, 'pending-price total remains exact beyond the sample cap');
reset role;

insert into public.journal_entries(
  org_id, entry_date, source_type, source_id, source_sequence, description, status)
values (:'org', date '2026-08-02', 'sale',
  '21500000-0000-0000-0000-000000000010', 2,
  'Malformed posted sibling without lines', 'posted');
select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.sibling_snapshot', public.fn_season_dashboard_snapshot(
  :'org', date '2026-08-01', date '2026-08-08', 400)::text, false);
select is((current_setting('test.sibling_snapshot')::jsonb->'summary'->>'invalid_revenue_count')::integer,
  4, 'a valid journal plus malformed posted sibling invalidates the sale revenue');
select is(current_setting('test.sibling_snapshot')::jsonb->'summary'->>'finalized_total',
  '0', 'duplicate posted journals cannot contribute booked revenue');
select is(current_setting('test.sibling_snapshot')::jsonb->'summary'->>'collected_total',
  '0', 'duplicate posted journals cannot contribute collections');
select is(current_setting('test.sibling_snapshot')::jsonb->'summary'->>'outstanding_total',
  '0', 'duplicate posted journals cannot contribute outstanding receivables');
select is(current_setting('test.sibling_snapshot')::jsonb->'centers'->0->>'finalized_total',
  '0', 'duplicate posted journals cannot contribute center revenue');
reset role;

insert into public.sales(
  id, org_id, sale_date, delivery_date, created_at, crop, buyer_id, cost_center_id,
  qty, unit, unit_price, total, price_status, payment_status)
values ('21500000-0000-0000-0000-000000000050', :'org', date '2026-08-08', date '2026-08-08',
  timestamptz '2026-08-08 12:00:00+03', 'برحي',
  '21500000-0000-0000-0000-000000000002', '21500000-0000-0000-0000-000000000004',
  1, 'كجم', 1, 1, 'finalized', 'unpaid');
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_season_dashboard_snapshot(%L, date '2026-08-01', date '2026-08-08', 400)$$, :'org'),
  '23514', 'season snapshot party mismatch',
  'foreign buyer and cost-center data never leave the database function');
reset role;

select * from finish();
rollback;
