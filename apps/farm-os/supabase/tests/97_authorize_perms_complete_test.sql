-- 97 — authorize() permission-completeness invariant.
-- authorize(perm, p_org) is RE-EMITTED by multiple migrations, each adding one permission (0035 base →
-- 0046 payroll.read → 0081 structure.write → 0091 academy.write → 0092 export.write → #444
-- responsibility.write → #438 finance/custody/request permissions). A re-emit that copies from an
-- OLDER base silently DROPS permissions added by intervening migrations — caught in integration:
-- #400's 0092 (export.write) had dropped #366's 0091 academy.write, breaking the whole Care Academy
-- gate. This pins the full union so any future re-emit that omits a known permission fails CI, and pins
-- the finance-only SPEC-0018 role semantics so stale forward-compat comments cannot re-broaden access.
-- Run via supabase test db or test-shims/run-pgtap-local.sh.
begin;
select plan(12);

\set org '00000000-0000-0000-0000-000000000001'

select set_config('test.accountant', (select user_id::text from public.organization_member where org_id=:'org' and role='accountant' limit 1), false);
select set_config('test.manager',    (select user_id::text from public.organization_member where org_id=:'org' and role='farm_manager' limit 1), false);
select set_config('test.owner',      (select user_id::text from public.organization_member where org_id=:'org' and role='owner' limit 1), false);

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select is(
  (select count(*)::int
     from unnest(array[
       'pr.approve', 'plan.write', 'op.execute', 'inventory.write', 'budget.write',
       'payroll.read', 'structure.write', 'academy.write', 'export.write', 'responsibility.write',
       'finance.read', 'custody.write', 'request.prepare', 'request.approve.op', 'request.approve.final'
     ]) as perm
     where position(perm in pg_get_functiondef('public.authorize(text, uuid)'::regprocedure)) = 0),
  0,
  'authorize(text,uuid) recognizes every expected permission — no re-emit dropped one');

select pg_temp.as_user(current_setting('test.accountant'));
select is(public.authorize('finance.read', :'org'), true, 'finance.read: accountant HAS it');
select is(public.authorize('custody.write', :'org'), true, 'custody.write: accountant HAS it');
select is(public.authorize('request.prepare', :'org'), true, 'request.prepare: accountant HAS it');
select is(public.authorize('request.approve.op', :'org'), true, 'request.approve.op: accountant HAS it');
select is(public.authorize('request.approve.final', :'org'), false, 'request.approve.final: accountant does NOT');
reset role;

select pg_temp.as_user(current_setting('test.manager'));
select is(public.authorize('finance.read', :'org'), false, 'finance.read: manager does NOT');
select is(public.authorize('custody.write', :'org'), false, 'custody.write: manager does NOT');
select is(public.authorize('request.prepare', :'org'), false, 'request.prepare: manager does NOT');
select is(public.authorize('request.approve.op', :'org'), false, 'request.approve.op: manager does NOT');
select is(public.authorize('request.approve.final', :'org'), false, 'request.approve.final: manager does NOT');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select is(public.authorize('request.approve.final', :'org'), true, 'request.approve.final: owner HAS it');
reset role;

select * from finish();
rollback;
