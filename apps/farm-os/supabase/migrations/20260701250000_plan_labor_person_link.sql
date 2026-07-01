-- Farm OS — labor cost basis: link plan_labor_requirements to people (OPTIONAL FK).
--
-- CONTEXT. plan_labor_requirements (0006) is free-text only (person_or_team text, count, days) and is
-- never linked to public.people, so a planned labor line can never be costed. plan_operation_assignees
-- (0090) DOES link to people (person_id, is_lead) but is a separate, disjoint list — "who is assigned",
-- not "how many workers × how many days does this line represent". This migration adds a NULLABLE
-- person_id FK to plan_labor_requirements so a labor line CAN optionally reference a real person for a
-- wage-rate lookup (people_compensation, 0046, payroll.read-gated) while still allowing person_or_team
-- free text for informal/day-labor crews that are not (yet) formal `people` records — SPEC-0006 §3 scope
-- explicitly anticipates this ("day laborers may not all be formal people records"). NOT NULL/required
-- would break every existing writer (fn_add_plan_operation, fn_add_plan_operation_multi, the plan_builder
-- RPC — 0038/0093/0084 — all insert plan_labor_requirements without a person_id today), so this is
-- additive only: person_id defaults to null and every existing insert keeps working unchanged.
--
-- Mirrors the FK + cross-org-guard pattern in migration 0090 (plan_operation_assignees.person_id) and the
-- WITH-CHECK-only re-emit style of 0042 (plan_req_rolegate) / 0072 (people_comp_person_org). ADR-0006
-- conventions: FK-index (0036), force RLS already on (0028), org-scoped 2-arg authorize (AUTHZ-2/0035).
--
-- Confidentiality (SPEC-0006, non-negotiable): this migration does NOT touch people_compensation's own
-- comp_rw policy (payroll.read gate, 0046/0072/0079) or the audit gate (0053) — a person_id FK here is
-- just "who the labor line refers to" (as non-sensitive as plan_operation_assignees.person_id, which is
-- already org-readable), never the wage itself. The wage lookup at query time stays gated exactly as
-- before: an org member without payroll.read simply cannot read people_compensation.rate, so a cost
-- rollup built on top of this column (a later slice) can never surface an unauthorized wage.

-- ── 1) The optional FK. ────────────────────────────────────────────────────────────────────────────
alter table public.plan_labor_requirements
  add column if not exists person_id uuid references public.people(id);

-- FK-index convention (migration 0036): cover the FK column used by joins / rate lookups.
create index if not exists plan_labor_requirements_person_id_idx
  on public.plan_labor_requirements(person_id);

-- ── 2) Re-emit tenant_all (0042) adding the same-org EXISTS for person_id to WITH CHECK only, exactly
-- like 0090 did for plan_operation_assignees.person_id and 0072 did for people_compensation.person_id.
-- Nullable ⇒ "is null or same-org person". USING / plan.write / parent-op EXISTS are all preserved
-- verbatim from 0042 — reads stay org-only (who a labor line names is not sensitive; the wage is,
-- and that boundary is unchanged), only the write-side cross-org guard is added. ──────────────────────
drop policy if exists tenant_all on public.plan_labor_requirements;
create policy tenant_all on public.plan_labor_requirements
  for all to authenticated
  using (org_id in (select public.user_org_ids()))
  with check (
    org_id in (select public.user_org_ids())
    and public.authorize('plan.write', org_id)
    and exists (select 1 from public.plan_operations po
                where po.id = plan_labor_requirements.plan_op_id
                  and po.org_id = plan_labor_requirements.org_id)
    and (
      plan_labor_requirements.person_id is null
      or exists (select 1 from public.people pe
                 where pe.id = plan_labor_requirements.person_id
                   and pe.org_id = plan_labor_requirements.org_id)
    )
  );
