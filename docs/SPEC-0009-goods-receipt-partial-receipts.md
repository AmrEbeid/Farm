# SPEC-0009 — Goods receipt & partial-receipt model (engine)

*Status: **DRAFT for Owner review** — design + decision-support only. No code, no migration, no
data change is performed by this document. The fix it specs is a **core-engine + financial** change
(PROJECT RULES hard stop): Owner-ratified, independent-review-required, applied via a forward
migration through the gated apply layer.*

*Companion to [`SPEC-0001`](SPEC-0001-stock-coverage-engine.md) (the engine whose disjointness
invariant this protects) and [`SPEC-0004`](SPEC-0004-accounting-and-pnl.md) (which later posts the
matching expense on receipt). Sources: GitHub issue **#155** (open, HIGH — "Engine has no
partial-receipt model — double-count reachable on partial/over receipts") and **#156** (closed —
the item-scoped/horizon-blind disjointness guard, whose proper fix is coupled here).*

---

## 1. Why this stage, why now

Receipts are **all-or-nothing**. `fn_post_receipt` posts the *full* `purchase_request_items.qty`
per line and flips the PR wholesale `approved → received` in one transaction; there is no
`received_qty` / remaining column on the line. Real procurement breaks the engine's core
"counted exactly once" invariant (SPEC-0001 §1) three ways:

1. **Partial under-delivery.** Approve 500, only 300 arrive. The RPC posts the full 500 →
   `on_hand` overstated by 200. A direct 300-only receipt is instead *rejected* by the
   ENGINE-DC guard (it keys on PR *status*, not remaining-on-order). The operator's only
   workaround — flip the PR to `received` and post 300 — makes the engine drop the entire 500
   from its scheduled-receipts projection, so the still-owed 200 **silently vanishes** from
   future supply. A silent shortage is the exact failure the wedge exists to prevent.
2. **Over-delivery.** 600 lands against a 500 order with no objection (`fn_post_movement` has a
   stock-floor but no upper bound vs. ordered).
3. **#156 coupling.** Because the guard can't reason about remaining-on-order, it is item-scoped
   and horizon-blind, relying on a forgeable transaction-local GUC marker (`app.posting_receipt`)
   to let the trusted path through. A real partial-receipt model lets that hack be retired.

**Now:** this must be fixed **before real Ebeid procurement data lands** (Stage M). Retrofitting a
`received_qty` balance onto already-posted history is far worse than adding it up front.

## 2. The decision (recommended)

**Adopt line-level remaining balances + a per-line receipt RPC + a remaining-based projection.**
(Option B in the #155 decision memo; Options "status-tier only" and "PR-header single balance" were
rejected as cosmetic / wrong-granularity for a per-`item_id` engine.)

- `purchase_request_items.received_qty numeric not null default 0`.
- `fn_post_receipt(pr_id, lines[])` accepts a per-line received qty (default = remaining), posts
  exactly that qty, increments `received_qty`, and flips the PR to `received` only when **every**
  line is fully received, else to a new `partially_received` status.
- The engine projects **`qty − received_qty`** (not full `qty`) for `approved` + `partially_received`
  PRs, keeping received-to-date (`on_hand`) and remaining-on-order (the projection) disjoint and
  exhaustive by construction.

## 3. Scope

**Allowed:**
1. Schema: add `received_qty` to `purchase_request_items`; add `'partially_received'` to the
   `purchase_requests.status` check; keep the ledger append-only (no edits to posted movements).
2. RPC: rewrite `fn_post_receipt` to be per-line and quantity-aware (reject qty > remaining =
   over-receipt); preserve its claim-first idempotency (the EXE-1/RCP-1 lesson) and atomicity.
3. Engine: change the scheduled-PO projection in `fn_stock_coverage` to sum `qty − received_qty`
   over `status in ('approved','partially_received')`; the period-1 receipt netting inherits it.
4. Guard (#156 fix): make the ENGINE-DC disjointness check **quantity-aware** (fire only when a
   receipt would push `received_qty` past `qty` for its line) and **horizon-aware** (mirror the
   engine's horizon bound); evaluate retiring the `app.posting_receipt` GUC bypass.
5. App: `recordReceipt` passes per-line received quantities; surface a partial-receipt UI affordance.

**Forbidden:**
- Editing posted `inventory_movements` (append-only ledger — migrations 0016/0020/0030).
- Posting the accounting expense here — that is a SPEC-0004 follow-on (this spec only fixes supply).
- Weakening the disjointness oracle to make a partial receipt pass (SPEC-0001 §7).
- Relaxing migration 0030's INSERT lockdown (the residual #156 over-block depends on it).

## 4. Acceptance (the oracle — define the checks first)

1. Approve 500, receive 300 → `on_hand +300`, line `received_qty=300`, PR `partially_received`,
   projection shows remaining **200** (not 0, not 500).
2. Receive remaining 200 → PR `received`, projection 0, total `on_hand +500`; Σ(receipt movements)
   == `on_hand` (SPEC-0001 §2.2 reconciliation oracle).
3. Receive 600 against 500 remaining → **rejected** (over-receipt); no movement posted; PR unchanged.
4. Two open POs for one item; partially receive one → the other's remaining is still projected; no
   false ENGINE-DC over-block (regression for #156).
5. Idempotency/atomicity: a mid-line failure rolls back the whole call; a double-submit posts once
   (carry forward tests 15/23 semantics).
6. ENGINE-DC double-count regression (tests 14/27 family) still red on a genuine orphan/over-receipt
   with the GUC bypass removed.
7. A receipt against a PO whose `needed_by` is **beyond** the projection horizon now **succeeds**
   (today it wrongly throws) — the horizon-blind half of #156.

## 5. Slices (small, independently gateable)

1. **Schema + reconciliation-oracle extension** (`received_qty`, `partially_received`; new pgTAP
   asserting the disjointness invariant under partial/over receipts — must fail on the current
   all-or-nothing RPC). *(Low risk; defines the gate.)*
2. **Per-line quantity-aware `fn_post_receipt`** (claim-first, over-receipt rejection, atomic).
   *(High — engine/financial, Owner-gated apply, independent review.)*
3. **Engine projection** → remaining-based (`qty − received_qty`). *(High — engine; full pgTAP +
   wedge-loop e2e.)*
4. **ENGINE-DC guard** → quantity + horizon aware; retire the GUC bypass if proven safe. *(High —
   security + engine.)*
5. **App** — `recordReceipt` per-line + partial-receipt UI. *(Med.)*

Each slice stops at its gate; **do not auto-advance** (PROJECT RULES). The accounting hook (a
partial receipt posting a partial committed/actual) is tracked separately in SPEC-0004.

## 6. Risks & mitigations

- **Engine regression / silent double-count** — the whole point; mitigated by the §4 oracle written
  first and never weakened, plus the existing 280+ pgTAP suite and the wedge-loop e2e.
- **RPC API break** (`fn_post_receipt` signature changes; callers must pass lines) — coordinate the
  app change (slice 5) with slice 2; default the per-line qty to remaining for backward-friendly calls.
- **Irreversibility once partial history exists** — the schema add is reversible; sequence before any
  real-data receipt (Stage M).
- **Guard trust boundary** (retiring the GUC) — independent security review; preserve migration 0030.

## 7. Decisions log

- **2026-06-26 (recommended, pending Owner ratification):** adopt Option B (line-level `received_qty`).
  Rationale + rejected options in the #155 decision memo. Belongs in its own spec (not SPEC-0004)
  because the invariant, projection, and guard all live in the stock-coverage engine; cross-linked
  from SPEC-0001 §2 and SPEC-0004 §2.
- **Open for the Owner:** ratify this spec; confirm whether the ENGINE-DC GUC bypass is retired now
  (slice 4) or deferred; confirm the partial-receipt UI affordance for field roles.
