-- 205 — SPEC-0028 C-1: custody-paid expense correction.
-- Proves append-only linked money truth, exact P&L/custody/journal effects, idempotency, role/tenant
-- isolation, period locks, request-line refusal, editable unrouted outcome, and failure atomicity.

begin;
select plan(80);

\set org '00000000-0000-0000-0000-000000000001'
\set orgB 'c2050000-0000-0000-0000-00000000000b'
\set acct 'c2050000-0000-0000-0000-000000000001'
\set costCenter 'c2050000-0000-0000-0000-000000000002'
\set expCancel 'e2050000-0000-0000-0000-000000000001'
\set expUnroute 'e2050000-0000-0000-0000-000000000002'
\set expRequest 'e2050000-0000-0000-0000-000000000003'
\set expLocked 'e2050000-0000-0000-0000-000000000004'
\set expForeign 'e2050000-0000-0000-0000-000000000005'
\set expJournalReversed 'e2050000-0000-0000-0000-000000000006'
\set expLegacy 'e2050000-0000-0000-0000-000000000007'
\set request 'a2050000-0000-0000-0000-000000000001'
\set requestActive 'a2050000-0000-0000-0000-000000000002'

select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'supervisor' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

insert into public.organization(id, name) values (:'orgB', 'مزرعة أخرى لاختبار العزل');
insert into public.custody_accounts(id, org_id, holder_label, target_float)
values (:'acct', :'org', 'عهدة تصحيح المصروف', 50000);
insert into public.cost_centers(id, org_id, code, name_ar, active)
values (:'costCenter', :'org', 'C205', 'مركز اختبار التصحيح', true);
select set_config('test.expense_account', (
  select account.id::text
    from public.accounts account
   where account.org_id = :'org'
     and account.kind = 'operating'
     and account.active
     and not exists (
       select 1 from public.accounts child
        where child.parent_id = account.id and child.active
     )
   order by account.code
   limit 1
), false);
insert into public.expenses(id, org_id, date, category, description, total, status, kind)
values
  (:'expCancel', :'org', current_date, 'اختبار', 'إلغاء مصروف خاطئ', 1000, 'approved', 'operating'),
  (:'expUnroute', :'org', current_date, 'اختبار', 'إعادة مصروف للتعديل', 2000, 'approved', 'operating'),
  (:'expRequest', :'org', current_date, 'اختبار', 'مصروف مرتبط بطلب', 3000, 'approved', 'operating'),
  (:'expLocked', :'org', current_date, 'اختبار', 'مصروف تاريخ عكس مقفل', 4000, 'approved', 'operating'),
  (:'expForeign', :'orgB', current_date, 'اختبار', 'مصروف مزرعة أخرى', 500, 'approved', 'operating'),
  (:'expJournalReversed', :'org', current_date, 'اختبار', 'قيد معكوس مسبقاً', 600, 'approved', 'operating'),
  (:'expLegacy', :'org', current_date, 'اختبار', 'تصحيح يدوي قديم', 700, 'approved', 'operating');
update public.expenses
   set account_id = current_setting('test.expense_account')::uuid
 where id = :'expUnroute';

select ok(not has_function_privilege('public',
  'public.fn_reverse_expense_payment(uuid, uuid, text, text, date)', 'EXECUTE'),
  'PUBLIC cannot execute the expense-payment reversal');
select ok(not has_function_privilege('anon',
  'public.fn_reverse_expense_payment(uuid, uuid, text, text, date)', 'EXECUTE'),
  'anon cannot execute the expense-payment reversal');
select ok(has_function_privilege('authenticated',
  'public.fn_reverse_expense_payment(uuid, uuid, text, text, date)', 'EXECUTE'),
  'authenticated reaches the RPC; database permissions still decide');
select ok(position('SECURITY DEFINER' in
  pg_get_functiondef('public.fn_reverse_expense_payment(uuid,uuid,text,text,date)'::regprocedure)) > 0,
  'the money RPC is SECURITY DEFINER');
select ok((select 'search_path=""' = any(proconfig)
             from pg_proc
            where oid = 'public.fn_reverse_expense_payment(uuid,uuid,text,text,date)'::regprocedure),
  'the money RPC pins an empty search_path');
select ok(not has_table_privilege('authenticated', 'public.custody_movements', 'INSERT'),
  'authenticated still cannot insert custody movements directly');
select ok(not has_function_privilege('public',
  'public.fn_correct_and_route_reversed_expense(uuid,date,text,text,numeric,uuid,uuid,uuid,text,uuid)', 'EXECUTE'),
  'PUBLIC cannot execute the atomic corrected-expense router');
select ok(not has_function_privilege('anon',
  'public.fn_correct_and_route_reversed_expense(uuid,date,text,text,numeric,uuid,uuid,uuid,text,uuid)', 'EXECUTE'),
  'anon cannot execute the atomic corrected-expense router');
select ok(has_function_privilege('authenticated',
  'public.fn_correct_and_route_reversed_expense(uuid,date,text,text,numeric,uuid,uuid,uuid,text,uuid)', 'EXECUTE'),
  'authenticated reaches the corrected-expense RPC; database permissions still decide');
select ok(position('SECURITY DEFINER' in pg_get_functiondef(
  'public.fn_correct_and_route_reversed_expense(uuid,date,text,text,numeric,uuid,uuid,uuid,text,uuid)'::regprocedure
)) > 0, 'the corrected-expense RPC is SECURITY DEFINER');
select ok((select 'search_path=""' = any(proconfig)
             from pg_proc
            where oid = 'public.fn_correct_and_route_reversed_expense(uuid,date,text,text,numeric,uuid,uuid,uuid,text,uuid)'::regprocedure),
  'the corrected-expense RPC pins an empty search_path');

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$select public.fn_record_custody_movement(%L, 'استلام عهدة من المالك', 50000, 0)$$, :'acct'),
  'accountant funds the fixture custody account');
select lives_ok(format($$select public.fn_set_expense_payment_status(%L, 'paid_from_custody', %L)$$, :'expCancel', :'acct'),
  'route the cancellation fixture from custody');
select lives_ok(format($$select public.fn_set_expense_payment_status(%L, 'paid_from_custody', %L)$$, :'expUnroute', :'acct'),
  'route the editable fixture from custody');
select lives_ok(format($$select public.fn_set_expense_payment_status(%L, 'paid_from_custody', %L)$$, :'expRequest', :'acct'),
  'route the request fixture from custody');
select lives_ok(format($$select public.fn_set_expense_payment_status(%L, 'paid_from_custody', %L)$$, :'expLocked', :'acct'),
  'route the locked-date fixture from custody');
select lives_ok(format($$select public.fn_set_expense_payment_status(%L, 'paid_from_custody', %L)$$, :'expLegacy', :'acct'),
  'route the legacy-manual-correction fixture from custody');
select set_config('test.move_cancel', (select id::text from public.custody_movements
  where expense_id = :'expCancel' and amount_out > 0), false);
select set_config('test.move_unroute', (select id::text from public.custody_movements
  where expense_id = :'expUnroute' and amount_out > 0), false);
select set_config('test.move_request', (select id::text from public.custody_movements
  where expense_id = :'expRequest' and amount_out > 0), false);
select set_config('test.move_locked', (select id::text from public.custody_movements
  where expense_id = :'expLocked' and amount_out > 0), false);
select set_config('test.move_legacy', (select id::text from public.custody_movements
  where expense_id = :'expLegacy' and amount_out > 0), false);
reset role;

insert into public.custody_movements(
  org_id, custody_account_id, occurred_at, movement_type, amount_in, amount_out, note
) values (
  :'org', :'acct', current_date, 'تصحيح يدوي قديم', 700, 0, 'الحل اليدوي السابق غير مربوط بالمصروف'
);

insert into public.payment_requests(id, org_id, request_no, status, custody_account_id)
values
  (:'request', :'org', 205001, 'paid', :'acct'),
  (:'requestActive', :'org', 205002, 'draft', :'acct');
insert into public.payment_request_lines(
  org_id, payment_request_id, expense_id, paid_at, paid_from_custody_account_id,
  custody_movement_id, journal_entry_id
)
select :'org', :'request', :'expRequest', now(), :'acct', movement.id, movement.journal_entry_id
  from public.custody_movements movement
 where movement.expense_id = :'expRequest'
   and movement.amount_out > 0;

select set_config('test.pnl_before', (
  public.fn_owner_pnl_summary(:'org', current_date, current_date)->>'operating_expenses'
)::text, false);
select set_config('test.expense_audit_before', (select count(*)::text from public.audit_log
  where entity_type = 'expense' and entity_id in (:'expCancel', :'expUnroute')), false);
select is(public.fn_custody_balance(:'acct'), 40000::numeric,
  'fixture balance is exact after five payments and one 700 legacy manual cash-in');

select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$select public.fn_reverse_expense_payment(%L, %L, 'cancelled', 'محاولة بلا صلاحية', current_date)$$, :'expCancel', current_setting('test.move_cancel')),
  '42501', null, 'non-finance role cannot reverse a payment');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select throws_ok(format($$select public.fn_reverse_expense_payment(%L, %L, 'other', 'سبب', current_date)$$, :'expCancel', current_setting('test.move_cancel')),
  '22023', null, 'outcome is a closed allowlist');
select throws_ok(format($$select public.fn_reverse_expense_payment(%L, %L, 'cancelled', '  ', current_date)$$, :'expCancel', current_setting('test.move_cancel')),
  '23502', null, 'reason is mandatory');
select throws_ok(format($$select public.fn_reverse_expense_payment(%L, %L, 'cancelled', 'سبب', null)$$, :'expCancel', current_setting('test.move_cancel')),
  '23502', null, 'reversal date is explicit and mandatory');
select throws_ok(format($$select public.fn_reverse_expense_payment(%L, %L, 'cancelled', 'عزل', current_date)$$, :'expForeign', current_setting('test.move_cancel')),
  'P0002', null, 'cross-org expense is indistinguishable from a missing expense');
select throws_ok($$select public.fn_reverse_expense_payment('e2050000-0000-0000-0000-000000000099', 'c2050000-0000-0000-0000-000000000099', 'cancelled', 'غير موجود', current_date)$$,
  'P0002', null, 'a genuinely missing expense returns the same not-found result');
select throws_ok(format($$select public.fn_reverse_expense_payment(%L, %L, 'unrouted', 'تطبيق التصحيح الجديد', current_date)$$, :'expLegacy', current_setting('test.move_legacy')),
  '22023', null, 'possible legacy manual cash-in blocks automatic reversal');
select is((select payment_status from public.expenses where id = :'expLegacy'), 'paid_from_custody',
  'legacy preflight leaves the expense payment state unchanged');
select is((select count(*)::int from public.custody_movements
            where expense_id = :'expLegacy' and reversal_of is not null), 0,
  'legacy preflight appends no second custody restoration');

select lives_ok(format($$select set_config('test.cancel_result', public.fn_reverse_expense_payment(%L, %L, 'cancelled', 'المصروف مكرر بالكامل', current_date)::text, false)$$, :'expCancel', current_setting('test.move_cancel')),
  'accountant atomically cancels the wrong expense and reverses its payment');
select lives_ok(format($$select set_config('test.unroute_result', public.fn_reverse_expense_payment(%L, %L, 'unrouted', 'طريقة السداد فقط كانت خاطئة', current_date)::text, false)$$, :'expUnroute', current_setting('test.move_unroute')),
  'accountant atomically returns a valid expense to unrouted');
reset role;

select is((select payment_status from public.expenses where id = :'expCancel'), 'cancelled',
  'whole-expense correction uses the existing P&L-excluded cancelled state');
select is((select payment_status from public.expenses where id = :'expUnroute'), null,
  'payment-only correction restores the exact unrouted NULL state');
select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(format($$select public.fn_correct_and_route_reversed_expense(
    %L, current_date, 'محاولة مشرف', null, 2200, null, %L, %L, 'none', null
  )$$, :'expUnroute', current_setting('test.expense_account'), :'costCenter'),
  '42501', null, 'non-finance role cannot edit or route a reversed expense');
reset role;
select pg_temp.as_user(current_setting('test.accountant'));
select throws_ok(format($$select public.fn_correct_and_route_reversed_expense(
    %L, current_date, 'مسار خاطئ', null, 9999, null, %L, %L, 'invalid', null
  )$$, :'expUnroute', current_setting('test.expense_account'), :'costCenter'),
  '22023', null, 'invalid corrected route aborts the atomic edit and route');
reset role;
select is((select total from public.expenses where id = :'expUnroute'), 2000::numeric,
  'a failed corrected route leaves the original editable amount unchanged');
select is(public.fn_custody_balance(:'acct'), 43000::numeric,
  'the two compensating cash-ins restore exactly 1,000 + 2,000 to custody');
select is((select count(*)::int from public.custody_movements where reversal_of is not null), 2,
  'exactly two append-only linked reversal movements exist');
select is((select sum(amount_in) from public.custody_movements where reversal_of is not null), 3000::numeric,
  'reversal cash-ins equal the two original out-movements exactly');
select is((select count(*)::int
             from public.custody_movements reversal
             join public.custody_movements original on original.id = reversal.reversal_of
            where reversal.expense_id in (:'expCancel', :'expUnroute')
              and reversal.org_id = original.org_id
              and reversal.custody_account_id = original.custody_account_id
              and reversal.amount_in = original.amount_out
              and reversal.amount_out = 0), 2,
  'each reversal links to the same-org original and mirrors its exact cash amount');
select is((select count(*)::int
             from public.custody_movements reversal
             join public.journal_entries journal on journal.id = reversal.journal_entry_id
            where reversal.reversal_of is not null
              and journal.reversal_of is not null
              and journal.status = 'reversed'), 2,
  'each compensating movement points at a linked reversal journal');
select is((select count(*)::int
             from public.journal_lines line
             join public.custody_movements reversal on reversal.id = line.custody_movement_id
            where reversal.reversal_of is not null), 4,
  'both lines of each reversal journal point at the compensating movement, not the original');
select is(
  (public.fn_owner_pnl_summary(:'org', current_date, current_date)->>'operating_expenses')::numeric,
  current_setting('test.pnl_before')::numeric - 1000,
  'owner P&L removes only the cancelled expense; the valid unrouted obligation remains');
select is((select count(*)::int from public.audit_log
            where entity_type = 'expense'
              and entity_id in (:'expCancel', :'expUnroute')),
  current_setting('test.expense_audit_before')::int + 2,
  'each successful correction records one expense audit update');

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(format($$select public.fn_reverse_expense_payment(%L, %L, 'cancelled', 'المصروف مكرر بالكامل', current_date)$$, :'expCancel', current_setting('test.move_cancel')),
  'exact replay is a friendly idempotent success');
select throws_ok(format($$select public.fn_reverse_expense_payment(%L, %L, 'cancelled', 'سبب مختلف', current_date)$$, :'expCancel', current_setting('test.move_cancel')),
  '22023', null, 'a changed reason is not mistaken for an idempotent retry');
select throws_ok(format($$select public.fn_reverse_expense_payment(%L, %L, 'unrouted', 'تغيير القرار', current_date)$$, :'expCancel', current_setting('test.move_cancel')),
  '22023', null, 'replay cannot silently change the chosen outcome');
select throws_ok(format($$update public.expenses set total = 1001 where id = %L$$, :'expCancel'),
  '22023', null, 'a cancelled expense keeps its original amount immutable');
select is((select total from public.expenses where id = :'expCancel'), 1000::numeric,
  'the rejected edit leaves cancelled accounting evidence unchanged');
select throws_ok(format($$update public.expenses set account_id = %L where id = %L$$,
    current_setting('test.expense_account'), :'expCancel'),
  '22023', null, 'a cancelled expense keeps its original account dimension immutable');
select throws_ok(format($$update public.expenses set cost_center_id = %L where id = %L$$,
    :'costCenter', :'expCancel'),
  '22023', null, 'a cancelled expense keeps its original cost-center dimension immutable');
select is((select account_id from public.expenses where id = :'expCancel'), null,
  'the rejected account edit leaves cancelled accounting evidence unchanged');
select is((select cost_center_id from public.expenses where id = :'expCancel'), null,
  'the rejected cost-center edit leaves cancelled accounting evidence unchanged');
select throws_ok(format($$select public.fn_save_expense(
    %L, %L, current_date + 1, 'فئة معدلة', 1000, 'وصف معدل', null, 'operating', null, null
  )$$, :'expCancel', :'org'),
  '22023', null, 'the general save RPC cannot rewrite any cancelled expense evidence');
select is((select jsonb_build_object('date', date, 'category', category, 'description', description)
             from public.expenses where id = :'expCancel'),
  jsonb_build_object('date', current_date, 'category', 'اختبار', 'description', 'إلغاء مصروف خاطئ'),
  'cancelled date, category and description remain the original evidence');
select throws_ok(format($$select public.fn_set_expense_payment_status(%L, 'paid_from_custody', %L)$$, :'expCancel', :'acct'),
  '22023', null, 'a cancelled expense cannot be routed and paid again');
select is((select payment_status from public.expenses where id = :'expCancel'), 'cancelled',
  'the rejected reroute leaves cancellation terminal');
select lives_ok(format($$select public.fn_correct_and_route_reversed_expense(
    %L, current_date, 'اختبار مصحح', 'تعديل وتوجيه ذري', 2200, null, %L, %L, 'custody', %L
  )$$, :'expUnroute', current_setting('test.expense_account'), :'costCenter', :'acct'),
  'the UI path atomically edits and routes the corrected expense from custody');
select set_config('test.move_unroute_2', (select id::text from public.custody_movements
  where expense_id = :'expUnroute' and amount_out > 0 and reversed_by is null), false);
select is((select count(*)::int from public.custody_movements
            where expense_id = :'expUnroute' and amount_out > 0 and reversed_by is null), 1,
  'exactly one active cash-out remains after the second payment attempt');
select is((select count(*)::int from public.custody_movements
            where expense_id = :'expUnroute' and amount_out > 0), 2,
  'the original reversed cash-out remains alongside the new active attempt');
select is((select jsonb_build_object('amount', amount_out, 'journal_status', journal.status)
             from public.custody_movements movement
             join public.journal_entries journal on journal.id = movement.journal_entry_id
            where movement.expense_id = :'expUnroute'
              and movement.amount_out > 0
              and movement.reversed_by is null),
  jsonb_build_object('amount', 2200, 'journal_status', 'posted'),
  'the new attempt posts the edited amount through a new active journal');
select lives_ok(format($$select public.fn_add_expense_to_request(%L, %L)$$, :'requestActive', :'expUnroute'),
  'a repaid expense can be added to a draft payment request');
select is((select custody_movement_id from public.payment_request_lines
            where payment_request_id = :'requestActive' and expense_id = :'expUnroute'),
  current_setting('test.move_unroute_2')::uuid,
  'request linking selects the active repayment, not the reversed historical attempt');
select is((select line.journal_entry_id
             from public.payment_request_lines line
            where line.payment_request_id = :'requestActive' and line.expense_id = :'expUnroute'),
  (select movement.journal_entry_id
     from public.custody_movements movement
    where movement.id = current_setting('test.move_unroute_2')::uuid),
  'request linking carries the active repayment journal');
reset role;
delete from public.payment_request_lines
 where payment_request_id = :'requestActive' and expense_id = :'expUnroute';
update public.custody_movements
   set occurred_at = current_date - 1
 where id = current_setting('test.move_unroute_2')::uuid;
select pg_temp.as_user(current_setting('test.accountant'));
select is(
  (select row->>'custody_movement_id'
     from jsonb_array_elements(public.fn_custody_cash_expense_report(
       :'org', current_date - 1, current_date
     )->'rows') row
    where row->>'expense_id' = :'expUnroute'),
  current_setting('test.move_unroute_2'),
  'cash-expense report selects the active backdated repayment, not the later reversed attempt');
select throws_ok(format($$select public.fn_reverse_expense_payment(%L, %L, 'unrouted', 'طريقة السداد فقط كانت خاطئة', current_date)$$, :'expUnroute', current_setting('test.move_unroute')),
  '22023', null, 'a stale retry cannot reverse the newer payment attempt');
select lives_ok(format($$select public.fn_reverse_expense_payment(%L, %L, 'unrouted', 'تصحيح محاولة السداد الثانية', current_date)$$, :'expUnroute', current_setting('test.move_unroute_2')),
  'the repaid expense can be corrected a second time');
select is((select payment_status from public.expenses where id = :'expUnroute'), null,
  'the second correction returns the expense to the unrouted state');
select is((select count(*)::int from public.custody_movements
            where expense_id = :'expUnroute' and amount_out > 0 and reversed_by is null), 0,
  'the second correction leaves no active cash-out');
select is((select count(*)::int from public.custody_movements
            where expense_id = :'expUnroute' and reversal_of is not null), 2,
  'both payment attempts retain one linked compensating movement');
select is(public.fn_custody_balance(:'acct'), 43000::numeric,
  'the second correction restores the edited 2,200 amount exactly');
select throws_ok(format($$select public.fn_reverse_expense_payment(%L, %L, 'unrouted', 'مرتبط بطلب', current_date)$$, :'expRequest', current_setting('test.move_request')),
  '22023', null, 'payment-request-linked expense fails closed pending request reversal semantics');
-- This suite tests reversal behavior, not close readiness. Install the locked-period fixture as
-- the test administrator so unrelated live-era blockers in the shared seed cannot weaken or
-- bypass fn_month_close_summary; migration 20260808070000 tests the real close RPC separately.
reset role;
select lives_ok(format($$insert into public.accounting_periods(
    org_id, period_start, period_end, status, note
  ) values (%L, '2030-02-01'::date, '2030-02-28'::date, 'locked', 'اختبار قفل تاريخ العكس')$$, :'org'),
  'test administrator installs the future locked-period fixture');
select pg_temp.as_user(current_setting('test.accountant'));
select throws_ok(format($$select public.fn_reverse_expense_payment(%L, %L, 'cancelled', 'تاريخ عكس مقفل', '2030-02-10'::date)$$, :'expLocked', current_setting('test.move_locked')),
  '55000', null, 'locked reversal period aborts the entire correction');
select lives_ok(format($$select public.fn_set_expense_payment_status(%L, 'paid_from_custody', %L)$$, :'expJournalReversed', :'acct'),
  'route the pre-reversed-journal fixture from custody');
select set_config('test.move_journal_reversed', (select id::text from public.custody_movements
  where expense_id = :'expJournalReversed' and amount_out > 0), false);
select lives_ok(format($$select public.fn_reverse_journal_entry(
  (select journal_entry_id from public.custody_movements where expense_id = %L and amount_out > 0),
  'عكس مباشر سابق', current_date)$$, :'expJournalReversed'),
  'the legacy journal RPC creates the inconsistent precondition');
select throws_ok(format($$select public.fn_reverse_expense_payment(%L, %L, 'unrouted', 'لا تعيد استخدام القيد', current_date)$$, :'expJournalReversed', current_setting('test.move_journal_reversed')),
  '22023', null, 'expense correction refuses an already-reversed payment journal');
select is((select count(*)::int from public.custody_movements
            where expense_id = :'expJournalReversed' and reversal_of is not null), 0,
  'the rejected repair appends no mismatched custody reversal');
reset role;

select throws_ok(format($$update public.custody_movements set reversed_at = null
  where expense_id = %L and amount_out > 0 and reversed_by is not null$$, :'expCancel'),
  '23514', null, 'original movement reversal markers must remain a complete pair');

select is((select count(*)::int from public.custody_movements where reversal_of is not null), 3,
  'idempotent replay and both failed paths append no extra movement');
select is((select payment_status from public.expenses where id = :'expRequest'), 'paid_from_custody',
  'request-linked failure leaves the expense payment state unchanged');
select is((select payment_status from public.expenses where id = :'expLocked'), 'paid_from_custody',
  'period-lock failure leaves the expense payment state unchanged');
select * from finish();
rollback;
