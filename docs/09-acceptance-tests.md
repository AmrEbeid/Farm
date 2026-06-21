# 09 — Acceptance Tests (Given / When / Then)
*Executable-style tests for every critical feature. These become the automated check suite (the "oracle" — never weaken a test to pass). ⭐ = MVP-0.*

---

## Stock Coverage

**⭐ SC-1 — covered**
```
Given current stock = 100 kg and reserved = 20 kg
And a planned consumption of 50 kg on 10 July
Then available stock = 80 kg
And the operation is marked "covered"
And remaining stock after the operation = 30 kg
```
**⭐ SC-2 — shortage + recommendation**
```
Given current stock = 40 kg
And planned consumption = 70 kg
Then the operation is marked "blocked by stock"
And the system recommends a purchase of at least 30 kg + safety stock
And if coverage < lead time, the recommended order-by date = today
```
**⭐ SC-3 — reorder point**
```
Given average demand = 100 kg/week, lead time = 5 days, safety stock = 74 kg
Then reorder point = demand-in-lead-time + safety stock
And when on_hand < reorder point, an "below reorder" alarm is raised
```
**SC-4 — expiry netting**
```
Given on_hand = 100 kg of which 30 kg expires before the planned consumption date
Then available excludes the 30 kg (available = 70 − reserved)
```
**SC-5 — time-phased projected balance**
```
Given opening = 300, a planned issue of 500 in week 1, no receipts
Then PAB(week 1) = -200
And the first period with PAB < 0 is flagged as the shortage period
And the shortfall (200) drives the recommended purchase quantity
```
**SC-6 — bin never drifts from ledger**
```
Given a sequence of receipts/issues/adjustments for an item×location
Then sum(movements) == inventory_bin.on_hand at all times
And a rebuild-from-ledger utility reproduces the same on_hand
```

## Reservations
**⭐ RS-1 — approve reserves, execute issues**
```
Given on_hand = 300, reserved = 0
When a plan reserving 500 is approved
Then reserved = 500, on_hand = 300, available = -200 (flagged shortage)
When the operation executes consuming 480 (after a 300 receipt)
Then on_hand = 600 - 480 = 120, reserved clears, a movement(type=issue, qty=480) exists
```
**RS-2 — cancel releases**
```
Given a plan operation with a 500 kg reservation
When the operation is cancelled
Then the reservation is released and available increases by 500
```

## Budget
**⭐ BG-1 — gate on breach**
```
Given budget approved = 1,000,000, actual = 870,000, committed = 70,000 (available = 60,000)
When a plan adds a 42,000 cost in that category
Then committed-after = 112,000 and the check returns "approval-needed"
And the purchase request cannot move past draft without Owner approval
```
**BG-2 — enough**
```
Given available = 200,000 and a plan cost of 14,000
Then the check returns "enough" and no extra approval is required
```
**BG-3 — variance after execution**
```
Given planned = 42,000, actual = 40,320, committed = 0
Then variance = actual + committed − planned = -1,680
And variance_pct = -4.0%
```

## Approvals & separation of duties
**⭐ AP-1 — only owner approves**
```
Given a purchase request in "submitted"
When a user with role ≠ owner attempts to approve
Then the action is rejected at the RLS/authorize layer (not just hidden in UI)
```
**AP-2 — author cannot self-approve**
```
Given a PR created by user X
When user X attempts to approve it
Then approval is blocked (separation of duties)
```
**AP-3 — idempotent, rejects stale**
```
Given an approval event for PR-0001
When the same approval is submitted twice
Then only one approval is recorded (idempotent), the second is a no-op
And an approval referencing a superseded PR version is rejected as stale
```
**AP-4 — every decision is audited**
```
When a PR is approved or rejected or edited
Then an immutable audit_log row records actor, action, before, after, timestamp
And audit_log has no UPDATE or DELETE policy
```

## Tenant isolation (RLS)
**⭐ TI-1 — cross-tenant returns nothing**
```
Given user U belongs only to org A
When U selects from any tenant table (farm_event, expenses, assets, …)
Then only org A rows return; supplying an org B id returns zero rows
```
**TI-2 — consultant multi-org**
```
Given consultant C is a member of org A (role=consultant) and org B (role=viewer)
Then C reads A and B with the correct per-org role, and writes only where permitted
```
**TI-3 — instant revocation**
```
When C is removed from org B's membership
Then C's next query against org B returns zero rows (no token-refresh delay)
```

## Farm files & events
**⭐ FF-1 — rollup**
```
Given an operation recorded against palm #2481 in الحصوة/حوشة 2/خط 5
Then it appears in the palm file, line file, hawsha file, sector file, and farm file
```
**FF-2 — derived status from history**
```
Given a palm's latest status-change event sets status = "sick"
Then the palm file header shows "sick" without storing a mutable status that can drift
```

## Financial correction (trust)
**FC-1 — no silent edit of approved records**
```
Given an approved expense/voucher
When an edit is attempted
Then the original is not mutated; a correction (reversing) entry is required
And both the original and the correction remain visible with audit links
```
**FC-2 — soft delete only**
```
When a financial record is "deleted"
Then it is soft-deleted/reversed, never hard-deleted, and remains in the audit trail
```

## Data import / onboarding
**IM-1 — validation blocks bad rows**
```
Given an uploaded palm-registry file with 10 rows, 2 missing a hawsha
Then the 2 invalid rows are listed as validation errors and not imported
And the import cannot be finalized until errors are resolved or skipped explicitly
```
**IM-2 — duplicate detection**
```
Given an import containing a palm code that already exists
Then it is flagged as a duplicate for the importer to merge/skip/replace
```
**IM-3 — approval before commit + rollback**
```
Given a staged import batch
Then nothing reaches live tables until the Owner/admin approves the batch
And a finalized batch can be rolled back as a unit if a problem is found
```
**IM-4 — reconciliation**
```
Given the palm registry totals to 4,380 برحي / 299 ذكور
When the import finalizes
Then Σ(imported palms per hawsha) == 4,380 and a reconciliation report is produced
```

## Offline drafts (mobile)
**OF-1 — draft survives offline**
```
Given a supervisor records an operation while offline
Then it is saved as a local draft with its photo and a "pending sync" badge
When connectivity returns
Then the draft syncs, inventory/cost post, and the badge clears
```
**OF-2 — online-only actions blocked offline**
```
Given the device is offline
Then approvals, final stock posting, financial posting, permission changes, and AI are unavailable
And the UI states clearly that these require a connection
```

## Attachments
**AT-1 — tenant-scoped access**
```
Given a photo stored at path {org_id}/operation/{uuid}
When a user from another org requests it
Then access is denied; only a signed URL scoped to the owning org is issued
```
**AT-2 — type/size enforced**
```
Given an upload exceeding max size or of a disallowed type
Then it is rejected before storage with a clear message
And images are compressed on upload
```

## Performance (smoke targets — see [10](10-operations-and-readiness.md))
**PF-1** — a sector file with 10,000 events loads its first page in < 2s (paginated/partitioned). **PF-2** — the stock-coverage function returns for one item×location in < 300ms. **PF-3** — owner dashboard renders for an org with 50,000 palms / 500,000 events without full-table scans (indexes + partition pruning).
