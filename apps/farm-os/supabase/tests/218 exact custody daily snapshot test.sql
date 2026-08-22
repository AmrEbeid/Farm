-- Exact, atomic daily custody workspace: role gate, tenant integrity, bounded rows, and decimal transport.
begin;
select no_plan();

\set org '21800000-0000-0000-0000-0000000000a0'
\set org_b '21800000-0000-0000-0000-0000000000b0'
\set account '21800000-0000-0000-0000-000000000001'
\set account_b '21800000-0000-0000-0000-000000000002'

select set_config('test.today', ((pg_catalog.now() at time zone 'Africa/Cairo')::date)::text, false);
select set_config('test.month_start', date_trunc('month', current_setting('test.today')::date)::date::text, false);
select set_config('test.month_end', (date_trunc('month', current_setting('test.today')::date) + interval '1 month')::date::text, false);
select set_config('test.owner', (select user_id::text from public.organization_member where role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member where role = 'accountant' limit 1), false);
select set_config('test.denied', (select user_id::text from public.organization_member where role = 'storekeeper' limit 1), false);

insert into public.organization(id, name) values
  (:'org', 'Exact custody daily org'),
  (:'org_b', 'Exact custody daily foreign org');
insert into public.organization_member(org_id, user_id, role) values
  (:'org', current_setting('test.owner')::uuid, 'owner'),
  (:'org', current_setting('test.accountant')::uuid, 'accountant'),
  (:'org', current_setting('test.denied')::uuid, 'storekeeper');
insert into public.custody_accounts(id, org_id, holder_label, holder_user_id, target_float) values
  (:'account', :'org', 'المحاسب', current_setting('test.accountant')::uuid, 9007199254740993.123456789),
  (:'account_b', :'org_b', 'عهدة أجنبية', null, 0);
insert into public.custody_movements(
  id, org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out, created_at
) values
  ('21800000-0000-0000-0000-000000000101', :'org', :'account', current_setting('test.today')::date,
   'تمويل دقيق', 9007199254740993.123456789, 0, pg_catalog.now()),
  ('21800000-0000-0000-0000-000000000102', :'org', :'account', current_setting('test.today')::date,
   'صرف', 0, 0.01, pg_catalog.now() - interval '1 minute');
insert into public.payment_requests(id, org_id, request_no, status, custody_account_id, created_at) values
  ('21800000-0000-0000-0000-000000000201', :'org', 1, 'draft', :'account', pg_catalog.now() - interval '3 minutes'),
  ('21800000-0000-0000-0000-000000000202', :'org', 2, 'submitted', :'account', pg_catalog.now() - interval '2 minutes'),
  ('21800000-0000-0000-0000-000000000203', :'org', 3, 'closed', :'account', pg_catalog.now() - interval '1 minute');
insert into public.expenses(
  id, org_id, date, category, total, status, payment_status, kind
) values (
  '21800000-0000-0000-0000-000000000301', :'org', current_setting('test.today')::date,
  'تشغيل', 9007199254740993.123456789, 'approved', 'post_paid_unpaid', 'operating'
);

select ok(not has_function_privilege('public',
  'public.fn_custody_daily_snapshot(uuid,text,date,date,integer,integer)', 'EXECUTE'),
  'PUBLIC cannot execute the custody daily snapshot');
select ok(not has_function_privilege('anon',
  'public.fn_custody_daily_snapshot(uuid,text,date,date,integer,integer)', 'EXECUTE'),
  'anon cannot execute the custody daily snapshot');
select ok(has_function_privilege('authenticated',
  'public.fn_custody_daily_snapshot(uuid,text,date,date,integer,integer)', 'EXECUTE'),
  'authenticated reaches the finance gate inside the snapshot');
select ok((select prosecdef from pg_proc
  where oid = 'public.fn_custody_daily_snapshot(uuid,text,date,date,integer,integer)'::regprocedure),
  'custody daily snapshot is security definer');
select is((select provolatile::text from pg_proc
  where oid = 'public.fn_custody_daily_snapshot(uuid,text,date,date,integer,integer)'::regprocedure),
  's', 'custody daily snapshot is stable');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.snapshot', public.fn_custody_daily_snapshot(
  :'org', 'awaiting', current_setting('test.month_start')::date, current_setting('test.month_end')::date, 1, 1
)::text, false);
select is(current_setting('test.snapshot')::jsonb->>'version', 'farm-os.custody-daily.v1',
  'snapshot version is pinned');
select is(current_setting('test.snapshot')::jsonb->>'org_id', :'org',
  'snapshot binds the requested organization');
select is(current_setting('test.snapshot')::jsonb->>'request_filter', 'awaiting',
  'snapshot echoes the selected request filter');
select is((current_setting('test.snapshot')::jsonb->>'movement_count')::integer, 2,
  'movement count covers the full organization');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'movements'), 1,
  'movement detail obeys its requested bound');
select is(current_setting('test.snapshot')::jsonb->'movements'->0->>'amount_in',
  '9007199254740993.123456789', 'same-day movement window uses posting time before UUID and keeps exact money');
select is(current_setting('test.snapshot')::jsonb->'accounts'->0->>'target_float',
  '9007199254740993.123456789', 'target float remains exact decimal text');
select is(current_setting('test.snapshot')::jsonb->'accounts'->0->>'closing_balance',
  '9007199254740993.113456789', 'derived custody balance remains exact decimal text');
select is((current_setting('test.snapshot')::jsonb->>'all_request_count')::integer, 3,
  'all request count covers the full organization');
select is((current_setting('test.snapshot')::jsonb->>'awaiting_request_count')::integer, 1,
  'awaiting request count is exact');
select is((current_setting('test.snapshot')::jsonb->>'settled_request_count')::integer, 1,
  'settled request count is exact');
select is((current_setting('test.snapshot')::jsonb->>'selected_request_count')::integer, 1,
  'selected request count matches the active filter');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'requests'), 1,
  'request detail obeys its requested bound');
select is(current_setting('test.snapshot')::jsonb->'requests'->0->>'status', 'submitted',
  'request rows obey the awaiting filter');
select is(current_setting('test.snapshot')::jsonb->'expense_summary'->>'unpaid_operating_total',
  '9007199254740993.123456789', 'unpaid expense total shares the exact snapshot response');
select lives_ok(format($$select public.fn_custody_daily_snapshot(
  %L, 'settled', %L::date, %L::date, 15, 200)$$,
  :'org', current_setting('test.month_start'), current_setting('test.month_end')),
  'owner can select the settled request view');
select throws_ok(format($$select public.fn_custody_daily_snapshot(
  %L, 'invalid', %L::date, %L::date, 15, 200)$$,
  :'org', current_setting('test.month_start'), current_setting('test.month_end')),
  '22023', null, 'unknown request filter is rejected');
select throws_ok(format($$select public.fn_custody_daily_snapshot(
  %L, 'all', %L::date, %L::date, 0, 200)$$,
  :'org', current_setting('test.month_start'), current_setting('test.month_end')),
  '22023', null, 'zero movement limit is rejected');
select throws_ok(format($$select public.fn_custody_daily_snapshot(
  %L, 'all', %L::date, %L::date, 15, 501)$$,
  :'org', current_setting('test.month_start'), current_setting('test.month_end')),
  '22023', null, 'request limit above the contract is rejected');
select throws_ok(format($$select public.fn_custody_daily_snapshot(
  %L, 'all', %L::date, %L::date, 15, 200)$$,
  :'org_b', current_setting('test.month_start'), current_setting('test.month_end')),
  '42501', null, 'cross-organization snapshot is rejected');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$select public.fn_custody_daily_snapshot(
  %L, 'all', %L::date, %L::date, 15, 200)$$,
  :'org', current_setting('test.month_start'), current_setting('test.month_end')),
  'accountant can read the custody daily snapshot');
reset role;

select pg_temp.as_user(current_setting('test.denied'));
select throws_ok(format($$select public.fn_custody_daily_snapshot(
  %L, 'all', %L::date, %L::date, 15, 200)$$,
  :'org', current_setting('test.month_start'), current_setting('test.month_end')),
  '42501', null, 'non-finance role cannot read the custody daily snapshot');
reset role;

-- The single-column FK permits a privileged bad row; the snapshot refuses to hide tenant corruption.
insert into public.payment_requests(id, org_id, request_no, status, custody_account_id)
values ('21800000-0000-0000-0000-000000000204', :'org', 4, 'draft', :'account_b');
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_custody_daily_snapshot(
  %L, 'all', %L::date, %L::date, 15, 200)$$,
  :'org', current_setting('test.month_start'), current_setting('test.month_end')),
  '23514', null, 'cross-organization request custody corruption fails closed');
reset role;

delete from public.payment_requests where id = '21800000-0000-0000-0000-000000000204';
insert into public.custody_movements(
  id, org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out
) values (
  '21800000-0000-0000-0000-000000000103', :'org', :'account_b', current_setting('test.today')::date,
  'حركة أجنبية', 1, 0
);
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_custody_daily_snapshot(
  %L, 'all', %L::date, %L::date, 15, 200)$$,
  :'org', current_setting('test.month_start'), current_setting('test.month_end')),
  '23514', null, 'cross-organization movement custody corruption fails closed');
reset role;

select * from finish();
rollback;
