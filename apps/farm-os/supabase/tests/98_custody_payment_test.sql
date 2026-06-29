-- 98 — SPEC-0018 slice 1: custody ledger + expense payment routing (migration 0098).
-- Verifies: authorize() carries the FULL permission union (incl. the new finance perms + the in-flight
-- academy/export forward-compat — guards the re-emit drop-trap, since test 97 isn't on main); the
-- custody.write gate; anon EXECUTE lockdown on the new RPCs; balance = Σin − Σout; the one-direction
-- guard; and the cardinal money rule — a paid_from_custody expense posts EXACTLY ONE custody out-movement
-- equal to its total, idempotently (no double-count, #6). Impersonation via request.jwt.claims (the JWT
-- harness used by tests 36/82). Run via test-shims/run-pgtap-local.sh.
begin;
select plan(15);

\set org '00000000-0000-0000-0000-000000000001'
\set acct 'a0c0a000-0000-0000-0000-0000000000c0'
\set exp  'a0e00000-0000-0000-0000-0000000000e0'

-- fixtures (superuser, RLS-bypassed): a custody account + a 5,000 expense; capture ids/uids as GUCs so
-- the dollar-quoted RPC calls below can read them.
insert into public.custody_accounts (id, org_id, holder_label, target_float)
  values (:'acct', :'org', 'مدير المزرعة', 30000);
insert into public.expenses (id, org_id, date, category, description, total, status)
  values (:'exp', :'org', current_date, 'تسميد', 'بند اختبار', 5000, 'approved');
select set_config('test.acct_id', :'acct', false);
select set_config('test.exp_id', :'exp', false);
select set_config('test.accountant', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'accountant' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member
  where org_id = :'org' and role = 'supervisor' limit 1), false);

select ok(exists(select 1 from public.custody_accounts where id = :'acct'), 'fixture: custody account exists');

-- 1) authorize() carries the FULL union (catalog read)
select is(
  (select count(*)::int from unnest(array[
     'pr.approve','plan.write','op.execute','inventory.write','budget.write','payroll.read','structure.write',
     'academy.write','export.write','custody.write','request.prepare','request.approve.op','request.approve.final'
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

-- helper: impersonate a member
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- 3) custody.write maps to accountant, NOT supervisor
select pg_temp.as_user(current_setting('test.accountant'));
select is(public.authorize('custody.write', :'org'), true,  'custody.write: accountant HAS it');
reset role;
select pg_temp.as_user(current_setting('test.supervisor'));
select is(public.authorize('custody.write', :'org'), false, 'custody.write: supervisor does NOT');
reset role;

-- 4) balance = Σin − Σout ; one-direction guard ; no-double-count idempotency — all as the accountant
-- (values inlined via format(%L) — the proven harness pattern from test 82; current_setting() inside the
--  executed string does not resolve reliably under pgTAP's lives_ok/throws_ok.)
select pg_temp.as_user(current_setting('test.accountant'));
select lives_ok(
  format($$ select public.fn_record_custody_movement(%L,'استلام عهدة من المالك',30000,0) $$, current_setting('test.acct_id')),
  'accountant records a 30,000 custody receipt');
select is(public.fn_custody_balance(:'acct'), 30000::numeric, 'balance = Σin − Σout = 30,000');
select throws_ok(
  format($$ select public.fn_record_custody_movement(%L,'تسوية',100,100) $$, current_setting('test.acct_id')),
  '22023', null, 'reject a movement with both amount_in and amount_out > 0');
select lives_ok(
  format($$ select public.fn_set_expense_payment_status(%L,'paid_from_custody',%L) $$, current_setting('test.exp_id'), current_setting('test.acct_id')),
  'mark expense paid_from_custody (first call)');
select lives_ok(
  format($$ select public.fn_set_expense_payment_status(%L,'paid_from_custody',%L) $$, current_setting('test.exp_id'), current_setting('test.acct_id')),
  'mark expense paid_from_custody again (idempotent)');
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
reset role;

select * from finish();
rollback;
