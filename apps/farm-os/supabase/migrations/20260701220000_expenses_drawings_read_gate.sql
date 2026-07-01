-- Farm OS — privacy fix: gate READ of expenses.kind='drawing' rows on finance.read (independent
-- security + product review, 2026-07-01).
--
-- THE GAP. Non-negotiable #6 (docs/CLAUDE.md) requires owner drawings (مسحوبات) to be separable from
-- operating expenses and visible only to owner/accountant. Migration 0044 gated expenses WRITES on
-- budget.write but explicitly left READS org-only ("USING stays org-only → reads unaffected"). So any
-- authenticated org member — including farm_manager — can read the FULL expense ledger, incl. the
-- owner's personal drawing rows, directly via PostgREST. The only boundary today is the app-layer
-- requireRole() check on expenses/page.tsx and finance/dashboard/page.tsx, both of which currently admit
-- farm_manager. This contradicts budgets/[budgetId]/page.tsx, which already treats the raw expense
-- ledger as "private finance data scoped to owner/accountant" and hides it from farm_manager (see #455,
-- which closed the equivalent gap on the supplier/budget 360 pages).
--
-- RELATIONSHIP TO #368. The open, still-DRAFT accounting-framework PR #368 carries an alternative,
-- unapplied migration (0097_expenses_read_gate.sql) that takes a FULL budget.write gate on ALL expense
-- reads — removing farm_manager visibility entirely, symmetric with the (also unshipped) `sales` table —
-- per a commit citing an "Owner decision (2026-06-29)". That PR is blocked behind the #368
-- accounting-reconciliation sign-off (docs/OWNER-DECISIONS.md P4 #13), not behind this security gap, so
-- the gap has sat open in prod. This migration is a narrower, independently-shippable sibling (same
-- pattern as #455): it redacts ONLY kind='drawing' rows, so farm_manager keeps reading operating/capex
-- expenses (today's product surface) while owner drawings are cut off at the DB, not just the app layer.
-- THE OWNER MUST RECONCILE the two designs before both land — whichever policy definition is applied
-- LAST wins the final `tenant_all` shape (the same "re-emit footgun" class of risk this repo already
-- guards for authorize(), just applied to a re-emitted table policy instead of the function).
--
-- THE FIX. Re-emit tenant_all adding `and (kind <> 'drawing' or authorize('finance.read', org_id))` to
-- USING only:
--   * WITH CHECK is carried over VERBATIM from 0044 (all five RLS-H1 NULL-tolerant parent-org EXISTS
--     predicates + the budget.write write-gate) — no change to who can write or what they can write.
--   * finance.read already exists (SPEC-0018, re-emitted in 20260629150000_custody_and_expense_payment)
--     mapped to owner/accountant — the SAME role set budget.write maps to today, so for owner/accountant
--     this is a no-op; only non-finance roles (farm_manager, agri_engineer, supervisor, storekeeper) lose
--     read access to drawing rows specifically.
--   * expenses.kind is NOT NULL (default 'operating', added in 20260629150000) so `kind <> 'drawing'` needs
--     no null-tolerance.
--   * expenses already carries ENABLE + FORCE ROW LEVEL SECURITY (0028) — untouched here.
--
-- ROLLBACK: re-emit tenant_all with the 0044 USING clause (org-only, no kind predicate) to revert.
-- Owner-gated apply (draft only). Validate with test-shims/run-pgtap-local.sh.

drop policy if exists tenant_all on public.expenses;
create policy tenant_all on public.expenses for all to authenticated
  using (
    org_id in (select public.user_org_ids())
    and (kind <> 'drawing' or public.authorize('finance.read', org_id))
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
