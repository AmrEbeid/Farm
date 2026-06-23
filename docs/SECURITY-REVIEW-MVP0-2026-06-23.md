# Independent Security Review — Farm OS MVP-0   (2026-06-23)

Reviewer: independent adversarial pass (DB layer via 3 subagents + app layer), verified
against SPEC-0001 and the pgTAP oracles. Owner: Amr Ebeid. Scope: `apps/farm-os` MVP-0
build on local Supabase. Method: every high-severity finding re-checked against source
before acting; fixes verified by re-running the pgTAP suite (59/59) on a local Postgres
(the Docker/Supabase stack would not start this session — see "Verification" below).

Status legend: ✅ fixed + verified · 📝 documented (fix pending) · ⏸ deferred (needs Docker stack)

---

## A. Database layer — RLS / grants / engine  (branch `fix/mvp0-security-remediation`)

| Id | Sev | Finding | Status |
|----|-----|---------|--------|
| GRANT-C1 | CRITICAL | Migration 0009 granted the unauthenticated `anon` role full DML + `EXECUTE on all functions` on `public`. RLS was the *only* control; `EXECUTE` on the SECURITY DEFINER engine (org-guard skipped when `auth.uid()` is null) exposed an **unauthenticated cross-tenant read/write RPC** path. | ✅ revoke anon grants (migration 0010) |
| ENGINE-guard | HIGH | Org guard trusted any null-`auth.uid()` caller (anon is also null-uid). | ✅ explicit `auth.role()='anon'` block |
| RLS-H1 | HIGH | Child tables (`event_*`, `quantities`, `plan_*_requirements`, `budget_lines`, `purchase_request_items`) checked only the row's own `org_id`, not the parent's → org A could write a child pointing at org B's parent (cross-tenant write/inject). | ✅ parent-org `WITH CHECK` |
| ENGINE-C1 | CRITICAL | `fn_stock_coverage` double-subtracted expiry (`on_hand` already nets it per the SC-6 oracle). | ✅ `available = on_hand − reserved` |
| ENGINE-H1 | HIGH | Phantom purchase recommendation for ample-stock / zero-demand items. | ✅ fires only on a real below-SS dip |
| ENGINE-H2 | MED | Demand/receipts beyond the horizon clamped into the last period. | ✅ filtered out |
| ENGINE-SS | — | SPEC `< safety_stock` warning never emitted. | ✅ `first_warning_period` added |
| HIGH-1 | HIGH | `organization`/`organization_member` writeable by `authenticated` at the privilege layer (denied only by policy omission) → latent self-service org-join escalation. | ✅ client writes revoked |
| ENGINE-M1 | MED | Projected stock-out date anchored to a (possibly past) plan start. | ✅ `greatest(today, period_start)` |

Regression: `supabase/tests/05_security_remediation_test.sql` (13 assertions) pins each.

---

## B. Application layer — server actions / auth   (📝 documented; fix needs e2e verification)

The Next.js server actions are the mutation path. Auth (`lib/auth.ts`) is sound:
`getUser()` (verified, not cookie-trusted), `requireMembership()`/`requireRole()` gate
routes, and reads go through the RLS-scoped session client. PR approval correctly
delegates SoD (AP-1/AP-2) to the `pr_update` RLS policy. The issues are in the
inventory-mutating actions:

### B1 (HIGH, integrity) — non-atomic `inventory_bin` arithmetic → ledger drift + lost updates
`recordReceipt` ([purchase-requests/[prId]/actions.ts:50](apps/farm-os/app/(app)/purchase-requests/[prId]/actions.ts)) and
`executeOperation` ([m/execute/[opId]/actions.ts:80](apps/farm-os/app/(app)/m/execute/[opId]/actions.ts))
read `inventory_bin.on_hand`/`reserved`, compute the new value in JS, write it back, and
**separately** insert the movement — across multiple un-transactioned Supabase calls.
- **Lost-update race:** two concurrent receipts read the same `on_hand`, both add, last
  write wins → stock silently lost. (TOCTOU on a read-modify-write.)
- **Bin↔ledger drift:** the bin is updated and the movement inserted as separate requests
  with no transaction; a partial failure leaves `on_hand ≠ Σ(movements)`, violating the
  **SC-6 reconciliation invariant** that the whole coverage engine trusts (SPEC-0001 §2).
- **`reserved` is not ledger-backed at all:** `executeOperation` does
  `reserved = max(0, reserved − req.qty)` directly on the snapshot; no `reserve`/`release`
  movement is recorded, so `reserved` can never be reconciled. (Related to deferred item D2.)

**Recommended fix:** move each inventory mutation into a single **SECURITY DEFINER
Postgres RPC** (transactional) that inserts the movement(s) and then sets
`on_hand = Σ(signed movements)` via the existing `fn_bin_rebuild` pattern — one round-trip,
atomic, always ledger-consistent. The architecture decision (SPEC-0001 §"Decisions") already
calls for logic in DB functions "close to the data." Add pgTAP that asserts the invariant
holds after concurrent receipts. **Verify via the Playwright wedge-loop e2e** (the exact
flow these actions drive) — which is why this wasn't shipped this session (Docker down).

### B2 (MED, authorization) — inventory writes are not role-gated
`inventory_bin`/`inventory_movements` use the blanket `tenant_all` policy (org-only). The
intended model (`authorize('inventory.write')` = owner/farm_manager/storekeeper, migration
0001) is **not enforced** in RLS or in the actions — any org member can mutate stock. The
code comments claim the restriction but nothing applies it. Acceptable for the single-tenant
pilot; tighten before multi-tenant (add `authorize('inventory.write')` to the policy or a
`requireRole` check in the action).

### B3 (MED, data fidelity) — hardcoded execution figures
`executeOperation` hardcodes `occurred_at = '2025-07-08'` and a price of **84 ج.م/kg**
([m/execute/[opId]/actions.ts:40,104](apps/farm-os/app/(app)/m/execute/[opId]/actions.ts)),
and `runPlanChecks` hardcodes the budget category `"أسمدة"`
([plans/[planId]/actions.ts:64](apps/farm-os/app/(app)/plans/[planId]/actions.ts)). These
are seed/demo conveniences but violate "never fabricate financial data" if they reach a real
tenant — a real execution must use the actual date and unit cost. Replace before any real
data (Stage M).

### B4 (MED, validation) — no input validation on server-action inputs  ✅ partial
`actualQty`, `laborCount`, `est_cost`, `material_qty` were written without range/NaN checks
— a negative `actualQty` would *increase* `on_hand`. **Added boundary guards** to
`executeOperation` (actualQty ≥ 0 finite; laborCount ≥ 0 integer) and `addPlanOperation`
(est_cost ≥ 0 finite; material_qty > 0 finite) — reject-only, so the valid path is
unchanged; `tsc` clean. **Pending:** confirm via the e2e, and extend to any other
numeric-input action. (No new dependency added — manual guards, not zod, per the
"no new deps without Owner approval" rule.)

### Reviewed and OK (no action)
- `app/api/dev/seed-auth/route.ts` — guarded by `isLocal()` (URL-based), returns 403 off
  local and safe-defaults to 403 when the URL is unset. **Correct as-is**: the e2e runs a
  *production build* against local Supabase, so a `NODE_ENV` guard would wrongly disable it.
- `lib/supabase/admin.ts` — service-role key is non-`NEXT_PUBLIC_`, `server-only`, window-
  guarded; only importer is the server-only seed path. Not in the client bundle.
- `middleware.ts` — refreshes the session only (no redirect); auth is enforced per-route via
  `requireMembership`/`requireRole` + RLS. Reasonable.

---

## C. Deferred (⏸ need the Docker/PostgREST stack to verify safely)
- **D1 — FORCE ROW LEVEL SECURITY** on tenant tables (definer-function defense-in-depth).
  Local Postgres can't verify it: the superuser bypasses RLS, masking FORCE behavior, and
  its interaction with the Supabase `postgres`/`service_role` roles must be checked on the
  real stack so the seed/migrations don't break.
- **D2 — `bin.reserved` ledger reconciliation** — make reservations `reserve`/`release`
  movements and extend `fn_bin_rebuild` to recompute `reserved`; couples to the B1 RPC fix
  and is validated by the reservation step of the e2e.

---

## Verification
- pgTAP suite: **59/59 green** (36 existing + 23 new, incl. SPEC §2 engine edge cases), run on a local PostgreSQL 17 + pgTAP
  with Supabase shims (`auth` schema, `auth.uid()/role()`, the `anon/authenticated/service_role`
  roles), all 10 migrations + seed applied. Docker Desktop crash-looped (`exit status 150`)
  this session, so `supabase test db` + the Playwright e2e were run via the local-PG harness
  for the DB layer; the **e2e remains the one item requiring the Docker stack**.
- App TS unit tests: 11/11.

## Recommended order for the Owner
1. Review + sign off branch `fix/mvp0-security-remediation` (A + the two hardening fixes).
2. Run the Playwright e2e on a healthy Docker stack to confirm A didn't regress the wedge loop.
3. Schedule B1 (transactional inventory RPCs) as the next slice — it's the highest-value
   remaining integrity fix; verify with e2e. Fold in B2/B4 and D2 there.
4. B3 + D1 before any real-tenant data / multi-tenant go-live.
