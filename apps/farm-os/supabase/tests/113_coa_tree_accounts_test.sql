-- 113 — SPEC-0024 S-1: editable COA tree + expense account linkage.
-- Verifies the budget.write-gated account tree RPCs, protected system accounts, leaf/kind
-- expense guards, request-time account_id enforcement, and selected-account cash posting.
begin;
select plan(42);

\set org '00000000-0000-0000-0000-000000000001'
\set acct 'd1130000-0000-0000-0000-0000000000c0'
\set expNoAccount 'd1130000-0000-0000-0000-0000000000e1'
\set expMerge 'd1130000-0000-0000-0000-0000000000e2'

insert into public.custody_accounts (id, org_id, holder_label, target_float)
  values (:'acct', :'org', 'عهدة اختبار الحسابات', 0);

select set_config('test.org', :'org', false);
select set_config('test.acct', :'acct', false);
select set_config('test.exp_no_account', :'expNoAccount', false);
select set_config('test.exp_merge', :'expMerge', false);
select set_config('test.opex_root', (select id::text from public.accounts where org_id = :'org' and code = '5000'), false);
select set_config('test.supplies_parent', (select id::text from public.accounts where org_id = :'org' and code = '5100'), false);
select set_config('test.revenue_root', (select id::text from public.accounts where org_id = :'org' and code = '4000'), false);
select set_config('test.fertilizer_leaf', (select id::text from public.accounts where org_id = :'org' and code = '5110'), false);
select set_config('test.drawing_root', (select id::text from public.accounts where org_id = :'org' and code = '3100'), false);
select set_config('test.accountant', (select user_id::text from public.organization_member where org_id=:'org' and role='accountant' limit 1), false);
select set_config('test.owner', (select user_id::text from public.organization_member where org_id=:'org' and role='owner' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member where org_id=:'org' and role='supervisor' limit 1), false);

select ok(not has_function_privilege('anon','public.fn_save_account(uuid, uuid, uuid, text, text, text, text, text, int, boolean)','EXECUTE'),
  'anon cannot EXECUTE fn_save_account');
select ok(not has_function_privilege('anon','public.fn_archive_account(uuid)','EXECUTE'),
  'anon cannot EXECUTE fn_archive_account');
select ok(not has_function_privilege('anon','public.fn_merge_accounts(uuid, uuid)','EXECUTE'),
  'anon cannot EXECUTE fn_merge_accounts');
select ok(not has_table_privilege('authenticated', 'public.accounts', 'INSERT'),
  'authenticated has no direct INSERT privilege on accounts');
select ok(not has_table_privilege('authenticated', 'public.accounts', 'UPDATE'),
  'authenticated has no direct UPDATE privilege on accounts');
select is(
  (select count(*)::int from public.accounts where org_id = :'org' and code in ('1000','1500','3000','3100','5000') and is_system),
  5,
  'seed marks the kernel accounting nodes as system accounts');
select ok(
  not exists (
    with recursive opex_tree as (
      select id from public.accounts where org_id = :'org' and code = '5000'
      union all
      select a.id from public.accounts a join opex_tree t on a.parent_id = t.id where a.org_id = :'org'
    )
    select 1 from opex_tree where id = current_setting('test.drawing_root')::uuid
  ),
  'owner drawings account is outside the operating-expense subtree');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role','authenticated', 'active_org_id', current_setting('test.org'))::text,
    true);
  execute 'set local role authenticated';
end $$;

select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(
  format($$ select public.fn_save_account(null, %L, null, '5990', 'حساب مرفوض', 'expense', 'debit') $$, current_setting('test.org')),
  '42501', null, 'supervisor without budget.write cannot save accounts');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(
  $$ select set_config('test.import_root', (public.fn_save_account(null, null, null, '5991', 'حساب جذر مستورد', 'expense', 'debit', 'operating')->>'id'), false) $$,
  'account import can omit org when the active org is unambiguous');
select is((select org_id from public.accounts where id = current_setting('test.import_root', true)::uuid), current_setting('test.org')::uuid,
  'omitted org resolves to the active org');
select lives_ok(
  format($$ select set_config('test.custom_a', (public.fn_save_account(null, %L, %L, '5199', 'اختبار شجرة أ', 'expense', 'debit')->>'id'), false) $$,
    current_setting('test.org'), current_setting('test.opex_root')),
  'accountant creates an operating child account');
select is((select kind from public.accounts where id = current_setting('test.custom_a')::uuid), 'operating',
  'child account inherits the operating kind from its parent');
select throws_ok(
  format($$ select public.fn_save_account(null, %L, %L, '4199', 'حساب نوع خاطئ', 'expense', 'debit') $$,
    current_setting('test.org'), current_setting('test.revenue_root')),
  '22023', null, 'child account_type must match parent account_type');
select lives_ok(
  format($$ select set_config('test.custom_b', (public.fn_save_account(null, %L, %L, '5199-1', 'اختبار شجرة ب', 'expense', 'debit')->>'id'), false) $$,
    current_setting('test.org'), current_setting('test.custom_a')),
  'accountant creates a third-level account');
select throws_ok(
  format($$ select public.fn_save_account(%L, null, %L, '5199', 'اختبار شجرة أ', 'expense', 'debit') $$,
    current_setting('test.custom_a'), current_setting('test.custom_b')),
  '22023', null, 'cycle guard rejects moving a parent under its child');
select lives_ok(
  format($$ select set_config('test.custom_c', (public.fn_save_account(null, %L, %L, '5199-2', 'اختبار شجرة ج', 'expense', 'debit')->>'id'), false) $$,
    current_setting('test.org'), current_setting('test.custom_b')),
  'accountant creates a fourth-level account');
select throws_ok(
  format($$ select public.fn_save_account(null, %L, %L, '5199-3', 'اختبار شجرة د', 'expense', 'debit') $$,
    current_setting('test.org'), current_setting('test.custom_c')),
  '22023', null, 'depth guard rejects a fifth-level account');
select throws_ok(
  format($$ select public.fn_archive_account(%L) $$, current_setting('test.opex_root')),
  '22023', null, 'system account cannot be archived');
select throws_ok(
  format($$ select public.fn_save_account(%L, null, %L, '5000', 'مصروفات تشغيلية', 'expense', 'debit') $$,
    current_setting('test.opex_root'), current_setting('test.supplies_parent')),
  '22023', null, 'system account cannot be re-parented');
select lives_ok(
  format($$ select public.fn_archive_account(%L) $$, current_setting('test.custom_c')),
  'custom leaf account can be archived');
select is((select active from public.accounts where id = current_setting('test.custom_c')::uuid), false,
  'archived account is inactive');

select lives_ok(
  format($$ select set_config('test.merge_target', (public.fn_save_account(null, %L, %L, '5196', 'هدف الدمج', 'expense', 'debit')->>'id'), false) $$,
    current_setting('test.org'), current_setting('test.supplies_parent')),
  'create merge target leaf');
select lives_ok(
  format($$ select set_config('test.merge_source', (public.fn_save_account(null, %L, %L, '5197', 'مصدر الدمج', 'expense', 'debit')->>'id'), false) $$,
    current_setting('test.org'), current_setting('test.supplies_parent')),
  'create merge source leaf');
select lives_ok(
  format($$ insert into public.expenses (id, org_id, date, category, description, total, status, account_id)
          values (%L, %L, current_date, 'اختبار', 'مصروف للدمج', 10, 'draft', %L) $$,
    current_setting('test.exp_merge'), current_setting('test.org'), current_setting('test.merge_source')),
  'expense can reference the merge-source leaf');
select lives_ok(
  format($$ select public.fn_merge_accounts(%L, %L) $$, current_setting('test.merge_source'), current_setting('test.merge_target')),
  'merge repoints account references and archives the source');
select is((select account_id from public.expenses where id = current_setting('test.exp_merge')::uuid), current_setting('test.merge_target')::uuid,
  'merge repointed the expense account_id');
select is((select active from public.accounts where id = current_setting('test.merge_source')::uuid), false,
  'merge archived the source account');

select lives_ok(
  format($$ insert into public.expenses (org_id, date, category, description, total, status, account_id)
          values (%L, current_date, 'تسميد', 'مصروف بحساب تشغيلي', 50, 'draft', %L) $$,
    current_setting('test.org'), current_setting('test.merge_target')),
  'operating expense can use an operating leaf account');
select throws_ok(
  $$ select public.fn_set_expense_kind(
       (select id from public.expenses where description = 'مصروف بحساب تشغيلي' order by id limit 1),
       'drawing') $$,
  '22023', null, 'drawing expense cannot use an operating account');
select throws_ok(
  format($$ insert into public.expenses (org_id, date, category, description, total, status, account_id)
          values (%L, current_date, 'تشغيل', 'مصروف على حساب غير ورقي', 50, 'draft', %L) $$,
    current_setting('test.org'), current_setting('test.supplies_parent')),
  '22023', null, 'expense account must be a leaf');
reset role;

insert into public.expenses (id, org_id, date, category, description, total, status, payment_status, kind)
  values (:'expNoAccount', :'org', current_date, 'صيانة', 'مصروف آجل بلا حساب', 123, 'approved', 'post_paid_unpaid', 'operating');

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(
  format($$ select set_config('test.req', public.fn_create_payment_request(%L, null, null, %L, 'اختبار ربط الحساب')::text, false) $$,
    current_setting('test.org'), current_setting('test.acct')),
  'accountant creates a payment request for account-linkage checks');
select throws_ok(
  format($$ select public.fn_add_expense_to_request(%L, %L) $$, current_setting('test.req'), current_setting('test.exp_no_account')),
  '22023', null, 'request line rejects an expense without account_id');
select lives_ok(
  format($$ update public.expenses set account_id = %L where id = %L $$,
    current_setting('test.merge_target'), current_setting('test.exp_no_account')),
  'post-paid expense can be classified before it enters a request line');
select lives_ok(
  format($$ select public.fn_add_expense_to_request(%L, %L) $$, current_setting('test.req'), current_setting('test.exp_no_account')),
  'request line accepts the expense after account_id is set');
select throws_ok(
  format($$ update public.expenses set account_id = %L where id = %L $$,
    current_setting('test.fertilizer_leaf'), current_setting('test.exp_no_account')),
  '22023', null, 'expense account_id is immutable after request linkage');
select lives_ok(format($$ select public.fn_submit_payment_request(%L) $$, current_setting('test.req')),
  'accountant submits the classified request');
select lives_ok(format($$ select public.fn_approve_request_operational(%L) $$, current_setting('test.req')),
  'accountant operationally approves the classified request');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(format($$ select public.fn_approve_request_final(%L) $$, current_setting('test.req')),
  'owner final approval succeeds when all request expenses have account_id');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(
  format($$ select public.fn_record_payment_request_funding(%L, %L, 123) $$, current_setting('test.req'), current_setting('test.acct')),
  'accountant records owner funding for the request');
select lives_ok(
  format($$ select public.fn_confirm_request_expense_paid(%L, %L, %L, current_date, 'المحاسب', 'سداد اختبار الحساب') $$,
    current_setting('test.req'), current_setting('test.exp_no_account'), current_setting('test.acct')),
  'payment confirmation posts the expense payout');
select is(
  (select jl.account_id
     from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
    where je.source_type = 'expense_payment'
      and je.source_id = current_setting('test.exp_no_account')::uuid
      and jl.debit > 0),
  current_setting('test.merge_target')::uuid,
  'expense-payment debit posts to the selected leaf account');
select is(
  (select balance from public.v_account_rollup where account_id = current_setting('test.opex_root')::uuid),
  123::numeric,
  'operating root rollup includes the selected leaf posting');
reset role;

select * from finish();
rollback;
