-- Farm OS MVP-0 — close the plan_checks mask-by-DELETE residual (the #313 review's finding).
--
-- 0068 gated plan_checks INSERT/UPDATE on plan.write (closing the forge/tamper vectors), but WITH CHECK
-- does not cover DELETE, and migration 0027 intentionally LEFT plan_checks member-deletable (the app's
-- runPlanChecks does delete+re-insert as the authenticated member). So a member WITHOUT plan.write can
-- still DELETE a `block` check to blank the warning until the next authorized recompute (mask-by-deletion,
-- non-negotiable #1 — the same harm class as the forge). (The fix was approved on #313 but did not land in
-- 0068 due to merge timing; this is the forward migration.)
--
-- THE FIX. A RESTRICTIVE FOR DELETE policy. RESTRICTIVE policies are AND-ed onto the permissive
-- tenant_all, so a DELETE now requires BOTH org membership (tenant_all USING) AND plan.write. The legit
-- deleter (runPlanChecks) holds plan.write so its delete+re-insert still works; a non-plan.write member's
-- DELETE is filtered to 0 rows (the check survives). SELECT/INSERT/UPDATE are untouched — this policy is
-- FOR DELETE only; tenant_all continues to govern them.

drop policy if exists plan_checks_delete_gate on public.plan_checks;
create policy plan_checks_delete_gate on public.plan_checks
  as restrictive for delete to authenticated
  using (public.authorize('plan.write', org_id));
