# Accounting balance-sheet account-integrity audit

**Date:** 2026-07-30
**Issue:** #719 item 5
**State:** merged, migrated, deployed, and live-verified

## Finding

`journal_lines.account_id` references `accounts.id` and `journal_entry_id` references `journal_entries.id`,
but neither foreign key includes `org_id`. The normal journal posting helper verifies ownership. A privileged
or historical write can still produce disagreement among the journal entry, line, and account organizations.

The balance-sheet report scopes both lines and accounts to the requested organization. Before this fix, an
account mismatch was lost at the account join, and moving both lines of an entry to another organization
could hide the complete entry while still returning `balanced = true`.

## Fix

Migration `20260730120000 accounting balance sheet account integrity.sql` re-emits the current
`fn_accounting_balance_sheet(uuid,date)` body and adds one preflight invariant after its existing membership
and `finance.read` gates. For posted, as-of-bounded records touching the requested organization, the journal
entry, line, and account organizations must agree. Otherwise the RPC raises SQLSTATE 23514 with a fixed
message that exposes no row or account identifier.

Signature, `STABLE`, `SECURITY DEFINER`, empty `search_path`, permissions, JSON contract, totals, archived
account behavior, posted-only filter, and as-of behavior are unchanged.

## Evidence

- Focused test 144: **10/10**. It uses three real currently-permitted corruption shapes without disabling
  any constraint, proves normal same-org output remains balanced, and proves account and both directions of
  coordinated entry/line organization corruption fail closed.
- Full Docker-free pgTAP: 3,118 ok / 0 not_ok / 0 file failures.
- Semantic diff against `20260705110000_accounting_balance_sheet.sql`: one integrity precheck plus comments.
- Hosted read-only preflight: **0 / 20,730** posted lines lack a same-organization account.
- Hosted read-only `EXPLAIN ANALYZE`: the three targeted checks measured about **5 ms**, **2.8 ms**, and
  **2.2 ms** on the current ledger. A single broad join measured about 90 ms and an initial left-join form
  measured about 166 ms; both were rejected.
- Hosted migration: `20260730083902 accounting_balance_sheet_account_integrity`.
- Hosted postflight: all three predicates present; metadata and grants unchanged; **0** account-org and
  **0** entry-line mismatches across **20,730** posted lines.
- Exact-head PR #973 app, design-system, db-tests, gitleaks, and Vercel checks: green.
- Independent review: **APPROVE**, including an independent 3,118/3,118 rerun.
- PR #973 merge: `4a051030c7b246b3126c04a4a609e857c1ad6e20`.
- Exact production deployment: `dpl_GVgRWZCojujLYzF1qgK4GDT7jDms`, READY.
- Exact-merge main CI, release, and db-tests: green; public `/login`: HTTP 200; post-release runtime errors:
  none in the queried 15-minute window.
- `git diff --check`: clean.

## Boundaries

This is report-level defense in depth. It changes no table, constraint, journal, account, amount, or business
row. It does not repair corruption; it prevents the report from concealing it. A future composite foreign key
would be a broader schema-hardening decision and is not required to close this report finding.

## Rollback

Restore `fn_accounting_balance_sheet` from migration `20260705110000_accounting_balance_sheet.sql`, then
clear the function comment with `comment on function public.fn_accounting_balance_sheet(uuid, date) is null`.
