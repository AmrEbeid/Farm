-- Exact atomic expense 360 core: role privacy, decimal transport, and tenant integrity.
begin;
select no_plan();

\set org '22000000-0000-0000-0000-0000000000a0'
\set org_b '22000000-0000-0000-0000-0000000000b0'
\set expense '22000000-0000-0000-0000-000000000001'
\set drawing '22000000-0000-0000-0000-000000000002'
\set supplier '22000000-0000-0000-0000-000000000003'
\set supplier_b '22000000-0000-0000-0000-000000000004'
\set account '22000000-0000-0000-0000-000000000005'
\set custody '22000000-0000-0000-0000-000000000006'
\set custody_b '22000000-0000-0000-0000-000000000007'
\set movement '22000000-0000-0000-0000-000000000008'
\set request '22000000-0000-0000-0000-00000000000a'
\set request_line '22000000-0000-0000-0000-00000000000b'

select set_config('test.owner', (select user_id::text from public.organization_member where role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member where role = 'accountant' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member where role = 'farm_manager' limit 1), false);
select set_config('test.denied', (select user_id::text from public.organization_member where role = 'storekeeper' limit 1), false);

insert into public.organization(id, name) values
  (:'org', 'Exact expense detail org'),
  (:'org_b', 'Exact expense detail foreign org');
insert into public.organization_member(org_id, user_id, role) values
  (:'org', current_setting('test.owner')::uuid, 'owner'),
  (:'org', current_setting('test.accountant')::uuid, 'accountant'),
  (:'org', current_setting('test.manager')::uuid, 'farm_manager'),
  (:'org', current_setting('test.denied')::uuid, 'storekeeper');
insert into public.suppliers(id, org_id, name) values
  (:'supplier', :'org', 'Local supplier'),
  (:'supplier_b', :'org_b', 'Foreign supplier');
insert into public.accounts(id, org_id, code, name_ar, account_type, normal_balance, kind) values
  (:'account', :'org', '2200', 'تشغيل تفصيلي', 'expense', 'debit', 'operating');
insert into public.custody_accounts(id, org_id, holder_label, target_float, active) values
  (:'custody', :'org', 'Local holder', 100, true),
  (:'custody_b', :'org_b', 'Foreign holder', 100, true);
insert into public.expenses(
  id, org_id, date, category, supplier_id, qty, unit, unit_price, total,
  status, payment_status, kind, account_id
) values
  (:'expense', :'org', current_date, 'تشغيل', :'supplier', 1.25, 'kg',
   7205759403792794.4987654312, 9007199254740993.123456789,
   'approved', 'paid_from_custody', 'operating', :'account'),
  (:'drawing', :'org', current_date, 'مسحوبات', null, null, null, null, 3.75,
   'approved', 'paid_by_owner', 'drawing', null);
insert into public.custody_movements(
  id, org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out, expense_id
) values
  (:'movement', :'org', :'custody', current_date, 'صرف نقدي', 0,
   9007199254740993.123456789, :'expense');

select ok(not has_function_privilege('public',
  'public.fn_expense_detail_snapshot(uuid,uuid)', 'EXECUTE'),
  'PUBLIC cannot execute expense detail snapshot');
select ok(not has_function_privilege('anon',
  'public.fn_expense_detail_snapshot(uuid,uuid)', 'EXECUTE'),
  'anon cannot execute expense detail snapshot');
select ok(has_function_privilege('authenticated',
  'public.fn_expense_detail_snapshot(uuid,uuid)', 'EXECUTE'),
  'authenticated reaches the internal role gate');
select ok((select prosecdef from pg_proc where oid =
  'public.fn_expense_detail_snapshot(uuid,uuid)'::regprocedure),
  'expense detail snapshot is security definer');
select is((select provolatile::text from pg_proc where oid =
  'public.fn_expense_detail_snapshot(uuid,uuid)'::regprocedure),
  's', 'expense detail snapshot is stable');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.snapshot', public.fn_expense_detail_snapshot(:'org', :'expense')::text, false);
select is(current_setting('test.snapshot')::jsonb->>'org_id', :'org', 'snapshot binds organization');
select is(current_setting('test.snapshot')::jsonb->>'expense_id', :'expense', 'snapshot binds expense');
select is(current_setting('test.snapshot')::jsonb->'expense'->>'total',
  '9007199254740993.123456789', 'expense total remains exact decimal text');
select is(current_setting('test.snapshot')::jsonb->'expense'->>'qty', '1.25',
  'expense quantity remains exact decimal text');
select is(current_setting('test.snapshot')::jsonb->'expense'->>'unit_price',
  '7205759403792794.4987654312', 'unit price remains exact decimal text');
select is(current_setting('test.snapshot')::jsonb->'movements'->0->>'amount_out',
  '9007199254740993.123456789', 'movement money remains exact decimal text');
select is(current_setting('test.snapshot')::jsonb->'movements'->0->>'custody_account_label',
  'Local holder', 'movement resolves the active-org custody account');
select is(current_setting('test.snapshot')::jsonb->'account'->>'code', '2200',
  'finance reader receives the active-org account label');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format('select public.fn_expense_detail_snapshot(%L,%L)', :'org', :'expense'),
  'accountant can read expense detail');
reset role;

select pg_temp.as_user(current_setting('test.manager'));
select set_config('test.manager_snapshot', public.fn_expense_detail_snapshot(:'org', :'expense')::text, false);
select is(current_setting('test.manager_snapshot')::jsonb->'expense'->>'id', :'expense',
  'farm manager receives a non-drawing expense');
select is(current_setting('test.manager_snapshot')::jsonb->'account', 'null'::jsonb,
  'farm manager receives no chart-of-accounts detail');
select is(jsonb_array_length(current_setting('test.manager_snapshot')::jsonb->'movements'), 0,
  'farm manager receives no custody movements');
select is(public.fn_expense_detail_snapshot(:'org', :'drawing')->'expense', 'null'::jsonb,
  'farm manager cannot read owner drawings');
reset role;

select pg_temp.as_user(current_setting('test.denied'));
select throws_ok(format('select public.fn_expense_detail_snapshot(%L,%L)', :'org', :'expense'),
  '42501', null, 'unapproved role cannot read expense detail');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format('select public.fn_expense_detail_snapshot(%L,%L)', :'org_b', :'expense'),
  '42501', null, 'cross-organization request is rejected');
reset role;

insert into public.expenses(id, org_id, date, category, supplier_id, total, status, kind, account_id)
values ('22000000-0000-0000-0000-000000000009', :'org', current_date, 'مرجع أجنبي',
  :'supplier_b', 1, 'approved', 'operating', :'account');
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format('select public.fn_expense_detail_snapshot(%L,%L)',
  :'org', '22000000-0000-0000-0000-000000000009'),
  '23514', null, 'foreign supplier corruption fails closed');
reset role;

set local session_replication_role = replica;
update public.custody_movements set org_id = :'org_b' where id = :'movement';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format('select public.fn_expense_detail_snapshot(%L,%L)', :'org', :'expense'),
  '23514', null, 'foreign custody-movement corruption fails closed');
reset role;
set local session_replication_role = replica;
update public.custody_movements set org_id = :'org' where id = :'movement';
set local session_replication_role = origin;

insert into public.payment_requests(id, org_id, request_no, status)
values (:'request', :'org', 220, 'draft');
insert into public.payment_request_lines(id, org_id, payment_request_id, expense_id)
values (:'request_line', :'org', :'request', :'expense');
set local session_replication_role = replica;
update public.payment_request_lines set org_id = :'org_b' where id = :'request_line';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format('select public.fn_expense_detail_snapshot(%L,%L)', :'org', :'expense'),
  '23514', null, 'foreign payment-request-line corruption fails closed');
reset role;
set local session_replication_role = replica;
update public.payment_request_lines set org_id = :'org' where id = :'request_line';
set local session_replication_role = origin;

set local session_replication_role = replica;
update public.custody_movements set custody_account_id = :'custody_b' where id = :'movement';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format('select public.fn_expense_detail_snapshot(%L,%L)', :'org', :'expense'),
  '23514', null, 'foreign custody-account corruption fails closed');
reset role;

select * from finish();
rollback;
