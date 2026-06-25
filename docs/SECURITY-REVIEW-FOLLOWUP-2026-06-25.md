# Independent Review — follow-up pass   (2026-06-25)

Reviewer: independent adversarial pass over the post-deploy `main` (continuing
[`SECURITY-REVIEW-MVP0-2026-06-23.md`](SECURITY-REVIEW-MVP0-2026-06-23.md)). Owner: Amr Ebeid.
Scope: `apps/farm-os` RLS/grants + the money/integrity server actions, on the live local Supabase
stack. Method: every finding reproduced on the DB before acting; fixes verified with `supabase test
db` (full reset). Status legend: ✅ fixed + verified (PR open) · 📝 documented (fix Owner-gated).

## Verification baseline (this pass)

- `@amrebeid/ui`: typecheck clean, `tsup` build clean, token-purity clean, **231 vitest/jest-axe tests pass**.
- `apps/farm-os`: `tsc --noEmit` clean, **18 vitest pass**, `next build` OK (19 routes), eslint **fixed to clean** (PR #43).
- DB: **pgTAP green** at every step — 78/78 (baseline) → 83/83 (with the append-only fix) → 84/84 (with the SoD-guard fix).

## Fixed this pass (PRs open for Owner review — not merged/deployed)

| Id | Sev | Finding | PR |
|----|-----|---------|----|
| **B2.1** | HIGH (integrity) | The stock ledger was directly **DELETE-able** by any org member. B2's `FOR ALL` policy gated INSERT/UPDATE via `WITH CHECK`, but DELETE is governed by `USING` alone, and the blanket `0009` grant still gave `authenticated` DELETE. Confirmed: a supervisor deleted all of an org's movements. Fixed by `revoke delete … from authenticated` (migration `0016`) → append-only ledger; pgTAP test `11`. | #42 |
| **AP-3** | MED–HIGH (financial control + audit) | PR **self-approval bypass**: `pr_update`'s AP-2 check (`requested_by <> auth.uid()`) reads the NEW row, which the same UPDATE can mutate — so an owner-author self-approved by rewriting `requested_by` to another member in one statement (also falsifying provenance). Confirmed on the DB. Fixed by a `BEFORE UPDATE` trigger that freezes `requested_by` and stamps `approved_by`/`approved_at` from the session (migration `0017`); pgTAP test `12`. | #47 |
| (lint) | — | `npm run lint` was red on `main` (1 error + 2 warnings; CI doesn't run lint). Fixed; presentation-only. | #43 |
| (finding) | — | Schema-wide direct-DELETE exposure across 28 tenant tables (root cause + tiered remediation). | #45 |

## Open findings — documented, fix is Owner-gated

### EXE-1 (MED, integrity) — `executeOperation` is not idempotent at the server boundary
`executeOperation` ([m/execute/[opId]/actions.ts:24](apps/farm-os/app/(app)/m/execute/[opId]/actions.ts))
reads the operation **without a status precondition** and issues stock + releases the reservation
**before** flipping `plan_operations.status` to `done` — and the flip is an unconditional
`update … where id = opId` (no `status` guard). The execute *page* hides the form when
`status = 'done'`, but a server action is a POST endpoint: a **double-submit, network retry, or
concurrent call bypasses the page** and runs the whole issue/release path again →
- `inventory_bin.on_hand` drops twice (real stock lost), a second `issue` movement is logged;
- a second `release` is posted (over-release of the reservation);
- a duplicate `done` farm_event is recorded.
**Recommended fix (e2e-gated):** *claim-first* — make the status flip the gating step:
`update plan_operations set status='done' where id = :id and status <> 'done' returning id`, and
**abort if no row is returned**, before any stock movement. (A fully race-safe version wraps the
execution in a single transactional RPC, like `fn_post_movement` did for the bin arithmetic.) Must
re-run the Playwright wedge-loop (the exact flow this action drives) before shipping — left
Owner-gated for that reason, not fixed blind.

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
`app` jobs — I missed the sibling workflow. So my fixes (B2.1 test 11, AP-3 test 12) and every other
RLS/audit/engine regression **are** caught on a PR. CI-1 is withdrawn.

The one true (and deliberately-accepted) residual: `db-tests.yml` runs the **Docker-free shim
harness** (plain Postgres + pgTAP shims), which by its own note does **not** exercise FORCE ROW
LEVEL SECURITY, PostgREST/GoTrue, or the Playwright e2e — the authoritative `supabase test db` +
`playwright` run stays a local/Docker step. Adding a full-stack `supabase test db` job would close
that, but it's a slow/Docker tradeoff the project chose against on purpose; it's the Owner's call,
not a defect. (I opened #50 for it and then closed it once I found `db-tests.yml`.)

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

## Repo hygiene (clean bill)
- **No committed secrets:** no `.env*` tracked; no JWTs (`eyJ…`), connection strings with embedded
  credentials, or hardcoded passwords/keys in tracked files. (The 🔴 "exposed secret" risk in the
  tracker is the *legacy* accounting sheet + the keys pasted in the deploy chat — Owner rotates at
  project end; the repo itself is clean.)
- **Auth layer sound:** `lib/auth.ts` uses `auth.getUser()` (verified, not cookie-trusted),
  RLS-scoped reads, role checks redirect. `approvePurchaseRequest` is idempotent
  (`status='submitted'` + `version` precondition) — the contrast that made EXE-1 stand out.
- **Budget checks are advisory by design:** `runPlanChecks` persists `ok/warn/block` to
  `plan_checks` for the manager's judgment; nothing hard-blocks an over-budget plan (the wedge is
  decision-support, not a hard gate).

## Naming note (AP-5)
This pass labelled the PR self-approval finding **AP-5** (originally written as "AP-3" in #47, since
corrected here). The codebase already uses AP-1 (owner-only), AP-2 (author ≠ approver), **AP-3 (the
optimistic version / stale guard in `approvePurchaseRequest`)**, AP-4 (audit immutability) — so the
self-approval guard is AP-5 to avoid conflating two distinct controls.

## Suggested merge order for the Owner

1. **#43** (lint) — trivial, unblocks a green `npm run lint`.
2. **#42** (B2.1 append-only ledger) and **#47** (AP-3 SoD guard) — both Owner-gated RLS/access
   changes; independent of each other (migrations `0016` vs `0017`). Apply the migrations to prod via
   `DEPLOY-RUNBOOK.md` (prod was at `0013`; `0015` already verified-not-applied — sequence the new
   ones accordingly).
3. **#45** + this doc — the documented findings; action EXE-1/AUTHZ-1 with the role-model decision.
   (CI-1 withdrawn — the pgTAP gate already exists via `db-tests.yml`.)
