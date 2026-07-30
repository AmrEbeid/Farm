# Accounting journal entry-date audit

**Date:** 2026-07-30
**Issue:** #719 item 3
**Release state:** production migration applied and hosted catalog verified; no business-row change

## Finding

`fn_post_two_line_journal` was the only accounting posting choke point, but it converted a null
`p_entry_date` to `current_date`. A future caller could therefore pass an unknown historical business
date, post it today, and avoid the lock on the true period.

The helper is internal: `public`, `anon`, and `authenticated` have no execute permission.

## Caller audit

Every active caller resolves a non-null date before calling the helper:

| Posting path | Date supplied |
|---|---|
| Sale revenue finalization | sale date, then delivery date, then current date |
| Sale collection | occurrence date, then current date |
| Custody owner funding and expense payment | occurrence date, then current date |
| Payment-request settlement | explicit settlement/current date |
| Opening balance | fixed `2019-01-01` |
| Historical GL backfill | expense date or sale/creation date |
| Reconciliation expense/sale execution | validated source/effective date |
| Reconciliation rollback re-post | preserved effective date |

Test and migration-only calls also supply explicit dates. Requiring a date at the internal boundary does
not change any active business workflow.

## Change

Migration `20260730110000_accounting_journal_entry_date_required.sql` re-emits the current function and:

1. rejects null `p_entry_date` with SQLSTATE `23502`;
2. checks `fn_period_locked` against the supplied date directly; and
3. inserts the supplied date directly.

The signature, mutex order, valid-date idempotency return, source sequencing, account/organization
validation, cost-center propagation, two-line journal shape, and privilege revocations are unchanged.
Null-date retries are intentionally rejected before lookup.

## Evidence

- Full Docker-free pgTAP: **3,108 ok / 0 not_ok / 0 file failures**.
- New test 143: **7/7** for signature preservation, null refusal, no-write-on-refusal, explicit-date
  success, exact date preservation, valid-date idempotency after locking, and no authenticated execute
  privilege.
- Semantic diff against the current `20260726170000` function body shows only the three date-handling
  changes above plus comments.
- `git diff --check`: clean.

## Production release

- Hosted migration: `20260730075952 accounting_journal_entry_date_required`.
- Exact signature remains
  `fn_post_two_line_journal(uuid,date,text,uuid,text,uuid,uuid,numeric,text,text,uuid,uuid,uuid,uuid)`.
- Catalog postflight: `SECURITY DEFINER`, volatile, `search_path = ''`, null guard present, no
  `coalesce(p_entry_date, current_date)`, and no public/anon/authenticated execute.
- The migration changes function code only. It inserts, updates, and deletes no business row.
- Exact-head GitHub app typecheck, lint, unit tests, production build, bundle guards, design-system
  tests/build/Storybook, gitleaks, and db-tests passed. GitHub queued the workflows late; an intermediate
  run was canceled by the final docs commit through the configured concurrency group.

## Rollback

Restore the `fn_post_two_line_journal` body from migration `20260726170000`. No table, row, index, type,
grant, or function signature is added or removed, so rollback is a function-body replacement only.
