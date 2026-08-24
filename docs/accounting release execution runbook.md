# Accounting release execution runbook

**Candidate:** `accounting-final-release-train-20260824`
**Pinned base:** `811da103a0d6de3db6ca443bfeeb1f9799232f40`
**Canonical branch:** `release/accounting-final-train-20260824`
**Scope:** 43 candidate files, nine pinned artifacts, four release controls, 56 bound files and two ordered
migrations.

This runbook is a checklist, not authorization. A commit, push, PR, preview deployment, production read,
migration, merge, production deployment, credentialed role test and production data change each require
explicit Owner approval naming that exact action. An approval for one stage does not authorize the next.

## Release contents

1. `20260823190000_exact_financial_statement_snapshots.sql`
   - Adds exact-decimal, versioned balance-sheet and income-statement read wrappers.
   - Preserves the existing trusted accounting definitions and performs no business-row write.
2. `20260824100000_labor_logs_require_active_person.sql`
   - Rejects new or reassigned labor logs for inactive or cross-organization people.
   - Preserves correction of historical rows whose person attribution is unchanged and preserves the existing
     closed-payroll freeze.
3. Application changes
   - Rebuild the statement, close and accounting-period surfaces and Arabic PDF/CSV output.
   - Defer Finance-dashboard Recharts loading while retaining exact server-rendered accessible and print data.

The migrations are additive and backward-compatible with the currently deployed R4j application. That permits
migrate-first release order but does not make either migration automatic or pre-approved.

## Release roles

| Role | Responsibility |
|---|---|
| Release preparer | Preserve exact bytes, run local gates, collect evidence and stop on drift |
| Independent reviewer | Review the exact candidate and release evidence; do not release it |
| Owner | Approve each external stage and the final production decisions |
| Accountant | Perform authenticated workflow acceptance and the later workbook dual run |

## Stage 0: preserve the exact local candidate

1. Work only in the canonical worktree and branch above.
2. Verify remote `origin/main` still equals the pinned base. Stop on any movement; do not rebase or merge by
   assumption.
3. Run the working-tree accounting preflight. Require:
   - candidate `accounting-final-release-train-20260824`;
   - base, `HEAD` and cached `origin/main` all equal the pinned base;
   - two migrations, nine pinned artifacts, 43 candidate files and 56 bound files;
   - status `PASS`.
4. Require the recorded candidate evidence:
   - focused Vitest 88/88 plus attendance-acceptance 76/76, statement-download 30/30 and acceptance-package 189/189;
   - full Vitest 2,386 passed plus 17 controlled skips;
   - Docker-free pgTAP 5,099/5,099 with both candidate migrations immediately replayed;
   - TypeScript, full ESLint, 70-page production build and repository guards;
   - zero-vulnerability dependency audit and clean `git diff --check`;
   - exact 46-test browser inventory, including the Owner active-person attendance picker and authenticated
     Owner/Accountant PDF plus section-CSV downloads;
   - both PDF traces complete at 71.21 MiB with all Chromium/font assets;
   - Finance dashboard initial union 13 chunks / 104,368 gzip bytes with Recharts absent;
   - independent exact-byte and final docs/manifest reviews APPROVE with no P0-P3 findings.
5. Stop if any file changes after the manifest refresh. Refreshing the manifest is not enough: rerun the
   proportionate gates and exact-byte review for the changed candidate.

## Stage 1: Owner-gated commit, push and PR

1. Obtain explicit Owner approval to create the candidate commit.
2. Commit only the manifest-bound files. Exclude credentials, generated evidence, `.next`, local database files
   and unrelated worktree changes.
3. Require a clean worktree and run the strict committed preflight. It must bind the exact committed `HEAD` and
   reproduce the Stage 0 counts and digest.
4. Obtain independent review of the exact commit. Any byte change requires strict preflight and rereview.
5. Obtain separate Owner approval before push and PR creation. Record whether opening the PR will automatically
   create a preview deployment; if it will, preview deployment must also be explicitly approved before push.
6. Target the exact fetched `main`. Do not merge. Require every CI, database, release, secret and preview check
   on the exact candidate commit to pass.

## Stage 2: Owner-gated production preflight

Production preflight is read-only but still requires explicit Owner approval. Use the Farm Supabase project only;
verify its project reference before every remote command. Do not use a Zeal, test or assumed project.

### Migration ledger

1. Export the complete remote migration-version list to the restricted release evidence folder outside Git.
2. The documented production head before this train is hosted migration
   `20260823113659 exact_chart_of_accounts_snapshot`; later R4j releases had no migration. Treat that as an
   expectation, not a substitute for a fresh approved read.
3. Require both candidate migrations to be absent remotely and exactly these two repository files to be pending,
   in this order:
   1. `20260823190000_exact_financial_statement_snapshots.sql`
   2. `20260824100000_labor_logs_require_active_person.sql`
4. Stop on an unexpected remote version, existing candidate object, duplicate timestamp, extra pending file or
   inability to map repository files to the hosted ledger. Never hand-edit
   `supabase_migrations.schema_migrations` as part of this release.

### Read-only baseline

Capture one timestamped aggregate result immediately before apply. Record no row identifiers or credentials.
At minimum capture:

- counts for organization, accounts, expenses, sales, sale collections, journal entries, journal lines,
  accounting periods, people, labor logs, payroll runs, payroll run lines, reconciliation batches and
  reconciliation batch rows;
- total journal debit and credit as decimal text;
- MD5 definitions of `fn_accounting_balance_sheet(uuid,date)`,
  `fn_accounting_income_statement(uuid,date,date)` and `fn_guard_labor_log_payroll_freeze()`;
- presence and metadata of both candidate snapshot functions, the private active-person guard and the two labor
  triggers.

The last documented finance baseline is 31 accounts, 10,201 expenses, 162 sales, 10,365 journal entries and
20,730 journal lines; the last payroll release recorded zero labor logs and payroll runs. A fresh approved
capture is authoritative. Any difference must be explained before apply; do not overwrite or adjust a business
row to match old documentation.

Confirm a current Supabase backup/PITR position and the last known-good Vercel production deployment are
identifiable. Do not initiate a restore or rollback during preflight.

### Exact catalog attestations

Set the catalog-check transaction's local `search_path` to `public, pg_catalog`, then normalize definitions with
`md5(regexp_replace(pg_get_functiondef(oid), '[[:space:]]+', ' ', 'g'))` for functions and
`md5(regexp_replace(pg_get_triggerdef(oid, true), '[[:space:]]+', ' ', 'g'))` for triggers. A fresh local replay
of the exact candidate pins these expected hashes:

| Object | Expected normalized MD5 |
|---|---|
| `fn_accounting_balance_sheet_snapshot(uuid,date)` | `b656798341542f3c188047bd1a7ad726` |
| `fn_accounting_income_statement_snapshot(uuid,date,date)` | `c90f05fee1371c4a8fac8e3fac35786f` |
| `private.fn_guard_labor_log_active_person()` | `e44fdeae92efeda3e14fd61b56e1d548` |
| trigger `zz_guard_labor_log_active_person` | `76f2dddd2616c8e550225f437a5ea4d6` |

Also capture the production preflight hashes and owners for the existing payroll-freeze function and trigger.
The local reference hashes are `f6ebb81b1b64eec1780d77f45fb1be78` for
`fn_guard_labor_log_payroll_freeze()` and `aeb707782c0cf96b1c6fb27ec5137c5e` for trigger
`guard_labor_log_payroll_freeze`; the fresh production preflight values, not the local references, must remain
identical after apply because this candidate does not replace either object.

If the hosted PostgreSQL version renders an otherwise identical catalog definition differently, stop and compare
the normalized text to the committed migration. Do not weaken or bypass the hash gate to continue the release.

## Stage 3: Owner-gated migrate-first apply

1. Obtain explicit Owner approval naming both repository migration files and their order.
2. Apply only the first committed migration through the approved Farm migration mechanism. Record its hosted
   version and repository-file mapping.
3. Re-read the ledger and catalog. If the result is unknown, partial or failed, stop. Because the file is
   transactional, inspect whether its functions and hosted ledger entry exist before considering any retry.
4. Apply only the second committed migration and record its hosted mapping.
5. Re-read the ledger and require each candidate migration exactly once and in order. Never rerun by pasting SQL
   merely because the client response was interrupted.

If the first migration succeeds and the second fails, leave the first additive migration in place and stop.
Prepare a reviewed fix-forward for the second under separate Owner approval. Do not delete the first functions,
rewrite migration history or continue to application merge.

## Stage 4: production postflight before merge

Postflight is a separately approved production read. Require all of the following:

1. The Stage 2 business counts, journal debit/credit totals and three trusted-function hashes are unchanged.
   If legitimate concurrent activity occurred, stop and recapture only after it is independently explained;
   never hide drift by editing data.
2. `fn_accounting_balance_sheet_snapshot(uuid,date)` and
   `fn_accounting_income_statement_snapshot(uuid,date,date)` both exist, are `STABLE`, `SECURITY DEFINER`, pin
   `search_path=""`, deny PUBLIC and `anon`, grant `authenticated`, have their documented comments, are owned
   by a role with `rolsuper` or `rolbypassrls`, and match the exact normalized hashes above.
3. The private active-person guard exists as `SECURITY DEFINER`, pins an empty search path and grants direct
   execute to none of PUBLIC, `anon` or `authenticated`. Its owner has `rolsuper` or `rolbypassrls` and its
   normalized function hash matches the exact candidate value above.
4. `labor_logs` has exactly one enabled `zz_guard_labor_log_active_person` trigger and retains exactly one enabled
   `guard_labor_log_payroll_freeze` trigger. The alphabetical trigger order keeps the existing payroll freeze
   before the active-person guard. The new trigger's normalized definition hash matches the candidate value;
   its definition names `private.fn_guard_labor_log_active_person()`, fires before insert or update of
   `person_id, org_id`, and is enabled. The existing freeze function/trigger hashes, owner and effective ACLs
   exactly match the Stage 2 production preflight.
5. Under separately approved read-only role sessions:
   - Owner and Accountant can read same-organization exact statement snapshots;
   - a non-finance role receives `42501`;
   - snapshot `version`, organization/date fields and totals are strings and match the trusted source functions.

Do not create a production labor row merely to prove postflight. The active-person rejection and historical
correction behavior remain covered by the 33-assertion local contract until they are observed in a legitimate
Owner-approved production workflow. Any synthetic write probe would require its own production-data approval and
must not be bundled into this read-only postflight.

## Stage 5: exact preview and role acceptance

1. Use only an explicitly approved preview of the exact committed candidate. Verify the preview commit SHA.
2. Run the protected accounting suite only with three distinct approved accounts: Owner, Accountant and one
   non-finance role. Credentials remain in the invocation environment only.
3. A production-backed preview read requires a separate Owner approval and the wrapper's one-shot production
   acknowledgement. Do not bypass origin, method, service-worker, WebSocket or environment guards.
4. Require all 46 tests: 23 workflows on desktop Chromium and Pixel 7. Require both statement PDFs to download,
   parse as nonblank PDFs and remain readable in Arabic. Require every rendered statement-section CSV to have
   its UTF-8 BOM, exact Arabic header, valid filename and at least one data row without logging financial rows.
   The income lane is pinned to 2019-01-01 through 2026-08-24 and must produce one unique revenue CSV plus one
   unique expense CSV with page-date-bound filenames. Balance filenames must bind each unique rendered section
   to the page's actual `asOf` date. If the approved Stage 2 baseline no longer supports that income prerequisite,
   stop and update the period, source contract and runbooks together under exact-byte review; never relax the
   identity checks during execution.
   The reconciliation workflow must also parse the downloaded annex and require its UTF-8 BOM, exact 73-column
   header, batch-and-digest-bound filename, report count, all 698 canonical rows and the report's full SHA-256
   digest repeated in every complete row. Only aggregate pass/fail evidence may enter logs.
5. Test PDF cold start and two concurrent downloads in the preview runtime. Stop on timeout, missing browser
   assets, unreadable Arabic, excessive memory, or a response from a different commit.
6. Missing credentials, unavailable non-finance account, role mismatch or any partial run means this gate is
   not passed.

## Stage 6: Owner-gated merge and production deployment

1. Reconfirm the PR, exact commit, CI, migration postflight and role acceptance. Stop if `main` moved
   incompatibly.
2. Obtain explicit Owner approval to merge.
3. If merge triggers production deployment, obtain explicit deployment approval before merge. Otherwise obtain
   separate approval for the deployment action.
4. Verify the production deployment is READY for the exact merge commit and the public alias serves it.
5. With separate approval, run signed-out routes and the authenticated read-only smoke. Confirm statements,
   close, periods, dashboard, PDF downloads, labor picker behavior and role denials; HTTP 200 alone is not proof.
6. Repeat the aggregate/catalog postflight and update `STATUS.md`, `PROJECT-TRACKER.md`, `DEPLOY-STATUS.md` and
   `SESSION-BRIEF.md` with exact commit, PR, hosted migration mapping, deployment and evidence location.

## Recovery and stop rules

- Both migration files are transactional and contain no business-row DML. An error should roll back that file;
  an uncertain client response still requires ledger/catalog inspection before retry.
- Database recovery is forward-only. Prepare an additive reviewed fix under separate Owner approval. Do not edit
  an applied migration, reset production or delete migration-ledger rows.
- The previous application remains compatible with both additive migrations. If preview or production application
  behavior fails, stop or roll back the Vercel deployment to the last known-good exact deployment under explicit
  Owner approval; leave the database additions in place while a fix-forward is prepared.
- Do not remove the labor guard as an emergency shortcut. If it rejects a legitimate workflow, preserve the
  evidence and produce a reviewed corrective migration.
- A database restore/PITR action is a separate incident decision. It requires explicit Owner approval and evidence
  of actual data corruption; these no-DML migrations do not by themselves justify a restore.
- Never change a financial, payroll, reconciliation or identity row to make a release check pass.

## Human accounting acceptance

After the software release, follow `accounting reconciliation acceptance runbook.md`. Accounting reaches 100%
only after authenticated role acceptance, all 698 row decisions, exception resolution, freeze and eligible
Owner approval, original-workbook dual run, separately authorized execution where required, final digest checks,
dated Accountant/Owner signatures and restricted evidence archive.

A green candidate, migration, deployment or browser suite alone is not 100% completion.
