-- Farm OS MVP-0 — gate plan_checks WRITES on plan.write (so a member cannot forge a check result).
--
-- THE GAP. plan_checks' tenant_all policy is org-only on writes (+ the 0063 plan-org FK). But
-- plan_checks.result (ok|warn|block) is the stock/budget/labor verdict shown on the plan and dashboards.
-- The app's runPlanChecks ALREADY requires plan.write (plans/[planId]/actions.ts:29, "PLAN-AUTHZ-1") and
-- is the only writer — but the RLS does not, so a member WITHOUT plan.write can direct-REST insert a
-- forged check (e.g. result='ok' for the stock kind) and MASK a real shortage/over-budget warning to the
-- user (non-negotiable #1: never fabricate/mask). Gating the RLS on plan.write closes that forge and
-- makes the database match the app-layer authz (defense-in-depth, mirroring 0042's plan-requirements
-- gate and the inventory write gates).
--
-- THE FIX. Re-emit tenant_all adding `and public.authorize('plan.write', org_id)` to the WITH CHECK only,
-- preserving USING (org-only reads — every member sees the plan's check results) and the 0063 plan-org
-- EXISTS verbatim. The legit writer (runPlanChecks) holds plan.write, so no legitimate flow is affected.

drop policy if exists tenant_all on public.plan_checks;
create policy tenant_all on public.plan_checks for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('plan.write', org_id)
    and exists (select 1 from public.plans p
                where p.id = plan_checks.plan_id and p.org_id = plan_checks.org_id)
  );
