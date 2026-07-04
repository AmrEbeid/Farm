-- 102 — SPEC-0018 slice 1: custody ledger + expense payment routing.
-- Verifies: authorize() carries the FULL permission union (incl. the new finance perms + the in-flight
-- academy/export forward-compat — reinforcing the re-emit drop-trap guard in test 97); the
-- finance.read/custody.write gates; anon EXECUTE lockdown on the new RPCs; balance = Σin − Σout; the one-direction
-- guard; and the cardinal money rule — a paid_from_custody expense posts EXACTLY ONE custody out-movement
-- equal to its total, idempotently (no double-count, #6). Impersonation via request.jwt.claims (the JWT
-- harness used by tests 36/82). Run via test-shims/run-pgtap-local.sh.
begin;
select plan(37);

\set org '00000000-0000-0000-0000-000000000001'
\set orgB 'c1020000-0000-0000-0000-00000000000b'
\set acct 'a0c0a000-0000-0000-0000-0000000000c0'
\set exp  'a0e00000-0000-0000-0000-0000000000e0'
\set expMismatch 'a0e00000-0000-0000-0000-0000000000e1'

-- fixtures (superuser, RLS-bypassed): a custody account + a 5,000 expense; capture ids/uids as GUCs so
-- the dollar-quoted RPC calls below can read them.
insert into public.custody_accounts (id, org_id, holder_label, target_float)
  values (:'acct', :'org', 'مدير المزرعة', 30000);
insert into public.expenses (id, org_id, date, category, description, total, status)
  values (:'exp', :'org', current_date, 'تسميد', 'بند اختبار', 5000, 'approved');
insert into public.expenses (id, org_id, date, category, description, total, status, payment_status, kind)
  values (:'expMismatch', :'org', current_date, 'تسميد', 'بند اختبار مبلغ مختلف', 700, 'approved', 'paid_from_custody', 'operating');
-- SPEC-0024 A.5: an expense must be classified to an account before payment routing. Seed one and
-- classify the fixtures (direct SQL, RLS-bypassed — same posture as the inserts above).
insert into public.accounts (org_id, code, name_ar, account_type, normal_balance)
  values (:'org', '5-test', 'مصروف اختبار', 'expense', 'debit') on conflict (org_id, code) do nothing;
update public.expenses set account_id = (select id from public.accounts where org_id = :'org' and code = '5-test')
  where org_id = :'org' and account_id is null;
insert into public.organization (id, name) values (:'orgB', 'مزرعة اختبار العهدة');
select set_config('test.cross_holder', gen_random_uuid()::text, false);
insert into auth.users (id, instance_id, aud, role, created_at, updated_at)
  values (current_setting('test.cross_holder')::uuid, '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', now(), now());
insert into public.organization_member (org_id, user_id, role)
  values (:'orgB', current_setting('test.cross_holder')::uuid, 'accountant');
select set_config('test.acct_id', :'acct', false);
select set_config('test.exp_id', :'exp', false);
select set_config('test.exp_mismatch_id', :'expMismatch', false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.owner', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'owner' limit 1), false);
select set_config('test.manager', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'farm_manager' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'supervisor' limit 1), false);

select ok(exists(select 1 from public.custody_accounts where id = :'acct'), 'fixture: custody account exists');

-- 1) authorize() carries the FULL union (catalog read)
select is(
  (select count(*)::int from unnest(array[
     'pr.approve','plan.write','op.execute','inventory.write','budget.write','payroll.read','structure.write',
     'academy.write','export.write','responsibility.write','finance.read','custody.write','request.prepare',
     'request.approve.op','request.approve.final'
   ]) as perm
   where position(perm in pg_get_functiondef('public.authorize(text, uuid)'::regprocedure)) = 0),
  0, 'authorize() recognizes the full permission union incl. SPEC-0018 + in-flight academy/export');

-- 2) anon EXECUTE lockdown
select ok(not has_function_privilege('anon',
  'public.fn_record_custody_movement(uuid, text, numeric, numeric, date, uuid, text)', 'EXECUTE'),
  'anon cannot EXECUTE fn_record_custody_movement');
select ok(not has_function_privilege('anon',
  'public.fn_set_expense_payment_status(uuid, text, uuid, text)', 'EXECUTE'),
  'anon cannot EXECUTE fn_set_expense_payment_status');
select ok(not has_function_privilege('anon', 'public.fn_custody_balance(uuid)', 'EXECUTE'),
  'anon cannot EXECUTE fn_custody_balance');
select ok(not has_function_privilege('anon',
  'public.fn_save_custody_account(uuid, uuid, text, uuid, numeric, boolean)', 'EXECUTE'),
  'anon cannot EXECUTE fn_save_custody_account');

-- helper: impersonate a member
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- 3) custody.write maps to owner/accountant, NOT farm_manager/supervisor
select pg_temp.as_user(current_setting('test.accountant'));
select is(public.authorize('custody.write', :'org'), true,  'custody.write: accountant HAS it');
reset role;
select pg_temp.as_user(current_setting('test.manager'));
select is(public.authorize('custody.write', :'org'), false, 'custody.write: manager does NOT have finance-only custody write');
reset role;
select pg_temp.as_user(current_setting('test.supervisor'));
select is(public.authorize('custody.write', :'org'), false, 'custody.write: supervisor does NOT');
reset role;

-- 3b) finance.read is confidential: owner/accountant only until an owner-ratified manager scope exists
select pg_temp.as_user(current_setting('test.owner'));
select is(public.authorize('finance.read', :'org'), true, 'finance.read: owner HAS it');
reset role;
select pg_temp.as_user(current_setting('test.accountant'));
select is(public.authorize('finance.read', :'org'), true, 'finance.read: accountant HAS it');
reset role;
select pg_temp.as_user(current_setting('test.manager'));
select is(public.authorize('finance.read', :'org'), false, 'finance.read: manager does NOT have broad finance read');
reset role;
select pg_temp.as_user(current_setting('test.supervisor'));
select is(public.authorize('finance.read', :'org'), false, 'finance.read: supervisor does NOT');
reset role;

select ok(not has_table_privilege('authenticated', 'public.custody_accounts', 'INSERT'),
  'authenticated has no direct INSERT privilege on custody_accounts');
select ok(not has_table_privilege('authenticated', 'public.custody_accounts', 'UPDATE'),
  'authenticated has no direct UPDATE privilege on custody_accounts');
select ok(not has_table_privilege('authenticated', 'public.custody_movements', 'INSERT'),
  'authenticated has no direct INSERT privilege on custody_movements');

-- 4) balance = Σin − Σout ; one-direction guard ; no-double-count idempotency — all as the accountant
-- (values inlined via format(%L) — the proven harness pattern from test 82; current_setting() inside the
--  executed string does not resolve reliably under pgTAP's lives_ok/throws_ok.)
select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(
  format($$ select public.fn_save_custody_account(null, %L, 'المحاسب', null, 15000, true) $$, :'org'),
  'accountant creates a custody account through the RPC-only path');
select throws_ok(
  format($$ select public.fn_save_custody_account(null, %L, 'حامل عابر', %L, 1000, true) $$, :'org', current_setting('test.cross_holder')),
  '42501', null, 'reject holder_user_id that belongs to another org');
select lives_ok(
  format($$ insert into public.expenses (org_id, date, category, description, total, status) values (%L, current_date, 'اختبار', 'مصروف مباشر عادي', 10, 'draft') $$, :'org'),
  'accountant can still insert a plain expense through the direct budget.write path');
select throws_ok(
  format($$ insert into public.expenses (org_id, date, category, description, total, status, payment_status) values (%L, current_date, 'اختبار', 'مصروف مسار دفع مباشر', 10, 'approved', 'paid_from_custody') $$, :'org'),
  '42501', null, 'direct INSERT cannot set payment routing columns');
select throws_ok(
  format($$ update public.expenses set payment_status = 'paid_from_custody' where id = %L $$, current_setting('test.exp_id')),
  '42501', null, 'direct UPDATE cannot change payment routing columns');
select lives_ok(
  format($$ select public.fn_record_custody_movement(%L,'استلام عهدة من المالك',30000,0) $$, current_setting('test.acct_id')),
  'accountant records a 30,000 custody receipt');
select is(public.fn_custody_balance(:'acct'), 30000::numeric, 'balance = Σin − Σout = 30,000');
select throws_ok(
  format($$ select public.fn_record_custody_movement(%L,'تسوية',100,100) $$, current_setting('test.acct_id')),
  '22023', null, 'reject a movement with both amount_in and amount_out > 0');
select throws_ok(
  format($$ select public.fn_record_custody_movement(%L,'صرف نقدي',0,5000,current_date,%L) $$, current_setting('test.acct_id'), current_setting('test.exp_id')),
  '22023', null, 'reject direct expense-linked cash out before paid_from_custody routing');
select throws_ok(
  format($$ select public.fn_record_custody_movement(%L,'صرف نقدي',0,100,current_date,%L) $$, current_setting('test.acct_id'), current_setting('test.exp_mismatch_id')),
  '22023', null, 'reject an expense-linked cash out that does not equal the expense total');
select lives_ok(
  format($$ select public.fn_set_expense_payment_status(%L,'paid_from_custody',%L) $$, current_setting('test.exp_id'), current_setting('test.acct_id')),
  'mark expense paid_from_custody (first call)');
select lives_ok(
  format($$ select public.fn_set_expense_payment_status(%L,'paid_from_custody',%L) $$, current_setting('test.exp_id'), current_setting('test.acct_id')),
  'mark expense paid_from_custody again (idempotent)');
select throws_ok(
  format($$ select public.fn_set_expense_payment_status(%L,'post_paid_unpaid',null) $$, current_setting('test.exp_id')),
  '22023', null, 'reject rerouting a custody-paid expense without an explicit reversal');
select throws_ok(
  format($$ select public.fn_record_custody_movement(%L,'صرف نقدي',0,100,current_date,%L) $$, current_setting('test.acct_id'), current_setting('test.exp_id')),
  '22023', null, 'reject a duplicate custody cash out-movement for the same expense');
select throws_ok(
  format($$ update public.expenses set total = 6000 where id = %L $$, current_setting('test.exp_id')),
  '22023', null, 'reject amount edits after custody cash posting');
reset role;

-- 5) the cardinal rule: exactly ONE out-movement = the expense total, even after the repeat call
select is(
  (select count(*)::int from public.custody_movements where expense_id = :'exp' and amount_out > 0),
  1, 'exactly ONE custody out-movement for the expense — no double-count after a repeat call');
select is(
  (select coalesce(sum(amount_out),0) from public.custody_movements where expense_id = :'exp'),
  5000::numeric, 'the single out-movement equals the expense total (5,000)');

-- 6) supervisor (no custody.write) cannot record
select pg_temp.as_user(current_setting('test.supervisor'));
select throws_ok(
  format($$ select public.fn_record_custody_movement(%L,'صرف نقدي',0,200) $$, current_setting('test.acct_id')),
  '42501', null, 'supervisor without custody.write is rejected (42501)');
select throws_ok(
  format($$ select public.fn_custody_balance(%L) $$, current_setting('test.acct_id')),
  '42501', null, 'supervisor without finance.read cannot call fn_custody_balance');
select is((select count(*)::int from public.custody_accounts where id = :'acct'), 0,
  'supervisor cannot read custody_accounts rows');
select is((select count(*)::int from public.custody_movements where custody_account_id = :'acct'), 0,
  'supervisor cannot read custody_movements rows');
reset role;

select * from finish();
rollback;
