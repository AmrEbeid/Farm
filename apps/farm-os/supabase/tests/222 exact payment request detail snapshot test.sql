-- Atomic payment-request detail: exact money, completeness, access, and tenant integrity.
begin;
select no_plan();

\set org '24000000-0000-0000-0000-0000000000a0'
\set org_b '24000000-0000-0000-0000-0000000000b0'
\set request '24000000-0000-0000-0000-000000000001'
\set request_b '24000000-0000-0000-0000-000000000002'
\set custody '24000000-0000-0000-0000-000000000003'
\set custody_inactive '24000000-0000-0000-0000-000000000004'
\set custody_b '24000000-0000-0000-0000-000000000005'
\set account '24000000-0000-0000-0000-000000000006'
\set account_b '24000000-0000-0000-0000-000000000007'
\set linked_expense '24000000-0000-0000-0000-000000000008'
\set available_a '24000000-0000-0000-0000-000000000009'
\set available_b '24000000-0000-0000-0000-00000000000a'
\set available_c '24000000-0000-0000-0000-00000000000b'
\set unclassified '24000000-0000-0000-0000-00000000000c'
\set line '24000000-0000-0000-0000-00000000000d'

select set_config('test.owner', (select user_id::text from public.organization_member where role = 'owner' limit 1), false);
select set_config('test.accountant', (select user_id::text from public.organization_member where role = 'accountant' limit 1), false);
select set_config('test.denied', (select user_id::text from public.organization_member where role = 'storekeeper' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

insert into public.organization(id, name) values
  (:'org', 'Payment request snapshot org'),
  (:'org_b', 'Foreign payment request snapshot org');
insert into public.organization_member(org_id, user_id, role) values
  (:'org', current_setting('test.owner')::uuid, 'owner'),
  (:'org', current_setting('test.accountant')::uuid, 'accountant'),
  (:'org', current_setting('test.denied')::uuid, 'storekeeper');
insert into public.people(id, org_id, name, position, user_id) values
  ('24000000-0000-0000-0000-00000000000f', :'org', 'Snapshot Owner', 'Owner', current_setting('test.owner')::uuid);
insert into public.accounts(id, org_id, code, name_ar, account_type, normal_balance, kind) values
  (:'account', :'org', '5240', 'مصروف طلب', 'expense', 'debit', 'operating'),
  (:'account_b', :'org_b', '5241', 'مصروف أجنبي', 'expense', 'debit', 'operating');
insert into public.custody_accounts(id, org_id, holder_label, target_float, active) values
  (:'custody', :'org', 'Active holder', 100, true),
  (:'custody_inactive', :'org', 'Inactive holder', 0, false),
  (:'custody_b', :'org_b', 'Foreign holder', 0, true);
insert into public.payment_requests(
  id, org_id, request_no, status, custody_account_id, prepared_by, period_start, period_end, note
) values
  (:'request', :'org', 240, 'draft', :'custody', current_setting('test.owner')::uuid,
   current_date - 7, current_date, 'Exact request'),
  (:'request_b', :'org_b', 241, 'draft', :'custody_b', null, null, null, null);
insert into public.expenses(
  id, org_id, date, description, category, total, status, payment_status, kind, account_id
) values
  (:'linked_expense', :'org', current_date - 4, 'Linked', 'تشغيل', 9007199254740993.123456789,
   'approved', 'post_paid_unpaid', 'operating', :'account'),
  (:'available_a', :'org', current_date - 1, 'Available A', 'تشغيل', 3.3,
   'approved', 'post_paid_unpaid', 'operating', :'account'),
  (:'available_b', :'org', current_date - 2, 'Available B', 'تشغيل', 2.2,
   'approved', 'paid_from_custody', 'operating', :'account'),
  (:'available_c', :'org', current_date - 3, 'Available C', 'تشغيل', 1.1,
   'approved', 'post_paid_unpaid', 'operating', :'account'),
  (:'unclassified', :'org', current_date, 'No account', 'تشغيل', 4.4,
   'approved', 'post_paid_unpaid', 'operating', null);
insert into public.payment_request_lines(id, org_id, payment_request_id, expense_id)
values (:'line', :'org', :'request', :'linked_expense');
update public.payment_requests set status = 'approved_final' where id = :'request';
select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.funding', public.fn_record_payment_request_funding(
  :'request', :'custody', 0.123456789012345678, current_date, 'Exact funding')::text, false);
reset role;
update public.payment_requests set status = 'draft' where id = :'request';

select ok(not has_function_privilege('public',
  'public.fn_payment_request_detail_snapshot(uuid,uuid,integer)', 'EXECUTE'),
  'PUBLIC cannot execute payment request detail snapshot');
select ok(not has_function_privilege('anon',
  'public.fn_payment_request_detail_snapshot(uuid,uuid,integer)', 'EXECUTE'),
  'anon cannot execute payment request detail snapshot');
select ok(has_function_privilege('authenticated',
  'public.fn_payment_request_detail_snapshot(uuid,uuid,integer)', 'EXECUTE'),
  'authenticated reaches the internal finance gate');
select ok((select prosecdef from pg_proc where oid =
  'public.fn_payment_request_detail_snapshot(uuid,uuid,integer)'::regprocedure),
  'payment request detail snapshot is security definer');
select is((select provolatile::text from pg_proc where oid =
  'public.fn_payment_request_detail_snapshot(uuid,uuid,integer)'::regprocedure),
  's', 'payment request detail snapshot is stable');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fn_payment_request_detail_snapshot'), 1,
  'payment request detail snapshot has no overload');
select is((select pg_get_function_identity_arguments(oid) from pg_proc
  where oid = 'public.fn_payment_request_detail_snapshot(uuid,uuid,integer)'::regprocedure),
  'p_org uuid, p_request uuid, p_available_limit integer',
  'payment request detail snapshot signature is pinned');

select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.snapshot',
  public.fn_payment_request_detail_snapshot(:'org', :'request', 2)::text, false);
select is(current_setting('test.snapshot')::jsonb->>'version',
  'farm-os.payment-request-detail.v1', 'snapshot version is pinned');
select is(current_setting('test.snapshot')::jsonb->>'org_id', :'org', 'snapshot binds organization');
select is(current_setting('test.snapshot')::jsonb->>'request_id', :'request', 'snapshot binds request');
select is(current_setting('test.snapshot')::jsonb->'request'->>'request_no', '240', 'request metadata is present');
select is(current_setting('test.snapshot')::jsonb->'request'->>'custody_account_label',
  'Active holder', 'request custody label is resolved');
select is(current_setting('test.snapshot')::jsonb->'totals'->>'gross_request',
  '9007199254741092.999999999987654322',
  'request total plus the evidence-backed custody top-up remains exact decimal text');
select is(current_setting('test.snapshot')::jsonb->'lines'->0->'expense'->>'total',
  '9007199254740993.123456789', 'line expense money remains exact decimal text');
select is(current_setting('test.snapshot')::jsonb->'fundings'->0->>'amount',
  '0.123456789012345678', 'funding money remains exact decimal text');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'custody_accounts'), 2,
  'active and inactive local custody accounts are complete');
select ok(current_setting('test.snapshot')::jsonb->'accounts' @>
  jsonb_build_array(jsonb_build_object('id', :'account')),
  'local chart account is returned');
select ok(not (current_setting('test.snapshot')::jsonb->'accounts' @>
  jsonb_build_array(jsonb_build_object('id', :'account_b'))),
  'foreign chart account is excluded');
select is(current_setting('test.snapshot')::jsonb->'actors'->0->>'name',
  'Snapshot Owner', 'approval actor is resolved inside the organization');
select is(current_setting('test.snapshot')::jsonb->>'available_expense_count', '3',
  'available classified count is exact beyond the row limit');
select is(current_setting('test.snapshot')::jsonb->>'unclassified_available_count', '1',
  'unclassified available count is exact');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'available_expenses'), 2,
  'available rows respect the explicit limit');
select ok((current_setting('test.snapshot')::jsonb->>'available_expenses_truncated')::boolean,
  'available row truncation is explicit');
select is(current_setting('test.snapshot')::jsonb->'available_expenses'->0->>'id', :'available_a',
  'available expenses are deterministic newest first');
select is(current_setting('test.snapshot')::jsonb->'available_expenses'->0->>'date',
  (current_date - 1)::text, 'available expense date is transported explicitly');
select ok(not (current_setting('test.snapshot')::jsonb->'available_expenses' @>
  jsonb_build_array(jsonb_build_object('id', :'linked_expense'))),
  'an expense already linked to a request is not offered again');
reset role;
update public.payment_requests set status = 'submitted' where id = :'request';
select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.submitted_snapshot',
  public.fn_payment_request_detail_snapshot(:'org', :'request', 2)::text, false);
select is(current_setting('test.submitted_snapshot')::jsonb->'available_expenses', '[]'::jsonb,
  'non-draft request skips available expense rows');
select is(current_setting('test.submitted_snapshot')::jsonb->>'available_expense_count', '0',
  'non-draft request skips available classified count');
select is(current_setting('test.submitted_snapshot')::jsonb->>'unclassified_available_count', '0',
  'non-draft request skips unclassified count');
reset role;
update public.payment_requests set status = 'draft' where id = :'request';

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format('select public.fn_payment_request_detail_snapshot(%L,%L,150)', :'org', :'request'),
  'accountant can read payment request detail');
reset role;

select pg_temp.as_user(current_setting('test.denied'));
select throws_ok(format('select public.fn_payment_request_detail_snapshot(%L,%L,150)', :'org', :'request'),
  '42501', null, 'non-finance role is denied');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format('select public.fn_payment_request_detail_snapshot(%L,%L,150)', :'org_b', :'request_b'),
  '42501', null, 'cross-organization access is denied');
select is(public.fn_payment_request_detail_snapshot(
  :'org', '24000000-0000-0000-0000-000000000099', 150)->'request', 'null'::jsonb,
  'missing same-organization request returns an explicit null');
select throws_ok(format('select public.fn_payment_request_detail_snapshot(%L,%L,0)', :'org', :'request'),
  '22023', null, 'invalid available-row limit fails closed');
reset role;

set local session_replication_role = replica;
update public.payment_requests set custody_account_id = :'custody_b' where id = :'request';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format('select public.fn_payment_request_detail_snapshot(%L,%L,150)', :'org', :'request'),
  '23514', null, 'foreign request custody account corruption fails closed');
reset role;
set local session_replication_role = replica;
update public.payment_requests set custody_account_id = :'custody' where id = :'request';
update public.expenses set account_id = :'account_b' where id = :'linked_expense';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format('select public.fn_payment_request_detail_snapshot(%L,%L,150)', :'org', :'request'),
  '23514', null, 'foreign linked-expense account corruption fails closed');
reset role;

set local session_replication_role = replica;
update public.expenses set account_id = :'account' where id = :'linked_expense';
update public.payment_request_fundings
   set amount = amount + 1
 where id = current_setting('test.funding')::uuid;
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format('select public.fn_payment_request_detail_snapshot(%L,%L,150)', :'org', :'request'),
  '23514', null, 'funding amount and movement evidence mismatch fails closed');
reset role;
set local session_replication_role = replica;
update public.payment_request_fundings
   set amount = amount - 1
 where id = current_setting('test.funding')::uuid;
insert into public.payment_request_lines(id, org_id, payment_request_id, expense_id)
values ('24000000-0000-0000-0000-0000000000ee', :'org_b', :'request_b', :'available_a');
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format('select public.fn_payment_request_detail_snapshot(%L,%L,150)', :'org', :'request'),
  '23514', null, 'foreign request line cannot hide a local available expense');
reset role;
set local session_replication_role = replica;
delete from public.payment_request_lines where id = '24000000-0000-0000-0000-0000000000ee';
update public.expenses
   set payment_status = 'paid_from_custody', total = 0.1
 where id = :'linked_expense';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.line_movement', public.fn_record_custody_movement(
  :'custody', 'صرف نقدي', 0, 0.1, current_date,
  :'linked_expense', 'Line proof fixture')::text, false);
reset role;
set local session_replication_role = replica;
update public.payment_request_lines
   set paid_at = now(),
       paid_from_custody_account_id = :'custody',
       custody_movement_id = current_setting('test.line_movement')::uuid,
       journal_entry_id = (
         select journal_entry_id from public.custody_movements
          where id = current_setting('test.line_movement')::uuid)
 where id = :'line';
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(format('select public.fn_payment_request_detail_snapshot(%L,%L,150)', :'org', :'request'),
  'linked paid-line posting evidence is accepted');
reset role;
set local session_replication_role = replica;
update public.custody_movements set amount_out = amount_out + 1
 where id = current_setting('test.line_movement')::uuid;
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format('select public.fn_payment_request_detail_snapshot(%L,%L,150)', :'org', :'request'),
  '23514', null, 'paid-line amount and movement evidence mismatch fails closed');
reset role;
set local session_replication_role = replica;
update public.custody_movements set amount_out = amount_out - 1
 where id = current_setting('test.line_movement')::uuid;
update public.journal_lines
   set debit = credit, credit = debit
 where journal_entry_id = (
   select journal_entry_id from public.custody_movements
    where id = current_setting('test.line_movement')::uuid);
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format('select public.fn_payment_request_detail_snapshot(%L,%L,150)', :'org', :'request'),
  '23514', null, 'paid-line journal account polarity corruption fails closed');
reset role;
set local session_replication_role = replica;
update public.journal_lines
   set debit = credit, credit = debit
 where journal_entry_id = (
   select journal_entry_id from public.custody_movements
    where id = current_setting('test.line_movement')::uuid);
update public.journal_entries
   set entry_date = entry_date + 1
 where id = (
   select journal_entry_id from public.custody_movements
    where id = current_setting('test.line_movement')::uuid);
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format('select public.fn_payment_request_detail_snapshot(%L,%L,150)', :'org', :'request'),
  '23514', null, 'paid-line journal posting-date corruption fails closed');
reset role;
set local session_replication_role = replica;
update public.journal_entries
   set entry_date = entry_date - 1
 where id = (
   select journal_entry_id from public.custody_movements
    where id = current_setting('test.line_movement')::uuid);
update public.journal_lines
   set debit = credit, credit = debit
 where journal_entry_id = (
   select journal_entry_id from public.payment_request_fundings
    where id = current_setting('test.funding')::uuid);
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format('select public.fn_payment_request_detail_snapshot(%L,%L,150)', :'org', :'request'),
  '23514', null, 'funding journal account polarity corruption fails closed');
reset role;
set local session_replication_role = replica;
update public.journal_lines
   set debit = credit, credit = debit
 where journal_entry_id = (
   select journal_entry_id from public.payment_request_fundings
    where id = current_setting('test.funding')::uuid);
update public.journal_entries
   set entry_date = entry_date + 1
 where id = (
   select journal_entry_id from public.payment_request_fundings
    where id = current_setting('test.funding')::uuid);
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(format('select public.fn_payment_request_detail_snapshot(%L,%L,150)', :'org', :'request'),
  '23514', null, 'funding journal posting-date corruption fails closed');
reset role;

select * from finish();
rollback;
