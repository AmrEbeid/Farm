# Pricing & Business-Value Decision Framework — Owner Decision #89

*Decision framework for GitHub issue #89 ("Replace hardcoded business values in PR/coverage/budget paths with a real price/qty source"). This document **structures the decision; it does not make it.** Per PROJECT RULE #1 (never fabricate farm or financial data), every actual number below is left as a `«TBD — Owner»` placeholder for the Owner (Amr Ebeid) to fill, after which an engineer implements against the chosen source.*

Two distinct concerns are tangled in issue #89. Keep them separate:

- **A. Item-cost & quantity data** inside the farm operating model (what a kilo of an input costs the farm, how much to reserve, when it is needed). This is the **subject of issue #89** — purchasing/coverage/budget correctness.
- **B. The product's own pricing** (what Farm OS charges a customer farm — per-farm EGP). This is a **separate GTM/commercial decision** (`docs/05-gtm-pricing.md`, OWNER-DECISIONS §8) and is included here only to keep the two from being conflated. See §4.

---

## 1. Where the hardcoded financial values currently live, and what they affect

These are **demo-seam constants that ship in production code paths**. They produce correct figures only for the single seeded item (potassium sulfate) and the single seeded budget op; for any other item or op they write/judge with wrong values.

| # | Location | Hardcoded value | What it is | What it affects |
|---|---|---|---|---|
| 1 | `apps/farm-os/app/(app)/inventory/[itemId]/coverage/actions.ts` (`createPurchaseRequestFromShortage`) | `est_cost: recommendQty * 84` | Unit price 84 ج.م/kg (potassium sulfate) baked into the PR line | `purchase_request_items.est_cost` — the estimated cost on every PR line, regardless of which item. Wrong for any non-potassium item. |
| 2 | `apps/farm-os/app/(app)/inventory/[itemId]/coverage/actions.ts` (`createPurchaseRequestFromShortage`) | `needed_by: "2025-07-08"` | Fixed calendar date | `purchase_requests.needed_by` on every created PR — a static past/fixed date rather than a lead-time-derived one. |
| 3 | `apps/farm-os/app/(app)/inventory/[itemId]/coverage/page.tsx` (`CreatePrButton` props) | `reserveQty={500}` | Fixed reserve quantity | The qty reserved against stock (`fn_post_movement` `reserve`) when a PR is created — passed regardless of the actual recommended/planned qty. |
| 4 | `apps/farm-os/app/(app)/budget/[planId]/check/page.tsx` | `const thisOp = 42000;` | Fixed op cost in EGP | The entire budget verdict (`block` / `approval-needed` / `ok`) is computed against this constant, so the budget gate is **decorative for any real op** — it does not reflect the cost of the PR/op actually being checked. |

**Schema reality (verified):**
- `inventory_items` (migration `20260622000005_inventory.sql`) has **no unit-cost / price column.** Its columns are name, category, unit, pack_size, min/max/safety stock, reorder_point, reorder_qty, lead_time_days, preferred_supplier_id, criticality, expiry_tracked. There is currently **nowhere on the item to store a price.**
- Money currently lives only on **transactions/lines, not on the catalog item:** `inventory_movements.unit_cost`, `purchase_request_items.est_cost`, and `expenses.unit_price` / `expenses.total` (migration `20260622000007_budget_purchase_expenses.sql`).
- Budget figures live on `budget_lines` / `budgets` (`planned`, `approved`, `committed`, `actual`). The budget-check page **reads these real columns** for the line totals — only `thisOp` (the cost being checked against them) is hardcoded.
- `lead_time_days` already exists on **both** `inventory_items` and `suppliers`.
- The coverage RPC `fn_stock_coverage` (migration `20260622000009`) **already returns** `recommend_qty`, `lead_time_days`, `reorder_point`, and `order_by` — so the quantity/date values in spots #2 and #3 are derivable from data the page already has (see §3).

> **Drift note (for the Owner, not a decision):** OWNER-DECISIONS-2026-06-24 §4 records that the `* 84` price (spot #1) and the fixed date (spot #2) were intended to be replaced (PRs #13/#16: plan-derived unit rate + `now()`). The code in this branch still shows the hardcoded `* 84` and `"2025-07-08"`. Whether that fix landed and regressed, or never merged into the PR-creation path, should be reconciled before implementation — issue #89 may overlap prior work.

---

## 2. Options for sourcing real item prices

The core decision in #89: **where does the unit cost of an inventory item come from?** Three candidate sources, not mutually exclusive.

### Option A — Unit-cost column on `inventory_items`
Add e.g. `last_unit_cost numeric` (and optionally `standard_cost numeric` + `cost_currency`/`cost_updated_at`) to `inventory_items`.

- **Pros:** Simplest schema change. One read to price a PR line. Matches the existing "one snapshot row per item" pattern (cf. `inventory_bin`). Good enough for a single-farm pilot.
- **Cons:** A single number per item hides supplier-by-supplier variation and price-over-time. Must be kept fresh manually (or auto-updated from receipts). No price history → no purchase-price variance analysis. Mixing "standard/planned" vs "last paid" in one field invites ambiguity.

### Option B — Dedicated price table (price list / item-cost history)
e.g. `item_prices(item_id, supplier_id?, unit_cost, currency, effective_from, source)`; price a PR line by selecting the most recent/effective row.

- **Pros:** Supports price history, supplier-specific prices, effective-dated changes, and variance reporting. Cleanest separation of "catalog" from "commercial terms." Scales to multi-supplier / multi-farm.
- **Cons:** More schema + more UI (someone must maintain the price list). Heavier than a single-tenant pilot strictly needs. Requires a selection rule (latest? cheapest? preferred supplier?) — itself an Owner decision.

### Option C — Supplier-quote / actual-paid driven (derive cost from receipts)
No catalog price at all: derive estimated cost from the **last actual receipt** (`inventory_movements.unit_cost` on the latest `receipt`) or from a captured supplier quote.

- **Pros:** Always grounded in a real paid/quoted number (strongly aligned with PROJECT RULE #1 — never invent). No separate price-maintenance burden. `inventory_movements.unit_cost` already exists. OWNER-DECISIONS §4 flags exactly this ("use the actual paid price… capture `unit_cost` on receipt movements") as the future refinement.
- **Cons:** No price until the item has been received at least once (cold-start: new items have no cost). PR `est_cost` is an *estimate before* purchase, so "last paid" may be stale vs current market. Needs a fallback for never-received items.

### Recommended shape of the decision (not the values)
A common ERP pattern combines these: **Option A or B as the priced source of truth, auto-refreshed from Option C** (each receipt updates the item's cost / appends a price row). The Owner should pick:
- the **storage model** (single column / price table), and
- the **default pricing rule for a PR estimate** (standard cost vs last paid vs preferred-supplier quote), and
- the **cold-start fallback** for items with no price yet (block PR? require manual entry? `«TBD — Owner»`).

| Decision input | Value |
|---|---|
| Storage model (A / B / hybrid) | `«TBD — Owner»` |
| Default PR-estimate pricing rule | `«TBD — Owner»` |
| Currency handling (EGP only? multi-currency?) | `«TBD — Owner»` |
| Cold-start fallback for un-priced items | `«TBD — Owner»` |
| Who maintains prices, how often | `«TBD — Owner»` |

---

## 3. How `reserveQty` and `needed_by` should be derived (these are NOT pricing)

These two are **not financial source-of-truth decisions** — they are **derivable from the coverage recommendation + lead time** that the system already computes. They were only hardcoded as demo seams. No new price source is required to fix them; the Owner's input here is to confirm the rule, not supply a number.

### `reserveQty` (spot #3, currently `500`)
The quantity to reserve against stock when the shortage PR is created. It should track the **planned requirement**, not a constant. Derive it from the coverage result the page already has:

- Candidate rule: `reserveQty = c.recommend_qty` (reserve what we're ordering), **or** the planned-consumption quantity for the operation, **or** `shortfall` (reserve only the deficit). These differ in intent — reserve-what-you-order vs reserve-only-the-gap — so the Owner/PM should confirm which.
- All three are already available on the `fn_stock_coverage` payload (`recommend_qty`, `shortfall`) or the plan. No schema change needed.

| Decision input | Value |
|---|---|
| Reserve rule (recommend_qty / planned qty / shortfall) | `«TBD — Owner/PM»` |

### `needed_by` (spot #2, currently `"2025-07-08"`)
The date the goods must be on hand. Should be **lead-time based**, computed at PR-creation time:

- Candidate rule: `needed_by = order_by + lead_time_days`, or `today + lead_time_days`, where `lead_time_days` comes from `inventory_items.lead_time_days` (falling back to `suppliers.lead_time_days`), and `order_by` is already returned by `fn_stock_coverage`.
- This is server-derived from existing columns — no invented date, no new source. Confirm whether the anchor is "today" or the planned operation date.

| Decision input | Value |
|---|---|
| `needed_by` anchor (today / order_by / plan op date) + lead-time source | `«TBD — Owner/PM»` |

### `thisOp` in the budget check (spot #4, currently `42000`)
This one **is** a real cost and must come from the §2 price source, not a constant. The budget verdict should be computed against the **actual cost of the PR/op being checked** — i.e. sum the referenced PR's line `est_cost` (the `?pr=` already in the page's `searchParams`) or the planned operation's `est_cost`. Once §2 is decided and `est_cost` is real, `thisOp` becomes `Σ(referenced PR line est_cost)`. The budget-line totals it is checked against (`approved`/`committed`/`actual`) are already real.

| Decision input | Value |
|---|---|
| Source of `thisOp` (referenced PR total / plan op est_cost) | `«TBD — Owner/PM»` (mechanically derivable once §2 lands) |

---

## 4. The per-farm EGP product-pricing model (separate concern)

This is the **product's commercial pricing** — what Farm OS charges a customer — and is **independent of issue #89's item-cost data.** It is included only so the two are not conflated. It is governed by:

- **PROJECT RULE #3:** pricing is **per-farm (EGP), never per-seat.** Do not reintroduce per-seat anywhere.
- **`docs/05-gtm-pricing.md` §3:** per-farm (+ per-area above a threshold), EGP, annual-prepay incentive, free/low entry tier. Tiers (Core / Pro / Enterprise / Private) and the indicative EGP bands there are explicitly labelled **"hypotheses to test — not final."**
- **OWNER-DECISIONS-2026-06-24 §8:** "Pricing: per-farm EGP anchors + setup fee (never per-seat) — **needs your number.**"

Open product-pricing decisions (Owner only — do not fill from the hypotheses; those are unvalidated):

| Decision input | Value |
|---|---|
| Per-farm anchor price by tier (EGP) | `«TBD — Owner»` |
| Per-area threshold + over-threshold rate | `«TBD — Owner»` |
| Setup / onboarding fee by farm size (EGP) | `«TBD — Owner»` |
| Free/entry-tier limits | `«TBD — Owner»` |
| Annual-prepay incentive | `«TBD — Owner»` |

**Relationship to §1–§3:** none at the data layer. Item costs (§2) live in the farm's operating data; product pricing (§4) is commercial/billing config. An engineer implementing #89 should **not** touch product pricing, and a product-pricing decision should **not** be encoded in the inventory/budget code paths.

---

## 5. Checklist — what the Owner decides vs what an engineer then implements

### Owner must decide (no engineering until these are set)
- [ ] **§2 storage model** for item cost: column on `inventory_items` (A) / price table (B) / receipt-derived (C) / hybrid. → `«TBD — Owner»`
- [ ] **§2 default PR-estimate pricing rule** (standard / last-paid / preferred-supplier quote). → `«TBD — Owner»`
- [ ] **§2 currency** (EGP-only vs multi-currency) and **cold-start fallback** for un-priced items. → `«TBD — Owner»`
- [ ] **§2 ownership/process** — who maintains prices and how often. → `«TBD — Owner»`
- [ ] **§3 `reserveQty` rule** (recommend_qty / planned / shortfall). → `«TBD — Owner/PM»`
- [ ] **§3 `needed_by` anchor** (today / order_by / plan op date) + lead-time source. → `«TBD — Owner/PM»`
- [ ] **§3 `thisOp` source** for the budget check (referenced PR total / plan op est_cost). → `«TBD — Owner/PM»`
- [ ] **§4 product pricing** — per-farm EGP anchors, area threshold, setup fee, entry tier, prepay incentive (separate commercial track). → `«TBD — Owner»`
- [ ] **Drift reconciliation** — confirm whether the §1 note (PR #16 plan-derived price) landed; decide if #89 supersedes/overlaps it.

### Engineer then implements (against the chosen decisions)
1. **Schema (if A or B):** add the cost column / price table via a new migration (DB migration = Owner-gated hard stop; deny-by-default RLS with `org_id`, matching existing tables). Verify with the listed checks; paste output.
2. **Auto-refresh (if hybrid/C):** update item cost / append a price row from `inventory_movements.unit_cost` on each `receipt`.
3. **Spot #1 (`est_cost`):** replace `recommendQty * 84` with `recommendQty × <resolved unit cost>` from the chosen source; handle the cold-start fallback. (Money logic → independent review required per PROJECT RULES.)
4. **Spot #3 (`reserveQty`):** pass the derived qty from the coverage result instead of `500`; remove the literal from `coverage/page.tsx`.
5. **Spot #2 (`needed_by`):** compute server-side from lead time at PR creation instead of the fixed `"2025-07-08"`.
6. **Spot #4 (`thisOp`):** compute from the referenced PR/op `est_cost` (now real) instead of `42000`; the budget verdict becomes meaningful for any op.
7. **Tests / checks first:** define a reconciliation/validation for each (e.g. PR `est_cost` = qty × resolved cost; budget verdict reflects the referenced PR). Never weaken a check to pass.
8. **Do NOT** encode any §4 product-pricing value in these code paths.

---

### Sources referenced
- GitHub issue #89.
- `apps/farm-os/app/(app)/inventory/[itemId]/coverage/actions.ts`, `.../coverage/page.tsx`, `apps/farm-os/app/(app)/budget/[planId]/check/page.tsx`.
- Migrations: `20260622000005_inventory.sql`, `20260622000007_budget_purchase_expenses.sql`, `20260622000009_fn_stock_coverage.sql`.
- `docs/CLAUDE.md` (PROJECT RULES #1, #3), `docs/05-gtm-pricing.md` §3, `docs/OWNER-DECISIONS-2026-06-24.md` §4 & §8.

*No prices, dates, quantities, or budget figures are asserted in this document. Every business value is left as `«TBD — Owner»` pending the Owner's decision.*
