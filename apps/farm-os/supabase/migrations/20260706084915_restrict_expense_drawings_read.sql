-- Restrict owner-drawing expense rows to finance readers.
--
-- `expenses` intentionally stays readable to org members for ordinary operating/capex spend that powers
-- manager budget workflows, but `kind='drawing'` is owner-confidential finance data. Keep the 0044
-- budget.write WITH CHECK gate and all RLS-H1 parent-org predicates intact while tightening SELECT/UPDATE
-- visibility for drawing rows behind authorize('finance.read', org_id) = owner/accountant.

drop policy if exists tenant_all on public.expenses;
create policy tenant_all on public.expenses for all to authenticated
  using (
    org_id in (select public.user_org_ids())
    and (
      kind <> 'drawing'
      or public.authorize('finance.read', org_id)
    )
  )
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('budget.write', org_id)
    and (farm_id     is null or exists (select 1 from public.farms     f   where f.id   = expenses.farm_id     and f.org_id   = expenses.org_id))
    and (sector_id   is null or exists (select 1 from public.sectors   s   where s.id   = expenses.sector_id   and s.org_id   = expenses.org_id))
    and (hawsha_id   is null or exists (select 1 from public.hawshat   h   where h.id   = expenses.hawsha_id   and h.org_id   = expenses.org_id))
    and (plan_id     is null or exists (select 1 from public.plans     p   where p.id   = expenses.plan_id     and p.org_id   = expenses.org_id))
    and (supplier_id is null or exists (select 1 from public.suppliers sup where sup.id = expenses.supplier_id and sup.org_id = expenses.org_id))
  );
