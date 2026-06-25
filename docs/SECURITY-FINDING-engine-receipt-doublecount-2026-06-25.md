# Engine Finding — scheduled receipts are double-counted (PAB masks real shortages)   (2026-06-25)

> **✅ FIXED on `main`** (migration `0018`, PR #61) via **direction #2** — scheduled receipts are now
> sourced from approved purchase_requests (open POs), disjoint from `on_hand` by construction.
> Independently reviewed (diff + pgTAP `97/97`, incl. the un-TODO'd regression test `14`, + the
> Playwright wedge-loop). **Core-engine change → the Owner should ratify it before the prod DB push**
> (which remains the gated step, with `0015`–`0018`).

Reviewer: independent adversarial pass over the **stock-coverage engine** (`fn_stock_coverage`, the
SPEC-0001 wedge — the product's differentiator). Owner: Amr Ebeid. Verified on the live local stack.
Severity: **MEDIUM–HIGH (correctness)** — it makes the projection *optimistic*, which can **hide a
real shortage** and under-recommend a purchase. That is SPEC-0001's explicitly-called-out #1 risk
("wrong recommendation → wasted/late purchase") and the exact field failure the product exists to
prevent ("standing in the field short of fertilizer"). **Owner-gated** — it's the core engine, so the
fix needs independent review + the full pgTAP + Playwright e2e, not a blind edit.

## The bug

`on_hand` and the forward projection **both** count the same receipt:

- **`fn_bin_rebuild`** (the reconciliation oracle) computes `on_hand = Σ(signed movements)` over
  `inventory_movements` with **no date filter** — so every `receipt` row is in `on_hand`, regardless
  of its `occurred_at`.
- **`fn_stock_coverage`** sets `available = on_hand − reserved`, seeds `PAB[1] = available`, **and
  then also** buckets `receipt` movements with `occurred_at >= period_start` into `v_receipts`, which
  it adds forward in the recurrence `PAB(t+1) = PAB(t) − issues(t) + receipts(t)`.

Any receipt dated **on or after `period_start`** (the earliest demanding op — which is frequently in
the past once a plan is underway) is therefore counted **twice**: once in the opening `available`,
and again as a forward "scheduled receipt."

## Reproduction (live local stack, potassium-sulfate item, horizon 8)

Seed baseline (only receipt is `2025-06-01`, *before* `period_start` `2025-07-08`):
```
available = 300
PAB       = [300, -200, -200, -200, -200, -200, -200, -200, -200]   → shortage in period 1 ✓ correct
```
Add one receipt of **100 kg dated `2025-07-10`** (after `period_start`) and rebuild the bin:
```
on_hand after rebuild = 400         -- the 100 is now in on_hand
available             = 400         -- …and in `available`
PAB                   = [400, 0, 0, 0, 0, 0, 0, 0, 0]   → shortage = FALSE
```
**The correct `PAB[2]` is −100** (a real shortage), under either reading of the 100 kg:
- already-received → `on_hand 400`, no *future* receipt → `400 − 500 = −100`;
- genuinely future → `on_hand 300`, `+100` receipt → `300 − 500 + 100 = −100`.

The engine returns `0` and **`shortage = false`** — it silently drops a real shortage. (The 480 kg
period-1 demand exceeds the 300 on-hand by 200; the spurious +100 receipt halves the apparent gap and,
with the extra 100 in on_hand, erases it entirely.)

## Root cause — a modelling inconsistency

`v_receipts` is sourced from `inventory_movements` (which records **actual, past** events) but is
treated as **future scheduled receipts**. `on_hand` already reflects those same actual movements.
The two overlap for any receipt with `occurred_at >= period_start`. The `>= period_start` filter was
meant to align receipts to the demand buckets, but it does not exclude receipts already baked into
`on_hand`.

## Recommended fix (Owner-gated; define the check first)

Keep `on_hand` (received-to-date) and the forward projection **disjoint** on the time axis. Options,
in order of least disruption:

1. **Project only genuinely-future receipts:** change the `v_receipts` filter from
   `occurred_at >= period_start` to `occurred_at > current_date`, AND ensure `on_hand` excludes
   future-dated receipts (either by convention — the ledger only holds actual/past movements — or by
   date-filtering `fn_bin_rebuild` to `occurred_at <= current_date`). The two must use the **same
   cut-line** so nothing is counted twice and nothing is dropped.
2. **Source scheduled receipts from open purchase orders / approved purchase_requests** (true future
   supply) rather than from the actual-movement ledger — this matches the SPEC's MRP framing
   ("scheduled receipts" = open POs) and removes the overlap by construction.

Whichever is chosen, the regression is already pinned by **`tests/14_engine_receipt_doublecount_test.sql`**
(added in #56, wrapped in TODO until the fix lands): *a received +100 must raise the forward PAB by
its qty once, not twice, and must not mask the real shortage*. Re-run the Playwright wedge-loop
afterward (the loop receives stock mid-plan, so it exercises exactly this path).

### Update (2026-06-25): direction #1 alone is NOT sufficient — it's a data-model decision

I prototyped direction #1 (project only `occurred_at > current_date`) and **it breaks
`tests/06_stock_engine_edge_test.sql` Case C** ("a scheduled period-1 receipt offsets the shortfall").
The reason is decisive: the engine's time model is **plan-relative**, not wall-clock. Case C dates its
"scheduled receipts" `2025-07-08`/`2025-07-15` (the plan window) — wall-clock-**past** relative to a
2026 `current_date`, yet semantically **future** supply — and sets the bin's `on_hand` **directly**
(so those receipts are NOT in `on_hand`, and the engine correctly projects them). A `> current_date`
filter drops them and Case C fails.

So the two contexts are genuinely incompatible for any engine-only tweak:
- **Case C / open-PO model:** the receipt is `>= period_start`, **not** in `on_hand` → must be projected.
- **Production / `fn_bin_rebuild`:** the receipt is `>= period_start`, **already** in `on_hand` (rebuild
  sums all receipts) → must **not** be projected.

The engine cannot tell these apart from a `type='receipt'` row alone — the same movement is "scheduled"
in one path and "received" in the other. **The double-count is therefore a receipt data-model
inconsistency, not a filter bug**, and **direction #2 is the real fix**: model genuinely-scheduled
supply as open POs / approved `purchase_requests` (never in `on_hand`), and stop sourcing the forward
projection from the actual-movement ledger. Re-date/rewrite Case C onto that source as part of the fix.

## Why not auto-fixed

The engine is the product's core IP and a CLAUDE.md "independent review required" area (stock-coverage
engine). Both fix directions touch either the reconciliation oracle (`fn_bin_rebuild`, with its SC-6
`on_hand = Σ(movements)` invariant and test) or the demand/receipt source model — a design decision
for the Owner, validated by the engine unit tests + the e2e, not a blind edit during review.
