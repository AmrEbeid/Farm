# ROADMAP — Accounting & Custody: market gap analysis + sequenced build plan (2026-07-01)

*Status: **DRAFT roadmap for Owner review** — not a build authorization. Synthesizes (a) an evidence-based status
audit of the shipped accounting + custody modules and (b) a verified market gap analysis, into a prioritized,
gated slice plan. Companion to [`SPEC-0004-accounting-and-pnl.md`](SPEC-0004-accounting-and-pnl.md) (accounting
design spec), [`SPEC-0018-custody-and-payment-requests.md`](SPEC-0018-custody-and-payment-requests.md) (custody
design spec), [`DECISION-0157-budget-enforcement.md`](DECISION-0157-budget-enforcement.md), and the prior
[`accounting standalone market research.md`](accounting%20standalone%20market%20research.md). Each slice below
still requires its own SPEC/plan + Owner gate before implementation — this doc sequences and justifies them, it
does not replace them.*

*Author: autonomous session, Owner: Amr Ebeid. Sources for market claims are cited inline with confidence and
caveats; do not treat vendor-marketing claims as an independent functional audit (see §8).*

---

## 1. Purpose

The double-entry accounting kernel shipped to production on 2026-07-01 (PR #568). This roadmap answers the next
question: **given what the market offers and what a MENA date-palm operation actually needs, what do we build next,
in what order, and what can we safely skip?** It exists because the finance pillar is simultaneously the
highest-value (turns operations into a P&L) and highest-integrity-risk surface — so its sequencing deserves an
explicit, evidence-backed decision record rather than ad-hoc feature additions.

The non-negotiables from [`docs/CLAUDE.md`](CLAUDE.md) hold throughout and constrain every slice: **(1)** never
fabricate financial data; **(6)** owner drawings (مسحوبات) stay separated from operating expenses in any P&L;
Arabic-RTL-first; per-farm (not per-seat) pricing; the palm registry (4,380 برحي / 299 ذكور / 28 حوش) is canonical.

## 2. What is built today (verified against code + live prod DB)

**Accounting kernel — LIVE (PR #568, migration `20260701220000_accounting_cash_custody_settlement`):**
- Double-entry general ledger: `accounts` (chart of accounts), `journal_entries`, `journal_lines`, with a
  **deferred constraint trigger `journal_lines_balance_guard`** that makes an unbalanced entry a hard Postgres
  error, and `fn_post_two_line_journal` posting idempotently per `(org, source_type, source_id)`.
- Expense classification `operating | drawing | capex` routed to **distinct accounts** (`5000` opex / `3100` owner
  drawings equity / `1500` capex asset) via `fn_account_for_expense_kind` — the drawings-vs-opex non-negotiable is
  enforced structurally, not just filtered in a report.
- `fn_accounting_trial_balance` + an owner/accountant-only `/accounting` screen; expense entry; a budgets table;
  a finance KPI dashboard and per-plan planned-vs-actual (PvA).

**Custody (عهدة) + payment-requests — LIVE, the more mature module:**
- Imprest float ledger: `custody_accounts` + append-only `custody_movements`; balance always *derived*
  (Σin − Σout via `fn_custody_balance`), never stored.
- Full monthly payment-request lifecycle (`fn_create_payment_request` → add expenses → submit → operational
  approve → final approve (owner-only) → `fn_record_payment_request_funding` → `fn_confirm_request_expense_paid`
  → `fn_close_payment_request`), with owner funds recorded **into custody first**, then payouts posting cash-out +
  the matching journal entry.
- Integrity posture: RLS FORCE + deny-by-default + RPC-only writes on every table; `custody_one_direction` CHECK;
  a partial unique index guaranteeing **one cash-out per expense**; an immutability trigger on routed money;
  claim-first concurrency on every lifecycle transition; audit triggers gated to `finance.read`.

**Live data state:** synthetic/empty (0 real expenses, 0 journal entries, 0 chart-of-accounts rows) — everything
below is gated behind the privacy-reviewed real-data path (Stage M) before real Ebeid financials are loaded.

## 3. Market gap analysis (summary; full evidence in §8)

**The market is bifurcated, and that gap is our wedge.** No surveyed vendor spans all three of {Arabic + Egyptian
ETA statutory} + {real per-feddan/per-tree farm costing} + {date-palm bearer-plant accounting}.

| Tier | Representative tools | Nails | Lacks (for us) |
|---|---|---|---|
| **Farm-costing** | Traction Ag, Harvest Profit, Conservis | Crop-year (≠ calendar-year) accounting; per-field/per-acre/per-bushel profitability + true breakeven | No Arabic/RTL, no VAT, no ETA — US/ANZ only, irrelevant to Egypt statutory |
| **MENA statutory** | Wafeq, Daftra, Qoyod | Full P&L / balance sheet (Wafeq 40+ reports), A/R + A/P, VAT, **Egyptian ETA e-invoicing**, Arabic-native; Qoyod adds per-crop/per-flock cost centers | Shallow/no farm costing; **none do bearer-plant / IAS 41** (Qoyod's IAS-41 + yield-reconciliation claims were *refuted*) |
| **Spend / petty-cash** | Zoho Expense, Alaan, Pemo, Pluto, Expensify | Receipt OCR, multi-level approvals, card issuance, reconciliation | Not farm-aware; card issuance is enterprise-bloat for a single farm |

Two structural conclusions:
1. **Our kernel-first, farm-native, Arabic/ETA-base bet is correct** — there is no off-the-shelf product that does
   what Farm OS aims to, so this is a build, not a buy-or-lose.
2. **On statutory table-stakes we are behind**, and one gap (being legally invoiceable in Egypt) may be a
   compliance blocker, not merely a feature — see §5.

## 4. Capability gap map (assessed against the shipped kernel)

Because the double-entry spine already exists, several gaps are **"extend the ledger," not greenfield** — which is
what makes the near-term slices cheap.

| Capability | Market has it | Farm OS today | Build cost for us | Verdict |
|---|---|---|---|---|
| Chart of accounts + balanced journals + trial balance | ✅ all | ✅ **shipped** (#568) | — | Done |
| Imprest custody float + approval workflow | Zoho/Pluto/Alaan | ✅ **shipped**, textbook-correct | — | Done — ahead of tier |
| Expense classification (opex/drawings/capex) | partial | ✅ shipped, structurally enforced | — | Done — ahead of tier |
| **Revenue / sales / A-R** | ✅ statutory tier | 🟡 backend implemented in `20260701500000`; reports/UI pending | Low (reports on new backend + existing kernel) | **Continue — Slice A** |
| **P&L + balance sheet + period close** | ✅ Wafeq (40+ reports) | ❌ trial-balance only | Low–med (reports over existing `journal_lines`/`accounts` + a period-lock table) | **Build — Slice A** |
| **ETA e-invoice + VAT (Egypt mandate)** | ✅ Daftra, Wafeq | ❌ none | High (external integration, e-signature, legal) | **Build/partner — Slice C, gated (§5)** |
| **Per-crop / feddan / tree cost accounting** | Qoyod (cost centers); Traction/Conservis (best) | ❌ none | Med (add a dimension to `journal_lines`, which already carries expense/custody/payment dimension FKs) | **Build — Slice B (the wedge)** |
| Budget-vs-actual tied to the real ledger | ✅ Conservis actuals-vs-plan | ❌ actuals are frozen seed numbers | Low (roll the ledger up by category — Decision-0157) | **Build — folds into Slice A/B** |
| Receipt / proof capture (+ OCR later) | ✅ Alaan/Pemo/Pluto | ❌ no attachment linkage | Low (link `attachments` to custody/expense rows) | **Build — folds into Slice A/B** |
| A-P / vendor bills + aging | ✅ Wafeq | ❌ none | Med | Slice D |
| Bank reconciliation / feeds | ✅ statutory tier | ❌ none | Med–high | Slice D (defer) |
| **IAS 16/41 bearer-plant depreciation** (depreciating palm vs fair-valued growing dates) | ❌ **nobody** (not even Qoyod) | ❌ none | High, specialized | **Slice D — defer, needs accountant** |
| Prepaid/corporate card issuance; commodity-price real-time P&L | Alaan/Pemo; Harvest Profit | ❌ | — | **Skip — bloat** |

## 5. ⚠️ The blocker to resolve before scoping ETA (Slice C)

The research **refuted** the claim that agriculture / small firms are automatically exempt from Egypt's e-invoicing
mandate — so **do not assume Farm OS is exempt.** But it equally did **not** confirm the mandate binds a date-palm
farm entity today. Whether the entity is actually obligated (and at what VAT-registration threshold) is a
determination for **the Owner's accountant / a local ETA ruling**, not a market source. That answer decides whether
ETA e-invoicing is urgent (pull Slice C forward) or deferrable (leave it after Slices A/B). This is the single
highest-leverage open question and aligns with the existing expert-sign-off gates (#366/#368) and Stage M.

Egyptian ETA e-invoicing is a real legal framework (Decree 188/2020 + 554/2021): VAT-registered businesses must
pre-register before issuing invoices, apply an e-signature stamp per invoice, and calculate VAT; penalties up to
EGP 50,000. It is solved today by Arabic-native SME tools **Daftra** and **Wafeq** — which raises the
build-vs-partner question in §7.

## 6. Prioritized roadmap (sequenced slices)

Each slice is independently gateable and stops at its gate; **do not auto-advance** (PROJECT RULES). Every slice
carries financial-integrity risk → each needs its own SPEC/plan + independent review + the acceptance oracle before
merge, and real-data reconciliation is Stage-M gated.

### Slice A — Statutory reporting completion *(cheap on the existing kernel; highest near-term value)*
- **Scope:** (1) Revenue/sales + A-R — backend tables/RPCs are implemented in `20260701500000`, and revenue
  by buyer/crop/season, pending-price delivery listing, and A/R aging are implemented in `20260701510000`; next is close/period lock plus P&L/balance sheet report RPCs grouped by `account_type` over the
  existing `journal_lines`/`accounts` (same shape as `fn_accounting_trial_balance`); (3) a period close/lock
  (`accounting_periods` + a lock check in the posting RPCs); (4) fold in **budget-vs-actual** by rolling the real
  ledger up by category, closing Decision-0157's "frozen seed numbers" gap.
- **Why it matters:** P&L/balance sheet are table-stakes everywhere; now *inexpensive* for us because the journal
  spine exists. Unblocks SPEC-0004's dual-run reconciliation oracle. The P&L must exclude owner drawings
  (non-negotiable #6 — already structurally routed to `3100`).
- **Gates:** the real chart of accounts must be seeded (Owner/accountant supplies it — currently 0 rows); no
  fabricated figures (non-negotiable #1); real-data reconciliation is Stage M.
- **Acceptance oracle:** one closed season's system totals reconcile to the 7-year Ebeid Excel workbook
  (SPEC-0004 §1 bar), drawings excluded from operating P&L.

### Slice B — Farm cost dimensions *(the differentiator / wedge)*
- **Scope:** add a farm dimension (crop / season / plan / hawsha / tree) to `journal_lines` — architecturally the
  same pattern `journal_lines` already uses for its expense/custody/payment dimension FKs — and build per-feddan /
  per-tree profitability reports (revenue − allocated cost per unit) in Arabic-RTL, tied to the canonical palm
  registry and `plans`/`plan_operations`.
- **Why it matters:** this is what no MENA-statutory competitor does well (Qoyod = cost centers only, no bearer
  plants) and what makes Farm OS *farm* software rather than generic accounting. It is the defensible wedge.
- **Gates:** depends on Slice A's revenue side (no per-unit *profit* without revenue); Stage M for real allocation.
- **Acceptance oracle:** per-sector/per-hawsha cost + margin roll up correctly and reconcile to the whole-farm P&L.

### Slice C — ETA e-invoicing + VAT *(gated on §5)*
- **Scope:** VAT on sales/expenses; Egyptian ETA e-invoice submission (pre-registration, e-signature stamp).
- **Build-vs-partner:** Daftra/Wafeq already implement ETA submission; evaluate integrating/partnering for the
  submission layer vs building native (open question — see §7).
- **Gates:** the ETA-obligation legal determination (§5) decides urgency and scope; external integration + real
  taxpayer credentials are Owner-only.
- **Acceptance oracle:** a test invoice is accepted by (or correctly formatted for) the ETA system; VAT return
  reconciles.

### Slice D — Deferred / later differentiators
- **IAS 16/41 bearer-plant accounting:** capitalize + depreciate the palm as PP&E (IAS 16) while measuring the
  growing dates at fair value less costs to sell (IAS 41). Primary-source, durable requirement (effective 2016);
  **no competitor does it**, so it is a *later* prestige differentiator, not a near-term need. Requires the
  accountant + real data.
- **A-P / vendor bills + aging; bank reconciliation:** standard statutory depth, lower urgency for a single
  owner-operated farm; sequence after A/R + P&L exist.
- **Receipt OCR:** basic receipt-*linkage* (attach a photo to a custody/expense row) is cheap and should ride along
  in Slice A/B; OCR auto-extraction is a later enhancement.

### Cross-cutting quick win (do anytime, low risk)
- **Docs-catalog update for #568:** `RPC-CATALOG.md`, `DATA-DICTIONARY.md`, `BUSINESS-RULES-CATALOG.md`,
  `FEATURE-REGISTRY.md` were not updated when the GL kernel shipped and don't list `accounts`/`journal_entries`/
  `journal_lines`/`fn_accounting_trial_balance`/`fn_record_payment_request_funding`/`fn_confirm_request_expense_paid`/
  `fn_close_payment_request`. A docs-only PR closes this before the module is called "done."

## 7. Open decisions for the Owner

1. **ETA legal determination (§5)** — is a date-palm farm entity obligated to ETA e-invoicing, at what VAT
   threshold? Decides Slice C urgency. *(Owner's accountant.)*
2. **Slice C build-vs-partner** — build ETA submission native, or integrate Daftra/Wafeq's existing ETA layer?
   Needs their API/embeddability + pricing (not covered by surviving research claims — §8).
3. **Chart of accounts** — the real date-palm chart to seed (`accounts` is empty); must reconcile to the 7-year
   Excel. *(Owner/accountant.)*
4. **Decision-0157 policy** — budget cap = hard-block vs warn-with-override; category→budget-line mapping; actuals
   basis (goods-at-est-cost vs invoice-at-real-cost). Still owed; folds into Slice A.
5. **Sequencing confirmation** — proceed A → B → (C gated) → D as proposed, or reprioritize?

## 8. Safe to skip (enterprise bloat)

Corporate/prepaid card issuance, commodity-price-fed real-time P&L, multi-entity consolidation, and (near-term)
bank feeds — none matter for a single owner-operated date-palm farm.

## 9. Research caveats & source quality

- Vendor capability claims (Traction Ag, Harvest Profit, Conservis, Daftra, Wafeq, Qoyod) rest largely on
  marketing / help-center pages — a **feature map, not an independent functional audit**.
- The **ETA agriculture-exemption claim was refuted** (0-3) — do not assume exemption; get a local determination (§5).
- Qoyod's **IAS-41 biological-asset revaluation** and **harvest-yield reconciliation** claims were **refuted**
  (0-3 / 1-2) — even the best MENA agri tool does *not* solve bearer-plant/biological-asset accounting.
- "VAT return ready for submission" (Wafeq/Daftra) means *formatted/exportable*, **not auto-filed** to ETA.
- **No verified claim survived** for QuickBooks / Xero / Zoho Books / Odoo, KSA ZATCA, or the spend-tool
  specifics/pricing — in scope but out-competed for source budget; treat as **un-researched, not absent**.
- IAS 16/41 findings are primary-source (IFRS, effective 2016, in force) and durable.

### Key sources
- Farm-costing: Traction Ag (`tractionag.com`), Harvest Profit (`harvestprofit.com`), Conservis.
- MENA statutory: Wafeq (`wafeq.com/en-eg`), Daftra (`daftra.com/en/egy-electronic-invoice`), Qoyod
  (`qoyod.com/en/fields/accounting-software-for-farms`).
- ETA mandate: Egyptian Tax Authority e-invoicing framework, Decree 188/2020 + 554/2021 (via Wafeq/Daftra + Egypt
  e-invoicing guides).
- Bearer plants: IFRS "Bearer Plants (Amendments to IAS 16 and IAS 41)", June 2014.
- Imprest fundamentals: Imprest system (Wikipedia) + spend-tool sources (Alaan, Pluto, Pemo, Expensify).

## 10. Next step

This is a roadmap for **Owner review**, not a build order. On approval (and the §7 decisions), the recommended
first move is **Slice A** authored as a SPEC-0004 revision + implementation plan (revenue + P&L/balance-sheet +
period close over the existing kernel), followed by the docs-catalog quick win. Nothing here is implemented until
its slice is separately specced, planned, and Owner-gated.

## 11. Companion detail doc (2026-07-01)

[`SPEC-0018-EXT-custody-transfer-and-revenue.md`](SPEC-0018-EXT-custody-transfer-and-revenue.md) fills in three
gaps this roadmap named at a high level but did not fully detail, against the Owner's restated day-to-day
operating model: (1) an explicit holder-to-holder custody-transfer RPC (no journal effect, cash-conservation
tested); (2) the payment-request PDF export + the custody-ledger/cash-expense/unpaid-obligation/owner-funding
report set (mostly read-only over data that already exists via `fn_payment_request_totals`); (3) the
delivery-before-price mechanic for Slice A's planned `sales` table (a sale can be delivered with `price_status =
'pending'` and posts no journal entry until `fn_finalize_sale_price` runs). It does not change this roadmap's
Slice A→D sequencing — Slices 5/6 in the companion doc (revenue schema + revenue reports) are the same work as
this roadmap's Slice A revenue line, just with the pending-price and A/R-aging detail filled in. The next
roadmap gap is still close/period lock plus trusted P&L/balance-sheet reporting and reconciliation.
