-- SPEC-0033 R3: owner home is active-org-only, exact, bounded, and keeps drawings separate.
begin;
select no_plan();

\set org '22300000-0000-0000-0000-0000000000a0'
\set org_b '22300000-0000-0000-0000-0000000000b0'
\set budget '22300000-0000-0000-0000-000000000001'
\set plan '22300000-0000-0000-0000-000000000002'
\set person '22300000-0000-0000-0000-000000000003'
\set item '22300000-0000-0000-0000-000000000004'

select set_config('test.today', ((pg_catalog.now() at time zone 'Africa/Cairo')::date)::text, false);
select set_config('test.owner', (select user_id::text from public.organization_member where role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member where role = 'accountant' limit 1), false);

insert into public.organization(id, name) values
  (:'org', 'Exact owner home org'),
  (:'org_b', 'Exact owner home foreign org');
insert into public.organization_member(org_id, user_id, role) values
  (:'org', current_setting('test.owner')::uuid, 'owner'),
  (:'org', current_setting('test.accountant')::uuid, 'accountant'),
  (:'org_b', current_setting('test.owner')::uuid, 'owner');

insert into public.data_authority_status(org_id, domain, status, source_label, record_count, notes)
select :'org', domain, 'verified', 'fixture', 1, 'verified test fixture'
from unnest(array['finance_ledger','palm_registry','offshoots','budgets','payroll','inventory','operations']) domain;

insert into public.budgets(id, org_id, name, approved) values
  (:'budget', :'org', 'موازنة اختبار', 9007199254740993.123456789);
insert into public.budget_lines(id, org_id, budget_id, category, approved, committed, actual)
select ('22300000-0000-0000-0000-' || lpad((100 + i)::text, 12, '0'))::uuid,
       :'org', :'budget', 'بند ' || i,
       case when i = 1 then 9007199254740993.123456789 else 100 end,
       case when i = 1 then 0.02 else 10 end,
       case when i = 1 then 0.01 else 5 end
from generate_series(1, 5) i;

insert into public.purchase_requests(id, org_id, code, requested_by, needed_by, reason, status)
select ('22300000-0000-0000-0000-' || lpad((200 + i)::text, 12, '0'))::uuid,
       :'org', 'PR-223-' || i,
       case when i = 1 then current_setting('test.owner')::uuid else current_setting('test.accountant')::uuid end,
       current_setting('test.today')::date + case when i >= 5 then -i else i end,
       'طلب ' || i,
       case when i >= 5 then 'approved' else 'submitted' end
from generate_series(1, 7) i;

insert into public.inventory_items(id, org_id, name, unit, reorder_point) values
  (:'item', :'org', 'سماد اختبار', 'كجم', 10),
  ('22300000-0000-0000-0000-000000000005', :'org', 'مخزون كاف', 'كجم', 5);
insert into public.inventory_bin(org_id, item_id, location, on_hand, reserved) values
  (:'org', :'item', 'main', 2, 1),
  (:'org', :'item', 'secondary', 3, 0),
  (:'org', '22300000-0000-0000-0000-000000000005', 'main', 8, 0);

insert into public.people(id, org_id, name, active) values
  (:'person', :'org', 'عامل اختبار', true);
insert into public.plans(id, org_id, status) values (:'plan', :'org', 'active');
insert into public.plan_operations(id, org_id, plan_id, subtype, planned_at, status)
select ('22300000-0000-0000-0000-' || lpad((300 + i)::text, 12, '0'))::uuid,
       :'org', :'plan', 'inspection', current_setting('test.today')::date + i, 'planned'
from generate_series(1, 4) i;
update public.plan_operations set subtype = 'fertilization'
 where id = '22300000-0000-0000-0000-000000000301';
insert into public.plan_operations(id, org_id, plan_id, subtype, planned_at, status, responsible_person_id)
values ('22300000-0000-0000-0000-000000000399', :'org', :'plan', 'inspection',
        current_setting('test.today')::date, 'done', :'person');
insert into public.plan_checks(id, org_id, plan_id, kind, result) values
  ('22300000-0000-0000-0000-000000000401', :'org', :'plan', 'stock', 'block');

insert into public.assets(id, org_id, type, status, archived) values
  ('22300000-0000-0000-0000-000000000501', :'org', 'palm', 'active', false),
  ('22300000-0000-0000-0000-000000000502', :'org', 'palm', 'watch', false),
  ('22300000-0000-0000-0000-000000000503', :'org', 'palm', 'dead', true);

insert into public.sales(id, org_id, crop, price_status, payment_status)
values ('22300000-0000-0000-0000-000000000601', :'org', 'برحي', 'pending', 'unpaid');
insert into public.expenses(id, org_id, date, category, description, total, status, payment_status, kind)
values
  ('22300000-0000-0000-0000-000000000701', :'org', current_setting('test.today')::date,
   'تشغيل', 'مصروف تشغيل', 9007199254740993.123456789, 'approved', 'post_paid_unpaid', 'operating'),
  ('22300000-0000-0000-0000-000000000702', :'org', current_setting('test.today')::date,
   'مسحوبات', 'مسحوبات مالك', 50, 'approved', 'post_paid_unpaid', 'drawing'),
  ('22300000-0000-0000-0000-000000000703', :'org', current_setting('test.today')::date,
   'تشغيل', 'قيمة مجهولة', null, 'approved', 'post_paid_unpaid', 'operating');

select ok(not has_function_privilege('public',
  'public.fn_owner_home_snapshot(uuid,date,integer)', 'EXECUTE'),
  'PUBLIC cannot execute the owner home snapshot');
select ok(not has_function_privilege('anon',
  'public.fn_owner_home_snapshot(uuid,date,integer)', 'EXECUTE'),
  'anon cannot execute the owner home snapshot');
select ok(has_function_privilege('authenticated',
  'public.fn_owner_home_snapshot(uuid,date,integer)', 'EXECUTE'),
  'authenticated reaches the internal owner and active-org gates');
select ok(not (select prosecdef from pg_proc
  where oid = 'public.fn_owner_home_snapshot(uuid,date,integer)'::regprocedure),
  'owner home snapshot keeps caller RLS through SECURITY INVOKER');
select is((select provolatile::text from pg_proc
  where oid = 'public.fn_owner_home_snapshot(uuid,date,integer)'::regprocedure),
  's', 'owner home snapshot is stable');
select is((select proconfig[1] from pg_proc
  where oid = 'public.fn_owner_home_snapshot(uuid,date,integer)'::regprocedure),
  'search_path=""', 'owner home snapshot has an empty search_path');

create or replace function pg_temp.as_user(uid text, active_org uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when active_org is null then json_build_object('sub', uid, 'role', 'authenticated')
         else json_build_object('sub', uid, 'role', 'authenticated', 'active_org_id', active_org) end::text,
    true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.owner'), :'org');
select set_config('test.snapshot', public.fn_owner_home_snapshot(
  :'org', current_setting('test.today')::date, 2)::text, false);
select is(current_setting('test.snapshot')::jsonb->>'version', 'farm-os.owner-home.v1',
  'snapshot version is pinned');
select is(current_setting('test.snapshot')::jsonb->>'org_id', :'org',
  'snapshot is bound to the active organization');
select is(current_setting('test.snapshot')::jsonb->'authority'->>'budgets', 'verified',
  'snapshot carries the source authority status');
select is((current_setting('test.snapshot')::jsonb->'attention'->>'pending_agronomy_signoffs')::integer,
  1, 'owner attention includes pending dose and spray sign-offs');
select is((current_setting('test.snapshot')::jsonb->'attention'->>'pending_payment_approvals')::integer,
  0, 'owner attention includes the payment approval queue');
select is((current_setting('test.snapshot')::jsonb->'state'->'budget'->>'line_count')::integer, 5,
  'budget count is exact independently from bounded detail');
select is(current_setting('test.snapshot')::jsonb->'state'->'budget'->>'approved',
  '9007199254741393.123456789', 'budget money remains exact decimal text');
select is(jsonb_typeof(current_setting('test.snapshot')::jsonb->'state'->'budget'->'line_count'),
  'string', 'bigint counts transport as exact strings');
select is((current_setting('test.snapshot')::jsonb->'attention'->>'pending_purchase_approvals')::integer,
  3, 'approval count excludes the owner own request');
select is((current_setting('test.snapshot')::jsonb->'attention'->>'overdue_purchase_requests')::integer,
  3, 'overdue count is exact across all requests');
select is((current_setting('test.snapshot')::jsonb->'state'->'inventory'->>'reorder_count')::integer,
  1, 'inventory availability sums bounded bin state exactly');
select is(current_setting('test.snapshot')::jsonb->'drivers'->'stock_shortages'->0->>'available',
  '4', 'shortage driver reports summed on-hand less reserved');
select is((current_setting('test.snapshot')::jsonb->'state'->'operations'->>'active_count')::integer,
  5, 'active operation count includes every operation in active plans');
select is((current_setting('test.snapshot')::jsonb->'state'->'operations'->>'unassigned_count')::integer,
  4, 'unassigned operation count is exact');
select is((current_setting('test.snapshot')::jsonb->'attention'->>'blocked_plan_checks')::integer,
  1, 'blocked checks are exact');
select is((current_setting('test.snapshot')::jsonb->'state'->'palms'->>'palm_count')::integer,
  2, 'archived palms do not enter the live count');
select is(jsonb_typeof(current_setting('test.snapshot')::jsonb->'state'->'farm_registry'->'barhi_count'),
  'string', 'registry quantities transport as exact strings');
select ok(not (current_setting('test.snapshot')::jsonb->'state' ? 'revenue'),
  'owner snapshot carries no unbounded nested revenue array');
select is((current_setting('test.snapshot')::jsonb->'state'->'expense_follow_up'->>'non_drawing_count')::integer,
  2, 'operating follow-up remains separate from owner drawings');
select is(current_setting('test.snapshot')::jsonb->'state'->'expense_follow_up'->>'non_drawing_total',
  '9007199254740993.123456789', 'known non-drawing money remains exact');
select is((current_setting('test.snapshot')::jsonb->'state'->'expense_follow_up'->>'non_drawing_unknown_count')::integer,
  1, 'unknown non-drawing money is explicit');
select is((current_setting('test.snapshot')::jsonb->'state'->'expense_follow_up'->>'owner_drawing_count')::integer,
  1, 'owner drawing count is returned in a separate field');
select is(current_setting('test.snapshot')::jsonb->'state'->'expense_follow_up'->>'owner_drawing_total',
  '50', 'owner drawing total is never merged into operating expense');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'purchase_requests'),
  2, 'purchase request drivers obey the detail limit');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'budget_pressure'),
  2, 'budget drivers obey the detail limit');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'drivers'->'due_operations'),
  2, 'operation drivers obey the detail limit');
reset role;

select pg_temp.as_user(current_setting('test.accountant'), :'org');
select throws_ok(format($$select public.fn_owner_home_snapshot(%L, %L::date, 8)$$,
  :'org', current_setting('test.today')), '42501', null,
  'accountant membership cannot read the owner-only snapshot');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format($$select public.fn_owner_home_snapshot(%L, %L::date, 8)$$,
  :'org', current_setting('test.today')), '42501', null,
  'missing active organization claim fails closed');
reset role;

select pg_temp.as_user(current_setting('test.owner'), :'org_b');
select throws_ok(format($$select public.fn_owner_home_snapshot(%L, %L::date, 8)$$,
  :'org', current_setting('test.today')), '42501', null,
  'active organization mismatch fails closed');
reset role;

select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_owner_home_snapshot(%L, %L::date, 0)$$,
  :'org', current_setting('test.today')), '22023', null,
  'zero detail limit is rejected');
select throws_ok(format($$select public.fn_owner_home_snapshot(%L, %L::date, 21)$$,
  :'org', current_setting('test.today')), '22023', null,
  'detail limit above the contract is rejected');
select throws_ok(format($$select public.fn_owner_home_snapshot(%L, (%L::date - 1), 8)$$,
  :'org', current_setting('test.today')), '22007', null,
  'stale as-of date is rejected');
reset role;

set local session_replication_role = replica;
insert into public.inventory_items(id, org_id, name) values
  ('22300000-0000-0000-0000-000000000999', :'org_b', 'صنف أجنبي');
insert into public.inventory_bin(org_id, item_id, location, on_hand) values
  (:'org', '22300000-0000-0000-0000-000000000999', 'corrupt', 1);
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_owner_home_snapshot(%L, %L::date, 8)$$,
  :'org', current_setting('test.today')), '23514', null,
  'cross-organization inventory corruption fails closed');
reset role;

set local session_replication_role = replica;
delete from public.inventory_bin
 where org_id = :'org' and item_id = '22300000-0000-0000-0000-000000000999';
delete from public.inventory_items
 where id = '22300000-0000-0000-0000-000000000999';
insert into public.people(id, org_id, name, active) values
  ('22300000-0000-0000-0000-000000000998', :'org_b', 'مسؤول أجنبي', true);
update public.plan_operations
   set responsible_person_id = '22300000-0000-0000-0000-000000000998'
 where id = '22300000-0000-0000-0000-000000000301';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'), :'org');
select throws_ok(format($$select public.fn_owner_home_snapshot(%L, %L::date, 8)$$,
  :'org', current_setting('test.today')), '23514', null,
  'cross-organization responsible person corruption fails closed');
reset role;

select * from finish();
rollback;
