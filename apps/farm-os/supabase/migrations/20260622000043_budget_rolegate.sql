-- Farm OS MVP-0 — gate budgets + budget_lines writes on budget.write (#235 RLS role-gate gap).
--
-- THE GAP. `budgets` (0007 do-block) and `budget_lines` (0010) carried only the org-scoped tenant_all
-- policy with NO role gate. INSERT/UPDATE are granted to authenticated (0009; DELETE already revoked,
-- 0027). The `budget.write` permission is defined in the role map (0001) but was referenced by no
-- policy — so any authenticated org member WITHOUT it (supervisor/agri_engineer/storekeeper, and even
-- farm_manager, who holds plan.write but NOT budget.write) could INSERT/UPDATE budget limits directly
-- via PostgREST — altering the org's financial controls. Intra-tenant (RLS still scopes to org).
--
-- THE FIX. Re-emit both tenant_all policies adding `and public.authorize('budget.write', org_id)` to
-- the WITH CHECK only — same shape as 0035's plan_operations gate and 0042's plan_*_requirements gate.
--   * USING stays org-only (reads — incl. the budget check page + owner dashboard — unaffected);
--   * budget_lines preserves its parent-org EXISTS predicate (0010) verbatim;
--   * org-scoped 2-arg authorize (0035, AUTHZ-2); DELETE stays revoked (0027); grants unchanged.
-- No app code writes these tables (the budget pages/actions only .select them), so this is pure
-- defense-in-depth closing the direct-REST hole. budget.write = owner / accountant (migration 0001).

drop policy if exists tenant_all on public.budgets;
create policy tenant_all on public.budgets for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('budget.write', org_id)
  );

drop policy if exists tenant_all on public.budget_lines;
create policy tenant_all on public.budget_lines for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('budget.write', org_id)
    and exists (select 1 from public.budgets b
                where b.id = budget_lines.budget_id and b.org_id = budget_lines.org_id)
  );
