-- Exact, bounded custody report pack with tenant and finance gates.
begin;
select no_plan();

\set org '21600000-0000-0000-0000-0000000000a0'
\set org_b '21600000-0000-0000-0000-0000000000b0'
\set account '21600000-0000-0000-0000-000000000001'
\set account_b '21600000-0000-0000-0000-000000000002'
\set request '21600000-0000-0000-0000-000000000003'

select set_config('test.today', ((pg_catalog.now() at time zone 'Africa/Cairo')::date)::text, false);
select set_config('test.period_start', (current_setting('test.today')::date - 7)::text, false);

select set_config('test.owner', (select user_id::text from public.organization_member
  where role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where role = 'accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member
  where role = 'supervisor' limit 1), false);

insert into public.organization(id, name) values
  (:'org', 'Exact custody reports org'),
  (:'org_b', 'Exact custody reports foreign org');
insert into public.organization_member(org_id, user_id, role) values
  (:'org', current_setting('test.owner')::uuid, 'owner'),
  (:'org', current_setting('test.accountant')::uuid, 'accountant'),
  (:'org', current_setting('test.supervisor')::uuid, 'supervisor');

insert into public.custody_accounts(id, org_id, holder_label, target_float) values
  (:'account', :'org', 'عهدة التقرير الدقيق', 9007199254740993.123456789012345678),
  (:'account_b', :'org_b', 'عهدة أجنبية', 1);
insert into public.payment_requests(
  id, org_id, request_no, period_start, period_end, status, custody_account_id,
  approved_post_paid_total, approved_custody_top_up, approved_net_request
) values (
  :'request', :'org', 216, current_setting('test.period_start')::date, current_setting('test.today')::date,
  'approved_final', :'account',
  1000, 0, 1000
);

set local session_replication_role = replica;
insert into public.custody_movements(
  id, org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out
) values (
  '21600000-0000-0000-0000-000000000010', :'org', :'account', current_setting('test.period_start')::date - 1,
  'رصيد سابق دقيق', 9007199254740993.123456789012345678, 0
);

insert into public.expenses(
  id, org_id, date, category, description, total, status, payment_status, kind
)
select
  ('21600000-0000-0000-0000-' || lpad((100000 + i)::text, 12, '0'))::uuid,
  :'org', current_setting('test.period_start')::date + ((i - 1) % 8), 'نقدي', 'مصروف عهدة ' || i,
  case when i = 1 then 9007199254740993.123456789012345678::numeric else 1::numeric end,
  'approved', 'paid_from_custody', 'operating'
from generate_series(1, 401) i;

insert into public.custody_movements(
  id, org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out, expense_id
)
select
  ('21600000-0000-0000-0000-' || lpad((200000 + i)::text, 12, '0'))::uuid,
  :'org', :'account', current_setting('test.period_start')::date + ((i - 1) % 8), 'صرف نقدي', 0,
  case when i = 1 then 9007199254740993.123456789012345678::numeric else 1::numeric end,
  ('21600000-0000-0000-0000-' || lpad((100000 + i)::text, 12, '0'))::uuid
from generate_series(1, 401) i;

insert into public.expenses(
  id, org_id, date, category, description, total, status, payment_status, kind
) values (
  '21600000-0000-0000-0000-000000000020', :'org', current_setting('test.today')::date, 'نقدي',
  'مصروف بلا مبلغ أو حركة', null, 'approved', 'paid_from_custody', 'operating'
);

insert into public.expenses(
  id, org_id, date, category, description, total, status, payment_status, kind
)
select
  ('21600000-0000-0000-0000-' || lpad((300000 + i)::text, 12, '0'))::uuid,
  :'org', case when i = 1 then null else current_setting('test.today')::date - 68 + ((i - 2) % 10) end,
  'آجل', 'التزام ' || i, case when i = 1 then null else 2::numeric end,
  'approved', 'post_paid_unpaid', 'operating'
from generate_series(1, 401) i;

insert into public.expenses(
  id, org_id, date, category, description, total, status, payment_status, kind
) values (
  '21600000-0000-0000-0000-000000000030', :'org', current_setting('test.today')::date + 1, 'آجل',
  'التزام مستقبلي لا يدخل لقطة 8 أغسطس', 999, 'approved', 'post_paid_unpaid', 'operating'
);

insert into public.payment_request_fundings(
  id, org_id, payment_request_id, custody_account_id, occurred_at, amount, note
)
select
  ('21600000-0000-0000-0000-' || lpad((400000 + i)::text, 12, '0'))::uuid,
  :'org', :'request', :'account', current_setting('test.period_start')::date + ((i - 1) % 8), 1, 'تمويل ' || i
from generate_series(1, 401) i;
set local session_replication_role = origin;

select ok(not has_function_privilege('public',
  'public.fn_custody_reports_snapshot(uuid,date,date,date,integer)', 'EXECUTE'),
  'PUBLIC cannot execute the custody reports snapshot');
select ok(not has_function_privilege('anon',
  'public.fn_custody_reports_snapshot(uuid,date,date,date,integer)', 'EXECUTE'),
  'anon cannot execute the custody reports snapshot');
select ok(has_function_privilege('authenticated',
  'public.fn_custody_reports_snapshot(uuid,date,date,date,integer)', 'EXECUTE'),
  'authenticated reaches the in-function finance gate');
select has_index('public', 'expenses', 'custody_reports_expenses_status_date_idx',
  'custody report expense status/date access has an index');
select has_index('public', 'payment_request_fundings', 'custody_reports_fundings_org_date_idx',
  'custody report funding date access has an index');
select ok(exists (
  select 1
  from pg_catalog.pg_index i
  join pg_catalog.pg_class c on c.oid = i.indexrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'prl_expense_once_uniq'
    and i.indisunique
    and i.indpred is null
), 'one request line per expense prevents obligation multiplication');
select ok(exists (
  select 1
  from pg_catalog.pg_index i
  join pg_catalog.pg_class c on c.oid = i.indexrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'custody_movements_one_out_per_expense_uniq'
    and i.indisunique
    and i.indpred is not null
), 'one active custody cash-out per expense prevents cash total multiplication');
select ok((select prosecdef from pg_proc
  where oid = 'public.fn_custody_reports_snapshot(uuid,date,date,date,integer)'::regprocedure),
  'custody reports snapshot is security definer');
select is((select provolatile::text from pg_proc
  where oid = 'public.fn_custody_reports_snapshot(uuid,date,date,date,integer)'::regprocedure),
  's', 'custody reports snapshot is stable');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.accountant'));
select set_config('test.snapshot', public.fn_custody_reports_snapshot(
  :'org', current_setting('test.period_start')::date, current_setting('test.today')::date,
  current_setting('test.today')::date, 400)::text, false);
select lives_ok(format($$select public.fn_custody_reports_snapshot(
  %L, %L::date, %L::date, %L::date, 400)$$, :'org', current_setting('test.period_start'),
  current_setting('test.today'), current_setting('test.today')),
  'accountant can read the exact custody report pack');
select is(current_setting('test.snapshot')::jsonb->>'version', 'farm-os.custody-reports.v1',
  'snapshot version is pinned');
select is(current_setting('test.snapshot')::jsonb->>'org_id', :'org',
  'snapshot binds the active organization');
select is(current_setting('test.snapshot')::jsonb->>'period_start', current_setting('test.period_start'),
  'snapshot echoes the period start');
select is(current_setting('test.snapshot')::jsonb->>'period_end', current_setting('test.today'),
  'snapshot echoes the period end');
select is(current_setting('test.snapshot')::jsonb->>'as_of', current_setting('test.today'),
  'snapshot echoes the obligations as-of date');
select is((current_setting('test.snapshot')::jsonb->>'relationship_mismatch_count')::integer, 0,
  'clean same-organization references pass');

select is(current_setting('test.snapshot')::jsonb->'summary'->>'opening_total',
  '9007199254740993.123456789012345678', 'opening custody remains exact text');
select is(current_setting('test.snapshot')::jsonb->'summary'->>'period_out',
  '9007199254741393.123456789012345678', '401 cash movements sum exactly beyond JavaScript precision');
select is(current_setting('test.snapshot')::jsonb->'summary'->>'cash_total',
  '9007199254741393.123456789012345678', 'cash expense total remains exact text');
select is((current_setting('test.snapshot')::jsonb->'summary'->>'cash_count')::integer, 402,
  'cash count includes the explicit missing-money/movement row');
select is((current_setting('test.snapshot')::jsonb->'summary'->>'cash_missing_movement_count')::integer, 1,
  'missing cash movement count is exact');
select is((current_setting('test.snapshot')::jsonb->'summary'->>'cash_unknown_total_count')::integer, 1,
  'unknown cash amount count is exact');
select is((current_setting('test.snapshot')::jsonb->'summary'->>'movement_count')::integer, 401,
  'movement count is exact beyond the sample');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'movements'), 400,
  'movement detail is capped at 400');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'cash_expenses'), 400,
  'cash detail is capped at 400');
select is((select jsonb_typeof(row->'amount_out')
  from jsonb_array_elements(current_setting('test.snapshot')::jsonb->'movements') row limit 1),
  'string', 'movement money crosses JSON as text');
select is((select row->>'target_float'
  from jsonb_array_elements(current_setting('test.snapshot')::jsonb->'holders') row
  where row->>'id' = :'account'),
  '9007199254740993.123456789012345678', 'holder target remains exact text');

select is((current_setting('test.snapshot')::jsonb->'summary'->>'obligation_count')::integer, 401,
  'future-dated obligation is excluded from the as-of snapshot');
select is((current_setting('test.snapshot')::jsonb->'summary'->>'obligation_unknown_total_count')::integer, 1,
  'unknown obligation amount is explicit');
select is((current_setting('test.snapshot')::jsonb->'summary'->>'obligation_unknown_date_count')::integer, 1,
  'unknown obligation date is explicit');
select is((current_setting('test.snapshot')::jsonb->'summary'->>'over_30_count')::integer, 400,
  'only dated 30-plus obligations enter the aged count');
select is((current_setting('test.snapshot')::jsonb->'summary'->>'over_30_unknown_total_count')::integer, 0,
  'the unknown-date obligation does not contaminate aged money');
select is(current_setting('test.snapshot')::jsonb->'summary'->>'obligation_total', '800',
  'known obligation total excludes unknown and future amounts');
select is(current_setting('test.snapshot')::jsonb->'summary'->>'over_30_total', '800',
  '30-plus total uses only dated known obligations');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'obligations'), 400,
  'obligation detail is capped at 400');
select is((select row->>'aging_bucket'
  from jsonb_array_elements(current_setting('test.snapshot')::jsonb->'obligations') row
  where row->>'id' = '21600000-0000-0000-0000-000000300001'),
  'unknown', 'missing date is not mislabeled as a current obligation');

select is((current_setting('test.snapshot')::jsonb->'summary'->>'funding_count')::integer, 401,
  'funding count is exact beyond the sample');
select is(current_setting('test.snapshot')::jsonb->'summary'->>'funding_total', '401',
  'funding total is exact');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'fundings'), 400,
  'funding detail is capped at 400');
select is((select row->>'remaining_to_fund'
  from jsonb_array_elements(current_setting('test.snapshot')::jsonb->'fundings') row limit 1),
  '599', 'funding context uses the exact request snapshot once per request');

select throws_ok(format($$select public.fn_custody_reports_snapshot(
  %L, %L::date, %L::date, %L::date, 400)$$, :'org', current_setting('test.today'),
  (current_setting('test.today')::date - 1)::text, current_setting('test.today')),
  '22007', null, 'inverted report period is rejected');
select throws_ok(format($$select public.fn_custody_reports_snapshot(
  %L, %L::date, %L::date, %L::date, 400)$$, :'org', current_setting('test.period_start'),
  (current_setting('test.today')::date + 1)::text, current_setting('test.today')),
  '22007', null, 'future period end is rejected on the Cairo calendar');
select throws_ok(format($$select public.fn_custody_reports_snapshot(
  %L, %L::date, %L::date, %L::date, 400)$$, :'org', current_setting('test.period_start'),
  current_setting('test.today'), (current_setting('test.today')::date + 1)::text),
  '22007', null, 'future obligations as-of date is rejected on the Cairo calendar');
select throws_ok(format($$select public.fn_custody_reports_snapshot(
  %L, %L::date, %L::date, %L::date, 400)$$, :'org', current_setting('test.period_start'),
  current_setting('test.today'), (current_setting('test.today')::date - 1)::text),
  '22007', null, 'historical obligations as-of date is rejected because status has no historical ledger');
select throws_ok(format($$select public.fn_custody_reports_snapshot(
  %L, %L::date, %L::date, %L::date, 401)$$, :'org', current_setting('test.period_start'),
  current_setting('test.today'), current_setting('test.today')),
  '22023', null, 'row limit above the explicit cap is rejected');
select throws_ok(format($$select public.fn_custody_reports_snapshot(
  %L, %L::date, %L::date, %L::date, 400)$$, :'org_b', current_setting('test.period_start'),
  current_setting('test.today'), current_setting('test.today')),
  '42501', null, 'accountant cannot read a foreign organization snapshot');
reset role;

select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$select public.fn_custody_reports_snapshot(
  %L, %L::date, %L::date, %L::date, 400)$$, :'org', current_setting('test.period_start'),
  current_setting('test.today'), current_setting('test.today')),
  '42501', null, 'non-finance role cannot read custody reports');
reset role;

set local session_replication_role = replica;
insert into public.custody_movements(
  id, org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out
) values (
  '21600000-0000-0000-0000-000000000099', :'org', :'account_b', current_setting('test.today')::date,
  'مرجع أجنبي تالف', 1, 0
);
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_custody_reports_snapshot(
  %L, %L::date, %L::date, %L::date, 400)$$, :'org', current_setting('test.period_start'),
  current_setting('test.today'), current_setting('test.today')),
  '23514', null, 'cross-organization custody account fails inside the snapshot');
reset role;

delete from public.custody_movements
where id = '21600000-0000-0000-0000-000000000099';
set local session_replication_role = replica;
insert into public.custody_movements(
  id, org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out
) values (
  '21600000-0000-0000-0000-000000000097', :'org_b', :'account_b', current_setting('test.today')::date,
  'عكس أجنبي تالف', 1, 0
);
update public.custody_movements
set reversed_by = '21600000-0000-0000-0000-000000000097', reversed_at = pg_catalog.now()
where id = '21600000-0000-0000-0000-000000200001';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_custody_reports_snapshot(
  %L, %L::date, %L::date, %L::date, 400)$$, :'org', current_setting('test.period_start'),
  current_setting('test.today'), current_setting('test.today')),
  '23514', null, 'cross-organization reversal link fails inside the snapshot');
reset role;

select * from finish();
rollback;
