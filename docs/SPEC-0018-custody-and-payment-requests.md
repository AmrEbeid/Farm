# SPEC-0018 — العهدة وطلبات الصرف (Custody & Payment Requests)

*Status: **DRAFT for Owner review** — design only; no schema applied, no prod mutation. Digitizes the
paper «إذن صرف المزارع» into a live, auditable custody + payment-request
module. Builds on existing Farm OS surfaces — the `expenses` table, the `attachments` table (`0082`), and the
org-scoped `authorize()` model — rather than duplicating them. It also depends on the draft SPEC-0004 accounting
lane for the `expenses.kind` operating/drawing/capex split (`0088` / PR #368); if that lane is not merged/applied
first, this module's first migration must include the same #6 split before any custody/request math ships.
Companion to [`SPEC-0004`](SPEC-0004-accounting-and-pnl.md) (P&L),
[`SPEC-0006`](SPEC-0006-people-labor-payroll.md) (labor/PII), [`CLAUDE.md`](CLAUDE.md) non-negotiables #1/#6.*

*An immediate Google-Sheets/Excel tool ships first (Deliverable A — `إذن-الصرف-والعهدة-Ebeid-Farm-v1.xlsx`);
this spec is the Farm OS module it migrates into (Deliverable B). The two share the same data model so the
sheet's CSVs import cleanly (§11).*

> Privacy note: this spec intentionally avoids embedding the real line-item amounts, worker-level matrix, receipt
> details, or bank/payment identifiers. Those stay in the offline workbook until the Stage-M privacy review and
> import dry-run approve their handling.

---

## 1. Product recommendation
- **Now (this week):** a **Google Sheets** workbook (built as `.xlsx`, upload to Drive → "open as Google
  Sheet"). Reasons: zero build time, Arabic-RTL + printable PDF out of the box, the farm staff already live
  in WhatsApp/Drive, receipt photos link straight from Drive, and it is **migration-ready** (its 8 sheets map
  1:1 to the tables below). Excel is the offline fallback (same file). *Not* a bespoke app yet — the process
  must stabilize on paper-equivalent first.
- **Later:** fold it into Farm OS as the **«العهدة وطلبات الصرف»** module (this spec), once the data shape and
  workflow are proven in the sheet and the team is ready for role-based, audited, multi-device use.

## 2. The current process (from إذن صرف #6) and its failures
Owner gives the Farm Manager a **permanent custody float**. The Manager hands cash custody to the
Accountant as needed. Some expenses are **paid from custody** (cash); the big ones — **labor and
tasmeed/fertilization** — are **post-paid** and requested from the Owner. Today this is a hand-totaled paper
form with category subtotals, labor/tasmeed detail, loose attached receipts, and the **custody top-up
scribbled in the margin**. Failures: never "always-ready",
no live balance, proof is loose paper, no approval trail, double-count risk between "paid cash" and
"requested from owner".

## 3. Core money rules (identical in sheet and module)
- **Current custody = Σ(amount_in) − Σ(amount_out).** Cash-paid expenses post an `amount_out` movement.
- **Post-paid unpaid** expenses are requested directly from the Owner (never hit custody).
- **Custody top-up = MAX(0, target_float − current_custody).**
- **Net payment request = post-paid unpaid + custody top-up.**
- **Never double-count:** an expense is *either* `paid_from_custody` (already left custody) *or*
  `post_paid_unpaid` (requested) — its `payment_status` decides which bucket; the request sums only the
  unpaid bucket + the top-up.
- **Flags:** missing receipt, duplicate receipt number, negative custody balance, unapproved expense.
- **#6 non-negotiable:** owner **drawings (مسحوبات)** must be classified separately (`kind='drawing'` once the
  SPEC-0004 split lands) and are **excluded** from operating-expense and custody-request math (they are a separate
  owner transfer).

## 4. Database tables (Postgres, all org-scoped + RLS + FORCE RLS + audited)
Extend, don't duplicate. New tables:
- **`custody_accounts`** — `(id, org_id, holder_membership_id, target_float numeric, active bool)`. One per
  custodian (Farm Manager, Accountant). `target_float` per holder.
- **`custody_movements`** — `(id, org_id, custody_account_id, occurred_at, movement_type, amount_in numeric,
  amount_out numeric, expense_id uuid null, note, created_by)`. Running balance is **derived** (never stored);
  `fn_custody_balance(account)` = `Σin − Σout`. CHECK: amounts ≥ 0; exactly one of in/out > 0.
- **`payment_requests`** — `(id, org_id, request_no int, period_start, period_end, status, prepared_by,
  approved_op_by, approved_final_by, submitted_at, approved_at, note)`. `status ∈
  draft→submitted→approved_operational→approved_final→paid→closed`. Totals are **derived** from linked
  expenses (not stored), so the request is always live.
- **`payment_request_lines`** — `(id, org_id, payment_request_id, expense_id)` — which expenses belong to a
  request (a request = a period's expenses + the top-up).

Reuse/extend existing:
- **`expenses`** (SPEC-0004) — add `payment_status text` (`paid_from_custody|post_paid_unpaid|paid_by_owner|
  cancelled`), `location text`, `paid_by`, `custody_account_id null`. Keep or add `kind`
  (operating/drawing/capex) for the #6 drawings split before any request totals are enabled. Money total stays on
  the line.
- **`attachments`** (`0082`) — extend the existing node-media attachment model for finance receipts before use:
  allow `entity_type='expense'`, update the resolver RPC/storage path validation, and add finance-confidential RLS
  / read gates for receipt media. Receipts then use `entity_id=expense.id`; the missing-proof/duplicate-number flags
  are computed views.
- **labor / tasmeed detail** — reuse `plan_operations` + `plan_labor_requirements` where an expense ties to a
  planned operation; otherwise a lightweight `expense_detail (expense_id, kind, qty, unit_price, …)` for the
  ad-hoc lines (labor matrix, fertilization breakdown). Detail **reconciles to** its expense
  line; it is never summed again (anti-double-count).

## 5. Secure RPCs (SECURITY DEFINER, `search_path=''`, EXECUTE locked, internal `authorize()` check)
`fn_record_custody_movement`, `fn_save_farm_expense`, `fn_set_expense_payment_status`, `fn_attach_receipt`,
`fn_create_payment_request`, `fn_add_expense_to_request`, `fn_submit_payment_request`,
`fn_approve_request_operational` (Farm Manager), `fn_approve_request_final` (Owner), `fn_close_month`,
`fn_import_from_sheet` (§11). **No direct client DML** on any of these tables — RLS denies writes; the RPC is
the only path; audit is server-side via the `fn_audit` trigger.

> ⚠️ Adding the new permissions below **re-emits `authorize()`** — it MUST carry the **union** of all existing
> perms (the re-emit footgun). Run `tests/22` + `tests/97` after.

## 6. Roles & permissions (maps onto the existing 6 roles)
Existing roles are `owner`, `farm_manager`, `agri_engineer`, `accountant`, `supervisor`, and `storekeeper`.
This finance module is **not all-member readable**: custody, payment requests, receipts, and wage/tasmeed detail
are finance-confidential. A future auditor role requires a separate role-model decision; until then, read-only audit
access is owner/accountant only.

| Capability | Owner | Farm Manager | Accountant | Agri engineer / Supervisor / Storekeeper |
|---|---|---|---|---|
| View custody/payment requests/receipts | ✅ | ⬜ Owner-ratified scope only | ✅ | |
| Enter expenses, attach receipts, prepare requests, record custody | | ✅ | ✅ | |
| Approve **operational** expenses | ✅ | ✅ | | |
| **Final approve** a payment request | ✅ | | | |
| Close the month | ✅ | ✅ (then Owner final) | | |
New `authorize()` perms: **`custody.write`** (owner/farm_manager/accountant), **`request.prepare`**
(accountant/farm_manager), **`request.approve.op`** (owner/farm_manager), **`request.approve.final`** (owner).
Do **not** add a broad `expense.write` permission unless a later migration intentionally replaces the existing
`budget.write` expense gate; the current expense privacy posture is owner/accountant by default, with any
farm_manager entry path needing a narrow RPC and explicit tests. Reads remain org-scoped **and finance-role gated**.
Compensation/PII stays gated per SPEC-0006 (labor *wages* in the detail are visible to finance roles only, not all
members).

## 7. Dashboard (module home — mirrors the sheet's لوحة التحكم)
KPIs: current custody balance, target float, required top-up, post-paid unpaid total, **total owner payment
request**, missing-receipts count, unapproved-expenses count. Charts: expenses by category, paid vs unpaid,
custody-balance trend, top-5 categories/suppliers. All query-derived from RLS-scoped reads (never fabricated
KPIs, #1). Built with the existing `KpiCard` + the dashboard pattern from the Module Navigator work.

## 8. Live payment request + printable PDF
A server-rendered Arabic-RTL A4 «إذن صرف» matching the paper: farm header + request no/month, summary by
category, detailed lines, total paid-from-custody, total post-paid-unpaid, current custody, required top-up,
**net requested from Owner**, a **missing-proof warning** section, and signature areas (Accountant → Farm
Manager → Owner). "Always ready": it renders from live data on demand; export to PDF. Numbers via `lib/money`
(Arabic-Indic, tabular) — no Western-digit leaks (#2).

## 9. Daily workflow
1. **Accountant** logs each expense as it happens (category, amount, location, supplier/worker group),
   marks `paid_from_custody` (and a custody `amount_out` auto-posts) or `post_paid_unpaid`; snaps the receipt
   photo → attachment. 2. Labor/tasmeed captured in their detail. 3. Custody top-ups/handovers recorded as
   movements. 4. The dashboard + live request update instantly — ready if the Owner/Manager asks.

## 10. Month-end workflow
1. Accountant reviews flags (missing receipts, duplicates, unapproved, negative custody) → resolves. 2.
   `fn_create_payment_request` for the period; lines = the period's expenses. 3. Farm Manager approves
   operational expenses. 4. Accountant submits. 5. **Owner final-approves** → request is the authoritative
   «إذن صرف #N». 6. Owner pays post-paid + tops up custody → those payments post as custody movements/owner
   transfers. 7. `fn_close_month` locks the period (audited); next month opens.

## 11. Migration path (Google Sheet → Farm OS)
The sheet's 8 tabs map 1:1: `الإعدادات`→`custody_accounts.target_float`+org settings; `سجل العهدة`→
`custody_movements`; `سجل المصروفات`→`expenses` (+ payment_status/category); `تفاصيل العمالة`/`تفاصيل التسميد`
→`expense_detail`; `سجل الفواتير والمرفقات`→`attachments`; `إذن الصرف الشهري`→ derived `payment_requests`.
Export each tab to CSV → **`fn_import_from_sheet(entity, csv)`** validates + writes through the gated RPCs
(same authorize/audit path; **no raw bulk insert**), dedupes by natural key (expense id, receipt no), and
reports rejects. Real Ebeid financial/PII data only enters after the **Stage-M privacy review** (CLAUDE.md
hard stop). The sheet stays the source of truth until import is verified, then the module takes over.

## 12. Acceptance criteria
- Custody balance = Σin−Σout at all times; a cash-paid expense moves it; negative balance flags.
- `net_request = post_paid_unpaid + MAX(0, target − current)`; **a paid-cash expense never appears in the
  request** (no double-count) — proven by a pgTAP oracle.
- Drawings are excluded from operating + request math (#6), with a hard test for the `kind='drawing'` classification
  once the SPEC-0004 split exists in the same apply path.
- Every write is audited (`audit_log`); approvals carry approver + timestamp; the period locks on close.
- A non-finance member cannot read wages, receipts, custody balances, payment requests, or write any
  custody/expense/request row (RLS, FORCE RLS).
- The printable request reconciles to the line items and shows the missing-proof warning when proof is absent.
- `authorize()` after the new perms passes `tests/22` + `tests/97` (no permission dropped).

## 13. Non-negotiables
#1 never fabricate (real receipts or "missing"), #2 Arabic-RTL + mobile/offline-tolerant, #6 drawings≠opex,
PII gated (SPEC-0006), writes via gated RPCs only, server-side audit, org-scoped RLS everywhere. Design only —
no build until each slice is gated.
