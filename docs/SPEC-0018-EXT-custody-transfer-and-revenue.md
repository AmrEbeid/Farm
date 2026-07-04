# SPEC-0018-EXT — Custody holder transfer, payment-request reporting, and revenue-with-pending-price

*Status: **DRAFT plan for Owner review — not a build authorization.** Produced against the Owner's restated
operating model (farm-manager custody float, accountant-prepared payment requests, owner approval + funds-received
step, and a Barhi/dates revenue model with delivery-before-price). Reconciles with, and does not duplicate,
[`SPEC-0018-custody-and-payment-requests.md`](SPEC-0018-custody-and-payment-requests.md) (the built custody/request
spec), [`SPEC-0004-accounting-and-pnl.md`](SPEC-0004-accounting-and-pnl.md) (the accounting/P&L design), and
[`ROADMAP-accounting-custody-2026-07-01.md`](ROADMAP-accounting-custody-2026-07-01.md) (the sequenced Slice A→D
market-driven roadmap). This document does not replace the roadmap's sequencing — it is the missing detail inside
Slice A/B for three gaps the roadmap named but did not fully specify: (1) multi-holder custody transfer, (2) the
payment-request report/PDF and other statement exports, (3) revenue/sales with a price finalized after delivery.*

> **Post-wave-3 cross-references (2026-07-02):** (a) `FINANCE-ACCOUNTANT-360-2026-07-02.md` gap #1 — the expense
> payment-routing UI is unwired — is a **prerequisite** for any flow in this spec that assumes expenses reach the
> custody/request pipeline from the app; build it first. (b) The revenue model in §3 must carry a **crop dimension
> from day one** (intercropping fact, issue #595 — seasonal cash crops like بنجر are sold alongside dates). (c) The
> «sold on the tree» (بيع على النخيل) outcome from `RESEARCH-ops-workflow-egypt-2026-07-02.md` §(a)3 belongs in the
> same revenue model as a first-class sale type.

*Author: autonomous docs/planning session, Owner: Amr Ebeid. Slice 1 is implemented in
`20260701480000_custody_transfer`. Slices 3/4 are implemented by
`20260701490000_custody_reports` and `/finance/custody-reports`. Slice 5 revenue/A-R backend is implemented by
`20260701500000_revenue_sales`. PDF export and revenue reports remain future slices.*

---

## 0. What is already live (do not rebuild — verified against `main` @ `a0e7337`)

This section is the ground truth this plan was built against, so the reader does not have to re-derive it.

**Custody + payment-request lifecycle (SPEC-0018, PRs #468/#474/#568):**
- `custody_accounts` — one row **per holder** (`holder_label` free text, e.g. "مدير المزرعة" / "المحاسب";
  optional `holder_user_id`; `target_float`). Multiple holders already modeled — this is not a gap.
- `custody_movements` — append-only, one-sided (`amount_in` xor `amount_out`), `movement_type` free text
  (`استلام عهدة` / `تسليم` / `صرف نقدي` / `رد` / `تسوية` are the documented conventions, but **`تسليم`
  (handover) is not a distinct enforced flow** — see Gap 1 below). Balance is always derived
  (`fn_custody_balance` = Σin − Σout), never stored.
- `expenses.payment_status ∈ {paid_from_custody, post_paid_unpaid, paid_by_owner, cancelled}`,
  `expenses.kind ∈ {operating, drawing, capex}` (the drawings/opex non-negotiable #6, enforced structurally —
  routed to distinct accounts `5000`/`3100`/`1500` via `fn_account_for_expense_kind`, not just filtered in a
  report).
- `payment_requests` (draft → submitted → approved_operational → approved_final → paid → closed),
  `payment_request_lines` (one row per expense in a request; carries settlement fields `paid_at`, `paid_by`,
  `paid_from_custody_account_id`, `custody_movement_id`, `journal_entry_id`).
- `payment_request_fundings` — owner transfer into custody **before** any payout, exactly the Owner's step 6.
- `fn_payment_request_totals` derives: `operating_unpaid` / `capex_unpaid` / `drawing_unpaid` /
  `post_paid_unpaid` / `target_float` / `current_custody` / `custody_top_up` / `gross_request` /
  `approved_*` snapshots / `owner_funding_received` / `request_cash_out` / `remaining_to_fund` / `net_request`.
  **This already computes almost everything the Owner's step-4 payment-request content list asks for** except
  "opening custody balance per holder" as an explicit period-scoped figure and "requested funding destination"
  (see Gap 2/3).
- Lifecycle RPCs: `fn_create_payment_request`, `fn_add_expense_to_request`, `fn_submit_payment_request`,
  `fn_approve_request_operational`, `fn_approve_request_final` (owner-only), `fn_record_payment_request_funding`,
  `fn_confirm_request_expense_paid`, `fn_close_payment_request`. All SECURITY DEFINER, RLS + `authorize()`-gated,
  audited.
- Frontend: `/custody` dashboard + `/custody/request/[requestId]` printable 360 page with lifecycle buttons and
  signature blocks (no PDF export yet — see Gap 2).

**Accounting kernel (SPEC-0004 §3.1, PR #568):**
- `accounts` (chart of accounts, org-scoped, currently **0 real rows** — lazily created by
  `fn_ensure_account`/`fn_account_for_expense_kind`; draft chart proposed in
  [`DRAFT-chart-of-accounts-date-palm.md`](DRAFT-chart-of-accounts-date-palm.md), not yet ratified).
- `journal_entries` / `journal_lines` — double-entry, `journal_lines_balance_guard` deferred constraint trigger
  makes an unbalanced entry a hard Postgres error (BR-116), `fn_post_two_line_journal` posts idempotently per
  `(org, source_type, source_id)` (BR-117), one-sided lines (BR-118).
- `fn_accounting_trial_balance` — owner/accountant-only cash trial balance; `/accounting` shows it + recent
  journals.
- Cash-method discipline is already correct: unpaid/debt expenses (`post_paid_unpaid`) sit outside the journal
  until `fn_confirm_request_expense_paid` posts the entry — **the Owner's non-negotiable #7 ("unpaid expenses
  must NOT hit P&L before cash payment") is already the built behavior**, not a gap.

**What is empty/absent (confirmed by grep, not assumed):**
- No `sales` table exists anywhere in the migrations. Revenue/A-R is genuinely greenfield (matches the roadmap's
  Slice A finding).
- Holder-to-holder custody transfer is implemented by `fn_transfer_custody` (`20260701480000_custody_transfer`):
  one linked out/in pair through `custody_movements.transfer_group_id`, no journal/P&L effect, balance floor.
- No PDF export exists for `/custody/request/[requestId]`; it is a printable HTML 360 page only (Gap 2).
- `accounts` has zero rows in prod (confirmed by the roadmap's live-data audit) — Slice A is blocked on the
  Owner/accountant ratifying the chart before any real posting.

**Conclusion:** the Owner's restated operating model in this task is **~80% already built** by SPEC-0018 +
SPEC-0004's cash-method slice. The concrete, currently-unbuilt gaps are: (Gap 1) an explicit, atomic
holder-to-holder custody transfer RPC; (Gap 2) payment-request PDF/print upgrade + the additional report set
(custody ledger by holder, cash expenses, unpaid/debt obligations, owner funding/replenishment); (Gap 3) the
revenue/sales workflow with delivery-before-price; (Gap 4) role-based dashboards + filter/sort/export/import
parity for finance tables, per the Owner's "every team member gets a role-based view" ask; (Gap 5) the chart of
accounts is drafted but not ratified, which blocks Slice A regardless of this plan.

---

## 1. Reconciling the Owner's restated flow to what exists

Walking the Owner's numbered flow against the built system:

1. **"Owner funds the farm manager's custody (~25-30K EGP/period)."** — Built: `fn_record_custody_movement` with
   `movement_type = 'استلام عهدة من المالك'` posts Dr `1000` custody / Cr `3000` owner funding automatically
   (`20260701220000` §5). Matches exactly.
2. **"Farm manager may pay cash directly, or hand custody cash to the accountant."** — Partially built: paying
   directly is `fn_set_expense_payment_status('paid_from_custody', <farm-manager's custody_account_id>)`. Handing
   cash to the accountant (a holder-to-holder transfer) has **no dedicated RPC** — this is Gap 1.
3. **"Accountant records expenses: cash paid (either custody), unpaid/debt, labor cash payouts, supplier
   purchases, capex, owner drawings (always separate)."** — Built: `expenses.kind`/`payment_status` already
   distinguish all of these; `kind='drawing'` is structurally routed to `3100` and excluded from opex (#6).
   "Labor cash payouts" and "supplier purchases" are just `expenses` rows with different `category`/`supplier_id`
   — no new table needed, confirmed against the existing `expenses` schema (migration `0007`).
4. **"Accountant prepares a payment request showing: opening custody balance per holder, custody received,
   cash expenses paid (by holder), unpaid/debt awaiting funding, requested replenishment, requested funding
   destination, total transfer required, attached proofs, approval/signature trail."** — Mostly built via
   `fn_payment_request_totals` + the request 360 page's lifecycle/signature blocks. Missing: **per-holder
   breakdown** (today's totals are per-request, not split by which custody account paid what), **attached
   proofs** (SPEC-0018 §9 already flags receipt/proof capture as a later gap — unchanged), and a **PDF export**
   (Gap 2).
5. **"Owner reviews and approves/rejects inside the system."** — Built: `fn_approve_request_operational` /
   `fn_approve_request_final`. Rejection is not modeled as a first-class state (only forward transitions exist)
   — flagged as a small owner decision in §6.
6. **"After approval + transfer, accountant records owner funds as custody FIRST, then confirms payouts from
   the selected source."** — Built exactly this way: `fn_record_payment_request_funding` (Dr custody / Cr owner
   funding) must run before `fn_confirm_request_expense_paid` can move a line to `paid` (the RPC checks
   `status in ('approved_final','paid')`). This is the Owner's most specific instruction and it is **already
   enforced in the schema**, not just a UI convention.
7. **"Cash-method: unpaid/debt expenses stay pending, must NOT hit P&L before cash payment."** — Built: confirmed
   by reading `fn_confirm_request_expense_paid` — the journal only posts at payout confirmation, never at
   request-line creation.

**Net finding:** the custody/payment-request half of the Owner's model needed almost no new design — it needed
(a) the holder-transfer RPC, (b) reporting/PDF polish, and (c) role-based views. The revenue half (buyers,
delivery-before-price, receivables) is genuinely new and is the largest real design gap — §4 below.

---

## 2. Gap 1 — Custody holder-transfer flow (small, real gap)

**Problem solved by slice 1:** "farm manager hands cash to the accountant" used to require two independent
`fn_record_custody_movement` calls (`amount_out` from the farm-manager account, `amount_in` to the accountant
account) with no guarantee the amounts match, no atomicity, and no `source_type` link between them for the
journal (a transfer between two custody accounts should **not** hit the P&L at all — it's an internal
reclassification of cash location, not income/expense — and today nothing prevents someone from also posting it
through `fn_ensure_account`/`fn_post_two_line_journal` as if it were owner funding, which would double-count
against `3000`).

**Implemented design (`20260701480000_custody_transfer`):**
- New RPC `fn_transfer_custody(p_from_account, p_to_account, p_amount, p_occurred_at, p_note)`:
  - both accounts same org, both active, `p_from_account <> p_to_account`.
  - gated `custody.write` (same as `fn_record_custody_movement`).
  - `amount <= fn_custody_balance(p_from_account)` (cannot hand over cash that isn't there — a hard error, not a
    warning, mirroring the engine's "never mask a shortage" discipline applied to cash).
  - inserts **two** `custody_movements` rows in one transaction: `amount_out` from source, `amount_in` to
    destination, both `movement_type = 'تحويل عهدة'`, and a new `transfer_group_id`
    shared reference) linking the pair so a report can show it as one handover, not two unrelated movements.
  - **No journal entry.** A custody-to-custody transfer moves cash between two internal float holders; it is
    not owner funding and not an expense, so it must not touch `accounts`/`journal_entries` at all — this is the
    key correctness property to test (see §7 acceptance tests).
- This is additive: no existing table/RPC changes, no data migration risk. Independently reviewable as a single
  small PR (one migration + one pgTAP file + one server action + one form).

## 3. Gap 2 — Payment-request PDF/report upgrade + the report catalog

**Problem:** `/custody/request/[requestId]` is a printable HTML page (browser print-to-PDF works today) but the
Owner's flow describes a document that gets handed/sent for approval and archived — worth a proper PDF export,
and the Owner listed several reports that don't exist as dedicated views yet.

**Design notes (not yet built):**
- **PDF export for the payment request** — reuse the existing `/custody/request/[requestId]` server-rendered
  data (no new query logic) and generate a PDF server-side. Prefer a lazy-loaded PDF library only in a server
  action/route handler (never a static top-level import into client code — the zeal-core-os OOM lesson applies
  here too: `@react-pdf/renderer` or a headless-print approach, evaluated at implementation time, not decided
  here since library choice is a "new dependency" hard-stop requiring Owner approval per `docs/CLAUDE.md`).
- **Report set to design (each a read-only RPC + a page, reusing `MasterTable`/`FilterableTable` +
  `exportToCsv`, per the established convention — no new table component):**
  1. *Custody ledger by holder* — `custody_movements` filtered/grouped by `custody_account_id`, with opening
     balance (Σ before period start) + period movements + closing balance. This directly answers the Owner's
     "opening custody balance per holder" ask from step 4.
  2. *Cash expenses report* — `expenses` where `payment_status = 'paid_from_custody'`, split by holder (via the
     linked `custody_movements.custody_account_id`) and by `kind`.
  3. *Unpaid/debt obligations report* — `expenses` where `payment_status = 'post_paid_unpaid'`, aged by
     `date` (30+ days highlighted, matching the Owner's "due later, 30+ days" framing), whether or not yet on a
     request.
  4. *Owner funding + custody replenishment report* — `payment_request_fundings` joined to `payment_requests`,
     showing requested vs received vs remaining (`fn_payment_request_totals` already computes remaining —
     this report is mostly a filtered/exported view over data that already exists).
  5. *Revenue by buyer/crop/season* and *A/R by buyer* — depend on Gap 3 (revenue does not exist yet).
  6. *P&L excluding owner drawings* — depends on Slice A of the existing roadmap (chart of accounts + P&L RPC);
     already designed there, not re-designed here.
  7. *Budget vs actual* — depends on Decision-0157 (owed by the Owner) + Slice A's "roll the ledger up by
     category" step; already tracked, not re-designed here.
- All of the above are **read-only RPCs** (`stable`, `finance.read`-gated) returning the same shape convention as
  `fn_accounting_trial_balance`/`fn_payment_request_totals` (a single `jsonb` or a `jsonb_agg` of rows), so the
  frontend pattern is uniform and reviewable.
- Every report table gets filter/sort (already free via `FilterableTable`/`MasterTable`) + CSV export
  (`exportToCsv`, already free) as a checklist item per report — no new export mechanism needed.

## 4. Gap 3 — Revenue / sales with delivery-before-price (the real new design)

This was genuinely new before S-10: no `sales` table, no buyer/customer entity, and no price-pending concept
existed. The S-10 backend migration `20260701500000` implements that first revenue/A-R foundation. It extends
SPEC-0004's planned `sales` table with the specific mechanic the Owner described: **delivery can happen before the
price is finalized.**

### 4.1 Implemented schema (S-10 backend — mirrors the expenses/custody pattern)

- `buyers` (org-scoped): `id, org_id, name, buyer_type ∈ {cash_customer, trader, company}, contact info,
  active`. Cash customers may not need a persistent row (a "walk-up" pseudo-buyer is acceptable), but traders and
  companies — who carry receivables — need one for A/R rollup.
- `sales` (org-scoped, mirrors `expenses`' shape for symmetry): `id, org_id, date, farm_id, sector_id, hawsha_id,
  crop, season, buyer_id, qty, unit, unit_price, total, price_status ∈ {pending, finalized}, delivery_date,
  price_finalized_at, payment_status ∈ {unpaid, partially_collected, collected}, notes`.
  - `unit_price`/`total` are **nullable while `price_status = 'pending'`** — this is the core mechanic. A
    delivery event can create a `sales` row with `qty` and `crop`/`season`/`buyer_id` populated and
    `unit_price = null`, `total = null`, `price_status = 'pending'`. This must render as an honest "السعر لم
    يُحدد بعد" (price not yet set) in any UI/report, **never as a fabricated 0** — this is the same
    non-negotiable #1 violation class the app has already fixed elsewhere for unknown costs (see
    `apps/farm-os/lib/money` honest-null handling, SESSION-BRIEF 2026-06-30 "#484... unknown/null/invalid
    values preserved").
  - `fn_finalize_sale_price(p_sale, p_unit_price)` — the only path to set `unit_price`/`total` and flip
    `price_status` to `finalized`; posts the revenue journal (`Dr 1200 A/R · Cr 4000 sales revenue`) only
    at this point, via the existing `fn_post_two_line_journal`, keyed `source_type = 'sale'`. **A pending-price
    sale never touches the ledger** — mirrors the cash-method discipline already applied to unpaid expenses
    (Owner's non-negotiable #7, extended symmetrically to revenue).
- `sale_collections` (org-scoped): `id, org_id, sale_id, amount, occurred_at, collected_by, note` — supports
  **partial collections** for trader/company receivables (a sale can be finalized in price but collected over
  multiple payments). The RPC rejects any `Σ(collections) > sale.total`; `payment_status` is refreshed from the
  collection sum (`unpaid` / `partially_collected` / `collected`) while no running balance is stored.
- All writes are RPC-only. The backend deliberately reuses existing `budget.write` (owner/accountant) instead of
  adding a new `sale.write` permission, avoiding an `authorize()` re-emit. Reads are `finance.read`; tables have
  FORCE RLS, direct DML revoked, and audit triggers.

### 4.2 Reports enabled
- Revenue by buyer/crop/season (group `sales` by `buyer_id`/`crop`/`season`, excluding `price_status='pending'`
  rows from revenue totals but still listing them as "pending price" line items — never silently dropped).
- A/R report for trader/company sales: `total − Σ(collections)` per buyer, aged by `delivery_date`.
- Profitability by crop/season needs Slice B's cost-dimension work (already scoped in the roadmap) joined to
  this revenue table — not re-designed here, just noted as the dependency the roadmap already tracks.

### 4.3 Why this is scoped as its own slice, not bundled into Slice A
SPEC-0004's Slice A already plans "`sales` + A-R" as its first line item. This section is that design filled in
with the delivery-before-price mechanic the Owner specified, which the original SPEC-0004 draft did not yet
have (it assumed price-at-sale). No conflict — this is the detail SPEC-0004 Slice A was missing, not a
competing plan.

---

## 5. Staged implementation plan (each slice independently shippable + reviewable)

Numbering continues from the existing roadmap's Slice A/B/C/D so both documents stay addressable together.
Every slice: one SPEC/plan-confirmed scope → independent review (money logic) → migrate-first → Owner-gated
merge/apply, per `docs/CLAUDE.md`. None of these are authorized to build by this document alone.

| # | Slice | Scope | Depends on | Risk |
|---|---|---|---|---|
| 1 | **Custody holder-transfer RPC** (Gap 1) | **Implemented:** `fn_transfer_custody` + pgTAP proving no-journal-effect + amount-can't-exceed-balance + atomic pair | none — additive | Low-med (money, but small + isolated) |
| 2 | **Payment-request PDF export** (Gap 2a) | Server-side PDF generation from existing request-360 data; no new query logic | Owner approval of a PDF library (new dependency = hard stop) | Low (presentation only) |
| 3 | **Custody ledger + cash-expense + unpaid-obligations reports** (Gap 2b, items 1-3) | **Implemented:** 3 read-only RPCs + one dense `/finance/custody-reports` page using `FilterableTable` + CSV export | none — reads existing tables | Low (read-only) |
| 4 | **Owner funding/replenishment report** (Gap 2b, item 4) | **Implemented:** 1 read-only RPC + `/finance/custody-reports` section over `payment_request_fundings` | none | Low (read-only) |
| 5 | **Revenue/sales schema + finalize-price + collections** (Gap 3, §4.1) | **Implemented:** `buyers`, `sales`, `sale_collections` tables + RPCs; **no chart-of-accounts dependency for the pending-price case** (a pending sale posts nothing). Finalization uses default `1200`/`4000` accounts through `fn_ensure_account`; trusted P&L still needs the real chart mapping later. | Existing accounting kernel (`fn_post_two_line_journal`) | High (new money-adjacent schema; independent review required) |
| 6 | **Revenue reports** (Gap 3, §4.2) | Revenue-by-buyer/crop/season + A/R report | Slice 5 | Low (read-only, once 5 exists) |
| 7 | **Role-based dashboards + filter/sort/export/import parity** (Gap 4) | Extend existing per-module dashboards (already largely live per SESSION-BRIEF) to explicitly cover finance/custody/revenue tables with the same filter/sort/export pattern; author `ImportDescriptor`s for `buyers`/`sales` once Slice 5 lands, per `docs/CLAUDE.md` "bulk-import descriptors" rule | Slice 5 for revenue; custody/expense import descriptors could start now | Low-med (many small touches) |
| — | **Accounting-kernel integration** | Not a new slice — this plan explicitly defers to the existing roadmap's Slice A (P&L/balance-sheet/period-close) and Slice B (cost dimensions). Slices 5/6 above are designed to plug into that same kernel (`fn_post_two_line_journal`, `journal_lines` dimension FKs) rather than inventing a parallel ledger. | Roadmap Slice A | — |

Recommended order after slice 1: **3 → 4 → 2 → 5 → 6 → 7**, i.e. do the cheap read-only reports next,
hold the PDF export until a library is approved, and treat revenue reports (Slice 6) as the next review-heavy
step after the S-10 backend is live.

---

## 6. Owner decisions needed (exact, not invented)

1. **Does the farm manager get direct finance access, or does the accountant record custody movements on the
   farm manager's behalf only?** This is the single decision SPEC-0018 §6 already flagged as explicitly
   deferred ("Farm-manager finance access was intentionally not shipped... requires a separate owner-ratified
   scope decision"). The Owner's restated flow ("farm manager may pay cash expenses directly") implies the farm
   manager at minimum needs to *trigger* a `paid_from_custody` recording — but does that mean:
   (a) the farm manager gets `custody.write`/`budget.write` in the app directly, or
   (b) the farm manager pays cash in the field and *tells* the accountant, who is the only one who ever touches
   the app for money?
   This changes the RLS/`authorize()` role grants materially. Slice 1 deliberately did **not** broaden access:
   owner/accountant records the handover for the physical farm-manager holder.
2. **Custody handover semantics** — when the farm manager "hands custody cash to the accountant," is that always
   a full handover of the float, or partial? Does the farm manager's custody account's `target_float` reset to 0
   after a full handover, or stay as a standing entitlement the owner re-funds independently? Affects whether
   Slice 1 implements a partial-or-full amount transfer and leaves `target_float` unchanged.
3. **Rejection/return states** — the Owner's step 5 says "owner reviews and approves/rejects." Today's lifecycle
   only has forward transitions (draft → ... → approved_final); there's no `rejected` state or "send back to
   accountant with a note" flow. Does the Owner want an explicit reject-with-reason state, or is "don't approve,
   discuss offline, accountant edits the draft" sufficient for now?
4. **Buyer identity for cash customers** — do walk-up cash buyers need a persistent `buyers` row (for repeat-
   customer history) or is an unlinked "نقدي" sale sufficient? Affects whether `buyers.buyer_type='cash_customer'`
   rows are ever created, or `sales.buyer_id` is nullable for cash sales.
5. **Sale write permission** — resolved for S-10 backend: reuse `budget.write` (owner/accountant) and do not add a
   separate `sale.write` permission until a real third revenue-entry role exists.
6. **PDF library selection** — adding any dependency is a hard stop per `docs/CLAUDE.md` ("Adding dependencies,
   tools, or integrations" requires explicit approval). No library is chosen in this plan; the Owner (or whoever
   implements Slice 2) must approve one before that slice starts.
7. **All decisions already on record and unchanged by this plan** — the chart of accounts ratification, the
   ETA e-invoicing legal determination, and Decision-0157's budget cap policy remain exactly as scoped in the
   existing roadmap/SPEC-0004/DECISION-0157 docs. This plan does not reopen or restate them beyond noting where
   they gate a new slice (Slice 5 needs at least the chart's revenue accounts).

---

## 7. Acceptance tests + pgTAP coverage plan (define-the-check-first, before any implementation)

Every invariant below must have a failing/passing pgTAP test authored **before** the implementing migration, per
`docs/CLAUDE.md` ("Define the check first"). Numbers are illustrative slots, not final test-file numbers (the
actual next-available test number is chosen at implementation time against current `main`).

**Custody transfer (Slice 1):**
- A transfer moves `amount` from the source account's derived balance and adds it to the destination's; the
  sum of both balances before and after is unchanged (conservation of cash — the same "over-order is safe,
  under-report is not" spirit applied to money: a transfer must never manufacture or destroy cash).
- A transfer **creates zero rows** in `journal_entries`/`journal_lines` (it is not a P&L event) — an explicit
  test asserting the journal table row count is unchanged after the RPC call.
- A transfer for more than the source account's current balance is rejected (hard error), never silently
  clamped.
- A transfer between accounts in different orgs is rejected (cross-org invariant, same pattern as every other
  RPC in this file).
- Two custody_movements rows are created per transfer, linked (via a shared reference), both auditable.

**Reports (Slices 3/4):**
- Every report RPC is `finance.read`-gated: a `supervisor`/`farm_manager`-only session gets `forbidden`, not
  empty data (the difference matters — empty-but-allowed silently looks like "no expenses" instead of "you can't
  see this," a data-honesty issue).
- Custody-ledger-by-holder opening balance for period N equals the closing balance of period N-1 (continuity
  test) — proves the report can't silently drop movements at a period boundary.
- Cash-expenses report total reconciles to `Σ(expenses.total) where payment_status='paid_from_custody'` computed
  directly (no drift between the report and the base table).
- Unpaid/debt report never shows a `post_paid_unpaid` expense as "paid" and never shows a `paid_from_custody`
  expense in the unpaid bucket (no double-bucketing).

**Revenue / sales (Slice 5) — the highest-stakes new logic:**
- A `sales` row with `price_status='pending'` can be created with `unit_price`/`total` both null, and **posts no
  journal entry** — an explicit test that `journal_entries` row count is unchanged after inserting a pending
  sale.
- `fn_finalize_sale_price` on a pending sale sets `unit_price`/`total`/`price_status='finalized'` and posts
  exactly one balanced journal entry (`Σdebit=Σcredit`, reusing BR-116's existing guard — no new balance logic
  needed, just a new caller).
- `fn_finalize_sale_price` is idempotent per sale (calling it twice does not double-post) — same
  `(org, source_type, source_id)` uniqueness `fn_post_two_line_journal` already provides; test that the second
  call either errors or is a no-op, never a second journal entry.
- `fn_finalize_sale_price` cannot be called on an already-finalized sale (immutability, mirroring
  `expense_guard_routed_money_immutable`'s "routed money is immutable, use a reversal" rule).
- `Σ(sale_collections.amount) <= sales.total` is enforced at the DB level (check constraint or trigger, not
  just app validation) — a collection that would over-collect a sale is rejected.
- `sales.payment_status` derived state (`unpaid`/`partially_collected`/`collected`) is never stored out of sync
  with `Σ(collections)` — test by inserting a partial collection and asserting the derived read reflects it
  without a separate "recompute" step (same "always derive, never store a running total" pattern as
  `fn_custody_balance`).
- **Non-negotiable #1 test:** a pending-price sale's `total` is never rendered/exported as `0` anywhere in a
  report — assert the money-formatting helper's null-preservation behavior is applied to the new revenue path,
  not just the existing cost paths (`apps/farm-os/lib/money` already has this convention; a Vitest asserting the
  new report component uses it, not a raw `??  0`).
- **Non-negotiable #6 test (extended to revenue):** revenue reports and P&L never include a `price_status =
  'pending'` sale's (null) total in a summed figure, but the row **is still listed** as a pending-price line
  item — proving the system reports honestly ("we delivered dates worth an unknown amount") rather than either
  fabricating a number or hiding the delivery.
- RLS: a non-owner/non-accountant role cannot read `sales`/`buyers`/`sale_collections` (same confidentiality
  posture as every other finance table — reuse the exact `tenant_read` policy shape from `custody_accounts`).
- Cross-org FK safety on every new table (`org_id` check on every FK'd row before insert, matching the pattern
  in `fn_record_custody_movement`/`fn_add_expense_to_request`).

**General regression guard for this whole extension:**
- `tests/97_authorize_perms_complete_test.sql`-style completeness check extended to cover any new permission
  (`sale.write` if introduced) so the `authorize()` re-emit footgun (documented in the farm-os skill) cannot
  silently drop it in a later migration.
- Full local pgTAP suite (`bash apps/farm-os/supabase/test-shims/run-pgtap-local.sh`) must stay green after each
  slice — no slice merges with a broken existing test.

---

## 8. Non-negotiables carried into every slice (unchanged, restated for this doc's scope)

- Never fabricate financial data — a pending-price sale is reported as "price not yet set," never as 0 or
  omitted.
- Arabic-RTL first; all new UI copy in Arabic, matching existing custody/payment-request page conventions.
- Owner drawings always separate from operating expenses — already enforced structurally
  (`fn_account_for_expense_kind`); no new slice may weaken this.
- Reuse `MasterTable`/`FilterableTable`/`exportToCsv`/`ImportDescriptor` patterns exactly; no new table/export
  component invented for these reports.
- RLS never bypassed; every new table gets `FORCE ROW LEVEL SECURITY` + deny-by-default + RPC-only writes,
  matching `custody_accounts`/`custody_movements`/`payment_requests` exactly.
- Money logic (Slices 1, 5 especially) requires **independent review** before merge — flagged explicitly for
  whoever implements each slice, per `docs/CLAUDE.md` "Independent review required... money/voucher/budget
  logic."
- No real email/WhatsApp sent externally; the approval workflow stays internal-only, as already built.
- No migration is applied and no deploy happens as part of this planning document.

---

## 9. Implementation performed under this task

**Slice 1 implemented:** `20260701480000_custody_transfer` adds `custody_movements.transfer_group_id` and
`fn_transfer_custody(p_from_account, p_to_account, p_amount, p_occurred_at, p_note)`. The UI adds
**تحويل عهدة** on `/custody`. The test `119_custody_transfer` proves the transfer writes exactly two linked
movements, conserves total custody cash, rejects over-transfer/self-transfer/cross-org transfer, keeps
farm-manager direct finance access closed, and creates no journal entry.

**Slices 3/4 implemented:** `20260701490000_custody_reports` adds
`fn_custody_ledger_report`, `fn_custody_cash_expense_report`, `fn_unpaid_obligations_report`, and
`fn_owner_funding_report`. `/finance/custody-reports` gives the accountant period filters, KPI totals,
search/sort/export tables, and links back to the related expense or payment request. The test
`120_custody_reports` proves finance-read gating, holder opening/closing balances, cash-expense holder split,
unpaid aging, owner-funding remaining amount, and non-finance denial.

**Slice 5 implemented:** `20260701500000_revenue_sales` adds `buyers`, `sales`, `sale_collections`,
and the RPCs `fn_save_buyer`, `fn_save_sale`, `fn_finalize_sale_price`, and `fn_record_sale_collection`.
The test `115_revenue_sales` proves owner/accountant write gating, pending-price sales with NULL totals and no
journal, finalization posting Dr A/R / Cr revenue, partial/final collections posting Dr cash / Cr A/R,
over-collection rejection, org-bound farm dimensions, revenue RLS, and anon EXECUTE lockdown.

---

## 10. Next step

After Slice 5 is live, the next practical accounting lane is **Slice 6 revenue reports**: revenue by buyer/crop/
season, pending-price deliveries listed separately, and A/R aging. Custody polish still has **Slice 2 PDF/export
packaging** waiting on an approved PDF approach/dependency.
