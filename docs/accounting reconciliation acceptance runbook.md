# Accounting reconciliation acceptance runbook

**Applies to:** the canonical 698-row reconciliation batch and any later real-data batch.

**Purpose:** produce dated, evidence-bound accountant and Owner acceptance without changing a row automatically.
This runbook does not authorize a migration, deployment, production read, batch decision, execution, rollback, or
other production write. Each external action remains separately Owner-approved.

## Released software and protected browser acceptance

The dependable-daily accounting software release is live (PR #1008, merge
`046a14e902ab1c0e4f3b3dbfa636937edff88c55`). Its automated database, application, build and signed-out
production checks passed. That proves the released software baseline; it does not replace authenticated
Owner/Accountant use or the financial reconciliation below.

The repository includes a write-blocked browser suite covering the same 23 workflows on desktop and phone
(46 tests total). It permits one password sign-in per browser context, then allows only local application reads
and allowlisted Supabase read RPCs. Any other POST, mutation, WebSocket, page error or console error fails the run.
The Owner attendance workflow requires at least one active person but keeps option identifiers and labels inside
the browser evaluation, so a failed shape check emits only aggregate booleans rather than personal identifiers.

The income-statement CSV lane uses the pinned regression period **2019-01-01 through 2026-08-24**. The documented
Farm ledger has both revenue and expense rows in that period, so the lane requires exactly one uniquely named
revenue CSV and one uniquely named expense CSV, with filenames bound to the dates rendered in the page inputs.
The balance-sheet lane binds each unique rendered section identity and filename to the page's actual `asOf` date;
zero-balance sections may be absent, but duplicate or unknown sections fail. If a fresh approved production
baseline no longer proves both income sections in the pinned period, or the canonical loaded-history contract
changes, stop and update the period, source contract and both runbooks together under exact-byte review. Do not
weaken counts or filename identity merely to make the role run pass.

Run it only from `apps/farm-os`, with no Next environment file in that directory, and supply these values through
the invocation environment:

- Public target: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `FARM_OS_ACCOUNTING_E2E_AUTH_ORIGIN`, and optionally a local
  `FARM_OS_ACCOUNTING_E2E_BASE_URL` (default `http://127.0.0.1:3100`).
- Canonical batch: `FARM_OS_E2E_BATCH_ID`.
- Three distinct existing accounts: Owner, Accountant and one non-finance role, through the matching
  `FARM_OS_E2E_*_EMAIL` and `FARM_OS_E2E_*_PASSWORD` variables.
- The non-finance account's exact role in `FARM_OS_E2E_DENIED_ROLE`: `farm_manager`, `agri_engineer`,
  `supervisor`, or `storekeeper`.

Never put those values in Git, shell history, reports or screenshots. The production run requires the wrapper's
one-shot acknowledgement and performs reads only:

```bash
npm run test:e2e:accounting:readonly -- --owner-approved-production-readonly
```

Stop if any account is shared, impersonated, missing its expected production role, or unavailable. A partial run
does not satisfy the 46-test gate.

Before using real credentials, run Playwright's `--list` mode with synthetic local-only environment values and
confirm it reports exactly **46 tests in 1 file**: 23 logical workflows across desktop Chromium and Pixel 7.
This inventory check does not authenticate, read production, or satisfy acceptance.

The current R4k candidate updates the protected checks to the exact compact finance UI: **قائمة الدخل**,
**قائمة المركز المالي**, **الفترات المحاسبية**, **إقفال الشهر**, the ready/blocked close controls, and both
statement PDF downloads. The browser suite verifies PDF response headers, filename, `%PDF-` header, `%%EOF`
trailer and nonblank size. It also downloads every rendered statement-section CSV for Owner and Accountant and
requires a UTF-8 BOM, exact Arabic header, valid statement filename and at least one data row; financial row
content is reduced to booleans and never enters assertion output. The reconciliation-control lane downloads and
parses the complete RFC-4180 acceptance annex. For the canonical batch it requires a UTF-8 BOM, the exact
73-column Arabic schema, a filename carrying the batch ID and first 12 digest characters, a 698-row page count,
exactly 698 complete data rows, and the same 64-character SHA-256 digest shown on the report in every row. It
emits only aggregate pass/fail evidence, never annex cells. A missing, partial, malformed, stale-digest or
differently named annex fails the protected run. The local finance PDF test additionally extracts rendered text
with Poppler when
available and proves formal Arabic labels, account codes, literal hostile markup, exact positive money beyond
JavaScript safe-integer precision, and exact negative money shown in accounting parentheses survive. Visual
inspection proves connected RTL Arabic, no overlap, one-page A4 balance output and readable signatures. The
generated PDF is tagged and contains no embedded JavaScript; the renderer disables page JavaScript and external
network access. The finance CSV integration test runs parser → shared page rows → CSV and proves Arabic headers
and exact positive/negative decimal bytes round-trip without number conversion. The rebuilt Next traces include
all four Chromium payloads plus both Noto WOFF files, report zero missing files, and measure 71.21 MiB per PDF
route. These automated checks do not replace the accountant opening the final production files and tying them
to the workbook.

The combined working-tree release manifest binds 56 files to exact `origin/main` `811da10`, includes both
ordered migrations, and passes its dedicated preflight. The strict committed preflight remains intentionally
unavailable until an Owner-approved commit
exists; do not substitute the working-tree result for commit, preview, migration or production evidence.

The combined train is not part of this production gate until its reviewed migrations and application bytes are explicitly
approved, released, and production-verified. Never run the credentialed suite against an unreleased local
candidate while pointing authentication at Farm production.

## Roles and separation

| Role | Responsibility | Must not substitute for |
|---|---|---|
| Accountant | Review every row, resolve evidence questions, perform the workbook comparison, prepare and sign the acceptance packet | Owner approval or execution |
| Eligible Owner approver | Be an Owner who neither created the batch nor reviewed any of its rows; approve the frozen batch, authorize execution separately, review the completed comparison, and countersign final acceptance | Accountant's dual run |
| Release operator | Run only an explicitly approved release, migration, or deployment command and preserve its output; never execute or roll back the accounting batch | Either signatory or the Owner-only batch controls |

The batch creator and row reviewers remain subject to the database approval separation rules. A system Owner
approval is not the same act as signed dual-run acceptance or authorization to migrate/deploy.

## Required inputs

- The original source workbook used for staging, unchanged and available to the accountant.
- Its printed SHA-256 value on the acceptance report.
- The canonical batch ID and the active Farm organization.
- Distinct authenticated accountant and eligible Owner sessions. Before review starts, verify that the Owner
  approver neither created the batch nor reviewed any row; the database will reject approval otherwise. The
  canonical 698-row batch was created by an Owner, so its creator cannot be its approver.
- A restricted evidence folder outside Git. It must be readable only by the Owner and authorized finance staff.

Stop if any input is unavailable, the workbook hash differs, the batch ID is uncertain, either role is being
impersonated, or no eligible non-creator, non-reviewer Owner is available. Never recreate a missing source workbook
from application rows. Never restage or alter a batch merely to bypass separation of duties; any authorized
remediation must preserve the source workbook hash and evidence trail and start a new controlled review cycle.

## Phase 1: complete review

1. The accountant opens the batch review queue and works every page until **بدون قرار = 0**.
2. Open each available quality shortcut on the acceptance report. Separately investigate every hard alarm that has
   no direct shortcut. Resolve invalid source dates, missing source amounts, unlinked amount corrections, missing
   evidence, and frozen rows without payload hashes.
3. For every amount correction, link the exact production expense or sale and retain the supporting source.
4. Held rows must be resolved before acceptance. Rejected rows must have an explicit evidence-backed outcome in
   the working papers; rejection is a decision, not permission to ignore the row.
5. Reopen the acceptance report. Stop if it refuses the read, shows an incomplete count, or shows any unexplained
   quality condition.

No agent or bulk tool may choose the 698 row decisions. These are accountant decisions over real financial evidence.

## Phase 2: freeze and Owner approval

1. The accountant freezes only after every row has a decision. Freezing binds each included payload.
2. Reopen the report and confirm every included row is frozen, every frozen row has a payload hash, and all held or
   rejected outcomes remain fully accounted for.
3. The verified eligible Owner reviews the frozen batch and records the application approval through the Owner-only
   control. Stop if the system rejects separation of duties; do not substitute another account or restage the batch.
4. Do not execute yet. Owner approval makes execution eligible; it does not prove the workbook comparison.

If any row changes after the comparison starts, discard that comparison package and restart from Phase 1.

## Phase 3: pre-execution dual run

1. From the approved batch, open **تقرير القبول** and download the CSV annex in the same review session.
2. Use the report's print control and print it or save it as PDF through the browser. Confirm the full SHA-256
   acceptance digest printed on the report equals the digest repeated in every CSV row. A mismatch means the
   files came from different reads: discard both.
3. Confirm the report row count equals the staged batch row count: 698 for the canonical batch.
4. Reconcile the source workbook to the report's period and worksheet control totals. Use the original workbook's
   own totals as the source side; do not copy the report total into both sides.
5. Record the source reference/version, covered period, source control total, system control total, exact
   difference, explanation and evidence for every difference, and the outcome of every exception.
6. The accountant signs a **pre-execution working paper**, not final acceptance. Any unexplained difference stops
   execution. A zero difference must still be written explicitly as zero.

Store the workbook hash, report/PDF, CSV, comparison working paper, and supporting exception evidence together in
the restricted evidence folder. Do not commit financial evidence, signatures, credentials, or personal data.

## Phase 4: separately authorized execution

1. The Owner reviews the completed pre-execution working paper and gives explicit authorization for this exact
   batch execution. This is separate from release, migration, merge, and deployment approval.
2. The Owner executes the batch once through the application control. Do not retry an unknown or interrupted
   result until the batch status and execution ledger are read and understood.
3. Record the execution timestamp and resulting batch status. No manual journal may be used to imitate a missing
   batch result.

## Phase 5: final verification and signatures

1. Reopen the acceptance report after execution and download a new CSV. Execution changes the batch record, so
   this final package normally has a new digest.
2. Confirm the final report says the batch was executed, all expected posting rows have settled results, and no
   row is listed as an unsettled or unknown execution outcome.
3. Recheck the final package digest against every CSV row and confirm the 698-row count.
4. Repeat or mechanically tie the final system totals to the signed pre-execution comparison. Explain and evidence
   every difference; never infer that successful execution proves the workbook comparison.
5. Complete every printed acceptance field. The accountant signs and dates first; the Owner then reviews the same
   digest-bound package and countersigns and dates it.
6. Archive the final report/PDF, CSV, signed assertion, workbook hash, comparison, exception evidence, and the
   pre-execution package together. Record the restricted archive location in the finance close checklist, not Git.

## Failure and rollback path

Do not sign final acceptance when the read is incomplete, a digest differs, a count differs, a quality exception is
unresolved, an execution result is unsettled, or a difference lacks evidence.

If execution completed but final verification fails:

1. Stop all follow-on accounting work that depends on the batch.
2. Preserve the failed final package and the observed mismatch before taking corrective action.
3. The Owner decides whether to invoke the existing whole-batch append-only rollback and records a specific reason.
4. After rollback, download and archive the rolled-back acceptance package and verify the reversal outcome.
5. Correct evidence or decisions only through a new controlled review cycle. Never alter the signed package or
   source workbook to make them agree.

## Completion evidence

The reconciliation acceptance gate is complete only when all of the following are true:

- All 698 canonical rows have human decisions and every quality exception has an evidence-backed outcome.
- Freeze and Owner approval are recorded by the application with existing separation rules intact.
- The original workbook hash matches the report and the dual run covers the stated period and source version.
- Source and system control totals, exact difference, and every difference explanation are recorded.
- The final executed package has matching report/CSV digests, complete settled outcomes, and the exact row count.
- The accountant and Owner signed and dated the same final digest-bound package.
- The complete evidence set is retained in the restricted finance archive and its location is recorded.

Until every item is evidenced, accounting remains not fully accepted for dependable daily use.
