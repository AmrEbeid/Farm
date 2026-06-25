# 0004 — ENGINE-DC: scheduled receipts from open purchase requests

- **Status:** Accepted — 2026-06-22
- **Implementation:** `apps/farm-os/supabase/migrations/20260622000018_engine_scheduled_receipts_from_pos.sql`
- **Finding:** `docs/SECURITY-FINDING-engine-receipt-doublecount-2026-06-25.md`
- **Oracle:** `apps/farm-os/supabase/tests/14_engine_receipt_doublecount_test.sql`

## Context

The stock-coverage engine (`fn_stock_coverage`, SPEC-0001) projects a period-by-period
projected-available-balance (PAB) to warn of shortages — the product's core wedge. In the
migration-0010 definition, `fn_bin_rebuild` summed **all** `receipt` movements into
`on_hand`, while `fn_stock_coverage` **also** projected `receipt` movements dated
`>= period_start` forward as scheduled supply.

A receipt that has been received was therefore counted twice — once in the opening `on_hand`
and again in the forward projection — making the PAB optimistic and able to hide a real
shortage (pgTAP 14). Prototyping a wall-clock filter proved insufficient: the engine's model
is plan-relative, and an actual `receipt` movement cannot be distinguished from a "scheduled"
one. The double-count was a data-model problem, not a filter bug.

## Decision

Redefine a "scheduled receipt" as genuinely-future supply that is **not yet** in `on_hand`:
an **approved** purchase request that has not been received. Source the receipts array from
`purchase_request_items` joined to `purchase_requests` where `status = 'approved'`, bucketed
by `needed_by` (plan-relative, like demand), and **stop reading the actual-movement ledger**
for the projection. This is the only change from the 0010 definition (the `v_receipts` source
query). It matches SPEC-0001's MRP framing where "scheduled receipts" = open POs.

## Consequences

- **Positive:** `on_hand` (received-to-date, from receipt movements) and the forward
  projection (open POs) are now disjoint **by construction**. When a PR is received,
  `recordReceipt` flips its status to `'received'` (so it leaves the projection) at the same
  time a receipt movement lands in `on_hand` (so it enters the opening) — counted exactly
  once, always. The shortage wedge is trustworthy again; pinned by pgTAP `tests/14` and
  `tests/16`.
- **Negative / trade-offs:** the projection now depends on purchase requests carrying a
  `needed_by` date and an accurate `approved`/`received` status lifecycle. MVP-0 assumes a
  single location: `purchase_requests` carry no location, so all supply is assumed to land at
  the same bin the demand draws from — revisit for multi-location.
