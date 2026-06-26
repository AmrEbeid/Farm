-- Farm OS MVP-0 — #270 H2: gate people_compensation audit rows on payroll.read (wage PII confidentiality).
--
-- THE GAP (latent on prod — 0 wage-audit rows today, but the policy is already wrong). audit_read
-- (migration 0002) is org-only: `org_id in (user_org_ids())`. Migration 0046 introduced
-- people_compensation, restricted its BASE-table reads to payroll.read (owner/accountant), backfilled
-- wages, and dropped people.rate — but the audit MIRROR was left org-wide. fn_audit writes before/after
-- wage rows to audit_log with entity_type='people_compensation'; so the moment a wage is created or
-- edited, ANY org member (storekeeper, supervisor, field) could read the amount out of audit_log,
-- re-opening exactly the leak #173/0046 closed on the base table. Confirmed via prod pg_policies:
-- audit_read USING is still `org_id IN (user_org_ids())` with no entity_type gate.
--
-- THE FIX. Re-emit audit_read with the base-table's confidentiality rule mirrored onto the log: a
-- people_compensation audit row is visible only to payroll.read holders; every other entity_type is
-- unchanged (org-scoped). `is distinct from` is NULL-safe, though entity_type is NOT NULL. payroll.read
-- already exists in authorize() (0046), verified present on prod.

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log
  for select to authenticated
  using (
    org_id in (select public.user_org_ids())
    and (
      entity_type is distinct from 'people_compensation'
      or public.authorize('payroll.read', org_id)
    )
  );
