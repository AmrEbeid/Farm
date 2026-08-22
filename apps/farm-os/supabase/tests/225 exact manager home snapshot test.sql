-- SPEC-0033 R3c: manager home is role-exact, active-org-only, bounded, and operational.
begin;
select no_plan();

\set org '22500000-0000-0000-0000-0000000000a0'
\set org_b '22500000-0000-0000-0000-0000000000b0'
\set plan '22500000-0000-0000-0000-000000000001'
\set person '22500000-0000-0000-0000-000000000002'
\set item '22500000-0000-0000-0000-000000000003'

select set_config('test.today', ((pg_catalog.now() at time zone 'Africa/Cairo')::date)::text, false);
select set_config('test.manager', (select user_id::text from public.organization_member where role = 'farm_manager' limit 1), false);
select set_config('test.owner', (select user_id::text from public.organization_member where role = 'owner' limit 1), false);
select set_config('test.agronomist', (select user_id::text from public.organization_member where role = 'agri_engineer' limit 1), false);

insert into public.organization(id, name) values
  (:'org', 'Exact manager home org'), (:'org_b', 'Exact manager foreign org');
insert into public.organization_member(org_id, user_id, role) values
  (:'org', current_setting('test.manager')::uuid, 'farm_manager'),
  (:'org', current_setting('test.owner')::uuid, 'owner'),
  (:'org', current_setting('test.agronomist')::uuid, 'agri_engineer'),
  (:'org_b', current_setting('test.manager')::uuid, 'farm_manager');
insert into public.data_authority_status(org_id, domain, status, source_label, record_count, notes) values
  (:'org', 'operations', 'verified', 'fixture', 6, 'verified test fixture'),
  (:'org', 'inventory', 'verified', 'fixture', 3, 'verified test fixture');

insert into public.people(id, org_id, name, active) values (:'person', :'org', 'مدير اختبار', true);
insert into public.plans(id, org_id, type, period_start, status)
values (:'plan', :'org', 'weekly', current_setting('test.today')::date - 2, 'active');

insert into public.plan_operations(id, org_id, plan_id, subtype, planned_at, ends_on, status, responsible_person_id) values
  ('22500000-0000-0000-0000-000000000101', :'org', :'plan', 'inspection', current_setting('test.today')::date - 3, null, 'planned', null),
  ('22500000-0000-0000-0000-000000000102', :'org', :'plan', 'irrigation', current_setting('test.today')::date - 1, current_setting('test.today')::date + 1, 'in_progress', :'person'),
  ('22500000-0000-0000-0000-000000000103', :'org', :'plan', 'harvest', current_setting('test.today')::date, null, 'ready', null),
  ('22500000-0000-0000-0000-000000000104', :'org', :'plan', 'inspection', null, null, 'planned', null),
  ('22500000-0000-0000-0000-000000000105', :'org', :'plan', 'fertilization', current_setting('test.today')::date + 2, null, 'planned', null),
  ('22500000-0000-0000-0000-000000000106', :'org', :'plan', 'inspection', current_setting('test.today')::date, null, 'done', null),
  ('22500000-0000-0000-0000-000000000107', :'org', :'plan', 'spraying', current_setting('test.today')::date + 3, null, 'planned', :'person');
set local session_replication_role = replica;
update public.plan_operations set signed_off_at = pg_catalog.now()
 where id = '22500000-0000-0000-0000-000000000105';
update public.plan_operations set signed_off_by = :'person'
 where id = '22500000-0000-0000-0000-000000000107';
set local session_replication_role = origin;
insert into public.plan_checks(id, org_id, plan_id, kind, result) values
  ('22500000-0000-0000-0000-000000000201', :'org', :'plan', 'stock', 'block');

insert into public.inventory_items(id, org_id, name, unit, reorder_point) values
  (:'item', :'org', 'سماد اختبار', 'كجم', 10),
  ('22500000-0000-0000-0000-000000000004', :'org', 'مخزون كاف', 'كجم', 5),
  ('22500000-0000-0000-0000-000000000005', :'org', 'رصيد غير معروف', 'كجم', 5),
  ('22500000-0000-0000-0000-000000000006', :'org', 'نافد بلا حد طلب', 'كجم', null);
insert into public.inventory_bin(org_id, item_id, location, on_hand, reserved) values
  (:'org', :'item', 'main', 3, 1),
  (:'org', '22500000-0000-0000-0000-000000000004', 'main', 8, 0),
  (:'org', '22500000-0000-0000-0000-000000000006', 'main', 0, 0);

select ok(not has_function_privilege('public', 'public.fn_manager_home_snapshot(uuid,date,integer)', 'EXECUTE'), 'PUBLIC cannot execute the manager home snapshot');
select ok(not has_function_privilege('anon', 'public.fn_manager_home_snapshot(uuid,date,integer)', 'EXECUTE'), 'anon cannot execute the manager home snapshot');
select ok(has_function_privilege('authenticated', 'public.fn_manager_home_snapshot(uuid,date,integer)', 'EXECUTE'), 'authenticated reaches internal gates');
select ok(not (select prosecdef from pg_proc where oid = 'public.fn_manager_home_snapshot(uuid,date,integer)'::regprocedure), 'snapshot is SECURITY INVOKER');
select is((select provolatile::text from pg_proc where oid = 'public.fn_manager_home_snapshot(uuid,date,integer)'::regprocedure), 's', 'snapshot is stable');
select is((select proconfig[1] from pg_proc where oid = 'public.fn_manager_home_snapshot(uuid,date,integer)'::regprocedure), 'search_path=""', 'snapshot has empty search_path');

create or replace function pg_temp.as_user(uid text, active_org uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', case when active_org is null
    then json_build_object('sub', uid, 'role', 'authenticated')
    else json_build_object('sub', uid, 'role', 'authenticated', 'active_org_id', active_org) end::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.manager'), :'org');
select set_config('test.snapshot', public.fn_manager_home_snapshot(:'org', current_setting('test.today')::date, 2)::text, false);
select is(current_setting('test.snapshot')::jsonb->>'version', 'farm-os.manager-home.v1', 'snapshot version is pinned');
select is(current_setting('test.snapshot')::jsonb->>'org_id', :'org', 'snapshot is bound to active organization');
select is(current_setting('test.snapshot')::jsonb->'authority'->>'operations', 'verified', 'snapshot carries operations authority');
select is((current_setting('test.snapshot')::jsonb->'state'->'operations'->>'open_count')::integer, 6, 'terminal work is excluded');
select is((current_setting('test.snapshot')::jsonb->'state'->'operations'->>'today_count')::integer, 2, 'today includes spanning work');
select is((current_setting('test.snapshot')::jsonb->'state'->'operations'->>'overdue_count')::integer, 1, 'overdue starts after effective end');
select is((current_setting('test.snapshot')::jsonb->'state'->'operations'->>'unscheduled_count')::integer, 1, 'unscheduled work stays visible');
select is((current_setting('test.snapshot')::jsonb->'state'->'operations'->>'unassigned_count')::integer, 4, 'assigned work is excluded from unassigned');
select is((current_setting('test.snapshot')::jsonb->'state'->>'blocked_plan_checks')::integer, 1, 'blocked active-plan checks stay visible');
select is((current_setting('test.snapshot')::jsonb->'state'->>'pending_agronomy_signoffs')::integer, 2, 'both asymmetric sign-off states stay advisory');
select is((current_setting('test.snapshot')::jsonb->'state'->'inventory'->>'below_threshold_count')::integer, 1, 'reorder threshold count is exact');
select is((current_setting('test.snapshot')::jsonb->'state'->'inventory'->>'out_of_stock_count')::integer, 1, 'known zero stock is counted even without a reorder threshold');
select is((current_setting('test.snapshot')::jsonb->'state'->'inventory'->>'unknown_stock_count')::integer, 1, 'an item without bins stays unknown instead of zero');
select is(current_setting('test.snapshot')::jsonb->'drivers'->'stock_below_threshold'->0->>'available', '2', 'availability is exact text');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'priority_operations'), 2, 'priority drivers obey limit');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'unassigned_operations'), 2, 'assignment drivers obey limit');
select ok(not (current_setting('test.snapshot')::jsonb ? 'finance'), 'snapshot exposes no finance branch');
reset role;

select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_manager_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')), '42501', null, 'owner is denied');
reset role;
select pg_temp.as_user(current_setting('test.agronomist'), :'org');
select throws_ok(format($$select public.fn_manager_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')), '42501', null, 'agronomist is denied');
reset role;
select pg_temp.as_user(current_setting('test.manager'));
select throws_ok(format($$select public.fn_manager_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')), '42501', null, 'missing active org fails closed');
reset role;
select pg_temp.as_user(current_setting('test.manager'), :'org_b');
select throws_ok(format($$select public.fn_manager_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')), '42501', null, 'active org mismatch fails closed');
reset role;
select pg_temp.as_user(current_setting('test.manager'), :'org');
select throws_ok(format($$select public.fn_manager_home_snapshot(%L, %L::date, 0)$$, :'org', current_setting('test.today')), '22023', null, 'zero detail limit rejected');
select throws_ok(format($$select public.fn_manager_home_snapshot(%L, (%L::date - 1), 8)$$, :'org', current_setting('test.today')), '22007', null, 'stale date rejected');
reset role;

set local session_replication_role = replica;
insert into public.inventory_items(id, org_id, name) values
  ('22500000-0000-0000-0000-000000000999', :'org_b', 'صنف أجنبي');
insert into public.inventory_bin(org_id, item_id, location, on_hand) values
  (:'org', '22500000-0000-0000-0000-000000000999', 'corrupt', 1);
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.manager'), :'org');
select throws_ok(format($$select public.fn_manager_home_snapshot(%L, %L::date, 8)$$, :'org', current_setting('test.today')),
  '23514', null, 'cross-organization inventory corruption fails closed');
reset role;

select * from finish();
rollback;
