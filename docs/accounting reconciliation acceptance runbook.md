# Accounting reconciliation acceptance runbook

**Applies to:** the canonical 698-row reconciliation batch and any later real-data batch.

**Purpose:** produce dated, evidence-bound accountant and Owner acceptance without changing a row automatically.
This runbook does not authorize a migration, deployment, production read, batch decision, execution, rollback, or
other production write. Each external action remains separately Owner-approved.

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
