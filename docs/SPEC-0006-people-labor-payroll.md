# SPEC-0006 — People, labor & payroll (Stage 8)

*Status: **DRAFT for Owner review** — design + decision-support only. No code/migration/data. Stage 8
is **High risk** (PII + regulated payroll); **independent review of access is REQUIRED**, and real
staff PII must not enter any environment or third-party model before the Stage M privacy review.
Mirrors SPEC-0001..0005.*

*Companion to [`MASTER-PLAN.md`](MASTER-PLAN.md) §4 Stage 8 + §6 risk #5, [`CLAUDE.md`](CLAUDE.md)
(Security · least privilege), [`02-prd.md`](02-prd.md).*

---

## 1. The risk is confidentiality, not features

`people` already holds **PII + wages**: `name`, `phone`, `email`, `position`, `employment_type`,
**`rate`** (wage), `user_id`, `reports_to_person_id`. `responsibility_assignments` (person ↔ scope,
many-to-many) and `plan_labor_requirements` (planned labor) exist. Missing: **labor logs** (actual
work), **payroll**, **teams**. The dominant risk is that wages/PII are **over-readable** — so the
first job is to **lock confidentiality**, then add labor/payroll on top.

## 2. ⚠️ CONFIRMED pre-existing gap to close (PII-1 — issue #173)

**Confirmed:** `people` carries only the blanket `tenant_all` policy (org-readable, no role gate;
migration `0002`), and `rate`/`phone`/`email` are columns on it — so **any org member can read
everyone's wages + contact PII** directly via `GET /rest/v1/people?select=name,rate,phone,email`
(UI-gated, not RLS-gated). Filed as **issue #173 (MED)**. The MASTER-PLAN requires "PII fields
RLS-scoped; payroll visible only to owner/accountant." **First slice must verify this on the live DB
and, if confirmed, close it** before any payroll feature:
- **Wages (`rate`) + payroll rows:** readable only by `owner`/`accountant` (an `authorize('payroll.read')`
  permission, or RLS `using` restricted to those roles). Field-level: either split `rate` into a
  separate `people_compensation` table (RLS owner/accountant) or a column-masking view — **recommend
  a separate `people_compensation` table**, since Postgres RLS is row-, not column-level.
- **Contact PII (`phone`/`email`):** need-to-know — at minimum the person themself + their manager
  chain + owner/HR; not every field role.

## 3. Scope

**Allowed:** `people_compensation` (wage/pay-rate, RLS owner/accountant); `labor_logs` (person ×
operation/day × hours/units, links to `farm_event`/`plan_operations`); a **basic payroll run**
(period → compute gross from `labor_logs` × rate, owner/accountant only, idempotent transactional
RPC — the EXE-1/RCP-1 discipline); `teams` + team membership; tighten `people` RLS (PII-1);
responsibility auto-routing (already modeled — wire it to notifications later, not here).

**Forbidden:** real staff PII into any environment/model before the Stage M privacy review (#5);
**any payroll figure into a third-party model / the AI** (the عبدالجليل tools must exclude
compensation — see SPEC-0005 permission parity); a **tax engine** (explicitly later); fabricating
people/rates (#1).

## 4. Acceptance (the oracle)

1. **Confidentiality (the gate):** a non-owner/non-accountant role **cannot** read `rate`/payroll
   (RLS test, two roles — owner sees, supervisor does not); contact PII restricted to need-to-know.
   **Independent access review REQUIRED.**
2. **Labor → payroll integrity:** a payroll run's gross = `Σ(labor_logs.hours × rate)` for the period,
   reconciled to a hand-computed fixture; **idempotent** (re-running a closed period does not
   double-pay).
3. **Audit:** payroll runs + compensation changes write the append-only `audit_log` (the membership
   audit precedent, `fn_audit_org_member`/`0019`).
4. **No leakage:** the AI (SPEC-0005) and any export cannot surface compensation to an unauthorized
   role.

## 5. Open decisions for the Owner

1. **Compensation model** — separate `people_compensation` table (recommended) vs masked view; hourly
   vs daily vs monthly rate; allowances/deductions scope (keep minimal for MVP).
2. **Payroll scope** — "basic payroll" = gross from labor only? (No tax/insurance engine — later.)
3. **Contact-PII visibility policy** — exactly which roles see `phone`/`email`.
4. **Real PII timing** — synthetic staff for the build; real staff only post-privacy-review (Stage M).

## 6. Enforcement, evidence, slices

- **Enforcement:** RLS deny-by-default; wages/payroll gated by role (`authorize()`), never app-only;
  payroll RPC idempotent + transactional; audit triggers on compensation + payroll.
- **Evidence:** the two-role confidentiality test, the payroll reconciliation vs a fixture, the
  idempotency test, the audit-row check. **Independent review REQUIRED.** Owner gate; separate
  approver for any real-PII step.
- **Slices:** (1) **PII-1** — confirm + close the `people`/wage over-read (confidentiality first, no
  new features); (2) `labor_logs` + capture UI; (3) payroll run RPC + report (owner/accountant); (4)
  teams + responsibility wiring. Each stops at its gate; **do not auto-advance**.

Stage 8 shares the confidentiality posture with Stage 7 (SPEC-0004) financial RLS and must be
reflected in SPEC-0005's AI tool allow-list (no compensation tools for non-owner/accountant).
