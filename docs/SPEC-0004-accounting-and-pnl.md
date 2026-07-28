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

*All of §7 is design only — no enforcement changes here. Slices land via the gated flow (independent
review + Owner gate); the real-data reconciliation stays behind Stage M.*

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
