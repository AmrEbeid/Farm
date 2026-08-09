# Accounting release execution runbook

**Candidate:** `accounting-release-20260808`
**Pinned base:** `07b12245e54c635e62293779f86c589f1f1f071b`
**Canonical branch:** `validation/accounting-release-current-main-20260808`
**Scope:** the manifest-bound accounting application, documentation, tests, and twenty-one pending migrations.

**Local mobile follow-up:** the locally committed branch `validation/accounting-mobile-acceptance-20260809`
contains the validated 44-test desktop/mobile role gate. Exact-commit review found and prompted correction of a
shell-contained overflow false pass; the corrected tip still requires exact-commit rereview. It is not canonical
or externally usable until approval and canonical-branch fast-forward.

This runbook is a checklist, not authorization. Committing, pushing, opening or merging a PR, applying a
migration, deploying, reading production, running credentialed acceptance, and changing business rows each
remain separately Owner-approved. Stop when an approval does not name the exact next action.

## Release roles

| Role | Responsibility |
|---|---|
| Release preparer | Preserve the manifest-bound bytes, collect validation evidence, and stop on drift |
| Independent reviewer | Review the exact committed candidate and migration order; do not perform the release |
| Owner | Authorize each external stage and make the final merge, migration, deployment, and production-read decisions |

The actor who prepared the candidate must not silently substitute for the Owner or independent reviewer.

## Stage 0: establish the exact candidate

1. Work only from the canonical release worktree on
   `validation/accounting-release-current-main-20260808`; confirm `STATUS.md` names the same branch and base.
2. Fetch `origin/main`, then stop if it is not the manifest's `baseCommit`.
3. Run `npm --prefix apps/farm-os run release:accounting:preflight:working-tree` and require `PASS`, 165
   candidate files, 51 pinned artifacts, four controls, and 220 total bound files.
4. Require the recorded full gates: pgTAP 4,018/4,018, Vitest 1,745 plus 14 controlled skips, full ESLint,
   TypeScript, 63/63-page build, `npm audit` with zero vulnerabilities, and `git diff --check` clean.
5. Confirm no migration timestamp duplicates and no pending migration outside the manifest.
6. Obtain explicit Owner approval before creating the candidate commit. Do not amend the candidate after review;
   any byte or mode change requires a new manifest digest and rerun of this stage.

## Stage 1: committed release proof

1. Commit only the manifest-bound candidate. Do not include credentials, generated financial evidence, or an
   unrelated worktree change.
2. Require a clean worktree and rerun `npm --prefix apps/farm-os run release:accounting:preflight`.
3. Require the strict result to bind the committed `HEAD`, the pinned base, all twenty-one migrations, 165 candidate
   files, 51 pinned artifacts, and 220 total files.
4. Obtain an independent review of the exact commit and resolve every P1-P4 finding before any external action.
5. Obtain separate Owner approval before push and PR creation. The PR must target the fetched `main` base and
   must not be merged yet.
6. Require every CI check on the exact candidate commit to pass before migration preflight. If a check reruns on
   different bytes, changes the commit, or is missing, stop and repeat the committed proof and independent review.

## Stage 2: migration preflight

1. Confirm the Farm project identity before any remote command. Never use a Zeal or disposable project by
   assumption.
2. Export and retain the current migration-version list and exact aggregate-only preflight evidence approved for
   this release. Do not include credentials, row identifiers, or financial evidence in Git.
3. Require the remote list to show exactly these pending versions in this order and no additional version:

   1. `20260808040000` - exact unpaid obligations
   2. `20260808050000` - versioned reconciliation review concurrency
   3. `20260808060000` - canonical ordered reconciliation queue
   4. `20260808070000` - exact month-close summary
   5. `20260808080000` - exact annual cost-center history
   6. `20260808090000` - exact posted-sale cost-center revenue
   7. `20260808100000` - standalone custody movement reversal
   8. `20260808110000` - atomic exact custody-dashboard summary
   9. `20260808120000` - exact payment-request totals
   10. `20260808130000` - exact receivable workflow money
   11. `20260808140000` - exact revenue-report transport
   12. `20260808150000` - exact atomic daily accounting-ledger snapshot
   13. `20260808160000` - exact atomic unified-transactions snapshot
   14. `20260808170000` - exact atomic season-dashboard snapshot
   15. `20260808180000` - exact atomic custody-report snapshot
   16. `20260808190000` - exact role-aware finance-dashboard snapshot
   17. `20260808200000` - exact atomic daily custody-workspace snapshot
   18. `20260808210000` - exact atomic daily expense-workspace snapshot
   19. `20260808220000` - exact atomic expense-detail snapshot
   20. `20260808230000` - exact atomic cost-center report snapshot
   21. `20260808240000` - exact atomic payment-request detail snapshot

4. Stop if any version is already present unexpectedly, absent from the candidate, reordered, or accompanied by
   another pending migration.
5. GitHub issue #903 is separate migration-history maintenance. Do not repair, rewrite, or hand-edit
   `supabase_migrations.schema_migrations` during this release. If the approved migration mechanism cannot prove
   the exact pending set because of #903, stop the release and handle that issue under its own Owner approval.
6. Obtain explicit Owner approval naming the exact twenty-one-version apply before migration.

## Stage 3: migrate first and verify

1. Apply only the twenty-one committed migration files, in the order above, using the approved Farm migration path.
2. Stop immediately on an unknown, partial, or failed result. Do not retry until the remote version list and
   catalog state identify what committed.
3. Re-read the remote migration list and require all twenty-one versions exactly once and in order.
4. Run the approved catalog, privilege, function-signature, RLS, and aggregate-only postflight checks. Compare
   protected accounting counts and totals with the retained preflight evidence; explain every difference.
5. Do not change a business row to make postflight pass. Production database failures are forward-only: prepare
   an additive reviewed fix-forward under separate Owner approval. Do not reset production, edit historical
   migrations, or treat the accounting batch's application rollback as a database migration rollback.

## Stage 4: role acceptance before merge

1. Use three distinct, approved test accounts: Owner, accountant, and one non-finance role. Use the pinned batch
   UUID and the exact Farm Supabase origin.
2. Keep credentials in the invocation environment only. Do not place them in shell history, `.env*`, Git,
   screenshots, traces, reports, or chat.
3. For a production read, obtain explicit Owner approval for that invocation and run the read-only wrapper with
   its production acknowledgement flag. Never bypass its localhost, origin, method, service-worker, WebSocket, or
   environment guards.
4. Once the mobile follow-up is integrated into the canonical candidate, require all 44 discovered browser tests to
   pass: the same 22 workflows on Desktop Chrome and pinned Pixel 7 Chromium. Each workflow must pass its settled
   final-state page-level horizontal-overflow assertion. Until then, the canonical branch retains its reviewed
   desktop-only gate. The suite must not stage, decide, freeze, approve, execute, roll back, or otherwise write
   financial data.
5. Treat missing credentials, a blocked request, an unexpected redirect, an unreadable statement PDF, or a role
   mismatch as a failed release gate.

## Stage 5: merge, deploy, and verify

1. Reconfirm all PR checks are green against the exact reviewed commit and confirm `main` did not move
   incompatibly.
2. Obtain explicit Owner approval to merge and a separate explicit Owner approval for the production deployment
   that the merge will trigger. If production auto-deployment cannot be disabled and deployment approval is
   absent, do not merge. Merge only after migration postflight and role acceptance pass.
3. Verify the resulting authorized deployment corresponds to the merge commit and reaches READY.
4. Perform only the separately approved signed-out and authenticated read-only smoke checks. Confirm the canonical
   finance routes, reconciliation report/CSV, statements, and role redirects; do not infer success from HTTP 200
   alone.
5. Re-run the approved production postflight and record the deployment, commit, migration versions, checks, and
   evidence location in the canonical project documents.

## Stage 6: human accounting acceptance

After release, follow `accounting reconciliation acceptance runbook.md`. The 698 row decisions, evidence
exceptions, freeze, approval by an eligible non-creator/non-reviewer Owner, dual run, separately authorized batch
execution, final digest verification, signatures, and restricted archive are not automated release steps.

Accounting reaches 100% only when both this release runbook and the human acceptance runbook have complete,
dated evidence. A green local candidate, migration apply, deployment, or browser suite alone is not completion.
