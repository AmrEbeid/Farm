-- 97 — authorize() permission-completeness invariant.
-- authorize(perm, p_org) is RE-EMITTED by multiple migrations, each adding one permission (0035 base →
-- 0046 payroll.read → 0081 structure.write → 0091 academy.write → 0092 export.write → #444
-- responsibility.write → #438 finance/custody/request permissions). A re-emit that copies from an
-- OLDER base silently DROPS permissions added by intervening migrations — caught in integration:
-- #400's 0092 (export.write) had dropped #366's 0091 academy.write, breaking the whole Care Academy
-- gate. This pins the full union so any future re-emit that omits a known permission fails CI.
-- (Catalog-level via pg_get_functiondef — valid on the local superuser cluster.)
-- Run via supabase test db or test-shims/run-pgtap-local.sh.
begin;
select plan(1);

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

select * from finish();
rollback;
