begin;
select plan(20);

\set org '00000000-0000-0000-0000-000000000001'
\set org_b '15000000-0000-0000-0000-0000000000b0'

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

create or replace function pg_temp.post_sale_journal(
  p_org uuid,
  p_sale uuid,
  p_amount numeric,
  p_status text default 'posted')
returns uuid language plpgsql as $$
declare
  v_debit uuid;
  v_credit uuid;
  v_entry uuid;
begin
  select id into v_debit
    from public.accounts
   where org_id = p_org and account_type = 'asset'
   order by code, id
   limit 1;
  select id into v_credit
    from public.accounts
   where org_id = p_org and account_type = 'revenue'
   order by code, id
   limit 1;
  if v_debit is null or v_credit is null then
    raise exception 'test accounts missing for %', p_org;
  end if;
  v_entry := public.fn_post_two_line_journal(
    p_org, current_date, 'sale', p_sale, 'قيد اختبار', v_debit, v_credit, p_amount);
  if p_status = 'reversed' then
    update public.journal_entries set status = 'reversed' where id = v_entry;
  end if;
  return v_entry;
end $$;

select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.cc_a',
  (public.fn_save_cost_center(null, :'org', null, 'CC-150-A', 'مركز أ', null, 'برحي', 10, 1, true))->>'id', false);
select set_config('test.cc_b',
  (public.fn_save_cost_center(null, :'org', null, 'CC-150-B', 'مركز ب', null, 'عام', 5, 2, true))->>'id', false);
reset role;

insert into public.organization (id, name) values (:'org_b', 'مزرعة أخرى');

-- Two posted sales on center A. Each eligible sale must contribute exactly once.
insert into public.sales(org_id, sale_date, crop, cost_center_id, qty, unit, unit_price, total, price_status)
values (:'org', current_date, 'أ', current_setting('test.cc_a')::uuid, 12, 'كجم', 100, 1200, 'finalized')
returning set_config('test.sale_a1', id::text, false);
select pg_temp.post_sale_journal(:'org', current_setting('test.sale_a1')::uuid, 1200);

insert into public.sales(org_id, sale_date, crop, cost_center_id, qty, unit, unit_price, total, price_status)
values (:'org', current_date, 'أ', current_setting('test.cc_a')::uuid, 3, 'كجم', 100, 300, 'finalized')
returning set_config('test.sale_a2', id::text, false);
select pg_temp.post_sale_journal(:'org', current_setting('test.sale_a2')::uuid, 300);

-- Null-center posted revenue remains explicit rather than disappearing into a center.
insert into public.sales(org_id, sale_date, crop, qty, unit, unit_price, total, price_status)
values (:'org', current_date, 'غير موزع', 2, 'كجم', 100, 200, 'finalized')
returning set_config('test.sale_null', id::text, false);
select pg_temp.post_sale_journal(:'org', current_setting('test.sale_null')::uuid, 200);

-- Historical treasury is legitimate posted history and must remain in the all-history scorecards.
alter table public.sales disable trigger guard_historical_treasury_sale;
insert into public.sales(
  org_id, sale_date, crop, cost_center_id, qty, unit, unit_price, total, price_status, payment_status)
values (
  :'org', current_date, 'تاريخي', current_setting('test.cc_b')::uuid,
  6, 'كجم', 100, 600, 'finalized', 'historical_treasury')
returning set_config('test.sale_history', id::text, false);
select pg_temp.post_sale_journal(:'org', current_setting('test.sale_history')::uuid, 600);

-- Explicit exclusions: reversed journal, finalized without a posted journal, a posted header with no
-- revenue line, pending, and even a malformed historical-reversed row that still has a posted journal.
insert into public.sales(org_id, sale_date, crop, cost_center_id, qty, unit, unit_price, total, price_status)
values (:'org', current_date, 'معكوس', current_setting('test.cc_b')::uuid, 4, 'كجم', 100, 400, 'finalized')
returning set_config('test.sale_reversed', id::text, false);
select pg_temp.post_sale_journal(:'org', current_setting('test.sale_reversed')::uuid, 400, 'reversed');

insert into public.sales(org_id, sale_date, crop, cost_center_id, qty, unit, unit_price, total, price_status)
values (:'org', current_date, 'بلا قيد', current_setting('test.cc_b')::uuid, 5, 'كجم', 100, 500, 'finalized');
insert into public.sales(org_id, sale_date, crop, cost_center_id, qty, unit, unit_price, total, price_status)
values (:'org', current_date, 'رأس قيد فقط', current_setting('test.cc_b')::uuid, 11, 'كجم', 100, 1100, 'finalized')
returning set_config('test.sale_header_only', id::text, false);
insert into public.journal_entries(org_id, entry_date, source_type, source_id, status, description)
values (:'org', current_date, 'sale', current_setting('test.sale_header_only')::uuid, 'posted', 'رأس بلا سطور');
insert into public.sales(org_id, sale_date, crop, cost_center_id, qty, unit, price_status)
values (:'org', current_date, 'معلق', current_setting('test.cc_b')::uuid, 7, 'كجم', 'pending');
insert into public.sales(
  org_id, sale_date, crop, cost_center_id, qty, unit, unit_price, total, price_status, payment_status)
values (
  :'org', current_date, 'تاريخي معكوس', current_setting('test.cc_b')::uuid,
  8, 'كجم', 100, 800, 'finalized', 'historical_reversed')
returning set_config('test.sale_bad_history', id::text, false);
select pg_temp.post_sale_journal(:'org', current_setting('test.sale_bad_history')::uuid, 800);
alter table public.sales enable trigger guard_historical_treasury_sale;

-- A fully posted foreign-organization sale must never contribute.
insert into public.sales(org_id, sale_date, crop, qty, unit, unit_price, total, price_status)
values (:'org_b', current_date, 'بعيد', 90, 'كجم', 100, 9000, 'finalized')
returning set_config('test.sale_foreign', id::text, false);
select pg_temp.post_sale_journal(:'org_b', current_setting('test.sale_foreign')::uuid, 9000);

select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.summary', public.fn_cost_center_revenue_summary(:'org')::text, false);
select is((current_setting('test.summary')::jsonb->>'version'),
  'farm-os.cost-center-revenue-summary.v1', 'versioned response contract');
select is((current_setting('test.summary')::jsonb->>'org_id')::uuid,
  :'org'::uuid, 'response is bound to the requested active organization');
select is((current_setting('test.summary')::jsonb->>'total_revenue')::numeric,
  2300::numeric, 'total is exact and excludes reversed, unposted, pending, malformed reversed, and foreign sales');
select is((current_setting('test.summary')::jsonb->>'sale_count')::int,
  4, 'count covers each eligible sale exactly once');
select is(jsonb_array_length(current_setting('test.summary')::jsonb->'rows'),
  3, 'one row per nullable cost-center group');
select is((select (r->>'revenue')::numeric from jsonb_array_elements(current_setting('test.summary')::jsonb->'rows') r
  where r->>'cost_center_id' = current_setting('test.cc_a')),
  1500::numeric, 'center A revenue sums both sales');
select is((select (r->>'sale_count')::int from jsonb_array_elements(current_setting('test.summary')::jsonb->'rows') r
  where r->>'cost_center_id' = current_setting('test.cc_a')),
  2, 'center A count covers each eligible sale once');
select is((select (r->>'revenue')::numeric from jsonb_array_elements(current_setting('test.summary')::jsonb->'rows') r
  where r->>'cost_center_id' = current_setting('test.cc_b')),
  600::numeric, 'center B contains posted historical treasury only');
select is((select (r->>'sale_count')::int from jsonb_array_elements(current_setting('test.summary')::jsonb->'rows') r
  where r->>'cost_center_id' = current_setting('test.cc_b')),
  1, 'reversed, unposted, header-only, pending, and historical-reversed center B sales are excluded');
select is((select (r->>'revenue')::numeric from jsonb_array_elements(current_setting('test.summary')::jsonb->'rows') r
  where r->'cost_center_id' = 'null'::jsonb),
  200::numeric, 'null-center revenue is explicit');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select is((public.fn_cost_center_revenue_summary(:'org')->>'total_revenue')::numeric,
  2300::numeric, 'accountant can read the exact summary');
reset role;

select pg_temp.as_user(current_setting('test.storekeeper'));
select throws_ok(format('select public.fn_cost_center_revenue_summary(%L)', :'org'),
  '42501', null, 'non-finance role is rejected');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format('select public.fn_cost_center_revenue_summary(%L)', :'org_b'),
  '42501', null, 'cross-org request is rejected');
select throws_ok('select public.fn_cost_center_revenue_summary(null)',
  '23502', null, 'null organization is rejected');
reset role;

select ok(not has_function_privilege('anon',
  'public.fn_cost_center_revenue_summary(uuid)', 'EXECUTE'), 'anon cannot execute summary');
select ok(not has_function_privilege('public',
  'public.fn_cost_center_revenue_summary(uuid)', 'EXECUTE'), 'PUBLIC cannot execute summary');
select ok(has_function_privilege('authenticated',
  'public.fn_cost_center_revenue_summary(uuid)', 'EXECUTE'), 'authenticated can execute the gated summary');
select volatility_is('public', 'fn_cost_center_revenue_summary', array['uuid'], 'stable',
  'summary is stable');
select ok(
  (select p.prosecdef from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.oid = 'public.fn_cost_center_revenue_summary(uuid)'::regprocedure),
  'summary is security definer');
select is(
  (select array_to_string(p.proconfig, ',') from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_cost_center_revenue_summary'),
  'search_path=""', 'summary pins an empty search_path');

select * from finish();
rollback;
