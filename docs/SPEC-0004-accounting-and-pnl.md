# SPEC-0004 — Accounting: expenses / sales / vouchers + cost allocation + P&L (Stage 7)

*Status: **LIVE cash-method custody ledger slice (2026-07-01)** — an operational cash-method accounting kernel shipped
via PR #568 (`8ffc4ae`), reviewed by CI + CodeRabbit, **prod-applied migrate-first** as
`20260701220000 accounting_cash_custody_settlement`, and live-route probed. Stage 7 remains
**High risk** (financial integrity): this cash-method custody ledger is not the full statutory/management P&L, and
reconciliation against real financials depends on the privacy-reviewed real-data path (Stage M). Mirrors
[`SPEC-0001`](SPEC-0001-stock-coverage-engine.md) /
[`SPEC-0002`](SPEC-0002-authorization-enforcement.md) / [`SPEC-0003`](SPEC-0003-farm-structure-and-palm-registry-import.md).*

*Companion to [`MASTER-PLAN.md`](MASTER-PLAN.md) §4 Stage 7, [`03-architecture-and-data-model.md`](03-architecture-and-data-model.md),
and the real **7-year Ebeid accounting workbook** (the reconciliation source).*

---

## 1. Why & the bar

Accounting is the highest-value pillar for the owner persona (it turns operations into a P&L by
sector/crop/season) and the **highest-integrity-risk** one: a wrong P&L misinforms real money
decisions. The bar is therefore the **finance oracle** — a **dual-run reconciliation**: the system's
totals for **one already-closed season** must match the known Excel totals before the P&L is trusted.
Define that check first; never weaken it.

## 2. What exists vs what's missing

**Exists (migration `0007`):**
- `expenses` — already cost-allocatable: FKs to `farm/sector/hawsha/plan/event` + `supplier`,
  `category`, `qty/unit/unit_price/total`, `payment_method`, `recorded_by`/`approved_by`, `status`.
- `budgets` / `budget_lines` — `planned/approved/committed/actual` per category.
- The Stage 6 spine: purchase requests → receipts (`fn_post_receipt`) → could post the matching expense.

**Missing (this stage builds):**
- **`sales`** (revenue: crop, qty, unit price, buyer, date, sector/season allocation).
- **`vouchers`** (the payment/receipt voucher document tying an expense/sale to a payment).
- A **drawings (مسحوبات) classification** — owner withdrawals MUST be separable from operating
  expenses (non-negotiable #6). Recommend an explicit `expense.kind ∈ {operating, drawing, capex}`
  (or a dedicated `drawings` table), never a free-text category.
- **Cost-allocation rollup + P&L** — revenue − operating expenses by farm/sector/**crop**/**season**
  (the expenses table has farm/sector/hawsha/plan/event but **no crop or season dimension** — see §5).
- Wiring **actuals back into the budget** — closes #157's "`committed`/`actual` are display-only":
  a posted expense should increment `budget_lines.actual` (and a committed PO → `committed`) in a
  transactional RPC, so the budget gate reflects reality.

## 3. Scope

**Allowed:** the `sales`/`vouchers` tables + the drawings classification; a transactional posting RPC
(expense/sale → cost allocation + budget actual/committed update, idempotent — same claim-first
discipline as `fn_execute_operation`/`recordReceipt`); the **P&L view/report** (by sector/crop/season,
drawings excluded); the **reconciliation harness** (dual-run vs the Excel totals); RLS so financial
rows are visible only to `owner`/`accountant` (payroll-grade confidentiality), writes gated to
`budget.write`/a new `accounting.write` via `authorize()` (the SPEC-0002 pattern).

**Forbidden:** fabricating any figure (#1) — missing data is reported, not invented; copying the
legacy sheet's **data-quality defects** forward (typos like `العام الحقلي`, the embedded
Gmail/password — flag, don't propagate, #6); putting real financials into any third-party model
(#lethal-trifecta / Stage M privacy review); presenting a P&L that hasn't passed reconciliation.

### 3.1 Cash-method accounting slice built on the draft branch (2026-07-01)

The current branch implements the first standalone accounting slice **only for cash-method custody/payment
settlement**:

- `accounts`, `journal_entries`, and `journal_lines` provide a minimal double-entry ledger.
- Owner custody receipts recorded as `استلام عهدة من المالك` post Dr custody cash / Cr owner funding, so the
  standing farm-manager float appears in accounting.
- `payment_request_fundings` records owner transfers into custody before payout.
- `payment_request_lines` now carry settlement fields (`paid_at`, `paid_by`, custody source, movement, journal).
- New RPCs post accounting effects through controlled paths:
  `fn_accounting_trial_balance`, `fn_record_payment_request_funding`,
  `fn_confirm_request_expense_paid`, and `fn_close_payment_request`.
- `/accounting` shows a cash trial balance and recent journals for owner/accountant only.
- `/custody/request/[requestId]` now supports the full workflow: request lines → owner final approval →
  owner funding recorded as custody → accountant confirms payout from selected custody source → close.

This is **not** yet the full statutory accounting stage: no bank reconciliation, tax/VAT, accrual/AP aging,
depreciation, sales ledger, balance sheet close, real Excel dual-run, or real-data import has been done.
It is the operational cash ledger needed to stop custody/payment-request money from living only in reports.

## 4. Acceptance (the oracle)

1. **Reconciliation (the gate):** for one closed season, `system Σ(operating expenses by category)` and
   `system Σ(revenue)` equal the Excel totals within a defined tolerance (ideally exact); a
   before/after reconciliation report is the evidence. The P&L is not "trusted" until this passes.
2. **Drawings excluded:** the operating P&L excludes `kind='drawing'`; a separate owner-drawings line
   shows them (proves #6).
3. **Allocation integrity:** every expense/sale rolls up to exactly one farm→sector (and crop/season
   once those dimensions land); `Σ(allocated) = Σ(total)` — no unallocated leakage.
4. **Budget actuals are live:** posting an expense moves `budget_lines.actual`; the gate (#157) now
   reflects real spend (if the Owner ratifies making the budget a hard cap — see SPEC-0002/BUD-1).
5. **Confidentiality:** a non-owner/non-accountant role cannot read financial rows (RLS test, like the
   payroll posture).

## 5. Open decisions for the Owner (ratify before build)

1. **Chart of accounts / category taxonomy** — must map 1:1 to the Excel's categories for
   reconciliation. Owner/accountant supplies the canonical list.
2. **Crop + season dimensions** — the P&L needs them but `expenses` lacks them today. Add
   `crop`/`season` columns (or a season table) and a sector→crop mapping? Owner decides the model.
3. **Drawings model** — `expense.kind` enum vs a dedicated `drawings` table. (Recommend the enum:
   minimal, keeps one ledger, trivially excludable.)
4. **Budget enforcement (#157)** — **Recommended (2026-06-26): two-step.** *Step-1 (shipped in open PR #190, not yet merged):*
   make the gate honest — judge the **real** plan-op cost, not a hardcoded constant (decision-support
   only, no block). *Step-2 (Owner-gated, this stage):* once slice 2 below makes `committed`/`actual`
   live, make the budget a **hard cap with Owner-override + audit**, enforced in the `pr_update` RLS
   policy **AND-ed** alongside the existing SoD predicate (never a separate PERMISSIVE policy that
   ORs the guard away). Do **not** enforce a cap on inert figures (non-negotiable #1). Owner-only
   financial decision; independent review required. (Ties to SPEC-0002 §budget / BUD-1.)
5. **Reconciliation data source** — the dual-run needs the real closed-season Excel figures; that is
   sensitive financial data → requires the **Stage M privacy review** first, OR a faithful
   synthetic-but-reconcilable fixture for the build, with the real dual-run gated to Stage M.

## 6. Enforcement, evidence, slices

- **Enforcement:** financial RLS (owner/accountant only) deny-by-default; writes via `authorize()`;
  the posting RPC idempotent + transactional (no double-post — the EXE-1/RCP-1 lesson); the
  reconciliation check is the un-weakenable gate.
- **Evidence:** the reconciliation report (system vs Excel), the RLS confidentiality test, the
  allocation-integrity test, idempotency test. **Independent review REQUIRED** on every slice
  (financial logic). **Owner gate**, separate approver for any real-data dual-run.
- **Slices (small, independently gateable):**
  1. `sales` + `vouchers` + `expense.kind` (drawings) schema + RLS + the `authorize()` write gate.
  2. Transactional posting RPC (expense/sale → allocation + budget actual/committed), idempotent.
  3. P&L report (sector/crop/season, drawings excluded) — read-only.
  4. Reconciliation harness + the closed-season dual-run (gated to Stage M for real figures).

Each slice stops at its gate; **do not auto-advance** (PROJECT RULES). Stage 7 is the natural home for
resolving re-audit finding **#157** (budget enforcement) and depends on **Stage M** for the real
reconciliation.

---

## 7. Build-now plan + resolved decisions (2026-06-27, from the Farm × Zeal × market deep-dive)

**Amended verdict (2026-07-01): build a narrow operational cash ledger, not a statutory GL.** The earlier
warning against building a full general ledger still stands for statutory close, bank feeds, tax, accrual,
depreciation, and real financial statement production. The new Owner requirement changes the custody/payment
request slice: Farm OS must stand alone for daily cash accountability, so the branch adds a minimal double-entry
cash ledger around custody and payment-request settlement. The ledger is intentionally small, source-linked,
cash-method, and owner/accountant-only; formal accounting and real P&L remain behind reconciliation and expert
review gates.

**Build now (fold into Stage 7 slices 2–3) · Defer (statutory / finance-owned):**

| Build now | Defer (integrate to an accountant instead) |
|---|---|
| crop + season dimension on `expenses` (§7.2) | double-entry GL, trial balance, balance sheet |
| lean chart of accounts (§7.1) | full accrual (offer a year-end accrual-adjustment *export*) |
| live budget actuals via an atomic posting RPC (§7.3, #157) | depreciation schedules + IAS 41 fair value |
| `vouchers` (payment/receipt doc) | multi-currency FX (farm is EGP-only) |
| period scoping on the P&L (§7.4) | VAT / ETA e-invoicing (fresh dates are largely VAT-exempt; triggers on VAT registration → post-pilot) |
| bearer-plant data capture (§7.5) | payroll engine (Stage 8) |

**Borrow from Zeal (patterns, not the system):** the **atomic single-transaction posting RPC** (its
"never DELETE+UPSERT in two calls" lesson — Farm already does this in `fn_post_movement`/
`fn_execute_operation`); a **lightweight period lock** (one `open/locked` flag + owner unlock — not
Zeal's multi-stage close); **server-side-only audit** (Farm has `fn_audit` ✅). **Do not** borrow
Zeal's GL, trial-balance tieout, FX engine, or QBO sync orchestration.

### 7.1 Decision #1 RESOLVED — proposed lean chart of accounts (~25 lines, date-palm-tailored)
A starting canonical list to replace free-text `category` (Owner reconciles these to the real Excel's
categories — that mapping *is* the reconciliation step). Each row maps to a `kind`.

- **Revenue (`sale`):** تمور برحي · تمور/منتجات الذكور · فاكهة أخرى · **فسائل/خلفات** (offshoots — a real Ebeid line) · إيرادات أخرى
- **Operating (`operating`):** أسمدة · **مبيدات ومكافحة** (incl. سوسة النخيل/RPW) · ري ومياه · **تلقيح** (manual pollination — date-palm-specific) · عمالة دائمة · عمالة موسمية/يومية · وقود وطاقة · صيانة معدات وآبار · إيجارات · نقل وشحن · تعبئة وتغليف · مصاريف إدارية (overhead — pooled, **not** force-allocated) · أخرى تشغيلية
- **Capex (`capex`):** إنشاء/توسعة بساتين (grove establishment — bearer-plant cost) · معدات وآلات · شبكات ري وآبار · مباني ومنشآت
- **Owner drawings (`drawing`, مسحوبات — excluded from opex per #6):** مسحوبات نقدية · مسحوبات عينية

Implementation: a small `account_categories` reference table (org-scoped, seeded with the above) with
`code · name_ar · kind`, and `expenses.category` / `sales.crop` referencing it — **or** keep `category`
text but constrain to this seeded set. Keeps reconciliation honest (no typo-split lines).

### 7.2 Decision #2 — crop + season dimension on `expenses` (the keystone)
Add `crop text` + `season text` to `expenses` (mirroring `sales`), and group the P&L by them in
`lib/pnl.ts`. This is the single most-used farm-accounting number (profit per crop/season). Recommend
plain text columns now (matches `sales`), a dimension table only if a crop master emerges.

### 7.3 Live budget actuals (#157) — the atomic posting RPC (Zeal pattern #1)
`fn_post_expense` / `fn_post_sale` (SECURITY DEFINER, `budget.write`-gated) that, in **one
transaction**, writes the row **and** increments `budget_lines.actual` for the matching category —
mirroring `fn_post_movement`. Makes budget-vs-actual live (closes #157 step-2's prerequisite) without
the racy two-call pattern. Idempotent + independent review (money logic).

### 7.4 Period scoping (app-layer note from the #368 review)
`accounting/page.tsx` sums all rows up to `limit(200)` with no period filter — fine for the synthetic
framework, but a real P&L must scope to a fiscal period/season. Add a period selector + a
`date`-range filter to the fetch before the dual-run.

### 7.5 Bearer-plant data capture (market insight — capture now, account later)
Date palms are **bearer plants**: under IFRS the *palms* are IAS 16 depreciable PP&E, the *fruit on
them* is IAS 41 (fair value), and *harvested dates* are IAS 2 inventory. **Do not build depreciation
or fair-value remeasurement** (accountant/statutory territory) — but **capture grove establishment
cost + a maturity flag per hawsha/sector** (ties to Stage 2 palm registry) so an accountant can later
capitalize/depreciate. It's cheap now and expensive to retrofit.

*All of §7 is design only — no enforcement changes here. Slices land via the gated flow (independent
review + Owner gate); the real-data reconciliation stays behind Stage M.*
