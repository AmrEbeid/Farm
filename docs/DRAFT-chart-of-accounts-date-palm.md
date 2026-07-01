# DRAFT — Chart of Accounts for a date-palm farm (دليل الحسابات)

*Status: **DRAFT proposal for the Owner + accountant to red-line** — NOT an authoritative or ratified chart, and
NOT a build authorization. Produced to unblock owner-decision #1 in
[`ROADMAP-accounting-custody-2026-07-01.md`](ROADMAP-accounting-custody-2026-07-01.md) (the empty `accounts` table
that Slice A's P&L / balance-sheet reconciliation depends on). Companion to
[`SPEC-0004-accounting-and-pnl.md`](SPEC-0004-accounting-and-pnl.md). Per non-negotiable #1 this file proposes the
account **structure** only — it contains **no financial figures** and must be reconciled to the real 7-year Ebeid
accounting workbook (the SPEC-0004 oracle) by a qualified accountant before it is trusted or seeded to prod.*

*Author: autonomous session, Owner: Amr Ebeid.*

---

## 1. Why this exists

The cash-method double-entry kernel shipped in PR #568 (`20260701220000`) and creates accounts **lazily** — only
the five it needs so far (below). A real P&L, balance sheet, and Excel reconciliation (Slice A) need a **complete,
ratified chart** seeded up front. This draft proposes that chart, tailored to a date-palm operation, extending the
codes the kernel already uses so nothing already-live has to change.

**The accountant owns this decision.** This is a starting point to red-line against the real books, not a
prescription — account choices are a financial decision the Owner/accountant makes, never the tool
(CLAUDE.md "Owner & approvals").

## 2. Already live in prod (created by #568 — do not renumber)

These five are created on demand by `fn_ensure_account` / `fn_account_for_expense_kind` and must stay as-is:

| Code | Name (Arabic) | Type | Normal balance | Role |
|---|---|---|---|---|
| `1000` | عهدة نقدية | asset | debit | Custody / petty cash float |
| `1500` | أصول ومشروعات رأسمالية | asset | debit | Capex (expense `kind = capex`) |
| `3000` | تمويل المالك | equity | credit | Owner funding into custody |
| `3100` | مسحوبات المالك | equity | debit | **Owner drawings (مسحوبات) — contra-equity; kept OUT of the P&L (non-negotiable #6)** |
| `5000` | مصروفات تشغيلية | expense | debit | Operating expenses (expense `kind = operating`) |

## 3. Proposed full chart (draft — for red-lining)

Numbering keeps the existing class convention: **1xxx assets · 2xxx liabilities · 3xxx equity · 4xxx revenue ·
5xxx expenses.** Rows marked **(live)** exist today; all others are **proposed additions**. "Slice" = which
[`ROADMAP`](ROADMAP-accounting-custody-2026-07-01.md) slice first needs the account (so seeding can be phased).

### 1xxx — Assets (أصول) · normal balance: debit
| Code | Name (Arabic) | Purpose | Slice |
|---|---|---|---|
| `1000` | عهدة نقدية | Custody / petty-cash float **(live)** | — |
| `1010` | نقدية بالخزينة / البنك | Cash on hand / bank (if a bank account is used) | A |
| `1100` | ذمم مدينة — عملاء | Accounts receivable (buyers who owe for delivered dates) | A |
| `1200` | مخزون مستلزمات | Inventory of inputs (fertilizer/pesticide/materials) at cost | A/B |
| `1300` | مخزون محصول تام | Finished-crop inventory (harvested, unsold dates) | B |
| `1500` | أصول ومشروعات رأسمالية | Capex / projects under construction **(live)** | — |
| `1600` | أصول بيولوجية مثمرة — نخيل | Bearer plants: mature date palms (IAS 16, cost/reval model) | D |
| `1700` | معدات وآلات ومركبات | Equipment / machinery / vehicles | A/D |
| `1800` | مجمع الإهلاك | Accumulated depreciation (contra-asset, credit balance) | D |

### 2xxx — Liabilities (خصوم) · normal balance: credit
| Code | Name (Arabic) | Purpose | Slice |
|---|---|---|---|
| `2000` | ذمم دائنة — موردون | Accounts payable (owed to suppliers) | D (A-P) |
| `2100` | مصروفات مستحقة | Accrued expenses | D |
| `2200` | ضريبة القيمة المضافة مستحقة | VAT payable / ETA | C |
| `2300` | أجور ومرتبات مستحقة | Wages / salaries payable (ties to payroll, SPEC-0006) | D |

### 3xxx — Equity (حقوق الملكية)
| Code | Name (Arabic) | Purpose | Normal | Slice |
|---|---|---|---|---|
| `3000` | تمويل المالك / رأس المال | Owner funding / capital **(live)** | credit | — |
| `3100` | مسحوبات المالك | Owner drawings مسحوبات — **contra-equity, excluded from P&L (#6)** **(live)** | debit | — |
| `3200` | أرباح مُحتجزة | Retained earnings (accumulated P&L) | credit | A |

### 4xxx — Revenue (إيرادات) · normal balance: credit
| Code | Name (Arabic) | Purpose | Slice |
|---|---|---|---|
| `4000` | مبيعات تمور / بلح | Date sales (the primary revenue line) | A |
| `4100` | مبيعات فسائل | Offshoot (فسيلة) sales | A |
| `4900` | إيرادات أخرى | Other income | A |

### 5xxx — Operating expenses (مصروفات تشغيلية) · normal balance: debit
`5000` stays the catch-all the kernel posts to today; the sub-accounts below are an **optional** finer breakdown
the accountant may prefer (the expense-`kind` routing still lands operating spend in the 5xxx class regardless).
| Code | Name (Arabic) | Purpose | Slice |
|---|---|---|---|
| `5000` | مصروفات تشغيلية (عام) | Operating expenses — general **(live)** | — |
| `5100` | أسمدة | Fertilizers | A/B |
| `5200` | مبيدات | Pesticides | A/B |
| `5300` | ري ومياه | Irrigation / water | A/B |
| `5400` | عمالة وأجور يومية | Labor / daily wages | A/B |
| `5500` | وقود وطاقة | Fuel / energy | A/B |
| `5600` | صيانة | Maintenance | A/B |
| `5700` | نقل وشحن | Transport / freight | A/B |
| `5800` | مصروفات إدارية | Administrative / overhead | A |
| `5900` | إهلاك | Depreciation expense (pairs with `1800`) | D |

## 4. Design notes (for the accountant)

- **Drawings stay out of the P&L.** `3100` مسحوبات is contra-equity, never an expense — this is enforced
  structurally by `fn_account_for_expense_kind` (BR-111) and must remain so; the P&L = `4xxx − 5xxx` only.
- **Per-crop / per-feddan / per-tree costing is a *dimension*, not more accounts.** Slice B adds a crop/season/
  hawsha/tree tag on the journal line (the `journal_lines` table already carries dimension FKs), so a single
  `5100 أسمدة` account still rolls up per-sector/per-feddan without exploding the chart. Do **not** create
  per-sector expense accounts.
- **Bearer plants (`1600`) + depreciation (`1800`/`5900`) are Slice D** and need the IAS 16/41 treatment (the palm
  depreciates as PP&E; the growing dates are fair-valued under IAS 41) — defer until the accountant scopes it.
- **VAT (`2200`) is Slice C** and only bites if the ETA-obligation determination (roadmap decision #2) says the
  farm entity must register — confirm with the accountant first.
- **A-R (`1100`) vs cash-only:** if dates are sold for immediate cash, revenue can post `Dr 1000/1010 · Cr 4000`
  and `1100` stays unused; `1100` matters only if buyers are invoiced on terms.

## 5. Open questions for the Owner / accountant

1. Confirm the **class numbering** (1/2/3/4/5) and whether to seed the fine 5xxx breakdown now or keep the single
   `5000` and rely on the Slice-B dimension for detail.
2. Are dates sold **cash** or **on terms** (decides whether `1100` A-R is needed in Slice A)?
3. Which accounts must exist to **reconcile the 7-year Excel** — the workbook's own categories should drive the
   final 5xxx list.
4. Bank account in use (→ `1010`), or purely cash/custody?
5. Confirm bearer-plant / depreciation policy is **deferred** (Slice D), not needed for the first real P&L.

## 6. Next step

On the accountant's red-line, this becomes the seed for a `fn_ensure_account` bootstrap (Slice A) — authored as a
migration + pgTAP, **independently reviewed as money logic, and Owner-applied** (migrations stay Owner-gated). No
account is seeded to prod until this chart is ratified and reconciled to the real workbook.
