# Autonomous Farm PR Review Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Farm OS moving without waiting for fresh owner prompts while preserving the Farm gates: plan first, review before merge, review before migrate, update docs last.

**Architecture:** Treat work as an autonomous review-and-advance loop over the current repo state. Each cycle starts with reconciliation, chooses one bounded lane, executes it in a scoped branch/worktree, verifies locally and on GitHub, then updates living docs. Production migrations are separate from merges and require a fresh pre-migration review of exact SQL, migration ordering, target Supabase project, and rollback notes.

**Tech Stack:** Git/GitHub CLI, Next.js app in `apps/farm-os`, Supabase migrations and pgTAP harness, Farm OS docs in `docs/`, Superpowers planning/review/verification skills.

## Global Constraints

- Follow `docs/CLAUDE.md` for Farm OS project rules.
- User instruction from 2026-06-29: keep working until stopped, plan first, review before merge, review before migrate, do deep research when needed, update plan/docs, proceed using best recommendations without waiting for owner input.
- Supabase DB password + service-role key rotation is complete per Owner correction on 2026-06-29; do not raise it as an open gate again unless reopened.
- Never fabricate farm, financial, agronomy, export, or compliance data.
- RLS and tenant isolation remain database-enforced, not app-only.
- For migrations: append-only; check migration-number collisions; review `authorize()` re-emits for union completeness; run pgTAP before merge/migrate.
- For high-risk domains (RLS/access, money, payroll/PII, stock engine, AI, export compliance, prod migrate), perform independent review before merge and again before migrate.
- Do not stage `.claude/`, `.mcp.json`, secrets, generated junk, or unrelated dirty files.

---

### Task 1: Preserve Current Status-Doc Correction

**Files:**
- Modify: `docs/PROJECT-TRACKER.md`
- Modify: `docs/DEPLOY-STATUS.md`
- Modify: `docs/PRODUCT-MASTER-FILE.md`
- Modify: `docs/ROADMAP-path-to-finish-2026-06-25.md`
- Modify: `docs/SESSION-BRIEF.md`
- Modify: `docs/superpowers/plans/2026-06-29-autonomous-farm-pr-review-loop.md`
- External durable note already updated: `/Users/amrebeid/claude-skills/skills/amr-operating-method/SKILL.md`

**Interfaces:**
- Consumes: Owner correction that Supabase DB password + service-role key rotation is complete.
- Produces: Living docs no longer present key rotation as an active gate.

- [x] **Step 1: Verify active docs no longer list key rotation as an active red gate**

Run:

```bash
rg -n 'only red item|🔴.*rotation|rotation still|key rotation still|service-role key rotation still|rotate the service-role key|Rotate the Supabase|Security follow-ups \(REQUIRED' docs/PROJECT-TRACKER.md docs/PRODUCT-MASTER-FILE.md docs/DEPLOY-STATUS.md docs/ROADMAP-path-to-finish-2026-06-25.md
```

Expected: no matches in these active status docs, except explicit "rotation complete" notes if the query is broadened.

- [x] **Step 2: Review the status-doc diff**

Run:

```bash
git diff -- docs/PROJECT-TRACKER.md docs/DEPLOY-STATUS.md docs/PRODUCT-MASTER-FILE.md docs/ROADMAP-path-to-finish-2026-06-25.md docs/SESSION-BRIEF.md docs/superpowers/plans/2026-06-29-autonomous-farm-pr-review-loop.md
```

Expected: only status-doc and plan wording changes; no app code, migration, or secret changes.

- [x] **Step 3: Commit only scoped docs**

Run:

```bash
git add docs/PROJECT-TRACKER.md docs/DEPLOY-STATUS.md docs/PRODUCT-MASTER-FILE.md docs/ROADMAP-path-to-finish-2026-06-25.md docs/SESSION-BRIEF.md docs/superpowers/plans/2026-06-29-autonomous-farm-pr-review-loop.md
git commit -m "docs(status): mark credential rotation complete"
```

Expected: commit succeeds; `.claude/` and `.mcp.json` remain untracked.

### Task 2: Review Clean Export Compliance Draft PR #400

**Files:**
- Read: `docs/SPEC-0016-export-compliance.md`
- Read: migration file(s) added by PR #400 under `apps/farm-os/supabase/migrations/`
- Read: pgTAP test(s) added by PR #400 under `apps/farm-os/supabase/tests/`
- Read: `apps/farm-os/lib/*export*` files added by PR #400
- Modify: `docs/SESSION-BRIEF.md` only after the review result is known.

**Interfaces:**
- Consumes: GitHub PR #400 branch `docs/spec-0016-export-compliance`.
- Produces: Review decision: merge-ready, needs-fix, or blocked by compliance/product uncertainty.

- [x] **Step 1: Check PR state**

Run:

```bash
gh pr view 400 --repo AmrEbeid/Farm --json number,title,isDraft,mergeStateStatus,reviewDecision,statusCheckRollup,files,headRefName,baseRefName
```

Expected: PR is draft, merge state clean, CI/pgTAP green or failures identified.

- [x] **Step 2: Research only if review turns on external compliance truth**

If PR claims current GACC/CAPQ/QCAP process details, verify against primary or official sources before approving those claims. If official sources are not accessible or ambiguous, mark the claim as requiring human compliance confirmation and keep the PR draft.

- [x] **Step 3: Review migration security**

Run:

```bash
git fetch origin docs/spec-0016-export-compliance
git diff main..origin/docs/spec-0016-export-compliance -- apps/farm-os/supabase/migrations apps/farm-os/supabase/tests
```

Expected: append-only migration, org-scoped RLS, FORCE RLS, no anon grants, RPC grants locked, `authorize()` re-emit carries union of permissions, tests pin new access behavior.

- [x] **Step 4: Verify locally if branch is merge candidate**

Run from repo root:

```bash
bash apps/farm-os/supabase/test-shims/run-pgtap-local.sh
```

Run from `apps/farm-os`:

```bash
npx tsc --noEmit
npx vitest run
npm run build
```

Expected: all pass. If pgTAP dependencies are unavailable locally, use GitHub CI evidence and record the limitation.

- [x] **Step 5: Decide**

Decision recorded 2026-06-29: reviewed and fixed; local + GitHub validation green; keep draft until migration lane
is reconciled with lower-number in-flight migrations before any merge/migrate.

### Task 3: Review Dirty Import PR #412

**Files:**
- Read: files changed by PR #412
- Modify: docs only after review result is known.

**Interfaces:**
- Consumes: GitHub PR #412 branch `feat/import-refs`.
- Produces: conflict/rebase recommendation and security review of import commit path.

- [x] **Step 1: Check conflict source**

Run:

```bash
gh pr view 412 --repo AmrEbeid/Farm --json number,title,isDraft,mergeStateStatus,statusCheckRollup,files,headRefName,baseRefName
git fetch origin feat/import-refs
git diff --name-only main..origin/feat/import-refs
```

Expected: identify files causing `DIRTY` merge state.

- [x] **Step 2: Review import security**

Check formula injection sanitization, lazy `exceljs` import, RLS-scoped commit path, no service-role bypass, dry-run behavior, partial-success semantics, and code-to-id reference resolution.

- [x] **Step 3: Decide**

If conflicts are trivial, rebase/fix in a scoped worktree. If import write path needs independent security review, keep draft and document exact blockers.

Decision recorded 2026-06-29: PR #412 was initially reviewed but not mergeable. Found a dry-run validation bug where impossible
calendar dates such as `2026-02-31` passed because `Date.parse` normalized them. Local commit `21467ad`
(`fix(import): reject impossible calendar dates`) now enforces strict `YYYY-MM-DD` calendar dates and corrects a stale
service-role-path comment. Local validation passed: focused validate test **6/6**, import suite **38/38**, `tsc`,
focused eslint, full Vitest **209/209**, and production build. Local `git push` stalls in `send-pack`/`pack-objects`,
so the same three file contents were published through GitHub's Contents API; GitHub PR #412 now points at remote head
`15fcbdd`. This intermediate hold was superseded by the follow-up below.

Follow-up recorded 2026-06-29: rebuilt #412 on current `main` to remove already-merged #410 stacked history. A fresh
review found two blockers: ref lookups could resolve archived structure parents, and ref errors could report the
wrong spreadsheet row after validation filtered earlier rows. Fixed both at head `08e925a`: farm/sector refs now
filter `archived=false`, and hidden source-row metadata preserves original spreadsheet row numbers through validation,
ref resolution, dedupe, and RPC failure reporting. Local validation passed: import suite **41/41**, `tsc`, focused
eslint, full Vitest **212/212**, and production build. Fresh GitHub CI passed, independent re-review approved, and
#412 was squash-merged to `main` as `d7b832d`. No migration or production apply was involved.

### Task 4: Pre-Merge and Pre-Migration Gate

**Files:**
- Modify: `docs/PROJECT-TRACKER.md`
- Modify: `docs/SESSION-BRIEF.md`
- Modify: `docs/DEPLOY-STATUS.md` if migration applied.

**Interfaces:**
- Consumes: reviewed PR and local/GitHub verification evidence.
- Produces: merged PR and, only after separate review, migrated prod state.

- [ ] **Step 1: Before merge, run final PR checks**

Run:

```bash
gh pr checks <PR_NUMBER> --repo AmrEbeid/Farm
gh pr view <PR_NUMBER> --repo AmrEbeid/Farm --json mergeStateStatus,isDraft,reviewDecision
```

Expected: checks green, mergeable clean, review complete. Convert out of draft only when merge is justified.

- [ ] **Step 2: Before migration, verify target**

Use the Supabase connector or CLI only after confirming the Farm project id is `veezkmytervjnpxcrbkw`, never Zeal. Compare prod migration head with repo migration queue and record exact versions.

- [ ] **Step 3: Update docs last**

Update `PROJECT-TRACKER.md`, `SESSION-BRIEF.md`, and `DEPLOY-STATUS.md` with exact PR, migration, validation, and residual risk.

### Task 5: Reconcile Remaining Draft Migration Lane

**Files:**
- Read: PR #366 migration/tests/app files
- Read: PR #368 migration/tests/app files
- Read: PR #400 migration/tests/app files
- Modify: docs first; modify PR branches only after a scoped plan and review.

**Interfaces:**
- Consumes: prod migration ledger at `0096`, draft PRs #366/#368/#400, independent review findings from 2026-06-29.
- Produces: a safe merge/migration order or branch patches that remove ordering traps.

- [x] **Step 1: Run independent draft-lane reviews**

Result recorded 2026-06-29: #366, #368, and #400 all remain draft. No merge or migration is approved.

- [x] **Step 2: Choose the #366/#400 `authorize()` strategy before any export/academy migration**

Allowed safe strategies:

1. Apply #366 `0091` before #400 `0092`.
2. Patch #366 `0091` to preserve the final `authorize()` permission union including `export.write`.
3. Add a post-`0096` repair/backfill migration that pins the final union after both features.

Do not apply #400 `0092` alone while #366 `0091` can later drop `export.write`.

Completed 2026-06-29: chose strategy 2. #366 `0091` now preserves the final known permission union including
`export.write` (head `86dfa6e`, CI green, focused independent check found no blockers). This reduces the out-of-order
gap-fill trap but does not approve any merge or migration.

- [ ] **Step 3: Preserve #368 accounting gates**

Before #368 can merge or migrate, confirm real 7-year Excel reconciliation and privacy review. Treat `0088` as an
explicit out-of-order prod gap-fill because prod is already at `0096`, and pair it with `0097` in the reviewed
apply path.

- [x] **Step 4: Queue low-risk branch fixes**

Completed 2026-06-29: #366 now surfaces `/academy` query failures and corrects stale `0089` comments to `0091`
(head `ca915dc`, CI green, focused independent check found no blockers). #368 now surfaces `/accounting` `expenses`/`sales` query
failures and aligns `/expenses` nav with the `0097` owner/accountant read gate (head `a4d1c7f`, CI green, focused
independent check found no blockers). Both PRs remain draft and unmigrated.

## Self-Review

- Spec coverage: plan covers the owner’s autonomous instruction, current credential-rotation correction, held draft PR #400, merged PR #412, remaining draft migration lane, and merge/migration gates.
- Placeholder scan: no TBD/TODO placeholders; every task has exact commands and expected outcomes.
- Type consistency: no new code interfaces are defined; process interfaces are explicit.
