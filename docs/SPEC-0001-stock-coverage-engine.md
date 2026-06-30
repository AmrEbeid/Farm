# SPEC-0001 — Stock-Coverage Intelligence Engine
Status: Draft   Owner: Amr Ebeid   Risk level: Medium   Last updated: 2026-06-18

> The product's differentiator. Defined as the first deep workstream because the wedge must be proven before the rest of the build earns investment.

## 1. Requirements (the what/why)
- **Problem:** No competitor forecasts stock **run-out against a forward operations plan** and ties it to a budget-gated purchase request (research doc 01 §3–4). Farms hit shortages mid-operation (the real Ebeid pain: standing in the field short of fertilizer).
- **Stories:**
  - *As a manager*, I want to see, when I build a plan, which inputs will run out and when — so I can order before I'm short.
  - *As a storekeeper*, I want a recommended purchase quantity and order-by date per shortage — so I don't guess.
  - *As the owner*, I want a shortage to auto-create a budget-gated purchase request — so spending stays controlled.
- **Acceptance criteria:**
  - [ ] Given on-hand, reserved, expired → computes **available** correctly.
  - [ ] Computes **reorder point** = demand-in-lead-time + safety stock; safety stock supports fixed and `Z·σ·√L`.
  - [ ] Runs the **time-phased Projected Available Balance (PAB)** per item×location and flags the **first period where PAB < 0** (and an earlier warning at `< safety_stock`).
  - [ ] Emits **coverage days** + **projected stock-out date**; flags when coverage < lead time.
  - [ ] Produces a **purchase recommendation** = shortfall + safety stock − scheduled receipts, rounded to pack/MOQ, with order-by date.
  - [ ] Reserving stock for an approved plan reduces **available** but not **on_hand**; executing flips reserved → issued.
  - [ ] Arabic-first output string.
- **Non-goals (out of scope):** full BOM/MRP-II explosion; demand forecasting/ML; multi-echelon; actually placing orders (that's the purchase-request/approval workstream, SPEC later).

## 2. Design (the how)
- **Approach (link: 03-architecture §4):** a Postgres function over the append-only event/movement stream + a materialized `inventory_bin` snapshot per item×location. Formulae: `ROP=d̄·L+SS`; `SS=Z·σ·√L` (Z: 1.28/1.65/2.33); `Available=on_hand−reserved` (**ENGINE-C1**: expiry is already netted into `on_hand` — the reconciliation oracle counts an `expiry` movement as a negative quantity — so it must **NOT** be subtracted again here; the `−expired` term was removed at migration `0010` and re-adding it would double-count); PAB recurrence `PAB(t)=PAB(t−1)−issues(t)+receipts(t)`. References: Oracle MRP / APICS MPS / safety-stock literature (cited in doc 03).
- **Affected areas:** `inventory_items`, `inventory_bin`, `inventory_movements`, `farm_event` (planned/reserved consumption), `suppliers` (lead time), `purchase_requests` (output). New: `fn_stock_coverage(item_id, location, horizon)`.
- **Test strategy (define checks FIRST — Verification Stack):**
  1. **Correctness unit tests** on the math: the worked example must reproduce (on_hand 300, need 500/wk, lead 5d, 95% → SS≈74, PAB(1)=−200, coverage≈4.2d<5d, recommend ~300kg). Edge cases: zero demand, on_hand ≥ requirement, lead time > horizon, expired stock netting, multiple receipts.
  2. **Reconciliation check:** Σ(movements) per item×location == `inventory_bin.on_hand` (the snapshot never drifts from the ledger).
  3. **Behaviour/contract:** approving a plan reserves; executing issues; `available` and `on_hand` move correctly end-to-end.
  - **Rule:** the check is the oracle — never weaken a test to make the engine pass.

## 3. Tasks (small, reviewable slices)
- [ ] T1 — Schema: `inventory_items`/`bin`/`movements` + indexes (risk Medium; items: those tables; checks: migration applies, RLS denies cross-org). → tracker Stage 5.
- [ ] T2 — `fn_stock_coverage` pure-calc core + **unit tests written first** (risk Medium; check: worked-example + edge cases pass).
- [ ] T3 — Reservation/issue flow on plan approve/execute (risk Medium; check: behaviour test).
- [ ] T4 — Purchase-recommendation output + Arabic string (risk Low; check: snapshot of the recommendation object).
- [ ] T5 — The coverage UI screen (the live sim already prototyped in `farm-os-prototype.html`) wired to the function (risk Low).

## Risks & mitigations
- **Wrong recommendation → wasted/late purchase** → unit tests are the gate; independent review of the math before it ships.
- **Bin snapshot drifts from ledger** → reconciliation check in CI; rebuild-from-ledger function as fallback.
- **σ/lead-time data sparse early** → default to fixed-days safety stock until variance data exists (documented default).

## Decisions log
- 2026-06-18: Build engine as in-DB Postgres function (not app-layer) so it's reusable by API + AI assistant RPC and close to the data. Start safety stock = fixed-days; upgrade to `Z·σ·√L` when data allows.
- 2026-06-26 (#156, recommended): the ENGINE-DC disjointness guard is **accepted item-scoped + horizon-blind for MVP-0**. The multi-PO over-block is genuinely fixed via `fn_post_receipt`'s trusted-path GUC bypass (migration `0029`, pgTAP `30`); the **horizon-blind** over-block is only *masked* by migration `0030`'s INSERT-lockdown (no client-reachable manual-receipt path), **not corrected in logic**. Dependency to record: if `0030` is relaxed or a privileged/manual-receipt path is added, the horizon-blind over-block returns. The proper quantity+horizon-aware fix (and retiring the forgeable `app.posting_receipt` GUC bypass) is **deferred to [`SPEC-0009`](SPEC-0009-goods-receipt-partial-receipts.md)** (partial receipts), to which #156 is coupled.
