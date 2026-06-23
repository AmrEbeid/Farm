-- Farm OS MVP-0 — D3: RLS reference-column hardening (security review MEDIUM-2).
--
-- assets and expenses carry nullable FK columns that reference other org-scoped tables.
-- The FK enforces the referenced row EXISTS, but not that it's in the SAME org — so an
-- org-A row could point its sector_id/farm_id/plan_id at an org-B row (a cross-tenant
-- reference / data-integrity leak, even though the victim can't read the A-owned row).
-- Recreate each tenant_all policy with a NULL-tolerant same-org WITH CHECK per reference.
-- (Lower severity than RLS-H1 — these are advisory/nullable — but same class of hole.)
--
-- Verifiable on plain Postgres (RLS as `authenticated`), no Docker needed. Test 08 pins it.

-- assets: sector_id, hawsha_id, line_id (location rollup).
-- (parent_id is a self-reference: an EXISTS against `assets` inside the assets policy
--  triggers 42P17 infinite-recursion, and a foreign-org parent_id is RLS-invisible to the
--  victim anyway, so it is the lowest-value check — omitted to keep the policy non-recursive.)
drop policy if exists tenant_all on public.assets;
create policy tenant_all on public.assets for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and (sector_id is null or exists (select 1 from public.sectors s where s.id = assets.sector_id and s.org_id = assets.org_id))
    and (hawsha_id is null or exists (select 1 from public.hawshat h where h.id = assets.hawsha_id and h.org_id = assets.org_id))
    and (line_id   is null or exists (select 1 from public.lines   l where l.id = assets.line_id   and l.org_id = assets.org_id))
  );

-- expenses: farm_id, sector_id, hawsha_id, plan_id, supplier_id.
drop policy if exists tenant_all on public.expenses;
create policy tenant_all on public.expenses for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and (farm_id     is null or exists (select 1 from public.farms     f  where f.id  = expenses.farm_id     and f.org_id  = expenses.org_id))
    and (sector_id   is null or exists (select 1 from public.sectors   s  where s.id  = expenses.sector_id   and s.org_id  = expenses.org_id))
    and (hawsha_id   is null or exists (select 1 from public.hawshat   h  where h.id  = expenses.hawsha_id   and h.org_id  = expenses.org_id))
    and (plan_id     is null or exists (select 1 from public.plans     p  where p.id  = expenses.plan_id     and p.org_id  = expenses.org_id))
    and (supplier_id is null or exists (select 1 from public.suppliers sup where sup.id = expenses.supplier_id and sup.org_id = expenses.org_id))
  );
