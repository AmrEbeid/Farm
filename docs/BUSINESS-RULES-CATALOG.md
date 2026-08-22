# Business Rules Catalog — Farm OS

*Tier 1 of the Product Knowledge System ([`SPEC-0015`](SPEC-0015-product-knowledge-system.md)). Each rule has a
stable `BR-NNN` id, the enforcing object (RPC / trigger / RLS policy / constraint / grant) with its migration, a
test reference, and the `FEAT-NNN` it belongs to. **This is the source for the rule-based "Why?" surface**
([`SPEC-0014`](SPEC-0014-knowledge-living-documentation.md)). Reconciled to `main` 2026-07-01 (through the
cash-method accounting kernel `20260701220000` (PR #568), SPEC-0018 backend migrations
`20260629150000`/`20260629150100`, responsibility gate `20260629141650`, SPEC-0016 export
compliance `20260622000092`, and pgTAP suite). Maturity **L3**. IDs stable + append-only.*

Evidence: mig = `apps/farm-os/supabase/migrations/`; test = `apps/farm-os/supabase/tests/`.

## Separation of Duties (financial control)
| BR | Rule | Enforced by (migration) | Test | FEAT |
|---|---|---|---|---|
| **BR-001** | A purchase-request requester cannot approve their own request. | `pr_guard_approval` trigger (`0017`/`0023`) | `12_pr_approval_sod_guard` | FEAT-009 |
| **BR-002** | `requested_by` is immutable after creation (no rewriting the creator to dodge SoD). | `pr_guard_approval` BEFORE UPDATE (`0017`) | `12_pr_approval_sod_guard` | FEAT-009 |
| **BR-003** | A PR revert to draft is blocked when requester = approver. | `pr_guard_revert_sod` (`0052`) | `52_pr_revert_sod_guard` | FEAT-009 |

## Stock ledger integrity
| BR | Rule | Enforced by | Test | FEAT |
|---|---|---|---|---|
| **BR-010** | `inventory_movements` is INSERT-only via RPC; no direct client INSERT. | REVOKE INSERT (`0030`) | `20_inventory_ledger_no_update` | FEAT-006 |
| **BR-011** | Ledger rows cannot be UPDATEd by clients. | REVOKE UPDATE (`0022`) | `20_inventory_ledger_no_update` | FEAT-006 |
| **BR-012** | Ledger rows cannot be DELETEd; movements are permanent. | REVOKE DELETE (`0016`) | `11_inventory_ledger_append_only` | FEAT-006 |
| **BR-013** | `inventory_bin` (snapshot) is rebuild-only; no client UPDATE/DELETE. | REVOKE (`0016`/`0022`); `fn_bin_rebuild` | `11_inventory_ledger_append_only` | FEAT-006 |
| **BR-014** | An outflow (issue/loss/expiry/transfer) cannot drive on_hand negative. | CHECK/floor in `fn_post_movement` (`0031`/`0033`) | `07_post_movement` | FEAT-006 |

## Stock-coverage engine correctness
| BR | Rule | Enforced by | Test | FEAT |
|---|---|---|---|---|
| **BR-020** | A receipt cannot be posted while an approved-not-received PO for the same (org,item) exists (no double-count). | `inv_guard_receipt_no_open_po` (`0026`) | `14_engine_receipt_doublecount` | FEAT-007 |
| **BR-021** | Scheduled receipts project only remaining-on-order qty (`qty − received_qty`). | `fn_stock_coverage` (`0045`/`0047`) | `04_stock_coverage` | FEAT-007 |
| **BR-022** | A null-dated planned demand is treated as immediate (period 1), never silently dropped. | `coalesce(planned_at,…)` (`0047`) | `04_stock_coverage` | FEAT-007 |
| **BR-023** | An overdue PO (needed_by before the window) is not projected into period 1 to mask a shortage. | stale-PO guard (`0034`/`0045`) | `34_engine_stale_po_guard` | FEAT-007 |
| **BR-024** | Available = on_hand − reserved; reserved never exceeds on_hand in coverage. | `fn_stock_coverage` (`0009`) | `04_stock_coverage` | FEAT-007 |
| **BR-025** | `blocked` operations are paused demand: stock coverage ignores them until they return to a live status. | `fn_stock_coverage` LIVE_OP filter (`20260701200000`) | `133_engine_blocked_demand_semantics` | FEAT-007 |

## Operation execution & reservation
| BR | Rule | Enforced by | Test | FEAT |
|---|---|---|---|---|
| **BR-030** | Only `op.execute` holders may execute operations (claim-first, atomic). | `authorize('op.execute')` in `fn_execute_operation` (`0020`/`0057`) | `13_execute_idempotent_claim` | FEAT-012 |
| **BR-031** | A `done` operation cannot be re-executed (idempotency). | claim-first `WHERE status<>'done'` (`0020`) | `13_execute_idempotent_claim` | FEAT-012 |
| **BR-032** | An operation executes only from an active status; terminal statuses are not executable. | status check (`0057`) | `13_execute_idempotent_claim` | FEAT-012 |
| **BR-033** | Execution is atomic: claim + event + quantities + movement + reservation release in one transaction. | `fn_execute_operation` (`0020`) | `18_execute_operation_rpc` | FEAT-012 |
| **BR-034** | Operation tables (`farm_event`/`event_locations`/`quantities`/`plan_operations`) are role-gated at REST. | RLS gate (`0025`) | `26_operation_tables_authz` | FEAT-011 |

## Purchase-request line integrity
| BR | Rule | Enforced by | Test | FEAT |
|---|---|---|---|---|
| **BR-040** | PR line fields (qty/item/supplier/unit/est_cost) are immutable once the PR is approved/received. | `fn_pr_items_lock_when_decided` (`0032`/`0050`) | `33_pr_items_lock_version_bump` | FEAT-009 |
| **BR-041** | `received_qty` advances only via `fn_post_receipt`; never by client UPDATE. | column REVOKE + CHECK (`0045`) | `15_receipt_idempotent_claim` | FEAT-010 |
| **BR-042** | At most one PR line per (pr_id, item_id). | UNIQUE `purchase_request_items_pr_item_uniq` (`0076`) | `77_pri_unique_pr_item` | FEAT-009 |
| **BR-043** | PR line qty must be strictly positive. | CHECK `pri_qty_positive` (`0056`) | `50_pr_items_lock_partially_received` | FEAT-009 |
| **BR-044** | A receipt cannot exceed remaining-on-order qty (over-receipt rejected atomically). | over-receipt check in `fn_post_receipt` (`0045`) | `15_receipt_idempotent_claim` | FEAT-010 |
| **BR-045** | A PR becomes `received` only when all lines are fully received; else `partially_received`. | status logic in `fn_post_receipt` (`0045`) | `15_receipt_idempotent_claim` | FEAT-010 |
| **BR-046** | A receipt is idempotent (claim-first; second call is a safe no-op). | claim-first in `fn_post_receipt` (`0045`) | `15_receipt_idempotent_claim` | FEAT-010 |

## Custody & payment-request integrity
| BR | Rule | Enforced by | Test | FEAT |
|---|---|---|---|---|
| **BR-047** | A custody-paid expense can post only one custody cash out-movement; controlled payment-routing columns are RPC-only, and routed amount/kind cannot drift after posting. | column grants + `fn_record_custody_movement` / `fn_set_expense_payment_status` / `expense_guard_routed_money_immutable` (`20260629150000`) | `102_custody_payment` | FEAT-028 |
| **BR-048** | Payment request lines can include only operating `post_paid_unpaid` expenses; each expense can belong to one request only; paid-cash/drawings/capex are excluded from request math, and routed request-line amount/kind/status cannot drift. | `fn_add_expense_to_request` + `fn_payment_request_totals` + `fn_set_expense_payment_status` + `expense_guard_routed_money_immutable` (`20260629150100`) | `103_payment_request` | FEAT-028 |

## General ledger (double-entry) integrity
| BR | Rule | Enforced by (migration) | Test | FEAT |
|---|---|---|---|---|
| **BR-116** | Every journal entry must balance: Σdebit = Σcredit across its lines (an unbalanced entry is a hard error). | `journal_lines_balance_guard` deferred constraint trigger (`20260701220000`) | `112_accounting_cash_custody_settlement` | FEAT-030 |
| **BR-117** | Active journal postings are idempotent per `(org, source_type, source_id)` — re-posting the same currently posted source cannot double-journal. After a reversal, the corrected posting advances `source_sequence` and becomes the new active posted entry. | UNIQUE `(org, source_type, source_id, source_sequence)` + posted-entry early-return in `fn_post_two_line_journal` (`20260706081636`) | `112_accounting_cash_custody_settlement`, `132_journal_reversal` | FEAT-030 |
| **BR-118** | Each journal line is one-sided: exactly one of `debit`/`credit` is positive. | CHECK `((debit>0) <> (credit>0))` on `journal_lines` (`20260701220000`) | `112_accounting_cash_custody_settlement` | FEAT-030 |
| **BR-119** | Owner funds are recorded into custody (`amount_in`) **before** any payout — posting Dr custody / Cr owner-funding; each confirmed payout posts Dr expense-kind account / Cr custody (cash-method). | `fn_record_payment_request_funding` / `fn_confirm_request_expense_paid` (`20260701220000`) | `112_accounting_cash_custody_settlement` | FEAT-028/030 |
| **BR-120** | A payment request closes only when every line has been paid (`paid_at` set). | `fn_close_payment_request` (`20260701220000`) | `112_accounting_cash_custody_settlement` | FEAT-028/030 |
| **BR-121** | A custody handover between holders is one atomic linked out/in pair, cannot exceed the source holder balance, and creates no journal entry. | `fn_transfer_custody` + `custody_movements.transfer_group_id` (`20260701480000`) | `119_custody_transfer` | FEAT-028 |
| **BR-122** | Custody/payment reports are finance-read-only derived views: they show holder opening/closing balances, custody-paid cash expenses, unpaid obligations, and owner funding without posting journals or changing request/payment state. | `fn_custody_ledger_report`, `fn_custody_cash_expense_report`, `fn_unpaid_obligations_report`, `fn_owner_funding_report` (`20260701490000`) | `120_custody_reports` | FEAT-028/030 |
| **BR-123** | A pending-price sale stores quantity/crop/delivery context with `unit_price` and `total` as NULL, and posts no journal entry until price finalization. | `sales_price_consistency` + `fn_save_sale` (`20260701500000`) | `115_revenue_sales` | FEAT-023 |
| **BR-124** | Revenue rows require a crop reporting dimension and any buyer/cost-center/farm/sector/hawsha reference must belong to the same org; cost centers must be active leaves. | `fn_save_sale` / `fn_save_buyer` guards (`20260701500000`) | `115_revenue_sales` | FEAT-023 |
| **BR-125** | Finalizing a sale price posts exactly one revenue journal Dr A/R / Cr sales revenue; collections cannot exceed the receivable and post Dr cash / Cr A/R. | `fn_finalize_sale_price`, `fn_record_sale_collection`, `fn_post_two_line_journal` (`20260701500000`) | `115_revenue_sales` | FEAT-023/030 |
| **BR-126** | Buyers, sales, and sale collections are finance-confidential: read requires `finance.read`, writes are RPC-only via the owner/accountant `budget.write` gate, and anon has no EXECUTE. | RLS, grants, RPC gates (`20260701500000`) | `115_revenue_sales` / `22_security_invariants` | FEAT-023 |
| **BR-127** | Revenue reports are finance-read-only derived views: pending-price deliveries are listed but excluded from finalized revenue/A-R totals; outstanding A/R is `total − Σ(collections)` as of the report date and is aged from the sale/delivery report date. | `fn_revenue_sales_report` (`20260701510000`) | `121_revenue_reports` | FEAT-023 |
| **BR-128** | A **locked** accounting period rejects any NEW journal posting dated inside it (idempotent re-posts unaffected); closing a period is owner/accountant and rejects overlap with an existing locked range; reopening (unlock) is **owner-only**. | `fn_close_accounting_period` / `fn_reopen_accounting_period` + the `fn_period_locked` guard in `fn_post_two_line_journal` (`20260701550000`) | `125_accounting_period_lock` | FEAT-030 |
| **BR-129** | The **balance sheet** is posted-only and as-of-scoped, grouped by `account_type`; owner drawings are a contra-equity line, never an expense (#6); and `Assets = Liabilities + Equity + Net income` holds by construction (self-checking `balanced` flag). Archived accounts with historical postings still count toward the totals. | `fn_accounting_balance_sheet` (`20260705110000`) | `126_accounting_balance_sheet` | FEAT-030 |
| **BR-130** | The **income statement (P&L)** is posted-only and period-scoped, summing revenue − expense over the GL by account; owner drawings are excluded by construction (equity, not expense, #6); and its `net_income` ties to the balance sheet for the same window. | `fn_accounting_income_statement` (`20260705120000`) | `127_accounting_income_statement` | FEAT-030 |
| **BR-131** | **Budget-vs-actual** is a finance-read-only report: `actual` is LIVE from the posted GL (rolled up by expense category via `journal_lines.expense_id`), **not** the frozen `budget_lines.actual` seed; it flags over-budget and unbudgeted categories but **enforces no cap** (the hard-block-vs-warn policy + canonical category mapping remain the Owner's Decision-0157). | `fn_budget_vs_actual` (`20260705150000`) | `128_budget_vs_actual` | FEAT-030 |
| **BR-132** | Journal corrections happen through explicit reversals: the original and mirror entries are marked `reversed`, the mirror points at `reversal_of`, a reason is required, reversing a reversal is blocked, and locked periods must be reopened before mutation. | `fn_reverse_journal_entry` (`20260706081636`) | `132_journal_reversal` | FEAT-030 |
| **BR-133** | Month-close readiness is one exact finance-read snapshot from live-entry cutover through an explicit Cairo as-of date. Pending prices and unresolved expense date/routing/account/cost-center data are hard blockers; valid aged receivables remain visible follow-up and do not block close. Closing takes the organization period mutex and atomically rechecks readiness; source writes and expense-payment reversal use the same lock order. Future ends are rejected, and a missing expense date may be filled once outside locked periods. | `fn_month_close_summary`, `fn_close_accounting_period`, `fn_set_missing_expense_date`, reversal wrapper (`20260822140300`) | `148_month_close_exact_summary`, `202 accounting reconciliation rollback batch`, `205_expense_payment_reversal`, `month-close.test.ts` | FEAT-030 |
| **BR-134** | A standalone owner-funding custody cash-in is corrected only through an append-only, equal cash-out mirror plus linked journal reversal. The original evidence stays intact; both `budget.write` and `custody.write` are required; linked/journal-less/consumed/reversed rows, pre-original dates and locked periods fail closed; exact retries are idempotent. | `fn_reverse_custody_movement`, guarded `fn_reverse_journal_entry` wrapper (`20260822140600`, local release-gated) | `206_custody_movement_reversal`, `132_journal_reversal`, `22_security_invariants` | FEAT-028/030 |
| **BR-135** | Custody dashboards derive account metadata, targets and all-history closing balances from one finance-read, organization-scoped database snapshot. Monetary fields cross JSON as decimal text and remain exact through application arithmetic, display, sorting and export. | `fn_custody_dashboard_summary` (`20260822140700`, local release-gated), `lib/custody-dashboard-summary.ts`, `lib/decimal.ts` | `208_custody_dashboard_summary`, `custody-dashboard-summary.test.ts`, `table-sort.test.ts` | FEAT-028/030 |
| **BR-136** | The daily accounting ledger is one finance-read, organization-scoped database snapshot: its trial balance is posted-only, archived ancestors remain available for complete subtree rollups, recent entry/line detail is explicitly bounded, and any tenant/account mismatch or incomplete detail fails closed. Money crosses JSON and the UI as exact decimal text. | `fn_accounting_ledger_snapshot` (`20260822141100`, local release-gated), `lib/accounting ledger snapshot.ts`, `lib/accounting-rollup.ts` | `213 exact accounting ledger snapshot`, `accounting ledger snapshot.test.ts`, `accounting-rollup.test.ts` | FEAT-030 |
| **BR-137** | The unified transactions ledger comes from one atomic, finance-read, organization-scoped snapshot. Exact full counts remain separate from the explicit 400-row per-source samples; cancelled and historically reversed money is excluded under the established lifecycle rules; party joins are tenant-scoped and any missing/foreign party raises before a payload leaves PostgreSQL. Money and quantity remain exact decimal text, and a truncated view cannot export a partial CSV as complete. | `fn_transactions_snapshot` (`20260822141200`, local release-gated), `lib/transactions snapshot.ts`, `/transactions` | `214 exact transactions snapshot`, `transactions snapshot.test.ts`, `transactions-ledger.test.ts` | FEAT-023/028/030 |
| **BR-138** | The season cockpit comes from one atomic, finance-read, organization-scoped snapshot and applies the same economic event date to filtering, display and newest-first ordering. Physical deliveries remain visible, while historical treasury/reversed rows are excluded. Finalized money is booked only when the sale has exactly one posted journal overall and that journal is the exact same-org two-line A/R debit and revenue credit for the sale total; missing, reversed, malformed or duplicate posted journals increment an explicit exception count and contribute no booked revenue, collections, A/R or center revenue. Exact full aggregates remain separate from the newest 400 delivery rows, decimals cross JSON as text, and a truncated delivery sample cannot be exported as complete. | `fn_season_dashboard_snapshot` (`20260822141300`, local release-gated), `lib/season dashboard snapshot.ts`, `/finance/season` | `215 exact season dashboard snapshot`, `season dashboard snapshot.test.ts` | FEAT-023/030 |
| **BR-139** | Custody reporting comes from one atomic, finance-read, organization-scoped snapshot. Exact full holder balances, period movements, custody-paid expenses, current unpaid obligations and period owner funding remain separate from bounded 400-row detail samples. Obligation aging is always current as of Cairo today because the mutable payment status is not a historical ledger; unknown dates and amounts remain explicit, truncated tables cannot export partial CSVs, exact money stays decimal text, and report-affecting cross-tenant or reversal references fail closed. | `fn_custody_reports_snapshot` (`20260822141400`, local release-gated), `lib/custody reports snapshot.ts`, `/finance/custody-reports` | `216 exact custody reports snapshot`, `custody reports snapshot.test.ts` | FEAT-028/030 |
| **BR-140** | The finance operating dashboard is one role-aware atomic organization snapshot. Exact totals/counts are separate from bounded detail; incomplete tables cannot export; money remains decimal text; unverified/blocked budget figures are withheld by the RPC; drawings, custody, payment and journal data remain owner/accountant-only; cross-org supplier or custody corruption fails closed; and month bounds must match the current Cairo as-of month. | `fn_finance_dashboard_snapshot` (`20260822141500`, local release-gated), `lib/finance-dashboard-reads.ts`, `/finance/dashboard` | `217 exact finance dashboard snapshot`, `finance-dashboard-reads.test.ts`, `data-authority.test.ts` | FEAT-028/030 |
| **BR-141** | The daily custody workspace is one finance-read, organization-scoped database snapshot. Exact full account balances, targets, top-ups, unpaid totals and request/movement counts remain separate from bounded request and movement rows; signed balances and money cross JSON as decimal text; same-day movements order by occurrence, creation and ID; partial request tables cannot export; and missing or cross-org account links fail closed. | `fn_custody_daily_snapshot` (`20260822141600`, local release-gated), `lib/custody-daily-snapshot.ts`, `/custody` | `218 exact custody daily snapshot`, `22_security_invariants`, `custody-daily-snapshot.test.ts` | FEAT-028/030 |
| **BR-142** | The daily expense register is one role-aware, organization-scoped database snapshot. Exact filter counts and full summary remain separate from at most 200 newest matching rows; the client rejects incomplete samples or count disagreement; decimal money preserves source scale; drawings and chart-of-accounts data remain finance-private; and supplier, account or cost-center tenant corruption fails closed. | `fn_expense_daily_snapshot` (`20260822141700`, local release-gated), `lib/expense-daily-snapshot.ts`, `/expenses` | `219 exact expense daily snapshot`, `22_security_invariants`, `expense-daily-snapshot.test.ts` | FEAT-030 |
| **BR-143** | Expense 360 core detail is one role-aware, organization-scoped database snapshot. Expense, event, account, custody-payment and payment-request evidence are read atomically; exact decimals stay text through display and correction writes; drawings, accounts and payment evidence remain finance-private; and missing or cross-tenant links fail closed. Correction picker options load only for an eligible open correction. | `fn_expense_detail_snapshot` (`20260822141800`, local release-gated), `lib/expense-detail-snapshot.ts`, `/expenses/[expenseId]` | `220 exact expense detail snapshot`, `22_security_invariants`, `expense-detail-snapshot.test.ts`, `expense detail performance.test.ts` | FEAT-030 |
| **BR-144** | Cost-center reporting is one finance-read, organization-scoped atomic snapshot. Posted expense and revenue are normalized by account side and rolled through the bounded center hierarchy without chart double counting; exact totals, activity counts, flags, unallocated lines and optional annual rows share one snapshot. Every visible rollup filter carries its descendant annual evidence, and malformed tenant, hierarchy or decimal data fails closed. | `fn_cost_center_reports_snapshot` (`20260822141900`, local release-gated), `lib/cost-center-reports-snapshot.ts`, `/finance/reports` | `221 exact cost center reports snapshot`, `22_security_invariants`, cost-center report parser tests | FEAT-030 |
| **BR-145** | Payment-request 360 detail is one finance-read, organization-scoped atomic snapshot. Exact totals and full unpaid-line count stay separate from bounded line detail; linked expense availability remains truthful; funding and payment evidence must match the exact organization, source, status, date, amount, two-line references and debit/credit account polarity; malformed, incomplete or cross-tenant state fails closed. | `fn_payment_request_detail_snapshot` (`20260822142000`, local release-gated), `lib/payment request detail.ts`, `/custody/request/[requestId]` | `222 exact payment request detail snapshot`, `22_security_invariants`, `payment request detail.test.ts` | FEAT-028/030 |
| **BR-146** | The owner home is one owner-only, active-organization atomic snapshot. Exact counts and decimal money remain separate from bounded driver rows; cross-organization plan, assignee, person, budget or inventory relationships fail closed; owner drawings stay separate from operating expenses; payment, purchase and agronomy approval queues are included; domain KPIs and drivers fail closed unless their source authority is verified; and the current Cairo date plus a 1-20 detail bound are mandatory. | `fn_owner_home_snapshot` (`20260822142500`, local release-gated), `lib/owner-home-reads.ts`, `/dashboard/owner` | `223 exact owner home snapshot test`, `22_security_invariants`, `owner-home-reads.test.ts`, `owner-home-surface.test.ts` | SPEC-0033 |
| **BR-147** | The Accountant home is one accountant-only active-organization snapshot for the current Cairo date. Close blockers reuse the canonical month-close contract; reconciliation actionability means staged batches the accountant can work, not owner-only approval/execution or held rows; future journal, custody and unpaid-expense activity is excluded from as-of state; operating, CAPEX, drawings and unknown amounts stay separate; canonical receivable readers validate tenant and over-collection integrity; and all money/comparisons remain null until `finance_ledger` authority is verified. | `fn_accountant_home_snapshot` (`20260822142600`, local candidate), `lib/accountant-home-reads.ts`, `/finance/dashboard` | `224 exact accountant home snapshot test`, `accountant-home-reads.test.ts`, `accountant-home-surface.test.ts` | SPEC-0033 / FEAT-030 |

## Tenant isolation & access control
| BR | Rule | Enforced by | Test | FEAT |
|---|---|---|---|---|
| **BR-050** | Every tenant table is org-scoped by RLS; members see/modify only their org's rows. | RLS `tenant_all` + `user_org_ids()` (`0001`–`0007`) | `01_rls_isolation` | FEAT-001 |
| **BR-051** | RLS is FORCED on all tenant tables (owner/definer paths obey the boundary). | FORCE ROW LEVEL SECURITY (`0028`) | `29_force_rls_tenant_tables` | FEAT-001 |
| **BR-052** | A cross-org FK reference (child pointing at another org's parent) is forbidden. | EXISTS checks in WITH CHECK (`0012`/`0061`–`0075`) + RPC guards (`0081`) | `24_cross_org_child_isolation`, `75_cross_org_fk_assets` | FEAT-001 |
| **BR-053** | Anonymous (`anon`) callers are always denied RPC/DML access. | explicit anon check in every RPC; grants (`0021`) | `80_anon_dml_lockdown` | FEAT-002 |
| **BR-054** | The active-org JWT claim is membership-validated and fail-closed. | `0085` active_org narrowing | `82_active_org` | FEAT-001 |
| **BR-055** | SECURITY DEFINER functions pin `search_path=''` and use fully-qualified names. | all definer fns (`0009`+) | `22_security_invariants` | FEAT-002 |
| **BR-056** | DELETE is revoked on tenant tables (soft-delete posture; `plan_checks` exempt for the builder). | REVOKE DELETE (`0027`); `0069` plan_checks gate | `28_delete_posture_remediation`, `69_plan_checks_delete_gate` | FEAT-002 |

## Role gates (least privilege)
| BR | Rule | Enforced by | Test | FEAT |
|---|---|---|---|---|
| **BR-060** | Only `owner` may approve purchase requests. | `authorize('pr.approve')` (`0001`/`0017`) | `12_pr_approval_sod_guard` | FEAT-009 |
| **BR-061** | Plans/operations writable only with `plan.write` (owner/farm_manager). | RLS WITH CHECK (`0035`/`0042`) | `26_operation_tables_authz` | FEAT-005 |
| **BR-062** | Inventory writes (movements/receipts) require `inventory.write` (owner/farm_manager/storekeeper). | RLS + RPC (`0015`/`0045`/`0066`/`0067`) | `10_inventory_write_rolegate` | FEAT-006 |
| **BR-063** | Budgets/lines/expenses writable only with `budget.write` (owner/accountant). | RLS WITH CHECK (`0043`/`0044`) | `43_budget_rolegate`, `44_expenses_rolegate` | FEAT-008/013 |
| **BR-064** | Farm structure writable only with `structure.write` (owner/farm_manager). | RLS + `fn_save_*` (`0081`) | `82_structure_crud` | FEAT-003 |
| **BR-065** | Palm status history writes only via `fn_update_palm_status`. | write-gate (`0073`) | `73_palm_history_write_gate` | FEAT-004 |
| **BR-066** | Finance-confidential custody/payment-request rows, the GL tables (`accounts`/`journal_entries`/`journal_lines`/`payment_request_fundings`), revenue/A/R rows (`buyers`/`sales`/`sale_collections`), and derived balances/trial-balance/revenue reports are readable only with `finance.read` (owner/accountant); GL/revenue tables are RPC-only writes + audited. | RLS + read RPC gates (`20260629150000`/`20260629150100`/`20260701220000`/`20260701500000`/`20260701510000`) | `102_custody_payment`, `103_payment_request`, `112_accounting_cash_custody_settlement`, `115_revenue_sales`, `121_revenue_reports` | FEAT-023/028/030 |
| **BR-067** | Custody account/movement writes require `custody.write` (owner/accountant) and same-org references. | RPC gates + direct DML revokes (`20260629150000`) | `102_custody_payment` | FEAT-028 |
| **BR-068** | Payment request preparation requires `request.prepare` (owner/accountant); request tables are RPC-only. | RPC gates + direct DML revokes (`20260629150100`) | `103_payment_request` | FEAT-028 |
| **BR-069** | Payment requests require operational approval by owner/accountant before final owner approval. | lifecycle RPC gates (`20260629150100`) | `103_payment_request` | FEAT-028 |
| **BR-073** | Responsibility assignments are org-readable but writable only with `responsibility.write` (owner/farm_manager). | RLS WITH CHECK (`20260629141650`) | `101_responsibility_assignments_write_gate` | FEAT-019 |
| **BR-074** | Export registrations/accreditations/residue tests/results are org-readable but writable only with `export.write` (owner/farm_manager), with same-org responsible-person and residue-parent guards. | RLS WITH CHECK (`20260622000092`) | `93_export_compliance` | FEAT-029 |
| **BR-075** | Care Academy content writes are reserved for `academy.write` (owner/agri_engineer); on `main` only the permission arm is present while #366 tables/routes stay draft-held. | `authorize()` union (`20260622000092`) | `97_authorize_perms_complete` | FEAT-024 |
| **BR-076** | Marketing contacts, activities, and records are visible and writable only to owner/accountant/farm_manager in the active org; writes are RPC-only, hard delete is forbidden, contact activity is append-only, and source imports upsert by a unique per-org provenance key. | RLS + RPC gates (`20260820090000`) | `100_marketing_module` | SPEC-0032 |

## PII & confidentiality
| BR | Rule | Enforced by | Test | FEAT |
|---|---|---|---|---|
| **BR-070** | Staff phone/email readable only by service-role; members cannot view contact PII. | column REVOKE + grant (`0048`) | `80_anon_dml_lockdown` | FEAT-019 |
| **BR-071** | Staff wages (`people_compensation`) readable only with `payroll.read` (owner/accountant). | RLS + `authorize('payroll.read')` (`0046`) | `53_audit_compensation_payroll_gate` | FEAT-022 |
| **BR-072** | A person's `reports_to` must be in the same org. | `people_reports_to_same_org` (`0071`) | `72_people_reports_to_same_org` | FEAT-019 |

## Audit
| BR | Rule | Enforced by | Test | FEAT |
|---|---|---|---|---|
| **BR-080** | `audit_log` is append-only (no client INSERT/UPDATE/DELETE/TRUNCATE). | REVOKE (`0008`) | `02_audit_immutable` | FEAT-020 |
| **BR-081** | DML on audited tables (people, org_member, compensation, events…) is logged immutably. | `fn_audit*` triggers (`0008`/`0019`/`0046`/`0059`) | `25_audit_immutable_all_entities` | FEAT-020 |

## Farm-structure integrity
| BR | Rule | Enforced by | Test | FEAT |
|---|---|---|---|---|
| **BR-090** | A palm cannot be re-parented into an archived hawsha (would vanish from live views). | `fn_save_palm` archived check (`0089`) | `89_palm_no_archived_hawsha` | FEAT-004 |
| **BR-091** | A child cannot be restored while its parent is still archived (restore parent first). | `fn_archive_structure` guard (`0081`) | `82_structure_crud` | FEAT-003 |
| **BR-092** | Archiving a parent cascades archive to descendants; restore only un-archives the same cascade. | `fn_archive_structure` (`0081`) | `82_structure_crud` | FEAT-003 |
| **BR-093** | A palm's `line_id` must belong to the same hawsha (no cross-hawsha lines). | `fn_save_palm` validation (`0081`) | `82_structure_crud` | FEAT-003 |
| **BR-094** | A palm cannot be re-parented across organizations. | cross-org guard in `fn_save_palm` (`0081`) | `89_palm_no_archived_hawsha` | FEAT-003 |
| **BR-095** | Hawsha counts (barhi/male/rows) must be non-negative. | CHECK in `fn_save_hawsha` (`0081`) | `82_structure_crud` | FEAT-003 |

## Input validation & enums
| BR | Rule | Enforced by | Test | FEAT |
|---|---|---|---|---|
| **BR-100** | `plan_operations.est_cost`, material qty, labor count/days are non-negative. | CHECKs (`0054`) | `54_plan_op_nonneg` | FEAT-005 |
| **BR-101** | Plan-operation status ∈ {planned, reserved, ready, blocked, in_progress, done, abandoned, skipped}. | CHECK (`0006`) | `58_plan_op_status` | FEAT-005 |
| **BR-102** | PR status ∈ {draft, submitted, approved, rejected, received, partially_received}. | CHECK (`0007`/`0045`) | `51_pr_receipt_status_gate` | FEAT-009 |
| **BR-103** | Member role ∈ {owner, farm_manager, agri_engineer, accountant, supervisor, storekeeper}. | CHECK (`0001`) | (RLS suite) | FEAT-002 |
| **BR-104** | Event type ∈ {operation, inspection, issue, note}. | check in `fn_record_event` (`0083`) | `83_record_event` | FEAT-011 |
| **BR-105** | Export-compliance validity windows cannot be inverted, and export acreage/approved quantity/residue values cannot be negative. | CHECK constraints (`20260622000092`) | `93_export_compliance` | FEAT-029 |

## Policy rules (governance — not DB-enforced; see CLAUDE.md)
| BR | Rule | Source | FEAT |
|---|---|---|---|
| **BR-110** | Never fabricate farm/financial data; if missing, say so. | CLAUDE.md #1 | all |
| **BR-111** | Owner drawings (مسحوبات) are separated from operating expenses in any P&L — now enforced **structurally**: `expenses.kind` routes to a distinct account (operating→`5000`, capex→`1500`, drawing→`3100` owner-drawings equity), so a drawing can never post to the operating-expense account. | CLAUDE.md #6; `expenses.kind`; `fn_account_for_expense_kind` (`20260701220000`) | FEAT-013/023/030 |
| **BR-112** | Pricing is per-farm (EGP), never per-seat. | CLAUDE.md #3 | FEAT-027 |
| **BR-113** | Agronomy content is an editable template, not a prescription (needs agronomist + pesticide-registration sign-off). | CLAUDE.md #4 | FEAT-024 |
| **BR-114** | The AI assistant is read-only, RLS-scoped, no PII, no outbound (lethal-trifecta never combined). | CLAUDE.md Security; `assistant-policy.ts` | FEAT-021 |
| **BR-115** | Export readiness never fabricates certificate/residue/MRL evidence and fails closed when required validity evidence is missing. | CLAUDE.md #1; `lib/export-readiness.ts` | FEAT-029 |

*~60 rules; the agent extraction found ~68 candidate constraints — the remainder (additional parent-existence
EXISTS checks, definer-EXECUTE lockdowns per function, supplier/item write gates) are covered by the families
above (BR-052/BR-055/BR-062). Add new rules with the next free id in the relevant family.*
