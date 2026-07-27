# Farm data coverage audit

**Date:** 2026-07-27  
**Mode:** source read-only, production read-only, no imports or record changes

## What was reviewed

- Farm Records Knowledge System: 2,221 source paths, 1,249 unique hashes, 972 duplicates.
- Extraction/OCR coverage: 95.28%, representing 1,742,233 indexed units.
- Expanded accounting, registry, payroll, inventory, operations, marketing, and archive sources.
- Production table counts, financial integrity, migration state, and authenticated report routes.

Extraction means the evidence is reachable. It does not mean every record is semantically understood,
approved for import, or reconciled to production.

## Accounting

| Measure | Source workbook | Production | Difference |
|---|---:|---:|---:|
| Expenses | 10,861 rows / EGP 22,948,268.01 | 10,201 / EGP 20,527,757.01 | 660 / EGP 2,420,511.00 |
| Sales | 181 rows / EGP 27,284,356.43 | 162 / EGP 25,835,533.40 | 19 / EGP 1,448,823.03 |

Production has 10,365 posted journals and 20,730 lines. The posted ledger is balanced and every loaded
expense and sale has a journal. The source coverage is still partial: reconciliation batch
`80a1051d-5bcf-504c-93cd-07206b4c59ef` has 698 rows, all unreviewed and held. It must not be executed
until owner/accountant row decisions, a dual run, and signed acceptance are complete.

Pre-2019 evidence also exists: 2,002 expenses and 162 sales from 2011-2018. Whether to import that detail
or retain the opening-balance treatment is an accounting-policy decision.

## Production coverage

| Domain | Production state | Source adequacy | Authority state |
|---|---|---|---|
| Finance ledger | balanced, posted | strong but reconciliation incomplete | partial |
| Palm registry | 34 hawshat, 796 palm assets; synthetic/incomplete | conflicting aggregate sources; partial tree numbering | unverified |
| Offshoots | no movement rows | no structured source ledger | blocked |
| Budgets | seeded/foundation values | no authoritative budget workbook | blocked |
| Payroll | 6 people; no compensation or labor logs in live inventory | sparse monthly files; PII/security and wage model unresolved | blocked |
| Inventory | 6 items, 7 movements | catalogue is strong; movements mainly 2021 | partial |
| Operations | 3 plans, 3 operations, 3 events | 2021 plan plus limited 2026 programmes | partial |

## Palm registry blocker

The previous baseline states 4,380 Barhi, 299 male palms, and 28 hawshat. A later workbook states 4,539
Barhi and implies 370 male palms while still stating 28 hawshat. It also duplicates a sector number and
contains internally inconsistent rows. Production contains 796 materialized palm assets, no male assets,
and duplicated tags. No count is approved for import. The next gate is a corrected owner-approved registry
or a fresh field count.

## Report validation

Fifty-six authenticated report and insight routes were exercised with the production owner session,
including all dynamic routes using real IDs. They loaded without application/internal load errors, generally
within 0.5-1.5 seconds. The balance sheet was independently checked as balanced.

This proves route and report-code health, not data completeness. Palm, offshoot, budget, payroll, inventory,
and operations reports must declare incomplete authority and suppress unsupported numbers. The
`data_authority_status` gate makes missing status fail closed and allows only the owner to change authority.
A domain cannot be marked verified without a source label, record count, and evidence notes.

## Required next gates

1. Rotate/remove the credential material embedded in the source workbook and close Stage-0 security.
2. Review the 698 accounting reconciliation rows with the owner and accountant; do not bulk-accept.
3. Decide pre-2019 accounting treatment and the internal-palm-purchase reporting basis.
4. Resolve the palm registry through corrected source or field verification.
5. Approve the wage model and complete independent payroll/PII access review before import.
6. Recover inventory/custody history from unstructured documents with explicit partial-coverage labels.
7. Capture structured offshoot, harvest, budget, and current operations ledgers rather than inferring values.

Derived annual reports are validation oracles, not import sources. Charity/beneficiary data remains outside
Farm OS scope. Buyer/exporter market research must never be loaded as transacting customers.
