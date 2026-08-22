-- 206 - SPEC-0028 C-4: reverse one standalone owner-funding custody movement.
-- The correction is append-only, exact, idempotent, tenant/role scoped, period-aware, and
-- deliberately refuses expense, request, transfer, reversal, journal-less, and non-funding rows.

begin;
set local time zone 'Africa/Cairo';
select no_plan();

\set org '00000000-0000-0000-0000-000000000001'
\set org_b 'c2060000-0000-0000-0000-00000000000b'
\set account 'c2060000-0000-0000-0000-000000000001'
\set small_account 'c2060000-0000-0000-0000-000000000002'
\set foreign_account 'c2060000-0000-0000-0000-000000000003'
\set request 'c2060000-0000-0000-0000-000000000004'
\set expense 'e2060000-0000-0000-0000-000000000001'
\set malformed_journal 'c2060000-0000-0000-0000-000000000005'

select set_config('test.accountant', (
  select user_id::text from public.organization_member
   where org_id = :'org' and role = 'accountant' limit 1
), false);
select set_config('test.supervisor', (
  select user_id::text from public.organization_member
   where org_id = :'org' and role = 'supervisor' limit 1
), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

insert into public.organization(id, name) values (:'org_b', 'مزرعة أخرى لاختبار عزل C-4');
insert into public.custody_accounts(id, org_id, holder_label, target_float) values
  (:'account', :'org', 'عهدة C-4', 20000),
  (:'small_account', :'org', 'عهدة الرصيد غير الكافي', 1000),
  (:'foreign_account', :'org_b', 'عهدة مزرعة أخرى', 1000);
insert into public.payment_requests(id, org_id, request_no, status, custody_account_id)
values (:'request', :'org', 206001, 'draft', :'account');
insert into public.expenses(id, org_id, date, category, description, total, status, kind)
values (:'expense', :'org', current_date, 'اختبار', 'حركة مرتبطة بمصروف', 1, 'approved', 'operating');
insert into public.journal_entries(
  id, org_id, entry_date, source_type, source_id, description, status
) values (
  :'malformed_journal', :'org', current_date, 'custody_owner_funding',
  'c2060000-0000-0000-0000-000000000099', 'قيد تمويل مكسور بلا حركة', 'posted'
);

select ok(not has_function_privilege('public',
  'public.fn_reverse_custody_movement(uuid,text,date)', 'EXECUTE'),
  'PUBLIC cannot execute the custody reversal');
select ok(not has_function_privilege('anon',
  'public.fn_reverse_custody_movement(uuid,text,date)', 'EXECUTE'),
  'anon cannot execute the custody reversal');
select ok(has_function_privilege('authenticated',
  'public.fn_reverse_custody_movement(uuid,text,date)', 'EXECUTE'),
  'authenticated reaches C-4; the RPC enforces finance permissions');
select ok(position('SECURITY DEFINER' in pg_get_functiondef(
  'public.fn_reverse_custody_movement(uuid,text,date)'::regprocedure)) > 0,
  'C-4 is SECURITY DEFINER');
select ok((select 'search_path=""' = any(proconfig)
             from pg_proc
            where oid = 'public.fn_reverse_custody_movement(uuid,text,date)'::regprocedure),
  'C-4 pins an empty search path');
select ok(
  position('pg_try_advisory_xact_lock_shared' in pg_get_functiondef(
    'public.fn_reverse_custody_movement(uuid,text,date)'::regprocedure)) > 0
  and position('pg_try_advisory_xact_lock_shared' in pg_get_functiondef(
    'public.fn_reverse_custody_movement(uuid,text,date)'::regprocedure))
    < position('for update' in pg_get_functiondef(
      'public.fn_reverse_custody_movement(uuid,text,date)'::regprocedure)),
  'C-4 takes the nonwaiting shared period mutex before any row lock');
select ok(has_function_privilege('authenticated',
  'public.fn_reverse_journal_entry(uuid,text,date)', 'EXECUTE'),
  'authenticated retains the ordinary journal reversal route');
select ok(not has_table_privilege('authenticated', 'public.custody_movements', 'INSERT'),
  'authenticated still cannot insert custody movements directly');

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format(
  $$select public.fn_record_custody_movement(%L, 'استلام عهدة من المالك', 10000, 0, current_date)$$,
  :'account'), 'accountant records the retained owner funding');
select lives_ok(format(
  $$select public.fn_record_custody_movement(%L, 'استلام عهدة من المالك', 3000, 0, current_date)$$,
  :'account'), 'accountant records the duplicate owner funding to reverse');
select lives_ok(format(
  $$select public.fn_record_custody_movement(%L, 'استلام عهدة من المالك', 1000, 0, current_date)$$,
  :'small_account'), 'accountant records the balance-floor funding');
reset role;

select set_config('test.original', (
  select id::text from public.custody_movements
   where custody_account_id = :'account' and amount_in = 3000
   order by created_at desc, id desc limit 1
), false);
select set_config('test.original_journal', (
  select journal_entry_id::text from public.custody_movements
   where id = current_setting('test.original')::uuid
), false);
select set_config('test.small_funding', (
  select id::text from public.custody_movements
   where custody_account_id = :'small_account' and amount_in = 1000
   order by created_at desc, id desc limit 1
), false);

select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format(
  $$select public.fn_reverse_custody_movement(%L, 'محاولة بلا صلاحية', current_date)$$,
  current_setting('test.original')), '42501', null,
  'a non-finance role cannot reverse owner funding');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select throws_ok(format(
  $$select public.fn_reverse_custody_movement(%L, '   ', current_date)$$,
  current_setting('test.original')), '23502', null, 'a reason is mandatory');
select throws_ok(format(
  $$select public.fn_reverse_custody_movement(%L, 'تاريخ ناقص', null)$$,
  current_setting('test.original')), '23502', null, 'the reversal date is mandatory');
select throws_ok(format(
  $$select public.fn_reverse_custody_movement(%L, 'تاريخ يسبق القيد', current_date - 1)$$,
  current_setting('test.original')), '22023', null,
  'a reversal cannot be dated before its original journal');
select throws_ok(format(
  $$select public.fn_reverse_custody_movement(%L, 'تاريخ مستقبلي', current_date + 1)$$,
  current_setting('test.original')), '22023', null,
  'a first reversal cannot be dated after the current Cairo business date');
select throws_ok(
  $$select public.fn_reverse_custody_movement('c2060000-0000-0000-0000-000000000099', 'غير موجود', current_date)$$,
  'P0002', null, 'a missing movement is not found');
reset role;

insert into public.custody_movements(
  org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out
) values (:'org_b', :'foreign_account', current_date, 'استلام عهدة من المالك', 1, 0);
select set_config('test.foreign_movement', (
  select id::text from public.custody_movements where custody_account_id = :'foreign_account'
), false);
select pg_temp.as_user(current_setting('test.accountant'));
select throws_ok(format(
  $$select public.fn_reverse_custody_movement(%L, 'عزل', current_date)$$,
  current_setting('test.foreign_movement')), 'P0002', null,
  'a cross-org movement is indistinguishable from a missing movement');

select lives_ok(format(
  $$select set_config('test.result', public.fn_reverse_custody_movement(%L, 'تمويل مكرر بالخطأ', current_date)::text, false)$$,
  current_setting('test.original')), 'accountant reverses one standalone owner funding');
reset role;

select is(public.fn_custody_balance(:'account'), 10000::numeric,
  'C-4 restores the exact custody balance');
select is(
  (select jsonb_build_object(
      'amount_in', amount_in,
      'amount_out', amount_out,
      'reversal_of', reversal_of,
      'reason', reversal_reason,
      'expense_id', expense_id,
      'request_id', payment_request_id,
      'transfer_id', transfer_group_id)
     from public.custody_movements
    where id = (current_setting('test.result')::jsonb->>'reversal_movement_id')::uuid),
  jsonb_build_object(
    'amount_in', 0,
    'amount_out', 3000,
    'reversal_of', current_setting('test.original')::uuid,
    'reason', 'تمويل مكرر بالخطأ',
    'expense_id', null,
    'request_id', null,
    'transfer_id', null),
  'C-4 appends the exact standalone linked cash-out mirror');
select is(
  (select reversed_by from public.custody_movements where id = current_setting('test.original')::uuid),
  (current_setting('test.result')::jsonb->>'reversal_movement_id')::uuid,
  'the original funding points to its reversal');
select ok(
  (select reversed_at is not null from public.custody_movements where id = current_setting('test.original')::uuid),
  'the original funding records when it was reversed');
select is(
  (select reversal_of from public.journal_entries
    where id = (current_setting('test.result')::jsonb->>'reversal_journal_id')::uuid),
  current_setting('test.original_journal')::uuid,
  'the new journal reverses the original owner-funding journal');
select is(
  (select status from public.journal_entries where id = current_setting('test.original_journal')::uuid),
  'reversed', 'the original owner-funding journal is reversed');
select is(
  (select count(*) from public.journal_lines
    where journal_entry_id = (current_setting('test.result')::jsonb->>'reversal_journal_id')::uuid
      and custody_movement_id = (current_setting('test.result')::jsonb->>'reversal_movement_id')::uuid),
  2::bigint, 'both reversal journal lines point to the compensating movement');

select pg_temp.as_user(current_setting('test.accountant'));
select is(
  public.fn_reverse_custody_movement(
    current_setting('test.original')::uuid, 'تمويل مكرر بالخطأ', current_date
  )->>'reversal_movement_id',
  current_setting('test.result')::jsonb->>'reversal_movement_id',
  'an exact retry returns the original reversal movement');
select is(
  public.fn_reverse_custody_movement(
    current_setting('test.original')::uuid, 'تمويل مكرر بالخطأ', current_date
  )->>'idempotent',
  'true', 'an exact retry reports an idempotent no-op');
select throws_ok(format(
  $$select public.fn_reverse_custody_movement(%L, 'سبب مختلف', current_date)$$,
  current_setting('test.original')), '22023', null,
  'a changed reason is not mistaken for an idempotent retry');
select throws_ok(format(
  $$select public.fn_reverse_custody_movement(%L, 'تمويل مكرر بالخطأ', current_date + 1)$$,
  current_setting('test.original')), '22023', null,
  'a changed date is not mistaken for an idempotent retry');
select throws_ok(format(
  $$select public.fn_reverse_custody_movement(%L, 'عكس العكس', current_date)$$,
  current_setting('test.result')::jsonb->>'reversal_movement_id'),
  '22023', null, 'a reversal movement cannot itself be reversed');
select throws_ok(format(
  $$select public.fn_reverse_journal_entry(%L, 'تجاوز المسار', current_date)$$,
  current_setting('test.original_journal')), '22023', null,
  'the generic journal RPC cannot bypass the custody correction path');
select throws_ok(format(
  $$select public.fn_reverse_journal_entry(%L, 'تجاوز رابط مكسور', current_date)$$,
  :'malformed_journal'), '22023', null,
  'the generic journal RPC blocks owner funding even when its custody link is malformed');
reset role;

update public.journal_lines
   set custody_movement_id = null
 where id = (
   select id from public.journal_lines
    where journal_entry_id = (current_setting('test.result')::jsonb->>'reversal_journal_id')::uuid
    order by id limit 1
 );
select pg_temp.as_user(current_setting('test.accountant'));
select throws_ok(format(
  $$select public.fn_reverse_custody_movement(%L, 'تمويل مكرر بالخطأ', current_date)$$,
  current_setting('test.original')), '22023', null,
  'an idempotent retry rejects damaged reversal journal linkage');
reset role;

insert into public.custody_movements(
  org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out
) values
  (:'org', :'account', current_date, 'تسوية يدوية', 1, 0),
  (:'org', :'account', current_date, 'استلام عهدة من المالك', 1, 0);
select set_config('test.wrong_type', (
  select id::text from public.custody_movements
   where custody_account_id = :'account' and movement_type = 'تسوية يدوية'
   order by created_at desc, id desc limit 1
), false);
select set_config('test.journal_less', (
  select id::text from public.custody_movements
   where custody_account_id = :'account'
     and movement_type = 'استلام عهدة من المالك' and journal_entry_id is null
   order by created_at desc, id desc limit 1
), false);
insert into public.custody_movements(
  org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out, payment_request_id
) values (:'org', :'account', current_date, 'استلام عهدة من المالك', 1, 0, :'request');
select set_config('test.request_linked', (
  select id::text from public.custody_movements where payment_request_id = :'request'
), false);
insert into public.custody_movements(
  org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out, transfer_group_id
) values (:'org', :'account', current_date, 'استلام عهدة من المالك', 1, 0, gen_random_uuid());
select set_config('test.transfer_linked', (
  select id::text from public.custody_movements
   where custody_account_id = :'account' and transfer_group_id is not null
   order by created_at desc, id desc limit 1
), false);
insert into public.custody_movements(
  org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out, expense_id
) values (:'org', :'account', current_date, 'صرف نقدي', 0, 1, :'expense');
select set_config('test.expense_linked', (
  select id::text from public.custody_movements where expense_id = :'expense'
), false);

select pg_temp.as_user(current_setting('test.accountant'));
select throws_ok(format($$select public.fn_reverse_custody_movement(%L, 'نوع خاطئ', current_date)$$,
  current_setting('test.wrong_type')), '22023', null, 'C-4 rejects a non-funding movement type');
select throws_ok(format($$select public.fn_reverse_custody_movement(%L, 'قيد ناقص', current_date)$$,
  current_setting('test.journal_less')), '22023', null, 'C-4 rejects journal-less owner funding');
select throws_ok(format($$select public.fn_reverse_custody_movement(%L, 'مرتبط بطلب', current_date)$$,
  current_setting('test.request_linked')), '22023', null, 'C-4 rejects request-linked funding');
select throws_ok(format($$select public.fn_reverse_custody_movement(%L, 'مرتبط بتحويل', current_date)$$,
  current_setting('test.transfer_linked')), '22023', null, 'C-4 rejects transfer-linked movements');
select throws_ok(format($$select public.fn_reverse_custody_movement(%L, 'مرتبط بمصروف', current_date)$$,
  current_setting('test.expense_linked')), '22023', null, 'C-4 rejects expense-linked movements');
reset role;

select throws_ok(format(
  $$insert into public.custody_movements(
      org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out,
      reversal_of, reversal_reason
    ) values (%L, %L, current_date, 'عكس غير صالح', 1, 0, %L, 'شكل خاطئ')$$,
  :'org', :'account', (select id from public.custody_movements
    where custody_account_id = :'account' and amount_in = 10000 limit 1)),
  '23514', null, 'the shape constraint rejects a cash-in C-4 mirror');

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format(
  $$select public.fn_transfer_custody(%L, %L, 600, current_date, 'إنفاق جزء من التمويل')$$,
  :'small_account', :'account'), 'transfer spends part of the small-account funding');
select throws_ok(format(
  $$select public.fn_reverse_custody_movement(%L, 'الرصيد لم يعد متاحاً', current_date)$$,
  current_setting('test.small_funding')), '22023', null,
  'C-4 refuses funding already consumed from the live balance');
reset role;
select is((select count(*) from public.custody_movements
  where reversal_of = current_setting('test.small_funding')::uuid), 0::bigint,
  'the insufficient-balance failure appends no reversal');

insert into public.organization_member(org_id, user_id, role)
values (:'org_b', current_setting('test.accountant')::uuid, 'accountant');
select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format(
  $$select public.fn_record_custody_movement(%L, 'استلام عهدة من المالك', 200, 0, current_date)$$,
  :'foreign_account'), 'record the locked-reversal-date funding in a clean organization');
reset role;
select set_config('test.locked_funding', (
  select id::text from public.custody_movements
   where custody_account_id = :'foreign_account' and amount_in = 200
   order by created_at desc, id desc limit 1
), false);
select set_config('test.locked_journal', (
  select journal_entry_id::text from public.custody_movements
   where id = current_setting('test.locked_funding')::uuid
), false);
select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format(
  $$select public.fn_close_accounting_period(%L, current_date, current_date, 'قفل C-4')$$,
  :'org_b'), 'close the current reversal date in the clean organization');
select throws_ok(format(
  $$select public.fn_reverse_custody_movement(%L, 'تاريخ مقفل', current_date)$$,
  current_setting('test.locked_funding')), '55000', null,
  'a locked reversal date aborts the correction');
reset role;
select is((select count(*) from public.custody_movements
  where reversal_of = current_setting('test.locked_funding')::uuid), 0::bigint,
  'the period-lock failure appends no custody mirror');
select is((select status from public.journal_entries
  where id = current_setting('test.locked_journal')::uuid), 'posted',
  'the period-lock failure leaves the original journal posted');

select * from finish();
rollback;
