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
- **Revenue reports/P&L over `sales`** — the backend `sales`/A-R tables are implemented in `20260701500000`,
  and the read-only revenue/A-R report is implemented in `20260701510000`; full P&L, balance sheet, close/lock,
  and reconciliation oracle are still pending.
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

### 3.2 Revenue/A-R backend and report slices (S-10/S-10b, 2026-07-04)

The S-10 backend adds the revenue side without pretending the full P&L is complete:

- `buyers`, `sales`, and `sale_collections` support delivery-before-price sales.
- A pending sale keeps `unit_price` and `total` as NULL and posts no journal entry.
- `fn_finalize_sale_price` sets the final total and posts Dr `1200` A/R / Cr `4000` sales revenue through the
  existing double-entry helper.
- `fn_record_sale_collection` supports partial receipts, rejects over-collection, and posts Dr `1100` sales cash /
  Cr `1200` A/R.
- Writes are RPC-only through the existing owner/accountant `budget.write` gate; reads require `finance.read`.
- `fn_revenue_sales_report` and `/finance/revenue-reports` provide read-only period KPIs, buyer/crop rollups,
  pending-price delivery rows, collections, and A/R aging; pending rows are listed but excluded from finalized
  revenue/A-R totals.

This is still **not** the trusted management P&L. The default accounts make the backend operational, but the real
chart mapping, close/period lock, P&L/balance-sheet reports, and Excel dual-run reconciliation remain the gate
before finance treats the totals as decision-grade.

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
  1. `sales` + A/R backend schema/RPCs + RLS + the existing owner/accountant write gate. **Backend implemented in
     `20260701500000`; read-only revenue report UI/RPC implemented in `20260701510000`; voucher documents remain
     pending.**
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

### 7.6 Finance-dashboard budget authority guard (2026-07-30, RELEASED)
PR #985 merged at `22428eac6bb2a7bf4666819e8f4c160b6e7e7bbc`; production deployment
`9jXcmKy6NBeYuhLuRwtVH4kjTSYD` completed successfully. This is an app-layer truthfulness guard, not the
live-posting design in §7.3. The dashboard reads budget authority for the active organization in the same
parallel wave as its existing reads and explicitly scopes the budget query by `org_id`.

If budget authority is not `verified`, every budget-value sink fails closed: approved/committed/actual/
available KPIs, charts, pressure table, printed DOM and CSV control are absent, and the standard unverified
source warning is rendered. If verified later, the current foundation-maintained fields remain visible only
as labelled snapshots; a warning states that they do not update automatically from approvals or expenses and
links to the posted-ledger budget-vs-actual report. No status semantics, hard budget cap, live posting or
automatic budget mutation was introduced.

The source contract pins the authority lookup in the parallel wave, explicit org scope, unique and
authority-contained KPI/chart/export sinks, the warning paths and the existing owner/accountant/farm-manager
route roles. Local evidence: focused Vitest 3/3; full Vitest 1,301 passed + 13 controlled skips across 92
files; TypeScript and touched-file ESLint clean; build 64/64; independent review APPROVE after one correction
round. Production preflight was read-only and found `budgets=blocked`, `finance_ledger=partial`. Exact-merge
CI, release and pgTAP are green; signed-out live smoke redirects the dashboard to login. No migration, schema,
RPC, dependency, authority row, financial row or budget value changed. #534 F2 is complete; F3/F4/F5 remain
open.

*Except for the released §7.6 display safeguard, §7 remains design only. Slices land via the gated flow
(independent review + Owner gate); the real-data reconciliation stays behind Stage M.*

---

## 8. Reconciliation review workspace — Slice 4 UI (2026-07-26, RELEASED)

The reconciliation review UI slice builds an Arabic-RTL owner/accountant workspace on top of the
already-live Slice-3 RPCs (migration `20260726111554 accounting_reconciliation_review_rpcs`). **This
UI portion adds no separate schema/dependency and stages **no** real data. It shipped with Slice 4A in
PR #917; production reconciliation counts remain 0/0/0.**

**Routes:**
- `/finance/reconciliation` — lists the active org's batches, newest first, bounded to ≤50. Shows
  the honest DB status and the staged row count from `result_summary` (never fabricated). Empty state
  states clearly that no reconciliation batch has been staged.
- `/finance/reconciliation/[batchId]` — one RLS-visible batch. Rows are bounded and paginated
  (50/page via `range()`); a bounded set of head-count queries gives the whole-batch state summary
  (no unbounded row read, no N+1). Each row surfaces the evidence needed to decide: classification,
  workbook sheet/row or production-snapshot target, source amount/date, the invalid-date quality flag,
  the current disposition/state/reason, and the typed target values. Missing or cross-org batches fail
  closed (`notFound()`), on top of RLS.

**Review controls & contract:** explicit hold / reject / include, each requiring a non-empty reason.
Include builds the exact `fn_review_reconciliation_row` jsonb payload — `expenses` (category, kind,
account_id required; description/cost_center/supplier/payment_decision optional) or `sales` (crop,
quantity, unit_price, recorded_total required; buyer/cost_center/farm/sector/hawsha/season/dates/notes/
historical-date-decision optional), plus the `corrects_*` id required only for
`amount_correction_candidate` rows. Options (accounts / cost centers / suppliers / buyers / farm
structure) are read org-scoped and bounded. No defaults are guessed that would create financial facts;
the form prefills only values already staged on the row. Validation and errors are Arabic and user
input is preserved on failure.

**Freeze / approve:** freeze is owner/accountant, allowed only when the batch is staged and every row
has an explicit decision; approve is owner-only after freeze, with the RPC-enforced separation of
duties (the creator and any row reviewer cannot approve) surfaced in Arabic. **Execute/post, rollback,
and manifest staging are out of scope** and are left to separate, independently reviewed migrations.
(Superseded in order: execute/rollback by §8.2, manifest staging by §8.3.)

**Enforcement:** server actions use the RLS-scoped user-session Supabase client only (never the
service role), re-require owner/accountant, validate UUIDs/payloads, call only
`fn_review_reconciliation_row` / `fn_freeze_reconciliation_batch` / `fn_approve_reconciliation_batch`,
and revalidate the exact routes. The gated RPCs + table CHECKs + tenant/freeze guards remain the
authoritative backstop; the UI fails closed before the RPC for a friendlier message.

Pure logic (payload build/validate, pagination, status summaries) lives in
`apps/farm-os/lib/reconciliation review.ts` with focused vitest coverage; nav + page-help metadata and
drift tests were added; the editable `database.types.ext.ts` gained the three reconciliation tables and
the three RPC signatures (generated `database.types.ts` untouched).

**Form seeding & discard (2026-07-30 — MERGED / DEPLOYED / LIVE-SMOKED, PR #979).** The
row card never unmounts while the page is open, so the form is re-seeded from the row **as the server
currently renders it** on every open, and «إلغاء» / closing the card discards every unsaved edit rather
than keeping it. Before this, React ran the field initialisers once and the two close paths only hid the
form: an abandoned edit reappeared on the next open looking like the stored decision — contradicting the
read-only decision summary in the same card — and was written back if the reviewer then saved, which on a
money batch flips a reviewed row silently. The re-seed also covers a row changed by the other reviewer,
which `router.refresh()` alone did not. The correction-target picker holds its own query/results/chosen
label, so it is remounted on discard rather than re-seeded. A successful save is deliberately **not** a
discard: it still just closes, leaving the saved values.

Because the re-seed reads the row **prop**, the post-save `router.refresh()` runs inside a `useTransition`
and the card cannot be reopened until that transition commits. `router.refresh()` returns void and applies
the refreshed RSC payload later, so without the gate the card was reopenable during that window against the
pre-save row — re-seeding the OLD stored decision and writing it back on the next save. The open button's
`loading`/`disabled` and an in-handler guard both read the transition's own pending flag; closing and
discarding stay available throughout. No RPC, payload contract, gate, read, or
acceptance-report byte changed. Pinned by the "review form discard contract" suite in
`lib/tests/reconciliation review.ts` — a source contract, because this repo has no jsdom
(`@testing-library/react` is a dependency hard-stop). Codex review found and rejected an initial
post-save stale-prop window; the transition-gated amendment passed re-review.
PR #979 merged at `93806f838af6102ed8b09e9dd8830fb5bf11e2ff`; exact deployment
`Fcy2Dq2PviGUD2kVmaegqiN92fyZ` completed, main CI/release/db-tests are green, and signed-out route health
passed. Authenticated row interaction was not used for smoke because no existing session was available.
No migration or business row change.

### 8.1 Slice 4A — DB/data-contract hardening (2026-07-26, RELEASED)

From the independent-review REQUEST CHANGES. Append-only migration
`20260726140000 accounting reconciliation evidence contract and dimensional guard.sql` (applied to Farm
production as hosted `20260726131109 accounting_reconciliation_evidence_contract_and_dimensional_guard`):
- **Source-evidence contract.** `reconciliation_evidence_items` gains a nullable `evidence_label`. The
  Slice-2 parser/generator/types now carry `evidence_label` for every row plus `source_amount`
  (exact nonnegative decimal or null), `source_date_text` (ISO-shaped or null), and `source_date_parsed`
  (a real calendar date or null — equal to the text ONLY when the text is a real calendar date and the
  invalid-calendar flag is false; `legacy_comparison_date` is never used). Production-snapshot rows keep
  every source-only field null. Stable ids are unchanged. The validator + stage RPC are re-emitted to
  validate, persist, and idempotently replay the enriched manifest and fail closed on a malformed
  amount/date/label — every existing authz, grant, advisory lock, portable hash, exact-key check, count
  reconciliation, and replay comparison preserved. `evidence_label` is nullable, so historical rows /
  older pgTAP fixtures stay valid (backward-safe).
- **Dimensional integrity.** `fn_guard_reconciliation_batch_row_tenant` is re-emitted with all existing
  tenant/correction checks plus: a set `sale_sector_id` requires a `sale_farm_id` it belongs to; a set
  `sale_hawsha_id` requires a `sale_sector_id` it belongs to (farm-only and sector-with-farm allowed);
  and an included expense must post to an **active leaf** account whose **kind equals `expense_kind`**.
  The UI mirrors this: sector options filter by the chosen farm and hawsha options by the chosen sector,
  clearing descendants when a parent changes.
- **Correctness.** Unreviewed rows display as default/no-decision (not an explicit hold); the frozen KPI
  counts `frozen=true` across dispositions; every bounded option query requests LIMIT+1 and fails loudly
  on overflow rather than silently truncating (so leaf-account and hierarchy filters never run on a
  truncated set). The evidence label is shown with the source amount/date; no raw private value is logged.
  Amount-correction rows also resolve the org-scoped target record server-side and permanently display
  its date, amount, and business identity outside editable controls, including after reload/freeze;
  an unresolved target fails closed before approval.

Coverage: new pgTAP `141 …test.sql` (enriched stage/replay exactness, malformed fail-closed, null-label
backward-safety, account active/kind/leaf rejection, hierarchy rejection + valid acceptance); expanded
parser/generator tests; updated Slice-3 pgTAP fixtures. **No real manifest was staged and production
counts stay 0/0/0. Local validation is complete: TypeScript and touched-file
ESLint pass; focused reconciliation Vitest 67 passed + 13 controlled skips; canonical private-file
regression 55/55; full Vitest 670 passed + 13 controlled skips; production build 65/65 pages; and full
local pgTAP 2,057 passing with zero file failures and only the two unchanged unrelated engine
assertions. Reconciliation suites pass 127/127, 21/21, and 60/60. Independent rereview: APPROVE.
PR #917 merged at `31b5b93f`; production postflight and Vercel deployment passed.**

### 8.2 Execution + atomic rollback workflow (2026-07-27, RELEASED)

The one reconciliation path is now complete from staged evidence through review, freeze, approval, owner
execution, and owner rollback. Expense, sale, and mixed-batch execution shipped in PRs #919/#921; PR #923 adds
the compact controls and `fn_rollback_reconciliation_batch(uuid,text)`.

Rollback is whole-batch atomic and append-only. It reverses journals created by execution, restores originals
that execution reversed by replaying the immutable typed baseline, marks execution-ledger claims reversed,
records a mandatory reason, and leaves every action link and journal auditable. It never deletes financial
evidence or claims success from an unrecognized RPC response. Restored sale histories must form exact closed
reversal/reinstatement chains before they can be corrected again.

The accounting-period exclusion contract is now enforced by a per-org transaction advisory mutex: money writers
take it shared before any row lock; close/reopen take it exclusive. Executor, rollback, posting, reversal, and
reinstatement share this order. Membership is resolved without locks first, so a foreign journal UUID cannot
queue on another tenant's advisory mutex or journal row. Action links are append-only, unique by batch row/action
kind, and checked in both directions against the frozen decision and execution ledger before rollback touches
money.

Release evidence: exact SQL hash
`e11f7746e571f3eeeb58bb4dc1a5b11e8dc2ced4fa2ae6edc1dbcf19d43b0420`, hosted migration
`20260727115115 accounting_reconciliation_rollback_batch`, PR #923 merge `835f80a`. Rollback pgTAP 317/317;
full pgTAP 2,861 passing with zero file failures and only the two unchanged stock-engine baselines; TypeScript,
ESLint, Vitest 755 + 13 controlled skips, and build 65/65 pass. Production counts remain unchanged and no real
batch was executed.

**Acceptance still pending:** the pinned 698-row manifest is staged untouched in production; owner/accountant
review, dual-run comparison to the workbook, exception resolution, and signed accountant acceptance remain.
The implementation workflow is live; Stage 7 must not be called 100% dependable daily use until that operating
proof is complete.

### 8.3 Manifest staging from the app (2026-07-27, RELEASED AND CANONICAL BATCH STAGED)

§8 originally left manifest staging out of the UI: the Slice-3 RPC
`fn_stage_reconciliation_manifest(uuid, jsonb)` was live and pgTAP-covered, but the only way to reach it
was outside the application. This slice closes that gap with the missing authenticated application
path. **No schema change and no migration: the RPC, its grants, and its contract are unchanged.**

**Route:** `/finance/reconciliation` gains a compact Arabic-RTL control — a real file input, one explicit
"تجهيز للمراجعة" command, a pending state, an inline safe error state, and navigation to the created
batch's detail page on success. Copy states plainly that staging creates **review rows only** and does
not create or modify any expense, sale, or journal. Page headers are unchanged.

**Staging creates review rows only.** One `reconciliation_batches` row plus its evidence items and its
`unreviewed`/`hold` batch rows. Nothing is posted. Money still moves only at owner execution, after
per-row review, freeze, and approval.

**Server action contract (`stageManifest`):**
- Owner/accountant via `requireRole`, re-required **before** the upload is touched.
- Exactly one JSON `File` from a `FormData` field. It is bounded **before it is read** — non-empty and
  ≤ `RECONCILIATION_MANIFEST_MAX_BYTES` (900,000 bytes; the pinned 698-row manifest is well under it).
  A wrong/missing field, malformed JSON, an array or non-object root, and a manifest whose
  `batch.org_id` is not exactly the caller's `m.orgId` are all rejected before any DB call.
- **`org_id` is never accepted from the client.** It is always the caller's own membership org, and it
  is both the RPC's `p_org` and the value `batch.org_id` must equal. The RPC re-checks membership,
  `authorize('reconciliation.write')`, and the same org equality — the app guard is the friendlier
  message, not the gate.
- The only DB call is `sb.rpc('fn_stage_reconciliation_manifest', {p_org, p_manifest})` through the
  RLS-scoped **user-session** client. No direct DML, no admin client, no service role, no network
  helper, no temp file, no new dependency.
- The returned body is parsed defensively: only a valid UUID `batch_id` with a non-empty `status` is
  reported or navigated to. An **idempotent replay is a success** (the RPC returns the same batch id
  having written nothing).
- SQLSTATEs map to fixed Arabic messages — 42501 permission, 22023 malformed manifest contract, 23505
  deterministic replay conflict, 23502 missing org — with a generic Arabic fallback for anything else.
  Nothing about the upload is logged or echoed: no filename, no contents, no amounts, no labels, no raw
  DB message.

Pure guards live in `apps/farm-os/lib/reconciliation staging.ts`; `database.types.ext.ts` gains the
staging RPC signature and its return type (generated `database.types.ts` untouched). Coverage:
`apps/farm-os/lib/reconciliation/tests/staging upload.ts` — validation, org binding, size cap, outcome
parsing, the fixed error map, and source-contract guards proving the role requirement, the user-session
RPC, the absence of direct DML/admin/service-role/network/temp-file, and the list-page integration.

**Release and production evidence:** PR #925 merged at `d976bba`; Vercel deployment
`dpl_B2rhqKSC3n4QX9z3JqnC7DquBKwb` is READY. The real owner session staged deterministic batch
`80a1051d-5bcf-504c-93cd-07206b4c59ef` with 698 evidence items and 698 rows. Every row remains
`unreviewed` / `hold` / not frozen; action links and execution ledger remain empty. Workbook, production
snapshot, and exception-evidence hashes match the pinned inputs. Financial counts and totals did not change.

### 8.4 Read-only review queue filters (2026-07-27, RELEASED)

PR #927 adds compact server-side filters to the staged batch workspace without adding a bulk decision path.
Classification is restricted to the five existing evidence classifications. Decision state is restricted to
unreviewed, included, held, rejected, or frozen, using the same exact predicates as the whole-batch KPIs.
Unknown or repeated URL values resolve to the unfiltered queue and are never forwarded as PostgREST syntax.

The filtered exact count and 50-row page query are scoped by both `batch_id` and `org_id`; evidence is joined
through the composite tenant-safe foreign key and explicitly tenant-filtered. Previous/next links retain active
filters, applying a filter resets to page one, and an empty filtered queue has its own state. Whole-batch KPI
counts and freeze/approve/execute/rollback gates remain independent and unfiltered.

Release evidence: commit `51c57f4`, merge `2d325fd`, production deployment
`dpl_HZhU5r8gfFXYorbq4AzNzjgA47fV`. Focused tests 32/32; full Vitest 797 passed + 13 controlled skips;
TypeScript/ESLint clean; build 65/65; CI app/shared/secret/Vercel green; DB baseline unchanged at
2,861 passing / two known stock-engine assertions / zero file failures. Live owner-session checks returned
698 unfiltered rows, 15 amount-correction rows, and the zero-result state with the full-batch 698 KPI and
disabled freeze gate intact. No decision, freeze, approval, execution, or financial row changed.

### 8.5 Review-page read concurrency (2026-07-27, RELEASED)

PR #929 removes avoidable server-read waterfalls without changing the data contract. Once the batch identity
and status are known, the whole-batch head counts, filtered exact count, and bounded editable option reads run
concurrently. The bounded row page still waits for its exact filtered pagination; correction targets start only
after those rows are known. Every started read is awaited before render, and failures remain fail-closed.

No query, tenant/batch scope, limit, KPI definition, filter, UI control, cache policy, write path, RPC, migration,
schema, or dependency changed. Source-order regressions pin the concurrency and prevent partial render or a
future reintroduced waterfall.

Release evidence: commit `19da7ed`, merge `0155c8e`, production deployment
`dpl_5bUiqwDEy9r4p6rHG4FBSbxMz9Ev`. Focused tests 38/38; full Vitest 803 passed + 13 controlled skips;
TypeScript/ESLint clean; build 65/65; app/shared/secret/Vercel green; DB baseline unchanged. Live owner-session
measurements: 4.2s navigation and 2.8s immediate reload, with the same 698 rows and release gates.

### 8.6 Lazy editable-option loading (2026-07-28, RELEASED)

PR #942 removes seven account/dimension reads from every initial batch render and row-save refresh.
Accounts, cost centers, suppliers, buyers, farms, sectors, and hawshat now load only when a reviewer
first opens a row. The server action requires owner/accountant, derives the org from the session, validates
the batch UUID, and proves the batch exists in the same org with `status = staged` before the seven bounded
reads. Every list retains its previous org, active/archive, order, `LIMIT + 1`, overflow, and leaf-account
rules. A load failure opens no form and returns only fixed Arabic copy.

The client shares one in-flight request and reuses the result across rows, but invalidates it before every
successful row-save refresh; batch/status/role changes remount the controls. This prevents stale dimensions
from surviving a review write while keeping untouched initial renders free of the seven queries. Independent
review found and closed the missing staged-batch binding and stale-cache risks. No review decision or money
gate changed. Merge `c6b0019`; production `dpl_2utZSFoGij4jJwCmSrA4Nje7wNX9` READY. Authenticated timing
is intentionally unclaimed until an owner session is available.

### 8.7 Dual-run acceptance package (2026-07-28, RELEASED)

PR #944 adds the missing read-only evidence packet between row review and the human acceptance gate:
`/finance/reconciliation/[batchId]/acceptance` plus
`/api/finance/reconciliation/[batchId]/acceptance.csv`. The page and annex use the same immutable package
builder and one database snapshot. They preserve source amounts as exact decimal text, classify every row
into an explicit destination, distinguish planned / executed / reverted / unsettled phases, and exclude
skipped or unresolved rows from posted totals. Posted and reversed execution results both remain visible as
real money actions. A deterministic digest binds batch identity, status, lifecycle/result summary, evidence,
row decisions, and the generated report.

The printed assertion is intentionally not a software-generated approval. It requires the reviewer to record:
the source and accounting period; source and system totals; difference or written explanation; exceptions;
accepted outcome; and dated accountant and owner names/signatures. The CSV annex is UTF-8/BOM compatible and
prevents formula injection, including whitespace/control-prefixed formula leaders, without changing valid
canonical numeric literals.

Migration `20260728120000 accounting reconciliation acceptance snapshot.sql` was applied to production as
hosted `20260728112054 accounting_reconciliation_acceptance_snapshot`. Its sole RPC is read-only,
`STABLE`, `SECURITY INVOKER`, `search_path = ''`, active-org + `finance.read` gated, executable by
`authenticated` only, and bounded to 1,000 rows. It refuses empty, overflow, incomplete, malformed,
count-mismatched, unknown-enum, wrong-batch, or unsettled execution snapshots. No service-role client, direct
DML, decision, freeze, approval, execution, rollback, or posting path is present.

Release evidence: merge `829b8f9`; production deployment `7pQ9nJX1nMXeUjA58BoL9DBRYqCq`; two independent
reviews APPROVE; focused Vitest 145/145; full Vitest 959 + 13 controlled skips; TypeScript/ESLint clean;
build 65/65; acceptance pgTAP 85/85; full pgTAP 2,961 passing, zero file failures, and only the two unchanged
stock-engine baselines. Production catalog and grants match the contract. Pre/post counts remained exactly
1 batch / 698 batch rows / 698 evidence items / 10,201 expenses / 162 sales / 10,365 journals.

Current baseline note: subsequent test-only PR #946 (`cddf044`) removed calendar drift from those two stock
fixtures without changing engine behavior. The full local and GitHub pgTAP baseline is now 2,963 passing,
zero failures, and zero file failures.

**Acceptance is still pending.** The owner/accountant must decide all 698 rows, perform the real workbook
dual run, resolve every exception, and sign/date the assertion. Shipping this packet completes the software
surface for that control; it does not itself make accounting dependable daily use 100%.

### 8.8 Explicit journal entry dates (2026-07-30, MIGRATED)

Production migration `20260730075952 accounting_journal_entry_date_required` removes the last silent
date default from the internal two-line posting choke point. `fn_post_two_line_journal` now raises SQLSTATE
23502 when `p_entry_date` is null, checks the period lock against the supplied date, and stores that date
directly. The signature and all valid-date posting behavior remain unchanged.

The active caller audit covers sale finalization, collections, custody, payment settlement, opening balance,
historical backfill, reconciliation execution, and reconciliation rollback. Every caller resolves a non-null
business date before reaching the helper. A seven-assertion regression proves null refusal with no write,
exact explicit-date preservation, valid-date idempotency after period lock, signature stability, and grant
hygiene. Full Docker-free pgTAP is 3,108/3,108; independent review is APPROVE. Hosted catalog postflight
confirms the guard, removal of the `current_date` fallback, empty `search_path`, and no client execute grant.

This closes issue #719 item 3. It does not complete accounting acceptance: all 698 staged reconciliation
rows still require human decisions, exception resolution, workbook dual-run, and dated accountant/Owner
acceptance.

### 8.9 Balance-sheet account-integrity refusal (2026-07-30, MIGRATED)

The balance-sheet RPC must not silently discard posted activity when journal entry, line, and account
organizations disagree. Although the normal posting helper prevents these shapes, the legacy single-column
foreign keys permit privileged or historical cross-organization references.

Migration `20260730120000 accounting balance sheet account integrity.sql` adds a fail-closed precheck over
posted, as-of-bounded records touching the requested organization. A mismatch raises a fixed SQLSTATE 23514
error without exposing identifiers. It changes no totals or JSON for valid ledgers and does not mutate or
repair data.

Evidence: hosted aggregate preflight found 0 mismatches across 20,730 posted lines; the three targeted
plans measured about 5 ms, 2.8 ms, and 2.2 ms; focused pgTAP is 10/10 and full pgTAP is 3,118/3,118.
Independent review is APPROVE. Production migration
`20260730083902 accounting_balance_sheet_account_integrity` is applied; hosted postflight confirms all
three predicates, unchanged metadata/grants, and zero account-org or entry-line mismatches across those
20,730 posted lines. No business row changed.

### 8.10 Acceptance source control totals by period and sheet (2026-07-30, RELEASED)

The acceptance report summarized a batch by classification and by destination, but a dual run is performed
one accounting period and one workbook sheet at a time. Preparing it therefore meant re-adding the CSV annex
by hand before any comparison could start.

The report now carries two further breakdowns of the SAME rows: by calendar period (`YYYY-MM`, with a
subtotal per calendar year) and by source workbook sheet. Each group states its row count, how many of those
rows carry a recorded source amount, how many carry none, the exact source total, and the part of that total
whose reported destination is a posting — the same basis the existing destination table uses, so held,
rejected, undecided, skipped and unsettled rows never enter it. Both breakdowns are exact partitions of the
batch and close visibly on the report's own batch-wide source total.

Period keys come only from `evidence.source_date_parsed`, and only when `invalid_calendar_quality_flag` is
false and the recorded value is a real calendar day. The raw `source_date_text` is never parsed. Three fixed
non-period groups are always printed and never merged: an unreadable/flagged source date, no recorded source
date (production-snapshot rows and anything else undated), and no readable evidence. Sheets use the report's
own natural order widened to Arabic-Indic and Persian digits by a local comparator, so «ورقة ١٠» follows
«ورقة ٢» and the shared locator comparator behind the signed row order and the CSV annex is untouched; two
names that differ only in digit script stay two sheets, tied deterministically by the raw comparator. Two
fixed fallbacks cover a blank sheet name and unreadable evidence, so no row is dropped from either table.

Both breakdowns are six columns wide and the report is signed on paper, so the wrapper's horizontal scroll —
which prints as a silently clipped column — is disabled in `@media print` only: the table drops its screen
minimum width, fits the portrait page with fixed column shares, wraps every cell, and repeats its header if
it spans pages. Screen behaviour is unchanged. A headless-Chrome A4 portrait render of the table at realistic
print geometry clips the last money column without the rule and fits all six columns with it.

The page prints an unconditional caveat: these are calendar buckets taken from source dates, a calendar month
is not a fiscal period, and mapping the buckets onto accounting periods — like choosing what the dual run is
performed against — remains the accountant's decision. Nothing is stored, decided, or claimed about the
workbook's own totals.

Scope limits held: no migration, schema, RPC, extra query, server action, write, bulk decision, fiscal
assignment, or stored acceptance. The page and CSV route each still perform exactly one acceptance snapshot
read. `ACCEPTANCE_CSV_COLUMNS`, `acceptancePayloadDocument`, the CSV route output and
`ACCEPTANCE_DIGEST_VERSION` are unchanged, and the annex/digest bytes for a fixed fixture are now pinned by
regression tests (payload digest `961c74b6…`, CSV SHA-256 `4339720a…`, 73 columns), so a later format change
must be an explicit versioning decision rather than an incidental edit.

Evidence: focused acceptance Vitest 144/144; full Vitest 1,264 passing with 13 controlled skips across
91 files; TypeScript clean; ESLint clean on the four touched TS/TSX files; production build compiled with
64/64 static pages generated; `git diff --check` clean. The Docker-free pgTAP shim is unchanged at
3,118/3,118 with zero file failures — this slice touches no SQL. Independent review is APPROVE after
print-fit and Arabic/Persian numeral-order corrections. Exact-head PR #975 app, design-system, db-tests,
gitleaks, and Vercel checks are green. PR #975 merged at
`bf0895ef3bf61cef11cda12f1b6d90a0a1edf033`; exact production deployment
`dpl_A7fXs2LWRVZEzzyYgS99tFPwK6rR` is READY, and exact-merge main CI, release, and db-tests are green.
Public `/login` is 200, the signed-out acceptance route redirects to `/login`, and the post-release
runtime-error window is empty. Authenticated real-route print was unavailable; Chrome A4 portrait replica
validation and print-contract regressions passed. No migration or business row changed.

### 8.11 Acceptance amount-correction totals (2026-07-30, RELEASED)

An included row that names the production record it corrects does not simply post its source amount. Both
execution RPCs — `fn_..._execute_expense_batch` and `..._execute_sale_batch` — first reverse the named
record's journal (`fn_reverse_journal_entry`, a `correction_reversal` action link, the corrected row moved to
`historical_reversed`), then post a REPLACEMENT only when the batch row's source amount is positive. A zero
amount creates no replacement row or journal. The executor writes
`execution_result='reversed'` for that row. The acceptance report treated the replacement as an ordinary
posting: it entered `plannedPostingTotal` and every control-total `postingAmount`, which overstated those
figures by the whole reversed amount. It also labelled `reversed` as "execution unsettled" in an executed
phase, even though `reversed` is precisely the result a correction is expected to carry.

**What a correction row is, for this purpose.** A healthy included correction carries both
`amount_correction_candidate` evidence and the dataset-matched `corrects_expense_id`/`corrects_sale_id` link
the executor uses. Database guards require that shape and reject missing or cross-domain linkage. The report
also defends against a malformed snapshot: either correction evidence or any correction link is enough to
segregate the row from ordinary posting totals into `correction_invalid`, whose wording makes no execution
claim. The existing `correctionCandidates`, `correctionLinked`, and `correctionUnlinked` quality counts also
expose missing linkage.

**What changed.** `included_correction` is a new phase-aware acceptance destination. Its label says, in every
phase, that the row is a correction, that the old record is reversed, and that the displayed amount is the
replacement — and never that a correction posts nothing. Correction rows are excluded from
`plannedPostingTotal`, `plannedPostingRowCount`, and every period / year-subtotal / sheet / batch-footer
`postingAmount` and `postingRowCount`; the posting labels now say "additions only". Their gross replacement
amount is reported separately and exactly as `correctionReplacementTotal` + `correctionRowCount` — the same
rows the destination group prints — and rendered on the Arabic RTL acceptance page under its own heading with
`ACCEPTANCE_CORRECTION_CAVEAT_AR`, printed unconditionally (including at zero correction rows). That caveat
states that zero creates no replacement row or journal, the net ledger effect is (new − old) per row, is
computed nowhere in this report and stored
nowhere in the system, and that the figure is a gross replacement-source total which may span owner drawings,
capital spend, operating expenses and sales at once and is therefore not a profit, expense or revenue line
(CLAUDE.md #6). Lifecycle mapping: planned → correction group; `reversed` in the executed, reverted and
unsettled phases → correction group (the reverted wording adds that it executed then rolled back);
`skipped` → skipped; anything else, including a `posted` correction the executor never writes → unsettled.
The ordinary posting headline now derives from the same reported destination used by every control total.
A missing replacement amount stays unknown (never zero); an exact `0` replacement is a known zero, because a
zero-value correction still reverses a real journal and the executor keeps it `reversed`.

**Digest decision — deliberately NO version bump and no v1 compatibility builder.** The digest recipe,
canonicalisation, and the 73-column CSV schema (ids, order, headers) are byte-unchanged, so
`ACCEPTANCE_DIGEST_VERSION` stays `farm-os.reconciliation-acceptance.v1` and unaffected already-signed
v1 packet stays valid. The per-row `destination`/`destination_ar` cells are already digested CONTENT, so the
same row moving between an ordinary addition and an amount correction changes the digested bytes and therefore
the package digest — asserted by test rather than assumed. The computed aggregates (classification,
destination and control totals, the posting and correction figures) are not themselves hashed; they are
derived views over rows the digest already binds, and the comments were corrected to say so.

The read stays one bounded, org-scoped snapshot; the destination partition stays exact (every row in exactly
one group); canonical row order, CSV columns, database/RPC/schema, grants, gates, decisions and all writes are
untouched. Included correction rows intentionally receive different destination cells; the pinned
non-correction fixture remains byte-identical.

Production aggregate preflight (read-only; no row identifiers recorded): one staged batch of 698 rows, with 15
amount-correction candidates — all held, unreviewed, unlinked, pending, not frozen. No reviewed, approved,
executed or rolled-back batch exists, and no row carries a payload hash or frozen state. No production figure
therefore moves today; the fix is what keeps the totals honest the first time a correction is linked and
included.

Local evidence: focused acceptance Vitest 157/157; full Vitest 1,277 passing with 13 controlled skips across
91 files; TypeScript clean; ESLint clean on the three touched files (`lib/reconciliation acceptance.ts`, its
test file, and the acceptance page); production build compiled with 64/64 static pages generated;
`git diff --check` clean. The pinned format guards (payload digest `961c74b6…`, CSV SHA-256 `4339720a…`, 73
columns, 2,675 bytes) are unchanged and passing, since the pinned fixture holds no correction row. pgTAP was
NOT run for this slice: no SQL byte changed. Independent review is APPROVE after three correction rounds; no
migration or data change is part of this slice. **Phase 2 remains gated:** computing the net (new − old)
effect requires human selection and linkage of each correction to its production record, plus accountant
policy. PR #977 merged at `002d04cfcad74f7bdc6088c4111d6d68a6bcee88`; exact production deployment
`dpl_7G5oxX4nd7JswTUnsPiBAjShVAcf` is READY. Exact-head checks and exact-merge main CI, release, and db-tests
are green. Public `/login` is 200, the signed-out acceptance route redirects to `/login`, and the post-release
runtime-error window is empty. No migration or business row changed.

### 8.12 Queue route to the acceptance report's evidence-quality exceptions (2026-07-30, MERGED / DEPLOYED / LIVE-SMOKED)

**Status: PR #981 merged at `7566402c1ca8757cb4e609ee9e35d3f0d949a932`; exact deployment
`5XWz8F9CE29VcyTq4bWLbRaHySm2` completed. Independent Codex review APPROVE. No migration, dependency,
production row decision, or financial figure changed.**

**The gap.** The acceptance packet (§8.7, §8.10) prints a quality panel of named exception figures the
accountant is expected to resolve before signing, among them «تواريخ مصدر غير صالحة» and «صفوف بلا مبلغ
مصدر مسجَّل» (`lib/reconciliation acceptance.ts` `AcceptanceQualityCounts.invalidDate` /
`.missingSourceAmount`, rendered at `app/(app)/finance/reconciliation/[batchId]/acceptance/page.tsx`).
The review queue is the only surface where those rows can actually be decided, and §8.4 gave it exactly
two filter dimensions: evidence `classification` and decision `state`. Neither of these two exceptions is
either one — `invalid_calendar_quality_flag` and a null `source_amount` both cut ACROSS all five
classifications and all five review states. The batch row card already renders the «تاريخ غير صالح» tag,
so the fact is on screen, but at 50 rows per page the only way to enumerate those rows in the staged
698-row batch was to open all fourteen pages and read every card. The report told the accountant a number
it gave them no way to navigate to.

**The change (two source files, no SQL).** A third bounded filter dimension, `quality`, with a closed
two-value allowlist:

| URL value | Predicate | Acceptance figure it routes to |
| --- | --- | --- |
| `invalid_source_date` | `evidence.invalid_calendar_quality_flag eq true` | «تواريخ مصدر غير صالحة» |
| `missing_source_amount` | `evidence.source_amount is null` | «صفوف بلا مبلغ مصدر مسجَّل» |

`reconciliationQueueQualityPredicates()` is the closed mapping, in the same shape and spirit as the
existing `reconciliationQueueStatePredicates()`. Its predicate carries an explicit **operator** because
the two are not both equalities: "no recorded source amount" is a NULL test, which PostgREST expresses as
`is`; an `eq`-with-null would match nothing and would have reported an empty exception list rather than a
real one. `parseReconciliationQueueFilters()` remains the single URL allowlist — an unknown, empty,
injected (`source_amount.is.null`) or repeated value resolves to the unfiltered queue and is never
forwarded as PostgREST syntax.

Both predicates read columns the queue's evidence relation **already joins and already selects**, so the
filter adds no query, no round trip, no new relation and no widening of what the page reads. It is applied
to the filtered exact count and to the 50-row page query identically — filtering only one would page a
narrowed list against an unnarrowed total.

**Boundaries, all deliberate.** The whole-batch KPI strip (the 698 total and its unreviewed / included /
held / rejected / frozen counts) stays independent and unfiltered, as it is of the other two dimensions —
pinned by test. The freeze, approve, execute and rollback gates, the 50-row pagination bound, the
`batch_id` + `org_id` scoping, the tenant-safe evidence join, the row order, the decision payload
contract, the read concurrency of §8.5, the lazy option cache of §8.6, and every acceptance
report / CSV / digest byte are untouched. **This slice adds no decision path of any kind: it changes which
rows are listed, never what any row says or what happens to it.** No row was decided.

**Two honest limits, stated rather than papered over.** (1) `missing_source_amount` selects rows whose
evidence records no source amount — which structurally includes every production-orphan row, because the
`reconciliation_evidence_items_locator_shape` CHECK requires a `production_snapshot_row` to carry no
source amount at all. It is a faithful route to the reported population, not a smaller "surprising rows
only" set. It also does not cover the report's separate `missingEvidence` alarm, whose rows cannot appear
in an `!inner`-joined queue at all and which the report alarms on independently. (2) The report's third
exception, «صفوف تصحيح بلا سجل مُصحَّح», is deliberately NOT a `quality` value: its rows are already
reachable via `classification=amount_correction_candidate` (15 rows, one page), and a predicate for it
would have to pin `evidence.classification` itself, colliding with the caller's own classification
choice. Isolating the unlinked subset within that population remains a visual step.

**Not attempted, and why.** The queue is ordered by `evidence_item_id`, while the acceptance report and
its CSV annex are ordered by evidence locator (sheet, then row) — `orderByEvidenceLocator`, whose own
comment records that PostgREST cannot express that order across an embedded relation. The two orders
genuinely differ, but reconciling them cannot be done inside a bounded server filter: it needs either an
ordering PostgREST cannot express or an unbounded read of the whole batch, which would break the
pagination bound. It is left open rather than half-done.

**Local evidence.** Regression checks written first: nine new assertions in `lib/tests/reconciliation
review.ts` (a five-test "evidence-quality queue filter" suite plus four additions to the "queue source
contract" suite) **failed 9/9 against the pre-fix bytes**; a tenth, the non-regression guard that the
whole-batch KPI loader never sees the quality filter, is green both ways by design. Focused Vitest 56/56;
full Vitest **1,292 passed + 13 controlled skips across 91 files** (baseline 1,283 + 13 across 91 —
exactly the nine new tests); `tsc --noEmit` clean; ESLint clean on all three touched files; production
build compiled successfully with **64/64** static pages; `git diff --check` clean. **pgTAP was NOT run:
zero SQL bytes changed.** Exact-head checks and exact-merge main CI/release/db-tests are green. Aggregate-only
production postflight found 698 joined rows, 2 rows with no source amount (both production snapshots), 0
invalid-date flags in this staged queue, and 15 correction rows; no identifiers, descriptions, or financial
values were read. No authenticated browser session was available, so the UI controls were not exercised
against a real row.

### 8.13 Read-only authenticated role-acceptance harness (2026-07-30, MERGED / DEPLOYED / SIGNED-OUT SMOKED)

The legacy wedge-loop Playwright suite provisions users with the service role and resets operational data,
so its enforced local-only guard is correct and remains unchanged. Farm no longer has a Docker-backed local
Supabase workflow, leaving no safe current browser path to prove the owner/accountant reconciliation surface.

The separate `playwright accounting readonly.config.ts` and `e2e/accounting readonly.spec.ts` close the
engineering part of that gap without creating a data path. Owner, accountant and denied-role credentials plus
the batch UUID come only from explicit environment variables. Remote execution requires an acknowledgement
flag and the exact production origin allowlist. After login, Playwright blocks service workers and intercepts
all page traffic: POST, PUT, PATCH and DELETE are aborted and fail the test; only GET, HEAD and OPTIONS remain.
The finance-role checks cover the reconciliation list, pinned batch, GET evidence-quality filter, acceptance
report and CSV. The denied-role check follows the existing `/dashboard` router to the role-specific manager,
field or inventory destination and verifies reconciliation content is absent. No test touches staging, review
decisions, freeze, approval, execution or rollback.

The pure policy lives in `lib/accounting e2e safety.ts`, with target, UUID, credential and HTTP-method tests
plus a source contract that rejects privileged clients/direct database access and financial-action locators.
Local evidence: focused Vitest 8/8; full Vitest 1,300 passed + 13 controlled skips across 92 files; TypeScript
and touched-file ESLint clean; build 64/64; missing configuration fails before browser launch. The authenticated
suite was not run because no role credentials were present. This is not accountant acceptance and does not
change the 698 unreviewed/hold rows, the 0 frozen count, the dual-run requirement or Stage 7's ~99.5% status.
Independent safety review is APPROVE after three rounds.

PR #983 merged at `3962e8caea3cff062e00c46085a2146d069f3729`; exact production deployment
`dpl_DmWDiUSzmoid9cX5txnqX4PdMx1J` is READY. Main app/design CI, release, gitleaks and pgTAP are green.
`/login` is 200, signed-out reconciliation routes redirect to login, and the deployment has no 5xx runtime
logs. No migration existed. The credentialed owner/accountant/denied-role suite remains unrun.
