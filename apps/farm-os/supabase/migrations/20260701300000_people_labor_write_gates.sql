-- Farm OS — SPEC-0006 (People/labor/payroll): close the `people` write gap + add `labor.write`.
--
-- THE GAP. `people` carries only the org-scoped `tenant_all` policy (migration 0002) with NO role
-- gate on writes — still true after the PII-1 remediations (0046 moved `rate` to
-- `people_compensation`; 0048 locked down `phone`/`email` column SELECT — both were READ-side fixes).
-- Any authenticated org member can INSERT/UPDATE a `people` row today, and there is no app write path
-- at all (no create/edit UI) — a farm_manager cannot onboard a seasonal/daily/contractor worker.
-- Product docs assign "People & Responsibility" management to owner/farm_manager (MASTER-PLAN.md
-- Stage 8; the sibling `responsibility_assignments_write_gate`, migration 20260629141650, already used
-- this EXACT role pair for the sibling table with the identical reasoning). This migration reuses that
-- established gate rather than inventing a new one:
--   (a) adds `people.write` (owner/farm_manager) and gates the existing `tenant_all` WITH CHECK on it
--       — reads stay org-wide (unchanged; the 0048 column lockdown remains the real PII boundary, not
--       row visibility);
--   (b) adds `labor.write` (owner/farm_manager/supervisor) for the new `labor_logs` table (next
--       migration). Attendance/hours are NOT wage data — only `rate` in `people_compensation` is
--       confidentiality-gated per SPEC-0006 §1/§4 — so this permission is intentionally BROADER than
--       `payroll.read`, mirroring the day-to-day field-execution role set (`op.execute` already grants
--       supervisor for field execution) rather than the finance-only `payroll.read` pair.
--
-- Because direct-REST insert becomes safely role-gated by this migration, no new SECURITY DEFINER RPC
-- is introduced for onboarding a person — the existing `people_reports_to_same_org` BEFORE trigger
-- (migration 0071) already enforces the one FK invariant a direct insert needs, exactly like the
-- `suppliers`/`responsibility_assignments` direct-REST + RLS-gate precedent.
--
-- MIGRATION-ORDER NOTE. authorize() is re-emitted by several migrations (checked every in-flight
-- session branch). At the time this migration was authored, 20260629150000_custody_and_expense_
-- payment.sql was the latest/highest-numbered re-emit on `main`, but a SIBLING in-flight PR —
-- #557 (feat/agronomist-signoff-gate, migration 20260701280000_agronomist_signoff_gate.sql) — ALSO
-- re-emits authorize(), adding `agronomy.signoff` (owner/agri_engineer). Both PRs independently
-- re-emitting from the same base migration is exactly the collision docs/CLAUDE.md's authorize()
-- re-emit footgun warns about: whichever merges/applies second would silently drop the other's new
-- permission if it re-emitted from the old base instead of the sibling's.
--
-- RESOLUTION (reconciled 2026-07-01): this migration now BUILDS ON PR #557's authorize() re-emit
-- (agronomy.signoff), not the original 20260629150000 base — this PR's own additions are
-- people.write/labor.write, giving PR #557 → PR #558 a safe apply order. PR #557 MUST be
-- applied/merged before this one; it is not touched by this change (its own logic is unmodified),
-- only used as the base union for this re-emit.
--
-- ADR-0006 conventions: SECURITY DEFINER + search_path=''; fully schema-qualified; drop-then-create /
-- create-or-replace policies; append-only. DRAFT — never applied to any remote DB from this session.

create or replace function public.authorize(perm text, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_member m
    where m.user_id = (select auth.uid())
      and m.org_id = p_org
      and ( (perm = 'pr.approve'             and m.role = 'owner')
         or (perm = 'plan.write'             and m.role in ('owner','farm_manager'))
         or (perm = 'op.execute'             and m.role in ('owner','farm_manager','agri_engineer','supervisor'))
         or (perm = 'inventory.write'        and m.role in ('owner','farm_manager','storekeeper'))
         or (perm = 'budget.write'           and m.role in ('owner','accountant'))
         or (perm = 'payroll.read'           and m.role in ('owner','accountant'))
         or (perm = 'structure.write'        and m.role in ('owner','farm_manager'))
         or (perm = 'academy.write'          and m.role in ('owner','agri_engineer'))   -- in-flight #366 (forward-compat)
         or (perm = 'export.write'           and m.role in ('owner','farm_manager'))     -- in-flight #400 (forward-compat)
         or (perm = 'responsibility.write'   and m.role in ('owner','farm_manager'))     -- in-flight #444 (forward-compat)
         or (perm = 'finance.read'           and m.role in ('owner','accountant'))        -- SPEC-0018 confidential finance reads
         or (perm = 'custody.write'          and m.role in ('owner','accountant'))        -- SPEC-0018 finance-only custody writes
         or (perm = 'request.prepare'        and m.role in ('owner','accountant'))        -- SPEC-0018 finance-only payment prep
         or (perm = 'request.approve.op'     and m.role in ('owner','accountant'))        -- SPEC-0018 finance approval
         or (perm = 'request.approve.final'  and m.role = 'owner')                       -- SPEC-0018 owner final approval
         or (perm = 'agronomy.signoff'       and m.role in ('owner','agri_engineer'))    -- PR #557: non-negotiable #4 sign-off gate (REASONABLE DEFAULT, not Owner's final word)
         or (perm = 'people.write'           and m.role in ('owner','farm_manager'))                 -- SPEC-0006: onboarding
         or (perm = 'labor.write'            and m.role in ('owner','farm_manager','supervisor')) )  -- SPEC-0006: attendance
  )
$$;
revoke execute on function public.authorize(text, uuid) from public, anon, authenticated;
grant  execute on function public.authorize(text, uuid) to anon, authenticated;  -- RLS helper (anon needed for policy eval)

drop policy if exists tenant_all on public.people;
create policy tenant_all on public.people for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('people.write', org_id)
  );
