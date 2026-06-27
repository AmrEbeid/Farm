# SPEC-0011 — Planning workspace (Stage 4 remainder)

*Status: **DRAFT for Owner review** — design + the build that lands with it. Stage 4's operation-authoring,
checks, and planned-vs-actual were built in MVP-0; this spec covers the **remainder**: creating a plan,
setting its status, assigning people, and capturing labor. No prod apply (Owner-gated). Companion to
[`MASTER-PLAN.md`](MASTER-PLAN.md) §4 Stage 4 and [`SPEC-0010`](SPEC-0010-activity-event-recording.md).*

## 1. Why now
The app can add operations to a plan (`fn_add_plan_operation` / OperationBuilder), run the five plan checks,
and show planned-vs-actual — but **there is no way to create a plan**: no `fn_create_plan`, no plans list,
no create form. `/plans/[planId]` only opens a pre-seeded plan. Stage 4's acceptance — "create a plan,
assign people, see planned cost & materials" — is unmet at the create step. Low/Med risk, Owner gate
(review recommended, not required).

## 2. What already exists (migration 0006 / 0038 / 0025)
`plans` + `plan_operations` + `plan_material_requirements` + `plan_labor_requirements` + `plan_checks`;
`fn_add_plan_operation` (0038, atomic op+material, `plan.write`-gated); `plan_operations` gated to
`plan.write` in RLS (0025); the OperationBuilder, runPlanChecks, and `/reports/[planId]/pva` UIs.

## 3. Scope (allowed)
1. **`fn_create_plan`** — SECURITY DEFINER, `plan.write`-gated, creates a `plans` row (type/period/scope,
   status `draft`); org resolved from the caller (single-org) / validated. Returns the plan id.
2. **`fn_set_plan_status`** — `plan.write`-gated, moves a plan draft → active → closed; validates the set.
3. **`fn_assign_plan_operation`** — `plan.write`-gated, sets `plan_operations.responsible_person_id`
   (the "assign people" half), validating the person is in the plan's org.
4. **`fn_add_plan_labor`** — `plan.write`-gated, adds a `plan_labor_requirements` row (person/team, count,
   days) to an operation — completes "planned cost & materials **and labor**".
5. **Gate the `plans` table direct-REST writes on `plan.write`** (parity with `plan_operations`/0025 and the
   structure tables) — defense-in-depth; the app writes via the RPCs.
6. **UI** — a **`/plans` list page** (all plans + status) with a **create-plan form**, and a person-assign
   control on the plan page. Arabic-RTL.

## 4. Forbidden / deferred
- Approvals/entitlement logic is **Stage 6** (budget + approvals) — not here; a plan's `approval_needed`/
  budget gating stays where it is. No money movement.
- Operation templates and recurring plans — deferred to a follow-up slice.
- No real-data import.

## 5. Acceptance (the oracle)
- **Create:** `fn_create_plan` as a `plan.write` role → a `plans` row (status draft) in the caller's org;
  a non-`plan.write` role → `42501`. Then `fn_add_plan_operation` against it works (existing path).
- **Status:** `fn_set_plan_status` flips draft→active; an invalid status → `22023`.
- **Assign:** `fn_assign_plan_operation` sets the responsible person; a person from another org → `22023`/`42501`.
- **Labor:** `fn_add_plan_labor` adds a labor requirement; a negative count/days → `22023`.
- **Direct-REST gate:** a non-`plan.write` member cannot `INSERT` a `plans` row via REST → `42501`.

## 6. Slices
1. `fn_create_plan` + `fn_set_plan_status` + `fn_assign_plan_operation` + `fn_add_plan_labor` + the `plans`
   RLS gate (migration) + pgTAP. *(Low/Med.)*
2. `/plans` list + create-plan form + assign-person control on the plan page. *(Low — UI.)*
3. *(Deferred)* operation templates, recurring/duplicated plans, labor in OperationBuilder.

## 7. Enforcement
Each RPC: pinned `search_path`, schema-qualified, `authorize('plan.write', v_org)` IN the DB, cross-org
guard, revoked from public+anon, granted to authenticated. Local pgTAP harness stays green. Prod apply is
Owner-gated. **Gate: Owner** (independent review recommended, not required — no money/PII; budget gating
stays Stage 6).
