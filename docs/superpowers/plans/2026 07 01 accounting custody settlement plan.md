# Accounting Custody Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first standalone accounting slice that posts owner funding and custody-paid expenses into a controlled double-entry ledger.

**Architecture:** Add a minimal accounting kernel with org-scoped accounts, immutable posted journal entries, source links, and a trial-balance RPC. Extend custody/payment requests so owner funds are received as custody before payout, and each request line is confirmed paid from a selected custody holder. Keep the farm's cash-method policy: unpaid request lines are operational pending items until payment confirmation.

**Tech Stack:** Next.js App Router, Supabase Postgres/RLS, SECURITY DEFINER RPCs, pgTAP, Vitest, Arabic RTL UI.

## Global Constraints

- No production migration/apply/merge in this task.
- Money logic requires independent review before merge/apply.
- No fabricated farm or financial data.
- Direct DML stays revoked for gated finance tables; writes go through RPCs.
- Owner drawings remain separate from operating P&L.
- Farm-manager physical custody can be recorded, but app access remains owner/accountant-only in this slice.
- Session brief is updated last.

---

### Task 1: Accounting Kernel And Settlement Migration

**Files:**
- Create: `apps/farm-os/supabase/migrations/20260701220000_accounting_cash_custody_settlement.sql`
- Modify: `apps/farm-os/supabase/tests/102_custody_payment_test.sql`
- Modify: `apps/farm-os/supabase/tests/103_payment_request_test.sql`
- Create: `apps/farm-os/supabase/tests/112_accounting_cash_custody_settlement_test.sql`

**Interfaces:**
- Produces tables: `accounts`, `journal_entries`, `journal_lines`, `payment_request_fundings`
- Extends table: `payment_request_lines` with `paid_at`, `paid_by`, `paid_from_custody_account_id`, `custody_movement_id`, `journal_entry_id`
- Produces RPCs: `fn_accounting_trial_balance`, `fn_record_payment_request_funding`, `fn_confirm_request_expense_paid`, `fn_close_payment_request`
- Re-emits RPCs: `fn_set_expense_payment_status`, `fn_record_custody_movement`, `fn_add_expense_to_request`, `fn_payment_request_totals`

- [ ] **Step 1: Add migration header**

  Document problem, intent, security, cash-method policy, and rollback notes at the top of the migration.

- [ ] **Step 2: Add accounting tables**

  Create `accounts`, `journal_entries`, and `journal_lines` with `org_id`, RLS, FORCE RLS, finance-read select policy, audit triggers, revoked direct DML, and storage checks for one-sided debit/credit lines.

- [ ] **Step 3: Add default account helper**

  Add internal RPC `fn_ensure_account(p_org, p_code, p_name_ar, p_type, p_normal_balance)` and call it from posting RPCs. Required account codes:
  - `1000` عهدة نقدية
  - `3000` تمويل المالك
  - `5000` مصروفات تشغيلية
  - `1500` أصول/مشروعات رأسمالية
  - `3100` مسحوبات المالك

- [ ] **Step 4: Add journal posting helper**

  Add internal RPC `fn_post_two_line_journal(...)` that inserts one posted journal entry and two balanced lines. It must be idempotent with `unique(org_id, source_type, source_id)`.

- [ ] **Step 5: Extend request lines and funding links**

  Add settlement columns to `payment_request_lines` and add `payment_request_fundings` to link request funding to one custody-in movement and one journal entry.

- [ ] **Step 6: Add owner-funding RPC**

  Add `fn_record_payment_request_funding(p_request, p_custody_account, p_amount, p_occurred_at default current_date, p_note default null)`. It must require `request.prepare`, require request status `approved_final` or `paid`, record a custody-in movement, post Dr custody cash / Cr owner funding, and move request status to `paid`.

- [ ] **Step 7: Add payment-confirmation RPC**

  Add `fn_confirm_request_expense_paid(p_request, p_expense, p_custody_account, p_occurred_at default current_date, p_paid_by default null, p_note default null)`. It must require `request.prepare`, require request status `approved_final` or `paid`, require the expense is a line on that request, require it is not already settled, select the custody source, record the custody cash-out, post the correct debit by `expenses.kind`, set the line settlement fields, and set expense `payment_status='paid_from_custody'`.

- [ ] **Step 8: Add close RPC**

  Add `fn_close_payment_request(p_request)` that requires `request.prepare`, requires status `paid`, and closes only when every request line has `paid_at`.

- [ ] **Step 9: Update request totals**

  Re-emit `fn_payment_request_totals` to return separate fields for `operating_unpaid`, `capex_unpaid`, `drawing_unpaid`, `post_paid_unpaid`, `custody_top_up`, `owner_funding_received`, `request_cash_out`, `remaining_to_fund`, and `net_request`.

- [ ] **Step 10: Update existing pgTAP tests**

  Update tests 102 and 103 so capex/drawing can route through payment requests while still staying separate from operating totals.

- [ ] **Step 11: Add new pgTAP coverage**

  Add test 112 for:
  - anon cannot execute new RPCs;
  - accountant can record owner funding only after final approval;
  - owner funding creates custody-in plus balanced journal;
  - confirming payment requires source custody;
  - confirming payment creates custody-out plus balanced journal;
  - duplicate funding source idempotency/duplicate settlement is rejected;
  - close is blocked until all lines are paid;
  - supervisor cannot read accounting tables or trial balance.

- [ ] **Step 12: Run database validation**

  Run: `bash apps/farm-os/supabase/test-shims/run-pgtap-local.sh`
  Expected: all pgTAP tests pass.

### Task 2: App Types And Server Actions

**Files:**
- Modify: `apps/farm-os/lib/database.types.ext.ts`
- Modify: `apps/farm-os/app/(app)/custody/actions.ts`

**Interfaces:**
- Consumes RPCs from Task 1.
- Produces server actions: `recordPaymentRequestFunding`, `confirmRequestExpensePaid`, `closePaymentRequest`

- [ ] **Step 1: Extend database types**

  Add row types for `accounts`, `journal_entries`, `journal_lines`, and `payment_request_fundings`; extend `payment_request_lines`; add the new RPC signatures.

- [ ] **Step 2: Add funding action**

  Validate positive amount and date, call `fn_record_payment_request_funding`, revalidate `/custody` and `/custody/request/[id]`.

- [ ] **Step 3: Add confirm-payment action**

  Validate request, expense, custody source, and date, call `fn_confirm_request_expense_paid`, revalidate `/custody`, `/custody/request/[id]`, `/expenses`, and `/accounting`.

- [ ] **Step 4: Add close action**

  Call `fn_close_payment_request`, return Arabic errors through the existing error helper.

### Task 3: Payment Request UI

**Files:**
- Modify: `apps/farm-os/components/CustodyForms.tsx`
- Modify: `apps/farm-os/app/(app)/custody/request/[requestId]/page.tsx`

**Interfaces:**
- Consumes actions from Task 2.
- Produces UI for owner funding received and line payment confirmation.

- [ ] **Step 1: Add funding form component**

  Component accepts request id and custody accounts. Show only for `approved_final` or `paid`.

- [ ] **Step 2: Add line payment confirmation form**

  Component accepts request id, unsettled lines, and custody accounts. It requires a selected expense and selected custody source.

- [ ] **Step 3: Split report sections**

  Request page must show operating, capex, drawing, funding received, cash paid, remaining funding, and custody source columns.

- [ ] **Step 4: Preserve print readability**

  Keep signature blocks and no-print controls; avoid fabricated zeroes.

### Task 4: Accounting Page

**Files:**
- Create: `apps/farm-os/app/(app)/accounting/page.tsx`
- Modify: `apps/farm-os/lib/nav.ts`
- Modify: `apps/farm-os/lib/nav.test.ts`
- Modify: `apps/farm-os/lib/page-help.ts`
- Modify: `apps/farm-os/lib/page-help.test.ts`

**Interfaces:**
- Consumes `fn_accounting_trial_balance`, `journal_entries`, `journal_lines`, and `accounts`.

- [ ] **Step 1: Add route**

  Create `/accounting` owner/accountant-only page with trial balance cards and latest journal entries. Empty state must say no posted accounting entries yet.

- [ ] **Step 2: Add navigation**

  Add Arabic nav label for owner/accountant only.

- [ ] **Step 3: Add help metadata and tests**

  Add page help entry and update nav/page-help tests.

### Task 5: Docs And Final Validation

**Files:**
- Modify: `docs/SPEC-0004-accounting-and-pnl.md`
- Modify: `docs/SPEC-0018-custody-and-payment-requests.md`
- Modify: `docs/PROJECT-TRACKER.md`
- Modify: `docs/SESSION-BRIEF.md`

**Validation:**
- `git diff --check`
- `npm --workspace apps/farm-os test`
- `npm --workspace apps/farm-os run lint`
- `npm --workspace apps/farm-os run build`
- `bash apps/farm-os/supabase/test-shims/run-pgtap-local.sh`

- [ ] **Step 1: Update specs**

  Record the implemented slice and remaining gates.

- [ ] **Step 2: Update tracker**

  Record that this is draft implementation work and no prod migration was applied.

- [ ] **Step 3: Update session brief last**

  Include status, validation, risks, and next gate.

- [ ] **Step 4: Final report**

  Report changed files, validation output, risks, not changed, model routing, next task, and stop point.
