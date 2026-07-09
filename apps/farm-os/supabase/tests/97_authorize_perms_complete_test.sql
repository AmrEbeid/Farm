-- 97 — authorize() permission-completeness invariant.
-- authorize(perm, p_org) is RE-EMITTED by multiple migrations, each adding one permission (0035 base →
-- 0046 payroll.read → 0081 structure.write → 0092 academy.write + export.write (+ finance/custody/request) → #444
-- responsibility.write → #438 finance/custody/request permissions → PR #557 agronomy.signoff → PR #558
-- people.write/labor.write). A re-emit that copies from an OLDER base silently DROPS permissions added
-- by intervening migrations — caught in integration: #400's 0092 (export.write) had dropped #366's 0091
-- academy.write, breaking the whole Care Academy gate. This pins the full union so any future re-emit
-- that omits a known permission fails CI, and pins the finance-only SPEC-0018 role semantics so stale
-- forward-compat comments cannot re-broaden access.
--
-- PR #558 NOTE: this migration's authorize() re-emit (20260701300000_people_labor_write_gates.sql)
-- builds on PR #557's re-emit (agronomy.signoff), not the original base — see that migration's header.
-- This test asserts the FULL permission union — 19 perms as of 20260701420000 (site.write): the 18
-- through PR #558 (people.write/labor.write) plus site.write. As of security-360 MEDIUM-4 it ALSO pins
-- each permission's ROLE MAP (not just its presence): a future re-emit that silently WIDENS or narrows a
-- role list (e.g. adds supervisor to budget.write) now fails CI, not only one that drops a perm entirely.
-- Run via supabase test db or test-shims/run-pgtap-local.sh.
begin;
select plan(45);

\set org '00000000-0000-0000-0000-000000000001'

select set_config('test.accountant', (select user_id::text from public.organization_member where org_id=:'org' and role='accountant' limit 1), false);
select set_config('test.manager',    (select user_id::text from public.organization_member where org_id=:'org' and role='farm_manager' limit 1), false);
select set_config('test.owner',      (select user_id::text from public.organization_member where org_id=:'org' and role='owner' limit 1), false);
select set_config('test.engineer',   (select user_id::text from public.organization_member where org_id=:'org' and role='agri_engineer' limit 1), false);
select set_config('test.supervisor', (select user_id::text from public.organization_member where org_id=:'org' and role='supervisor' limit 1), false);
select set_config('test.storekeeper', (select user_id::text from public.organization_member where org_id=:'org' and role='storekeeper' limit 1), false);

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
       'finance.read', 'custody.write', 'request.prepare', 'request.approve.op', 'request.approve.final',
       'agronomy.signoff', 'people.write', 'labor.write', 'site.write'
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
select is(public.authorize('agronomy.signoff', :'org'), false, 'agronomy.signoff: farm_manager does NOT (PR #557)');
select is(public.authorize('people.write', :'org'), true, 'people.write: manager HAS it (PR #558)');
select is(public.authorize('labor.write', :'org'), true, 'labor.write: manager HAS it (PR #558)');
reset role;

select pg_temp.as_user(current_setting('test.owner'));
select is(public.authorize('request.approve.final', :'org'), true, 'request.approve.final: owner HAS it');
select is(public.authorize('agronomy.signoff', :'org'), true, 'agronomy.signoff: owner HAS it (PR #557)');
reset role;

-- agronomy.signoff (PR #557): owner + agri_engineer (REASONABLE DEFAULT, not a final Owner decision on
-- sign-off authority) — confirms PR #557's permission survives this branch's rebased re-emit.
select pg_temp.as_user(current_setting('test.engineer'));
select is(public.authorize('agronomy.signoff', :'org'), true, 'agronomy.signoff: agri_engineer HAS it (PR #557)');
reset role;

-- labor.write (PR #558): supervisor is intentionally included (day-to-day field-execution role set).
select pg_temp.as_user(current_setting('test.supervisor'));
select is(public.authorize('labor.write', :'org'), true, 'labor.write: supervisor HAS it (PR #558)');
select is(public.authorize('people.write', :'org'), false, 'people.write: supervisor does NOT (PR #558)');
reset role;

-- ── security-360 MEDIUM-4: ROLE-MAP breadth for the 11 operational/structure/site perms ─────────────
-- These 11 were previously pinned for PRESENCE only (the union check above), not their role lists. Pin
-- one HAS role and one MUST-NOT role per perm, from the authorize() body in 20260701420000, so a silent
-- widening/narrowing of any of these role lists fails CI. Roles: owner / farm_manager / agri_engineer /
-- supervisor / storekeeper / accountant.
select pg_temp.as_user(current_setting('test.owner'));
select is(public.authorize('pr.approve', :'org'),  true, 'pr.approve: owner HAS it');
select is(public.authorize('site.write', :'org'),  true, 'site.write: owner HAS it');
reset role;

select pg_temp.as_user(current_setting('test.manager'));
select is(public.authorize('plan.write', :'org'),          true,  'plan.write: farm_manager HAS it');
select is(public.authorize('structure.write', :'org'),     true,  'structure.write: farm_manager HAS it');
select is(public.authorize('export.write', :'org'),        true,  'export.write: farm_manager HAS it');
select is(public.authorize('responsibility.write', :'org'),true,  'responsibility.write: farm_manager HAS it');
select is(public.authorize('op.execute', :'org'),          true,  'op.execute: farm_manager HAS it');
select is(public.authorize('inventory.write', :'org'),     true,  'inventory.write: farm_manager HAS it');
select is(public.authorize('pr.approve', :'org'),          false, 'pr.approve: farm_manager does NOT (owner-only)');
select is(public.authorize('budget.write', :'org'),        false, 'budget.write: farm_manager does NOT');
select is(public.authorize('payroll.read', :'org'),        false, 'payroll.read: farm_manager does NOT');
select is(public.authorize('academy.write', :'org'),       false, 'academy.write: farm_manager does NOT');
select is(public.authorize('site.write', :'org'),          false, 'site.write: farm_manager does NOT (owner-only)');
reset role;

select pg_temp.as_user(current_setting('test.accountant'));
select is(public.authorize('budget.write', :'org'),    true,  'budget.write: accountant HAS it');
select is(public.authorize('payroll.read', :'org'),    true,  'payroll.read: accountant HAS it');
select is(public.authorize('op.execute', :'org'),      false, 'op.execute: accountant does NOT');
select is(public.authorize('inventory.write', :'org'), false, 'inventory.write: accountant does NOT');
select is(public.authorize('export.write', :'org'),    false, 'export.write: accountant does NOT');
reset role;

select pg_temp.as_user(current_setting('test.engineer'));
select is(public.authorize('academy.write', :'org'),   true,  'academy.write: agri_engineer HAS it');
select is(public.authorize('op.execute', :'org'),      true,  'op.execute: agri_engineer HAS it');
select is(public.authorize('structure.write', :'org'), false, 'structure.write: agri_engineer does NOT');
reset role;

select pg_temp.as_user(current_setting('test.supervisor'));
select is(public.authorize('op.execute', :'org'),      true,  'op.execute: supervisor HAS it');
select is(public.authorize('structure.write', :'org'), false, 'structure.write: supervisor does NOT');
select is(public.authorize('inventory.write', :'org'), false, 'inventory.write: supervisor does NOT');
reset role;

select pg_temp.as_user(current_setting('test.storekeeper'));
select is(public.authorize('inventory.write', :'org'), true,  'inventory.write: storekeeper HAS it');
select is(public.authorize('op.execute', :'org'),      false, 'op.execute: storekeeper does NOT');
reset role;

select * from finish();
rollback;
