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

Follow-up completed 2026-06-29: #400 wording now matches its current draft scope (schema/readiness code implemented
but not merged or applied; head `dbcfeb8`, CI green, focused independent check found no wording blockers).

- [x] **Step 3: Preserve #368 accounting gates**

Before #368 can merge or migrate, confirm real 7-year Excel reconciliation and privacy review. Treat `0088` as an
explicit out-of-order prod gap-fill because prod is already at `0096`, and pair it with `0097` in the reviewed
apply path.

Completed 2026-06-29: implemented the DB-side summary fix without clearing the real gates. #368 now computes P&L
totals through DB-side `fn_accounting_pnl_summary` instead of capped PostgREST row reads; the page keeps capped
queries only for recent-detail previews. Added pgTAP coverage for aggregate totals, supervisor denial,
drawings/capex separation, and category totals; local validation passed pgTAP **709/709**, `tsc`, focused eslint,
P&L unit test **5/5**, and production build. GitHub CI green at head `0625150`; a session reviewer check found no
obvious blocker, but this is not a substitute for the fresh visible final review required before any merge/migrate.
#368 remains draft/unmigrated pending real Excel reconciliation + privacy review and fresh pre-migration review of
`0088` + `0097` apply order.

- [x] **Step 4: Queue low-risk branch fixes**

Completed 2026-06-29: #366 now surfaces `/academy` query failures and corrects stale `0089` comments to `0091`
(head `ca915dc`, CI green, focused independent check found no blockers). #368 now surfaces `/accounting` `expenses`/`sales` query
failures and aligns `/expenses` nav with the `0097` owner/accountant read gate (head `a4d1c7f`, CI green, focused
independent check found no blockers). Both PRs remain draft and unmigrated.

### Task 6: Draft #317/#229 Grant Hygiene Fix

**Files:**
- Add in #439: `apps/farm-os/supabase/migrations/20260629135038_grant_hygiene_default_privileges.sql`
- Add in #439: `apps/farm-os/supabase/tests/97_grant_hygiene_default_privileges_test.sql`
- Modify: `docs/PROJECT-TRACKER.md`
- Modify: `docs/SESSION-BRIEF.md`
- Modify: `docs/superpowers/plans/2026-06-29-autonomous-farm-pr-review-loop.md`

**Interfaces:**
- Consumes: issue #317 prod evidence, issue #229 prod-config/advisor umbrella, Supabase/Postgres privilege rules.
- Produces: held migration draft and pgTAP invariants; no prod mutation.

- [x] **Step 1: Re-read Supabase/Postgres guardrails**

Completed 2026-06-29: used Supabase guidance and PostgreSQL `ALTER DEFAULT PRIVILEGES` documentation. Important
design constraint: default-privilege changes affect only future objects and only the targeted grantor role, so #439
targets the prod-observed `postgres` grantor and leaves a review note to repeat the revoke if a future prod probe
finds another grantor.

- [x] **Step 2: Implement narrow migration + invariants**

Completed 2026-06-29: #439 removes current destructive client-role grants (`TRUNCATE`, broad `DELETE`), restores
authenticated `plan_checks` DELETE for the recompute path, and revokes future public-table default privileges from
`anon`/`authenticated` for role `postgres`. Test 97 checks TRUNCATE, DELETE exception preservation, and
`pg_default_acl`.

- [x] **Step 3: Verify and publish as held draft**

Completed 2026-06-29: local pgTAP passed **689/689**; GitHub checks are green; #439 is draft/held. Required gates:
focused review of migration blast radius and separate pre-migration review against the Farm Supabase project. #229's
leaked-password protection remains a separate Owner dashboard/Auth setting and is not closed by #439.

### Task 7: Review SPEC-0018 Backend Draft PR #438

**Files:**
- Read: `apps/farm-os/supabase/migrations/20260622000098_custody_and_expense_payment.sql`
- Read: `apps/farm-os/supabase/migrations/20260622000099_payment_requests.sql`
- Read: `apps/farm-os/supabase/tests/98_custody_payment_test.sql`
- Read: `apps/farm-os/supabase/tests/99_payment_request_test.sql`
- Modify: docs only after review result is known.

**Interfaces:**
- Consumes: draft PR #438, SPEC-0018 design in #421, current open migration queue (#436/#439/#366/#368/#400).
- Produces: review decision; no prod mutation.

- [x] **Step 1: Check CI and migration lane**

Completed 2026-06-29: #438 CI is green, but it introduces `0098`/`0099` while held #436 already uses `0098`. This
is a migration-order blocker; the PR body statement that those numbers are free is stale.

- [x] **Step 2: Review access control and money invariants**

Completed 2026-06-29: posted a blocking review. #438 keeps all-member org-scoped reads for custody/payment tables
and totals, which conflicts with SPEC-0018's finance-confidential read gate. It also ships request math without the
#6 drawings/opex split while #368 is still draft/unapplied.

- [x] **Step 3: Review lifecycle scope**

Completed 2026-06-29: #438 describes `paid`/`closed` lifecycle and `fn_close_month`, but implements/tests only
through final approval. Keep draft until scope is either implemented/tested or the enum/body/spec are reduced.

- [ ] **Step 4: Patch or wait for #438 author response**

Recommended path: fix finance-role read gates first, add/require the drawings split before request math, renumber or
stack migrations with #436, and either implement paid/closed/close-month or reduce scope. Do not merge/migrate #438
while these blockers remain.

### Task 8: Review Docs-Only Finance Specs Without Clearing Gates

**Files:**
- Read/modify: draft spec PR docs only.
- Modify: living docs after the decision.

**Interfaces:**
- Consumes: docs-only finance/control PRs, current accounting/privacy posture, Stage-M data gate.
- Produces: hardened spec wording and an explicit merge/hold decision.

- [x] **Step 1: Review #421 SPEC-0018 custody/payment-request draft**

Completed 2026-06-29: #421 was patched to remove precise real finance/worker figures, remove non-existent roles,
keep custody/payment/receipt reads finance-role gated, avoid a broad new `expense.write` permission, make #368
`expenses.kind`/`0088` an explicit prerequisite or same-apply-path dependency, and require extending `attachments`
for expense receipts before use (`entity_type='expense'`, resolver/storage validation, finance-confidential RLS).
Branch head `2fa6694`; GitHub CI green; focused re-review found no findings. #421 remains draft/design-only for
Owner review; no schema, migration, prod apply, or real financial/PII import.

### Task 9: Audit Issue Hygiene Pass

**Files:**
- Read: GitHub issues #188, #206, #229, #282, #317, #362, #383
- Read: `docs/PROJECT-TRACKER.md`, `docs/SESSION-BRIEF.md`, `docs/DEPLOY-STATUS.md`
- Modify: issue comments/state only when evidence is conclusive
- Modify: docs only after issue state changes materially

**Interfaces:**
- Consumes: current `main`, production migration ledger, read-only production grant probes, merged PR evidence.
- Produces: issue state/comments that distinguish fixed code defects from still-open prod-config/security tasks.

- [x] **Step 1: Verify #383 against main and prod before closing**

Result recorded 2026-06-29: #383 was closed only after verifying PR #402 merged, migration `0095` exists on `main`,
test `95_org_switcher_preapply_test.sql` pins the anon-lock/fiscal-year preserve behavior, and prod's migration
ledger includes `20260622000095 org_switcher_preapply_hardening`.

- [x] **Step 2: Re-probe #317 before any close**

Result recorded 2026-06-29: read-only prod grant probes still showed broad default/table grant hygiene gaps
(`TRUNCATE` on 38 public tables for anon and authenticated, plus limited `DELETE` grants). #317 stays open; no DDL
was run.

- [x] **Step 3: Split #229 into fixed vs remaining work**

Result recorded 2026-06-29: FK indexes are fixed/applied by #404 / migration `0096`; #383's adjacent code defects
are closed separately; #229 remains open for grant/default-privilege cleanup and leaked-password protection.

- [x] **Step 4: Narrow #188 without closing the atomic follow-up**

Result recorded 2026-06-29: #396 is merged and closes the reserve-aware app-layer dedup gap. #188 remains open for
the explicitly retained migration-gated fully atomic PR-line+reserve RPC follow-up.

- [x] **Step 5: Update living docs after issue-state changes**

This docs PR records #383 closed, #188 narrowed, and #317/#229 kept open with current production evidence.

- [x] **Step 6: Correct #362 so completed Supabase rotation is not reopened**

Result recorded 2026-06-29: #362 was retitled and its body was edited so Farm Supabase DB password +
`service_role` key rotation is checked off per Owner confirmation. The issue remains open only for the remaining
Owner/external cleanup: legacy keys/project, old repo history, spreadsheet/Google password, leaked-password
protection, and demo login cleanup before real data.

- [x] **Step 7: Close stale UI/display audit issues and split the residual**

Result recorded 2026-06-29: #206 and #282 were re-checked against current `main` and closed as resolved/superseded.
The fixed items include hardcoded/fabricated KPI surfaces, Arabic label/date/number leaks, offline spinner hangs,
and role-affordance dead ends. The only remaining LOW residual from #282, ExecuteForm cleared qty/labor fields
submitting as zero actuals, was split to #426 for a narrow product/validation decision.

- [x] **Step 8: Patch the #426 blank-input path without changing zero semantics**

Result recorded 2026-06-29: #428 adds a pure `parseExecuteInput` helper and wires `ExecuteForm` through it so blank,
invalid, or negative actual quantity/labor values fail client-side with Arabic copy before the server action runs.
An explicit typed `0` remains valid. Local validation passed: focused Vitest **3/3**, full Vitest **215/215**,
focused eslint, `tsc --noEmit`, and production build.

- [x] **Step 9: Close #398 after verifying #399 delivery**

Result recorded 2026-06-29: #398 was re-checked against current `main` and closed as delivered by merged #399
(`02b5da3`). Evidence: `plan_operations.ends_on`, `plan_operation_assignees`, `fn_add_plan_operation_multi`, pgTAP
coverage, and the richer `OperationBuilder` UI are all present, and deploy status says prod includes `0090` and
`0093`. No DDL, migration, prod apply, or production data change was run in this closeout.

- [x] **Step 10: Close #161 after splitting the remaining LOW findings**

Result recorded 2026-06-29: #161 was re-verified against current `main` and closed. L2/L5 are fixed; L1 demo-login
cleanup is already tracked in #362; L3/L4 were split to #431 (`transfer` destination semantics + dead
`inventory_bin.ordered`); L6 was split to #430 (`fn_bin_rebuild` authenticated EXECUTE decision). No code, DDL,
migration, prod apply, or production data change was run.

- [x] **Step 11: Close #235 after splitting the remaining approval-copy residual**

Result recorded 2026-06-29: #235 was re-verified against current `main` and closed. The original high-risk findings
are fixed or covered by focused issues/held PRs. Created #433 for the one untracked residual:
`approvePurchaseRequest` zero-row failure copy conflates stale version/status/authz. Remaining live work stays in
#89, #157, #188/#199, #229/#317, and #314. No code, DDL, migration, prod apply, or production data change was run.

- [x] **Step 12: Implement #433 approval-failure diagnostics**

Result recorded 2026-06-29: added a pure approval-failure classifier and wired `approvePurchaseRequest` to use a
read-scoped follow-up after zero-row approval updates. The action now distinguishes stale version, wrong status,
self-approval, missing owner permission, and missing/unreadable request without changing DB/RLS enforcement. Local
validation passed: focused Vitest **5/5**, full Vitest **220/220**, focused eslint, `tsc --noEmit`, and production
build.

- [x] **Step 13: Draft #430 fn_bin_rebuild internalization**

Result recorded 2026-06-29: opened draft #436 with migration `0098` to revoke authenticated EXECUTE on
`fn_bin_rebuild`, remove it from the authenticated SECURITY DEFINER allowlist, and pin the negative grant in tests
19/22. Verified no app direct `rpc("fn_bin_rebuild")` caller. Local pgTAP passed **687/687** and draft GitHub checks
are green. Held for migration review/apply; no merge, prod apply, or production data change.

### Task 10: Draft #431 Inventory Transfer/Ordered Guard

**Files:**
- Add: `apps/farm-os/supabase/migrations/20260629140248_inventory_transfer_ordered_guard.sql`
- Add: `apps/farm-os/supabase/tests/100_inventory_transfer_ordered_guard_test.sql`
- Modify: `docs/PROJECT-TRACKER.md`
- Modify: `docs/SESSION-BRIEF.md`
- Modify: `docs/superpowers/plans/2026-06-29-autonomous-farm-pr-review-loop.md`

**Interfaces:**
- Consumes: issue #431 and the existing inventory ledger/rebuild/RPC posture.
- Produces: held migration draft; no prod mutation.

- [x] **Step 1: Read #431 and current inventory semantics**

Completed 2026-06-29: `transfer` is allowed by the original movement type check and subtracted by
`fn_bin_rebuild`, but no destination bin/location exists and no app path posts it. `inventory_bin.ordered` exists and
is included in `projected`, but no writer maintains it.

- [x] **Step 2: Choose conservative behavior**

Completed 2026-06-29: do not invent transfer semantics. Disable new transfer rows until an atomic paired
source/destination model exists. Pin `ordered=0` until a real purchase-order writer maintains it.

- [x] **Step 3: Implement migration + tests**

Completed 2026-06-29: added NOT VALID constraints to enforce new writes (`type <> 'transfer'`, `ordered = 0`),
re-emitted latest `fn_post_movement` to reject `transfer` with 22023 while preserving internal-only EXECUTE posture,
and added pgTAP coverage for RPC rejection, direct table protection, ordered pinning, and projected semantics.

- [x] **Step 4: Verify locally**

Completed 2026-06-29: `bash apps/farm-os/supabase/test-shims/run-pgtap-local.sh` passed **691/691** with
`not_ok=0` and `file_failures=0`.

- [x] **Step 5: Publish held PR and review before any merge/migrate**

Completed 2026-06-29: opened draft #442. Local pgTAP passed **691/691**; GitHub checks are green; issue #431 was
updated. Required gates remain: focused review of the `fn_post_movement` re-emit and inventory semantics, and
separate pre-migration review before any prod apply.

### Task 11: Draft #314 Responsibility Assignment Write Gate

**Files:**
- Add in #444: `apps/farm-os/supabase/migrations/20260629141650_responsibility_assignments_write_gate.sql`
- Add in #444: `apps/farm-os/supabase/tests/101_responsibility_assignments_write_gate_test.sql`
- Modify in #444: `apps/farm-os/supabase/tests/64_cross_org_fk_sweep_test.sql`
- Modify in #444: `docs/BUSINESS-RULES-CATALOG.md`
- Modify in #444: `docs/PERMISSIONS-MATRIX.md`
- Modify in #444: `docs/DOMAIN-DICTIONARY.md`
- Modify: `docs/PROJECT-TRACKER.md`
- Modify: `docs/SESSION-BRIEF.md`
- Modify: `docs/superpowers/plans/2026-06-29-autonomous-farm-pr-review-loop.md`

**Interfaces:**
- Consumes: issue #314, People & Responsibility screen map, current `responsibility_assignments` RLS, current
  `authorize()` union, and open migration queue.
- Produces: held migration draft; no prod mutation.

- [x] **Step 1: Review issue and product basis**

Completed 2026-06-29: #314 is a governance/data-integrity gap, not privilege escalation, because
`responsibility_assignments` does not feed `authorize()`. Product docs already say People & Responsibility is
owner/farm_manager managed, so a bounded write gate is justified without waiting for the future UI.

- [x] **Step 2: Implement migration + tests**

Completed 2026-06-29: #444 adds `responsibility.write` for owner/farm_manager, re-emits
`responsibility_assignments` RLS so reads remain org-wide while writes require the permission, and preserves the
same-org `people` guard. Test 101 pins allow/deny/read/cross-org/policy/function invariants; test 64 now exercises
the responsibility cross-org case as farm_manager so the same-org guard remains proven after the role gate.

- [x] **Step 3: Verify locally and publish as held draft**

Completed 2026-06-29: local pgTAP passed **697/697**; `git diff --check` clean; opened draft #444 and posted the
#314 handoff. Held for review and separate pre-migration review. Migration-order warning: #366/#400/#438 also
re-emit `authorize()` and must preserve `responsibility.write` if rebased/applied after #444.

### Task 12: Review Draft #441 Custody Frontend

**Files:**
- Modify in #441: `apps/farm-os/lib/page-help.ts`
- Read/review in #441: `apps/farm-os/app/(app)/custody/actions.ts`
- Read/review in #441: `apps/farm-os/app/(app)/custody/page.tsx`
- Read/review in #441: `apps/farm-os/app/(app)/custody/request/[requestId]/page.tsx`
- Read/review in #441: `apps/farm-os/components/CustodyForms.tsx`
- Read/review in #441: `apps/farm-os/components/RequestLifecycle.tsx`
- Modify: `docs/PROJECT-TRACKER.md`
- Modify: `docs/SESSION-BRIEF.md`
- Modify: `docs/superpowers/plans/2026-06-29-autonomous-farm-pr-review-loop.md`

**Interfaces:**
- Consumes: draft PR #441, backend draft PR #438, SPEC-0018 review findings.
- Produces: CI fix and held review; no prod mutation.

- [x] **Step 1: Check CI and review dependency**

Completed 2026-06-29: #441 was draft and depended on #438. CI initially failed in `lib/page-help.test.ts` because
the new dynamic route `/custody/request/[requestId]` fell back to dashboard help.

- [x] **Step 2: Patch the mechanical CI drift**

Completed 2026-06-29: pushed `e08562f`, adding `payment-request-360` help and a route-specific
`/custody/request/:id` mapping. Local validation passed: focused page-help test **7/7** and full app Vitest
**230/230**.

- [x] **Step 3: Post held review**

Completed 2026-06-29: posted a review keeping #441 draft/held. Blockers: backend #438 remains blocked; custody
account creation uses direct table DML while #438/security wording says custody writes are RPC-only; financial
query/RPC errors render zeros/empty tables instead of explicit error states.

## Self-Review

- Spec coverage: plan covers the owner’s autonomous instruction, current credential-rotation correction, held draft PR #400, merged PR #412, remaining draft migration lane, docs-only finance spec review, issue hygiene, held #431/#314 DB drafts, held #441 frontend review, and merge/migration gates.
- Placeholder scan: no TBD/TODO placeholders; every task has exact commands and expected outcomes.
- Type consistency: no new code interfaces are defined; process interfaces are explicit.
