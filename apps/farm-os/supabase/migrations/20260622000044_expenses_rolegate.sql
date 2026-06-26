-- Farm OS MVP-0 — gate expenses writes on budget.write (#235 RLS role-gate gap).
--
-- THE GAP. `expenses` carried only the org-scoped tenant_all policy (re-emitted in 0012 with the
-- RLS-H1 multi-scope EXISTS predicates) with NO role gate. INSERT/UPDATE are granted to authenticated
-- (0009; DELETE already revoked, 0027). So any authenticated org member could insert or edit financial
-- expense records directly via PostgREST — polluting the org's financial data (non-negotiable #6:
-- expense/drawings integrity). Intra-tenant (RLS still scopes to org).
--
-- THE FIX. Re-emit the tenant_all policy adding `and public.authorize('budget.write', org_id)` to the
-- WITH CHECK only — same shape as 0035 (plan_operations), 0042 (plan_*_requirements), 0043 (budgets):
--   * USING stays org-only → reads unaffected;
--   * all FIVE RLS-H1 NULL-tolerant parent-org EXISTS predicates (0012) are preserved verbatim;
--   * org-scoped 2-arg authorize (0035); DELETE stays revoked (0027); grants unchanged.
-- No app code writes expenses (the app only .select-reads them), so this is pure defense-in-depth
-- closing the direct-REST hole. budget.write = owner/accountant (migration 0001) — the appropriate
-- authority for financial records. (A future authz-lane change could introduce a dedicated
-- expense.write perm if expense entry should later be delegated to more roles.)

drop policy if exists tenant_all on public.expenses;
create policy tenant_all on public.expenses for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('budget.write', org_id)
    and (farm_id     is null or exists (select 1 from public.farms     f   where f.id   = expenses.farm_id     and f.org_id   = expenses.org_id))
    and (sector_id   is null or exists (select 1 from public.sectors   s   where s.id   = expenses.sector_id   and s.org_id   = expenses.org_id))
    and (hawsha_id   is null or exists (select 1 from public.hawshat   h   where h.id   = expenses.hawsha_id   and h.org_id   = expenses.org_id))
    and (plan_id     is null or exists (select 1 from public.plans     p   where p.id   = expenses.plan_id     and p.org_id   = expenses.org_id))
    and (supplier_id is null or exists (select 1 from public.suppliers sup where sup.id = expenses.supplier_id and sup.org_id = expenses.org_id))
  );
