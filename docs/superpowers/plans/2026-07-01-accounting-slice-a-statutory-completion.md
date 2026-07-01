# Accounting Slice A — Statutory completion (implementation plan)

> **For agentic workers:** this plan is **PENDING OWNER GATES — not yet executable.** Before ANY task here runs,
> the §"Gates" below must clear (chart of accounts ratified + seeded, #157 budget policy decided, independent
> money-logic review, Owner-applied migrations). It operationalizes the design already in
> [`SPEC-0004-accounting-and-pnl.md`](../../SPEC-0004-accounting-and-pnl.md) and the sequencing in
> [`ROADMAP-accounting-custody-2026-07-01.md`](../../ROADMAP-accounting-custody-2026-07-01.md) into ordered,
> testable, independently-gateable slices.

**Goal:** Complete statutory reporting on the existing cash-method double-entry kernel (PR #568) — add revenue/A-R,
a real P&L + balance sheet, period close, and budget-vs-actual on the real ledger — so the SPEC-0004 dual-run
reconciliation oracle can run.

**Architecture:** *Extend the existing GL kernel, do not rebuild it.* `accounts`/`journal_entries`/`journal_lines`
+ `fn_post_two_line_journal` + `journal_lines_balance_guard` are live; every task below posts through the existing
idempotent, balance-guarded helper and reuses the `finance.read` / RPC-only / audited posture. No new accounting
engine.

**Tech stack:** Supabase Postgres (SECURITY DEFINER RPCs, RLS FORCE, pgTAP), Next.js 16 app (`/accounting`),
Vitest. Money logic → **independent review required** (CLAUDE.md).

## Gates (ALL must clear before implementing — this is money logic)
1. **Chart of accounts ratified + seeded.** The accountant red-lines [`DRAFT-chart-of-accounts-date-palm.md`](../../DRAFT-chart-of-accounts-date-palm.md); final codes drive A1/A2. `accounts` is seeded via an Owner-applied bootstrap migration.
2. **#157 budget policy decided** (cap hard-block vs warn; category→account mapping; actuals basis) — see [`DECISION-0157-budget-enforcement.md`](../../DECISION-0157-budget-enforcement.md). Gates A4 only.
3. **Independent review** of every migration/RPC here (money logic) before merge; **migrate-first, Owner-applied** (migrations stay Owner-gated — CLAUDE.md).
4. **Stage M** for real figures: the dual-run reconciliation uses the real 7-year Excel only behind the privacy review.

## Global constraints (from SPEC-0004 / CLAUDE.md)
- P&L = `Σ4xxx − Σ5xxx` **excluding `3100` owner drawings** (non-negotiable #6; already structurally routed).
- Never fabricate figures (#1); reads throw on error rather than render a misleading zero.
- Arabic-RTL-first UI; numbers via `lib/money` (Arabic-Indic).
- Any new user-data write-RPC that should be bulk-importable ships an `ImportDescriptor` + `importable-rpcs.ts` entry (convention test) — applies to A2's `fn_save_sale`.
- Define the check first; never weaken a check to pass.

---

## Slice A1 — P&L + balance-sheet report RPCs *(read-only; cheapest; ship first)*
**Why first:** pure aggregation over the *existing* ledger — needs no revenue data and no new table, so it delivers
a real P&L/balance-sheet view immediately on whatever is already posted, and it's the lowest-risk (read-only) money
change.

**Files:** new migration `NNNN_accounting_pnl_balance_sheet.sql` (report RPCs only); pgTAP
`NNN_accounting_pnl_balance_sheet_test.sql`; `app/(app)/accounting/page.tsx` (+ P&L/BS sections); `lib` formatter.

**RPCs (read-only, `finance.read`-gated, `search_path=''`):**
- `fn_accounting_pnl(p_org uuid, p_from date, p_to date) → jsonb` — revenue (`4xxx`) and operating expense (`5xxx`)
  totals + net, grouped by account, over `[p_from, p_to]`; **excludes `3100`**.
- `fn_accounting_balance_sheet(p_org uuid, p_as_of date) → jsonb` — asset (`1xxx`) / liability (`2xxx`) /
  equity (`3xxx`) balances as of a date; returns the assertion `assets = liabilities + equity`.

**Acceptance oracle (define first, pgTAP):** (a) a `3100` drawing posted in-period does **not** appear in the P&L;
(b) balance sheet balances (`A = L + E`) on a seeded fixture; (c) period bounds exclude out-of-range entries;
(d) non-`finance.read` role cannot call either RPC.

**Gate:** independent review; Owner-applies the migration; then merge (migrate-first).

## Slice A2 — Revenue / sales + A-R
**Files:** migration `NNNN_sales_revenue.sql` (`sales` table + `fn_save_sale` + A/R settlement RPC); pgTAP;
`lib/import/descriptors/sales.ts` + `importable-rpcs.ts` entry + `descriptors/index.ts`; `app/(app)/…` sales entry UI.

**Data model:** `sales` (id, org_id, sale_date, buyer?, crop/season/hawsha dim? [ties to Slice B], qty, unit_price,
total, payment_status ∈ {cash, on_terms_unpaid, paid}, notes) — org-scoped, RLS FORCE, RPC-only, audited.

**RPCs:**
- `fn_save_sale(…) → jsonb` — records a sale and posts `Dr 1000/1010 (cash) or 1100 (A-R) · Cr 4000 revenue`
  through `fn_post_two_line_journal` (inherits BR-116 balance + BR-117 idempotency).
- `fn_settle_receivable(…)` — buyer pays: `Dr cash · Cr 1100`.

**Acceptance oracle:** balanced + idempotent posting; cash-sale vs on-terms routes to the right debit account; A/R
clears to zero on settlement; `finance.read`/`budget.write` gates; the `sales` `ImportDescriptor` passes
`convention.test.ts`.

**Gate:** chart ratified (revenue/A-R codes); independent review; Owner-applies.

## Slice A3 — Period close / lock
**Files:** migration `NNNN_accounting_periods.sql` (`accounting_periods` + posting-time lock check); pgTAP.

**Design:** `accounting_periods` (org_id, period_start/end, status ∈ {open, closed}, closed_by/at). The posting
path rejects a journal entry dated into a **closed** period; a lightweight Owner-only reopen (per SPEC-0004 § "a
lightweight period lock … one open/locked flag + owner unlock — not Zeal's multi-stage close").

**Acceptance oracle:** posting into a closed period is rejected; close + reopen are gated (owner); an open period
posts normally.

**Gate:** independent review; Owner-applies.

## Slice A4 — Budget-vs-actual on the real ledger *(closes #157 step-2)*
**Files:** migration/report `NNNN_budget_actuals_from_ledger.sql`; pgTAP; budgets UI wiring.

**Design:** derive budget `actual` (and `committed`) by rolling the **real ledger** up per category/account —
**not** the current frozen seed numbers — per the #157 category→account mapping decision. Derive, don't store.

**Acceptance oracle:** a budget line's `actual` equals the sum of its mapped ledger postings in-period; the
finance dashboard's two "budget" signals now agree (closes the roadmap's "two unreconciled budget signals" risk).

**Gate:** **#157 policy decided** (mapping + actuals basis); independent review; Owner-applies.

---

## Whole-slice acceptance (SPEC-0004 oracle)
For **one already-closed season**, `system Σ(revenue)` and `system Σ(operating expenses by category)` reconcile to
the real Excel totals within the defined tolerance (ideally exact), **with owner drawings excluded** from the
operating P&L — run behind Stage M. This is the gate SPEC-0004 §4 defines; never weaken it.

## Sequencing & PR discipline
A1 → A2 → A3 → A4, **each its own PR**, each migrate-first + Owner-applied + independently reviewed. A1 ships value
on existing data with zero new schema-for-revenue, so it's the safest first cut. Do not bundle; do not auto-advance
between slices (PROJECT RULES).

## Not in Slice A (later roadmap slices — do not scope-creep here)
Per-feddan/per-tree cost *dimension* on journal lines (Slice B); ETA/VAT (Slice C, gated on the accountant memo);
bearer-plant IAS 16/41, A-P/vendor bills, bank reconciliation (Slice D).
