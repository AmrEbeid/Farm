-- Farm OS — #368 follow-up (independent security review): gate expense READS on budget.write, symmetric
-- with the sales/revenue read-gate (0088). BEFORE: public.expenses tenant_all USING was org-only
-- (org_id in user_org_ids()), so EVERY authenticated org member could read all expense amounts AND the
-- 0088 owner-drawings `kind` marker (مسحوبات) directly via PostgREST — a financial-privacy leak the 0088
-- sales gate did not cover (P&L = revenue − expenses; only revenue was gated). Owner decision (2026-06-29):
-- gate symmetric → expense reads are owner/accountant only.
--
-- Writes were ALREADY budget.write-gated (the WITH CHECK below is re-emitted VERBATIM from the live policy,
-- including the cross-org FK validations for farm/sector/hawsha/plan/supplier); the ONLY change is adding
-- `authorize('budget.write', org_id)` to the USING (read) clause. errs safe: tightens reads, no write change.
-- NOTE (product follow-up, not a security item): this removes farm_manager/supervisor expense-read
-- visibility; the /expenses nav for those roles must be revisited separately.

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
