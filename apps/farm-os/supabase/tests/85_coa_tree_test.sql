-- 85 — SPEC-0024 S-1: editable chart-of-accounts tree + expense→account link (A.5).
-- Verifies migration 20260701430000: the budget.write gate on fn_save_account/fn_archive_account/
-- fn_merge_accounts, the cycle + depth-cap guards, is_system rename-only posture, archive-vs-delete,
-- merge repointing, v_account_rollup subtree math, the A.5 kind-consistency guard, the
-- classification-required-before-payment rule, and that a custody payment posts the journal to the
-- SPECIFIC leaf account (not just the kind bucket). budget.write = owner/accountant (migration 0001).
--
-- The local shim runs as superuser (bypasses RLS/FORCE RLS); authorize() is still exercised via
-- request.jwt.claims impersonation + `set local role authenticated` (as tests 44/82 do). Fixtures that
-- need to bypass the RPC gate are inserted directly as superuser between impersonations.
--
-- Run via test-shims/run-pgtap-local.sh or `supabase test db`.

begin;
select plan(28);

\set org '00000000-0000-0000-0000-000000000001'
select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.acct', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.sk', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'storekeeper' limit 1), false);

select isnt(current_setting('test.owner'), '', 'fixture: an owner exists in orgA');
select isnt(current_setting('test.acct'), '', 'fixture: an accountant exists in orgA');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ═════ 1) fn_save_account — create, gate, child ═════
select pg_temp.as_user(current_setting('test.owner'));

select lives_ok(
  format($$ select set_config('test.exp_root',
    (public.fn_save_account(null, %L, '5', 'مصروفات', 'expense', 'debit', null, null, 1))->>'id', false) $$, :'org'),
  'owner (budget.write) creates a root expense account');

select lives_ok(
  format($$ select set_config('test.exp_op',
    (public.fn_save_account(null, %L, '5-1', 'مصروفات تشغيلية', 'expense', 'debit',
      current_setting('test.exp_root')::uuid, 'operating', 1))->>'id', false) $$, :'org'),
  'owner creates an operating expense sub-account under the root');

select lives_ok(
  format($$ select set_config('test.exp_draw',
    (public.fn_save_account(null, %L, '5-9', 'مسحوبات (تصنيف)', 'expense', 'debit',
      current_setting('test.exp_root')::uuid, 'drawing', 9))->>'id', false) $$, :'org'),
  'owner creates a drawing-kind expense sub-account');

reset role;
select pg_temp.as_user(current_setting('test.sk'));
select throws_ok(
  format($$ select public.fn_save_account(null, %L, 'X', 'مزيف', 'expense', 'debit', null, null, null) $$, :'org'),
  '42501', null, 'storekeeper (no budget.write) cannot create an account');
reset role;

-- ═════ 2) cycle + depth-cap + kind guards ═════
select pg_temp.as_user(current_setting('test.owner'));

-- cycle: make the root a child of its own descendant (exp_op) → rejected.
select throws_ok(
  $$ select public.fn_save_account(current_setting('test.exp_root')::uuid, null, '5', 'مصروفات', 'expense', 'debit',
       current_setting('test.exp_op')::uuid, null, 1) $$,
  '22023', null, 'cycle: re-parenting a root under its descendant is rejected');

-- kind on a non-expense account → rejected.
select throws_ok(
  format($$ select public.fn_save_account(null, %L, '4-x', 'إيراد', 'revenue', 'credit', null, 'operating', 1) $$, :'org'),
  '22023', null, 'kind is rejected on a non-expense account');

-- depth cap: chain d1<d2<d3<d4 ok, d5 rejected.
select set_config('test.d1', (public.fn_save_account(null, :'org', 'd1','د1','expense','debit',null,null,1))->>'id', false);
select set_config('test.d2', (public.fn_save_account(null, null, 'd2','د2','expense','debit',current_setting('test.d1')::uuid,null,1))->>'id', false);
select set_config('test.d3', (public.fn_save_account(null, null, 'd3','د3','expense','debit',current_setting('test.d2')::uuid,null,1))->>'id', false);
select lives_ok(
  $$ select public.fn_save_account(null, null, 'd4','د4','expense','debit',current_setting('test.d3')::uuid,null,1) $$,
  'depth 4 is allowed');
select throws_ok(
  $$ select public.fn_save_account(null, null, 'd5','د5','expense','debit',
       (select id from public.accounts where org_id = '00000000-0000-0000-0000-000000000001' and code='d4'),null,1) $$,
  '22023', null, 'depth 5 exceeds the cap and is rejected');

reset role;

-- ═════ 3) is_system posture (rename-only) ═════
-- Seed a system account directly (superuser bypasses the RPC gate).
insert into public.accounts(org_id, code, name_ar, account_type, normal_balance, is_system)
values (:'org', '3100', 'مسحوبات المالك', 'equity', 'debit', true)
on conflict (org_id, code) do update set is_system = true
returning set_config('test.sys', id::text, false);

select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  $$ select public.fn_save_account(current_setting('test.sys')::uuid, null, '3100', 'مسحوبات المالك (محدث)', 'equity', 'debit', null, null, 1) $$,
  'system account can be renamed');
select throws_ok(
  $$ select public.fn_save_account(current_setting('test.sys')::uuid, null, '3100', 'مسحوبات', 'equity', 'debit',
       current_setting('test.exp_root')::uuid, null, 1) $$,
  '22023', null, 'system account cannot be re-parented');
select throws_ok(
  $$ select public.fn_archive_account(current_setting('test.sys')::uuid) $$,
  '22023', null, 'system account cannot be archived');
reset role;

-- ═════ 4) archive: block if active children, else soft-delete ═════
select pg_temp.as_user(current_setting('test.owner'));
select throws_ok(
  $$ select public.fn_archive_account(current_setting('test.exp_root')::uuid) $$,
  '22023', null, 'cannot archive an account that still has active children');
-- archive the drawing leaf, then confirm active=false (not deleted).
select lives_ok(
  $$ select public.fn_archive_account(current_setting('test.exp_draw')::uuid) $$,
  'a leaf account archives');
select is(
  (select active from public.accounts where id = current_setting('test.exp_draw')::uuid),
  false, 'archive is a soft-delete (row preserved, active=false)');
reset role;

-- ═════ 5) merge: same-type leaves, repoint refs, archive src ═════
select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.m_src', (public.fn_save_account(null, :'org', 'm-src','دمج مصدر','expense','debit',null,null,1))->>'id', false);
select set_config('test.m_dst', (public.fn_save_account(null, :'org', 'm-dst','دمج هدف','expense','debit',null,null,1))->>'id', false);
reset role;

-- Seed an expense referencing the src, then merge.
insert into public.expenses(org_id, category, total, kind, account_id)
values (:'org', 'اختبار', 500, 'operating', current_setting('test.m_src')::uuid)
returning set_config('test.m_exp', id::text, false);

-- cross-type merge rejected.
select pg_temp.as_user(current_setting('test.owner'));
select set_config('test.m_rev', (public.fn_save_account(null, :'org', 'm-rev','إيراد دمج','revenue','credit',null,null,1))->>'id', false);
select throws_ok(
  $$ select public.fn_merge_accounts(current_setting('test.m_src')::uuid, current_setting('test.m_rev')::uuid) $$,
  '22023', null, 'merge across account_type is rejected');
-- legit merge.
select lives_ok(
  $$ select public.fn_merge_accounts(current_setting('test.m_src')::uuid, current_setting('test.m_dst')::uuid) $$,
  'same-type leaf merge succeeds');
reset role;
select is(
  (select account_id from public.expenses where id = current_setting('test.m_exp')::uuid),
  current_setting('test.m_dst')::uuid, 'merge repointed the expense to the destination account');
select is(
  (select active from public.accounts where id = current_setting('test.m_src')::uuid),
  false, 'merge archived the source account');

-- ═════ 6) v_account_rollup — subtree net balance ═════
-- Post two journal lines (superuser): 300 debit on the operating child.
insert into public.journal_entries(org_id, entry_date, source_type, source_id, description)
values (:'org', current_date, 'test_rollup', gen_random_uuid(), 'اختبار تجميع')
returning set_config('test.je', id::text, false);
insert into public.journal_lines(org_id, journal_entry_id, account_id, debit, credit)
values (:'org', current_setting('test.je')::uuid, current_setting('test.exp_op')::uuid, 300, 0);

select is(
  (select rollup_balance from public.v_account_rollup where id = current_setting('test.exp_root')::uuid),
  300::numeric, 'rollup_balance of the root includes the descendant''s 300 debit');
select is(
  (select own_balance from public.v_account_rollup where id = current_setting('test.exp_root')::uuid),
  0::numeric, 'own_balance of the root (no direct lines) is 0');

-- ═════ 7) A.5 — kind-consistency + classification-required ═════
-- A drawing expense (superuser insert).
insert into public.expenses(org_id, category, total, kind)
values (:'org', 'سحب', 200, 'drawing')
returning set_config('test.a5_exp', id::text, false);

select pg_temp.as_user(current_setting('test.owner'));
-- classifying a drawing expense to an operating-kind account → kind mismatch.
select throws_ok(
  $$ select public.fn_set_expense_account(current_setting('test.a5_exp')::uuid, current_setting('test.exp_op')::uuid) $$,
  '22023', null, 'A.5: drawing expense cannot be classified to an operating account (#6)');
-- routing an unclassified expense to payment → rejected.
select throws_ok(
  $$ select public.fn_set_expense_payment_status(current_setting('test.a5_exp')::uuid, 'post_paid_unpaid') $$,
  '22023', null, 'A.5: an unclassified expense cannot be routed to payment');
reset role;

-- ═════ 8) posting swaps to the specific leaf account ═════
-- An operating expense classified to the operating leaf, paid from a custody account.
insert into public.custody_accounts(org_id, holder_label, target_float, active)
values (:'org', 'مدير المزرعة', 0, true)
returning set_config('test.cust', id::text, false);
insert into public.expenses(org_id, category, total, kind)
values (:'org', 'أسمدة', 400, 'operating')
returning set_config('test.pay_exp', id::text, false);

select pg_temp.as_user(current_setting('test.owner'));
select lives_ok(
  $$ select public.fn_set_expense_account(current_setting('test.pay_exp')::uuid, current_setting('test.exp_op')::uuid) $$,
  'classify the operating expense to the operating leaf');
select lives_ok(
  $$ select public.fn_set_expense_payment_status(current_setting('test.pay_exp')::uuid, 'paid_from_custody', current_setting('test.cust')::uuid) $$,
  'pay the classified expense from custody (posts the journal)');
reset role;

select is(
  (select jl.account_id
     from public.journal_lines jl
     join public.journal_entries je on je.id = jl.journal_entry_id
    where je.source_type = 'expense_payment' and je.source_id = current_setting('test.pay_exp')::uuid
      and jl.debit > 0),
  current_setting('test.exp_op')::uuid,
  'the expense-payment journal DEBITs the specific leaf account (not just the kind bucket)');

-- ═════ 9) anon lockdown on the new RPCs ═════
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('fn_save_account','fn_archive_account','fn_merge_accounts','fn_set_expense_account')
       and has_function_privilege('anon', p.oid, 'EXECUTE')),
  'none of the new COA RPCs are EXECUTE-able by anon');

select * from finish();
rollback;
