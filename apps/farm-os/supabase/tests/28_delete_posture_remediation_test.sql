-- 28 — DELETE-posture remediation (migration 0027): close the schema-wide direct-DELETE surface.
--
-- Finding (docs/SECURITY-FINDING-delete-exposure-2026-06-25.md): migration 0009's blanket
-- `grant ... delete ... to authenticated` + the single tenant_all FOR ALL policy (DELETE governed by
-- org-membership USING alone) let ANY authenticated org member DELETE rows directly via PostgREST on
-- ~28 tenant tables. The app only legitimately deletes ONE table as the authenticated client —
-- plan_checks (the plan builder recomputes via delete + re-insert). Migration 0027 REVOKEs DELETE
-- from authenticated|anon on every exposed tenant table EXCEPT plan_checks.
--
-- This test pins a representative sample of the locked tables (financial/operational/structural/PII)
-- as DELETE-denied to an authenticated member, and confirms plan_checks stays deletable. REVOKE
-- raises 42501 (insufficient_privilege) before any row scan, so a no-match predicate is sufficient.
--
-- Mirrors test 20 (the ledger append-only pin). Run via `supabase test db`.

begin;
select plan(7);

\set orgA '00000000-0000-0000-0000-000000000001'

select set_config('test.sup', (select user_id::text from public.organization_member
  where org_id = :'orgA' and role='supervisor'), false);

-- ===== act as a plain authenticated org member (supervisor) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('test.sup'), 'role','authenticated')::text, true);
set local role authenticated;

-- Locked tables — direct DELETE must be denied (privilege revoked).
select throws_ok($$ delete from public.expenses $$, '42501', null,
  '0027: authenticated member cannot DELETE expenses (financial record of truth)');
select throws_ok($$ delete from public.people $$, '42501', null,
  '0027: authenticated member cannot DELETE people (PII)');
select throws_ok($$ delete from public.farm_event $$, '42501', null,
  '0027: authenticated member cannot DELETE farm_event (operational ledger)');
select throws_ok($$ delete from public.quantities $$, '42501', null,
  '0027: authenticated member cannot DELETE quantities (operational ledger)');
select throws_ok($$ delete from public.plans $$, '42501', null,
  '0027: authenticated member cannot DELETE plans');

-- reads stay open so dashboards/engine keep working for every role
select isnt((select count(*) from public.people), 0::bigint,
  '0027: authenticated member can still READ people (tenant policy USING untouched)');

-- plan_checks is intentionally LEFT deletable — the plan builder needs it (actions.ts:91).
-- A no-match predicate exercises the privilege without touching seed rows.
select lives_ok(
  $$ delete from public.plan_checks where plan_id = '00000000-0000-0000-0000-000000000000' $$,
  '0027: authenticated member CAN still DELETE plan_checks (plan builder recompute path)');

reset role;
select * from finish();
rollback;
