-- Farm OS — #368 follow-up (independent security review): gate expense READS on budget.write, symmetric
-- with the sales/revenue read-gate (0088). Two parts, both required for symmetry:
--   (1) the public.expenses tenant_all USING was org-only → every member could read all expense amounts
--       AND the 0088 owner-drawings `kind` marker (مسحوبات) via PostgREST. Gate USING on budget.write.
--   (2) the audit_log mirror: expense before/after rows are written under entity_type='expense'; without
--       gating that arm too, the same data leaks via audit_read (the #270 H2 class — exactly what 0088
--       closed for 'sale'). Re-emit audit_read adding the 'expense' arm alongside people_compensation+sale.
-- Owner decision (2026-06-29): gate symmetric (owner/accountant only). Writes were already budget.write-
-- gated; the expenses WITH CHECK is re-emitted VERBATIM (incl. cross-org FK validations). errs safe.
-- NOTE (product follow-up, not security): removes farm_manager/supervisor expense-read visibility; the
-- /expenses nav for those roles is revisited separately.

-- (1) expense table reads
drop policy tenant_all on public.expenses;
create policy tenant_all on public.expenses
  for all to authenticated
  using (
    org_id in (select public.user_org_ids())
    and public.authorize('budget.write', org_id)
  )
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('budget.write', org_id)
    and (farm_id is null or exists (select 1 from public.farms f where f.id = expenses.farm_id and f.org_id = expenses.org_id))
    and (sector_id is null or exists (select 1 from public.sectors s where s.id = expenses.sector_id and s.org_id = expenses.org_id))
    and (hawsha_id is null or exists (select 1 from public.hawshat h where h.id = expenses.hawsha_id and h.org_id = expenses.org_id))
    and (plan_id is null or exists (select 1 from public.plans p where p.id = expenses.plan_id and p.org_id = expenses.org_id))
    and (supplier_id is null or exists (select 1 from public.suppliers sup where sup.id = expenses.supplier_id and sup.org_id = expenses.org_id))
  );

-- (2) audit_log mirror: gate the 'expense' arm too (preserves the people_compensation + sale arms from 0088).
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select to authenticated
  using (
    org_id in (select public.user_org_ids())
    and (entity_type is distinct from 'people_compensation' or public.authorize('payroll.read', org_id))
    and (entity_type is distinct from 'sale'    or public.authorize('budget.write', org_id))
    and (entity_type is distinct from 'expense' or public.authorize('budget.write', org_id))
  );
