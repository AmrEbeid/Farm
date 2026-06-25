# Independent Review — follow-up pass   (2026-06-25)

Reviewer: independent adversarial pass over the post-deploy `main` (continuing
[`SECURITY-REVIEW-MVP0-2026-06-23.md`](SECURITY-REVIEW-MVP0-2026-06-23.md)). Owner: Amr Ebeid.
Scope: `apps/farm-os` RLS/grants + the money/integrity server actions, on the live local Supabase
stack. Method: every finding reproduced on the DB before acting; fixes verified with `supabase test
db` (full reset). Status legend: ✅ fixed + verified (PR open) · 📝 documented (fix Owner-gated).

## Verification baseline (this pass)

- `@amrebeid/ui`: typecheck clean, `tsup` build clean, token-purity clean, **231 vitest/jest-axe tests pass**.
- `apps/farm-os`: `tsc --noEmit` clean, **18 vitest pass**, `next build` OK (19 routes), eslint **fixed to clean** (PR #43).
- DB: **pgTAP green** at every step — 78/78 (baseline) → 84/84 (append-only + SoD-guard) → 92/92 (EXE-1) → 94/94 (ENGINE-DC TODO regression) → **97/97** (RCP-1). After every step run `supabase db reset` first (the invariant tests assume the pristine seed).

## Fixed this pass — all **MERGED to `main`** (prod DB push still Owner-gated)

| Id | Sev | Finding | PR |
|----|-----|---------|----|
| **B2.1** | HIGH (integrity) | The stock ledger was directly **DELETE-able** by any org member. B2's `FOR ALL` policy gated INSERT/UPDATE via `WITH CHECK`, but DELETE is governed by `USING` alone, and the blanket `0009` grant still gave `authenticated` DELETE. Confirmed: a supervisor deleted all of an org's movements. Fixed by `revoke delete … from authenticated` (migration `0016`) → append-only ledger; pgTAP test `11`. | #42 ✅ |
| **AP-5** | MED–HIGH (financial control + audit) | PR **self-approval bypass**: `pr_update`'s AP-2 check (`requested_by <> auth.uid()`) reads the NEW row, which the same UPDATE can mutate — so an owner-author self-approved by rewriting `requested_by` to another member in one statement (also falsifying provenance). Confirmed on the DB. Fixed by a `BEFORE UPDATE` trigger that freezes `requested_by` and stamps `approved_by`/`approved_at` from the session (migration `0017`); pgTAP test `12`. | #47 ✅ |
| **EXE-1** | MED (integrity) | `executeOperation` was **not idempotent**: a double-submit/retry/concurrent POST bypassed the page's "done" guard and re-ran the whole issue/release path (double stock loss, over-release, duplicate `done` event). Fixed **claim-first** — flip `status→done` as the first write guarded by `status <> 'done'`, abort if no row, before any stock movement; revert the claim only before anything is persisted. pgTAP test `13` + Playwright wedge-loop. | #51 ✅ |
| **RCP-1** | MED–HIGH (integrity) | EXE-1's twin — `recordReceipt` posted a `receipt` movement per item then flipped the PR `received` with **no precondition**, so a double-submit re-posted every receipt → **phantom stock IN** (`on_hand` inflated). Fixed **claim-first** — flip `approved→received` guarded by `status='approved'`, abort if no row, before any movement (also adds the missing precondition). pgTAP test `15` + wedge-loop. | #57 ✅ |
| (lint) | — | `npm run lint` was red on `main` (1 error + 2 warnings; CI doesn't run lint). Fixed; presentation-only. | #43 ✅ |
| (finding) | — | Schema-wide direct-DELETE exposure across 28 tenant tables (root cause + tiered remediation). | #45 ✅ |

> **Naming:** the SoD finding is labelled **AP-5** (not AP-3) — "AP-3" is already the PR
> version/stale guard in the original review (`actions.ts`, [`09-acceptance-tests.md`](09-acceptance-tests.md)).
> Renamed in migration `0017`, test `12`, and these docs to avoid the collision.

## Open findings — documented, fix is Owner-gated

### ENGINE-DC (MED–HIGH, correctness) — scheduled receipts double-counted (masks real shortages)
`fn_stock_coverage` seeds `available = on_hand − reserved` (and `on_hand` = Σ **all** movements via
`fn_bin_rebuild`, no date filter) **and** also adds `receipt` movements dated `>= period_start`
forward as "scheduled receipts" — so any receipt on/after `period_start` (often in the past once a
plan is underway) is counted twice, making the projection optimistic and **hiding a real shortage**.
Full reproduction + root cause in
[`SECURITY-FINDING-engine-receipt-doublecount-2026-06-25.md`](SECURITY-FINDING-engine-receipt-doublecount-2026-06-25.md) (#53).
**Owner-gated — genuine design decision, not auto-fixed.** A `current_date` cut-line (the "minimal"
fix) would break test `06` Case C, which deliberately models `v_receipts` as future supply with a
hand-set `on_hand` — proving the real fix is a *data-model* choice. **Recommendation:** source
scheduled receipts from **approved purchase_requests / open POs** (the MRP-correct model, disjoint
from `on_hand` by construction) rather than from the actual-movement ledger, and rewrite test `06`
Case C to the new model. Needs independent review + full pgTAP + the Playwright wedge-loop (the
engine is the product's core IP and a PROJECT-RULES review-required area).

### CREATE-1 (LOW, integrity) — `createPurchaseRequestFromShortage` is not idempotent
The reserve/PR-create action (`inventory/[itemId]/coverage/actions.ts`) inserts a new draft PR +
line item and posts a `reserve` movement on every call, with no idempotency token — so a
double-submit makes **duplicate draft PRs** and an **extra reservation**. Lower severity than
EXE-1/RCP-1: the duplicate PRs are draft/visible/deletable, and the double `reserve` *over*-states
`reserved` (available drops further) — **conservative**, it can't mask a shortage. The clean fix is
a client-supplied idempotency key or a "one open PR per (item, plan)" unique constraint; deferred
(the UI disables the button on submit). Noted while fixing RCP-1.

### DEP-1 (LOW, dependency) — `postcss < 8.5.10` (transitive via `next`)
`npm audit --omit=dev` reports **2 moderate** advisories: `postcss < 8.5.10`
([GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93), XSS via an unescaped
`</style>` in CSS-stringify output), pulled in transitively by `next`. Real-world risk here is
**low** — postcss runs at **build time** over the app's own Tailwind/CSS, not untrusted input.
`npm audit fix --force` proposes a bogus **downgrade to `next@9`** — do not run it. The advisory
range covers `next` through `16.3.0-canary.5`, so a patch bump likely won't clear it; the clean fix
is an npm `overrides` entry `"postcss": "^8.5.10"` (the root `package.json` already uses `overrides`).
**Left for the Owner** — touch the dependency tree only with a full `next build` + Vercel deploy
re-verify, given how fragile the Linux-native / Tailwind-v4 build chain was to stabilize (PRs #22–#33).
Low urgency.

### AUTHZ-1 (LOW–MED, posture) — `op.execute`/role gates are claimed but not enforced at RLS
`executeOperation`'s docstring says "RLS-scoped (op.execute role …)", but the action only calls
`requireMembership()` and the tables it writes (`farm_event`, `quantities`, `event_locations`,
`plan_operations`) use the org-only `tenant_all` policy — so **any org member can execute an
operation** (issue stock, mark done) directly. This is the same posture as the deferred role model
(see B2 and the DELETE-exposure finding): acceptable for the single reference tenant, tighten with
the role model before multi-tenant. Recommend gating the execute path on `authorize('op.execute')`
when the role model lands (mirroring B2's inventory-write gate), keeping execution routed through
the bypassrls RPCs so supervisors/engineers can still execute.

### CI-1 (process) — ~~the pgTAP suite is not run in CI~~ **WITHDRAWN — the gate already exists**
**Correction:** the pgTAP suite **is** gated on every PR/push by a *separate* workflow,
`.github/workflows/db-tests.yml` (the "pgTAP — RLS · audit · seed · engine · security" check). I
originally concluded otherwise by inspecting only `ci.yml`, which carries just the lib `build` and
`app` jobs — I missed the sibling workflow. So my fixes (B2.1 test 11, AP-5 test 12) and every other
RLS/audit/engine regression **are** caught on a PR. CI-1 is withdrawn.

The one true (and deliberately-accepted) residual: `db-tests.yml` runs the **Docker-free shim
harness** (plain Postgres + pgTAP shims), which by its own note does **not** exercise FORCE ROW
LEVEL SECURITY, PostgREST/GoTrue, or the Playwright e2e — the authoritative `supabase test db` +
`playwright` run stays a local/Docker step. Adding a full-stack `supabase test db` job would close
that, but it's a slow/Docker tradeoff the project chose against on purpose; it's the Owner's call,
not a defect. (I opened #50 for it and then closed it once I found `db-tests.yml`.)

## Repo hygiene (clean bill)
- **No committed secrets:** no `.env*` tracked; no JWTs (`eyJ…`), connection strings with embedded
  credentials, or hardcoded passwords/keys in tracked files. (The 🔴 "exposed secret" risk in the
  tracker is the *legacy* accounting sheet + the keys pasted in the deploy chat — Owner rotates at
  project end.)

## Status — all fixes merged to `main` (2026-06-25)

#43, #42, #47, #45, #51, and **#57** are **merged** (+ docs #49/#54/#55 and the ENGINE-DC TODO
regression #56); `main` is green (pgTAP **97/97** on a clean reset, with ENGINE-DC test `14` as an
expected TODO + wedge-loop e2e + app/lib CI). Each code fix was independently diff-reviewed before
merge (RLS/money paths); #51 also incorporated three CodeRabbit data-integrity refinements.

**Still Owner-gated — prod DB migration push.** Prod is at migration `0013`; `0015` (B2), `0016`
(B2.1), and `0017` (AP-5) are verified on `main` but **not applied to prod** (a prod DB migration is
a hard stop per PROJECT RULES). When the Owner is ready, apply `0015`→`0016`→`0017` in order via
[`DEPLOY-RUNBOOK.md`](DEPLOY-RUNBOOK.md). The app runs correctly without them (writes already route
through the bypassrls RPCs); they tighten direct-REST access. *(The RCP-1/EXE-1 fixes are app code,
no migration — already on `main`, deploy on the next Vercel push.)*

**Remaining open findings (all Owner-gated / deferred):** **ENGINE-DC** (core-engine receipt
double-count — data-model decision; TODO regression test `14` is in place), **AUTHZ-1** (execute
org-only, not role-gated — with the role model), **CREATE-1** (PR-create not idempotent — low,
conservative), **DEP-1** (`postcss` transitive, build-time only — low). CI-1 withdrawn (the pgTAP
gate already exists via `db-tests.yml`).
