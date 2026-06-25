# Independent Review — follow-up pass   (2026-06-25)

Reviewer: independent adversarial pass over the post-deploy `main` (continuing
[`SECURITY-REVIEW-MVP0-2026-06-23.md`](SECURITY-REVIEW-MVP0-2026-06-23.md)). Owner: Amr Ebeid.
Scope: `apps/farm-os` RLS/grants + the money/integrity server actions, on the live local Supabase
stack. Method: every finding reproduced on the DB before acting; fixes verified with `supabase test
db` (full reset). Status legend: ✅ fixed + verified (PR open) · 📝 documented (fix Owner-gated).

## Verification baseline (this pass)

- `@amrebeid/ui`: typecheck clean, `tsup` build clean, token-purity clean, **231 vitest/jest-axe tests pass**.
- `apps/farm-os`: `tsc --noEmit` clean, **18 vitest pass**, `next build` OK (19 routes), eslint **fixed to clean** (PR #43).
- DB: **pgTAP green** at every step — 78/78 (baseline) → 84/84 (append-only + SoD-guard) → 92/92 (EXE-1) → 94/94 (ENGINE-DC TODO regression) → 97/97 (RCP-1) → **97/97 with test `14` a real pass** (ENGINE-DC fix, migration `0018`). After every step run `supabase db reset` first (the invariant tests assume the pristine seed).

## Fixed this pass — all **MERGED to `main`** (prod DB push still Owner-gated)

| Id | Sev | Finding | PR |
|----|-----|---------|----|
| **B2.1** | HIGH (integrity) | The stock ledger was directly **DELETE-able** by any org member. B2's `FOR ALL` policy gated INSERT/UPDATE via `WITH CHECK`, but DELETE is governed by `USING` alone, and the blanket `0009` grant still gave `authenticated` DELETE. Confirmed: a supervisor deleted all of an org's movements. Fixed by `revoke delete … from authenticated` (migration `0016`) → append-only ledger; pgTAP test `11`. | #42 ✅ |
| **AP-5** | MED–HIGH (financial control + audit) | PR **self-approval bypass**: `pr_update`'s AP-2 check (`requested_by <> auth.uid()`) reads the NEW row, which the same UPDATE can mutate — so an owner-author self-approved by rewriting `requested_by` to another member in one statement (also falsifying provenance). Confirmed on the DB. Fixed by a `BEFORE UPDATE` trigger that freezes `requested_by` and stamps `approved_by`/`approved_at` from the session (migration `0017`); pgTAP test `12`. | #47 ✅ |
| **EXE-1** | MED (integrity) | `executeOperation` was **not idempotent**: a double-submit/retry/concurrent POST bypassed the page's "done" guard and re-ran the whole issue/release path (double stock loss, over-release, duplicate `done` event). Fixed **claim-first** — flip `status→done` as the first write guarded by `status <> 'done'`, abort if no row, before any stock movement; revert the claim only before anything is persisted. pgTAP test `13` + Playwright wedge-loop. | #51 ✅ |
| **RCP-1** | MED–HIGH (integrity) | EXE-1's twin — `recordReceipt` posted a `receipt` movement per item then flipped the PR `received` with **no precondition**, so a double-submit re-posted every receipt → **phantom stock IN** (`on_hand` inflated). Fixed **claim-first** — flip `approved→received` guarded by `status='approved'`, abort if no row, before any movement (also adds the missing precondition). pgTAP test `15` + wedge-loop. | #57 ✅ |
| **ENGINE-DC** | MED–HIGH (correctness) | `fn_stock_coverage` seeded `available` from `on_hand` (Σ **all** receipt movements via `fn_bin_rebuild`) **and** re-projected `receipt` movements dated `>= period_start` forward → any received receipt counted **twice** → optimistic PAB that could **hide a real shortage** (SPEC-0001 #1 risk). Prototyping a `current_date` cut-line proved it's a *data-model* problem (broke test `06` Case C), so **direction #2**: source scheduled receipts from **approved purchase_requests (open POs)**, never the actual-movement ledger — disjoint from `on_hand` by construction (on receipt the PR flips `→received` as a receipt movement enters `on_hand`). Migration `0018`; test `06` re-modeled onto POs; regression test `14` un-TODO'd. | #61 ✅ |
| **CREATE-1** | LOW (integrity) | `createPurchaseRequestFromShortage` inserted a new draft PR + posted a `reserve` on every call → a double-submit made duplicate draft PRs + an extra reservation (conservative — over-reserves, can't mask a shortage). Fixed **find-or-create**: reuse an existing open (draft/submitted) PR that already carries a line for the item instead of creating a duplicate. (Residual: truly-concurrent calls could still both create — over-reserve only; a fully race-safe guard needs a DB constraint.) | #63 ✅ |
| (lint) | — | `npm run lint` was red on `main` (1 error + 2 warnings; CI doesn't run lint). Fixed; presentation-only. | #43 ✅ |
| (finding) | — | Schema-wide direct-DELETE exposure across 28 tenant tables (root cause + tiered remediation). | #45 ✅ |

> **Naming:** the SoD finding is labelled **AP-5** (not AP-3) — "AP-3" is already the PR
> version/stale guard in the original review (`actions.ts`, [`09-acceptance-tests.md`](09-acceptance-tests.md)).
> Renamed in migration `0017`, test `12`, and these docs to avoid the collision.

## Open findings — documented, fix is Owner-gated

> **ENGINE-DC is now FIXED on `main`** (migration `0018`, #61) via direction #2 — see the Fixed
> table above and [`SECURITY-FINDING-engine-receipt-doublecount-2026-06-25.md`](SECURITY-FINDING-engine-receipt-doublecount-2026-06-25.md).
> It was independently reviewed (diff + full pgTAP `97/97` incl. the un-TODO'd test `14` + the
> Playwright wedge-loop) before merge. As the change to the product's core IP, **the Owner should
> ratify it before the prod DB push** (which — like `0015`–`0017` — remains the gated step).

### BUD-1 (INFO, financial control) — the budget gate is decision-support, not a hard DB gate
The budget "gate" (`budget/[planId]/check/page.tsx`) computes a verdict (`ok` / `approval-needed` /
`block`) and **routes** over-threshold PRs to owner approval — but nothing **server-side** blocks an
owner from approving an over-budget PR. The enforced financial controls are **AP-1** (only an owner
can approve, `authorize('pr.approve')`) and **AP-5** (the requester can't approve) — both in the
`pr_update` RLS policy; the budget figure is **decision support** the owner sees before deciding (a
legitimate "owner may override budget" reality). Also: `budgets/budget_lines.committed` is
**display-only** in MVP-0 — it is read on the dashboard/check page but **never written** on
approval/receipt (the seed supplies the numbers; the wedge's `thisOp` cost is hardcoded for the
demo). **Not a defect** — it matches the single-tenant MVP scope — but the Owner should know the
budget is informational, not an enforced spend cap. If a hard cap is wanted later: increment
`committed` on approval (in a transactional RPC) and add a `WITH CHECK`/trigger that rejects an
approval exceeding `approved − committed − actual`, with a pgTAP case. Needs the role/budget design
+ independent review (money logic).

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

**AUDIT-1 (related, INFO):** `organization_member` has **no `fn_audit` trigger** (audited tables:
`purchase_request`, `budget`, `budget_line`, `farm_event`, `expense`, `inventory_movement`). Not a
current vulnerability — HIGH-1 (migration `0010`) **revoked** client INSERT/UPDATE/DELETE on
`organization_member` (SELECT-only), so there is no client role-change path to audit; role changes
happen out-of-band via the admin API. **When role-management UI lands (with the role model), add an
audit trigger on `organization_member`** so entitlement grants are on the immutable trail.

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

#43, #42, #47, #45, #51, **#57**, and **#61** are **merged** (+ docs #49/#54/#55/#58/#59/#60 and the
ENGINE-DC TODO regression #56); `main` is green (pgTAP **97/97** on a clean reset — test `14` now a
real pass after the ENGINE-DC fix — + wedge-loop e2e + app/lib CI). Each code fix was independently
diff-reviewed + locally verified (pgTAP + e2e) before merge (RLS/money/engine paths); #51 also
incorporated three CodeRabbit data-integrity refinements.

**Still Owner-gated — prod DB migration push.** Prod is at migration `0013`; `0015` (B2), `0016`
(B2.1), `0017` (AP-5), and `0018` (ENGINE-DC) are verified on `main` but **not applied to prod** (a
prod DB migration is a hard stop per PROJECT RULES). When the Owner is ready, apply
`0015`→`0016`→`0017`→`0018` in order via [`DEPLOY-RUNBOOK.md`](DEPLOY-RUNBOOK.md). **`0018` changes
the core stock-coverage engine — the Owner should ratify it specifically before the push.** The app
runs correctly without these (writes already route through the bypassrls RPCs; `0018` only affects
the coverage projection's receipt source). *(The RCP-1/EXE-1 app-code fixes are already on `main`,
deploy on the next Vercel push.)*

**Remaining open findings (all Owner-gated / deferred):** **AUTHZ-1** (execute org-only, not
role-gated — with the role model; + the related **AUDIT-1** INFO note: add an `organization_member`
audit trigger when role-management lands), **DEP-1** (`postcss` transitive, build-time only — low),
**BUD-1** (INFO — budget gate is decision-support, not a hard cap). CI-1 withdrawn (the pgTAP gate
already exists via `db-tests.yml`).
