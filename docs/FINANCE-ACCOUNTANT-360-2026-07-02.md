# FINANCE-ACCOUNTANT-360 — the accountant's workday (2026-07-02)

*Read-only focused review against main (code = `6184961`). Question: can the accountant run a real day and a real month in this? (The kernel wiring was reviewed separately — A−; this is the workday.) Paths relative to `apps/farm-os/`.*

## Grade: D+ as a daily tool (kernel: A−)

**The severing find: the ONLY function that routes an expense into the payment pipeline has no UI.** `setExpensePaymentStatus` exists (`app/(app)/custody/actions.ts:116`) and is **imported by nothing**; new expenses insert with `payment_status = NULL` (`expenses/actions.ts:40-52`; no column default); `fn_add_expense_to_request` hard-requires `post_paid_unpaid|paid_from_custody` (`20260701220000:637`). **An expense recorded in the app can never be paid, marked آجل, or added to an إذن صرف from the app.** Every آجل KPI on /custody counts only rows set outside the UI.

## The workday walkthrough

| Task | Path & effort | Verdict |
|---|---|---|
| Fund custody | /custody → «+ حركة عهدة» ≈ 4 clicks + amount; posts to GL | **B−** — but NO date field: the RPC accepts `p_occurred_at` (`20260629150000:265-267`), the action never passes it → today-only, can't record yesterday |
| Pay expense cash from custody | record expense (~9 interactions) → mark paid_from_custody → **no UI exists**; raw «صرف نقدي» can't carry `p_expense_id` either | **F** — the core daily entry is impossible end-to-end |
| Record آجل expense | AddExpense «طريقة الدفع» is free text (`AddExpense.tsx:128-130`) — typing آجل sets nothing | **F** — looks recorded, routed nowhere |
| Settle a payment request | full lifecycle works (send→op-approve→final→fund→confirm-per-line→close), live totals, printable إذن صرف | **B− structurally / C effort** — confirming 15 lines ≈ 90 interactions, no confirm-all |
| Record drawing (مسحوبات) | AddExpense kind=مسحوبات; two-step insert + `fn_set_expense_kind`; on step-2 failure the error says «غيّر النوع لاحقًا» — **no reclassify UI exists** | **B−** with a stranding path polluting non-negotiable #6 |
| Yesterday's 12 receipts | form closes+clears per save (`AddExpense.tsx:49-58`); custody form has no date at all | **F** — no batch/fast path anywhere |
| Duplicate detection | none (no constraint, no soft warning) | missing |
| Evidence | `attachments.entity_type` CHECK excludes finance entities (`20260622000082:18`); no `invoice_no` on expenses | **zero evidence capture on finance surfaces** |
| Month-end | no period close (Slice A by design); producible: expenses CSV, /finance/pnl (**not in nav**, no export), /accounting TB (no export; CoA empty → «لا توجد قيود») | **C−** — no monthly pack |
| Error correction | routed expenses immutable by trigger (correct) but the promised reversal has **no button and no GL reversal RPC**; unrouted rows have no edit/void UI; audit rows exist but **no audit-log page anywhere** | **D** — wrong amount = start over or call the developer |
| The approval triangle | UI labels op-approval «(مدير المزرعة)» yet farm_manager has neither the permission (`request.approve.op` = owner/accountant, `20260629150000:53`) nor page access; the preparer can self-approve; no queues/notifications — the owner learns by being phoned | **C−** — a 2-person flow wearing a 3-signature paper costume |
| Arabic register | strong (عهدة، إذن صرف، ميزان المراجعة، مدين/دائن، آجل، اعتماد تشغيلي/نهائي); gaps: no سند قبض/سند صرف serials on movements; journal source_type falls back to raw English | **B+** |

## Top 10 gaps (adoption impact; each one PR)

1. **Wire the payment-routing UI**: «حالة السداد» select on AddExpense (آجل / من العهدة+account / من المالك) calling the existing action; same control on the expense 360. *(Unblocks the entire custody pipeline.)*
2. **Date on the custody form** — pass `p_occurred_at` through.
3. **Batch entry**: «حفظ وإضافة آخر» keeping date/supplier/kind, refocusing amount.
4. **Edit/void/reclassify for unrouted expenses** (mirror the trigger's routed/unrouted line; void via `payment_status='cancelled'`; kind via `fn_set_expense_kind`).
5. **Fix the approval triangle**: either grant farm_manager `request.approve.op` + page read and block approver==preparer in the RPC, or relabel the step honestly.
6. **Duplicate warning** on same org+supplier+total+date.
7. **Evidence**: extend attachments CHECK to `expense`/`payment_request` (+ writes gated `budget.write`), add `invoice_no`, embed MediaGallery on the expense 360.
8. **Monthly outputs**: /finance/pnl into nav + print/CSV on pnl + accounting + custody; `fn_custody_statement(account, from, to)` (opening/in/out/closing).
9. **Corrections visible**: read-only «سجل التدقيق» card on expense/custody pages (audit_read already gates) + a «قيد عكسي» button posting the opposite movement with a linking note.
10. **Confirm-all settlement**: multi-select funded lines + one account/date, loop `fn_confirm_request_expense_paid`.

Honourable mentions: AddExpense can't scope to farm/sector/hawsha though columns+RLS exist (`20260622000044:25-27`) — blocks expense-by-hawsha reporting forever until added; finance-dashboard KPI totals are honest 12-row samples an accountant will misread as period totals.

## The monthly owner pack (spec — no new tables)

One printable `/finance/monthly?month=`: 1) قائمة الدخل التشغيلية (fn_owner_pnl_summary + month preset + print/CSV) · 2) ملخص العهدة per account (needs the one `fn_custody_statement` RPC) · 3) كشف حركة العهدة with running balance · 4) المصروفات حسب الفئة×النوع (+hawsha once entry captures it) · 5) ملخص المسحوبات (below the line) · 6) ميزان المراجعة (blocked on CoA #577; add period+export) · 7) الآجل aging (meaningful only after gap #1) · 8) طلبات الصرف للشهر. Prerequisites for credibility: gap #1 + CoA seed (#577).

## Protect

RPC-only append-only custody ledger + `expense_guard_routed_money_immutable` (new edit UI must respect the routed/unrouted line) · claim-first + 1:1 movement↔expense + idempotent GL posting + one-cash-out uniqueness · the kind split (`fn_set_expense_kind` sole writer; drawings below-the-line) — non-negotiable #6 enforced in depth · owner-only `request.approve.final` + farm_manager custody exclusion · the honesty patterns (real actors/timestamps only; «لا يوجد نموذج إيرادات بعد» not 0; full-period SUMs) · the printable three-signature إذن صرف — it matches the farm's real paper.

**Bottom line:** gaps #1–#3 are small PRs that jointly lift the workday from D+ to ~B. #1 is arguably the single highest-value 20-line PR in the product right now.
