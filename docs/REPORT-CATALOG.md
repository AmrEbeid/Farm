# Report Catalog - Farm OS

Phase 2 of the Product Knowledge System ([SPEC-0015](SPEC-0015-product-knowledge-system.md)).
Reconciled against `main` on 2026-07-06 after PR #843. Maturity: **L3**.

This catalog tracks reporting surfaces on `main`: dashboards, financial statements, operational
reports, charts, CSV extracts, print-ready pages, data sources, and access rules.

## Reports And Dashboards

| RPT | Route | Purpose | Metrics | Chart | Extract / print | Data source | Access |
|---|---|---|---|---|---|---|---|
| **RPT-01** | `/dashboard` | Role router | - | - | - | membership role | `requireMembership` |
| **RPT-02** | `/dashboard/owner` | Owner operating overview | area, pending approvals, stock risk, budget status, finance insight summary, offshoot estimate | `BudgetDoughnut`, `VarianceChart`, `PalmStatusDoughnut`, `CategoryBarChart` | Purchase-request CSV; print-ready | `purchase_requests`, `budget_lines`, inventory, farm structure, cost-center rollups | owner, accountant |
| **RPT-03** | `/dashboard/manager` | Plan readiness and assigned work | active operations, done operations, blocking checks, readiness %, open/due/unassigned tasks | Progress | Assigned-task and active-operation CSV; print-ready | `plans`, `plan_operations`, `plan_checks`, `plan_operation_assignees` | farm_manager, agri_engineer |
| **RPT-04** | `/inventory/[itemId]/coverage` | Stock coverage and reorder decision | available, coverage days, reorder point, recommended quantity, verdict | `PabChart` | Coverage summary and projection CSV; print-ready | RPC-007 `fn_stock_coverage` | any member; reserve action owner/farm_manager/storekeeper |
| **RPT-05** | `/budget/[planId]/check` | Plan budget gate | approved, actual, committed, available, utilization %, verdict | Progress | Print-ready | `budget_lines`, `plan_operations`, `lib/budget-check.ts` | any member |
| **RPT-06** | `/reports/[planId]/pva` | Planned-vs-actual execution report | planned cost, actual cost, variance, variance %, assignees, role-gated planned labor cost per operation | `VarianceChart` | Detail CSV; print-ready | `plan_operations`, done `farm_event` actuals, `plans`, role-gated `people_compensation` | any member; labor-cost columns owner/accountant |
| **RPT-07** | `/finance/revenue-reports` | Revenue, collections, pending-price deliveries, A/R aging | finalized revenue, collections, outstanding A/R, 30+ A/R, pending count/qty | `MultiInsightChart` with `CategoryBarChart` by buyer or crop/season | CSV per table with period/as-of filenames; print-ready | RPC-053 `fn_revenue_sales_report` | owner, accountant |
| **RPT-08** | `/finance/custody-reports` | Custody and payment-request settlement pack | opening/period/closing custody, cash expenses, unpaid obligations, 30+ obligations, owner funding | - | CSV per table with period/as-of filenames; print-ready | RPC-045 `fn_custody_ledger_report`, RPC-046 `fn_custody_cash_expense_report`, RPC-047 `fn_unpaid_obligations_report`, RPC-048 `fn_owner_funding_report` | owner, accountant |
| **RPT-09** | `/finance/reports` | Cost-center economics and reconciliation | posted centers, unallocated lines, review flags, operating net, debit/credit/net, net per feddan | `MultiInsightChart` with `CategoryBarChart` and `TrendLineChart` | CSV per table; print-ready | `v_cost_center_rollup`, `v_cost_center_reconciliation_flags`, `journal_lines`, `journal_entries`, `accounts` | owner, accountant |
| **RPT-10** | `/finance/insights` | Owner finance insight summary | allocation score, posted centers, unallocated net, review flags, operating net | `CategoryBarChart` | Center insight CSV; print-ready | `v_cost_center_rollup`, `v_cost_center_reconciliation_flags` | owner, accountant |
| **RPT-11** | `/accounting` | Accounting ledger overview | custody cash, owner funding, operating expenses, capex, drawings, trial balance, recent entries/lines | - | Trial-balance, journal-entry, and journal-line CSV; print-ready | RPC-040 `fn_accounting_trial_balance`, `journal_entries`, `journal_lines`, accounts | owner, accountant |
| **RPT-12** | `/finance/balance-sheet` | Trusted balance sheet | assets, liabilities, equity incl. net income, cumulative net income, balanced flag | - | Assets/liabilities/equity CSV with as-of filename; print-ready | RPC-055 `fn_accounting_balance_sheet` | owner, accountant |
| **RPT-13** | `/finance/income-statement` | Trusted income statement / P&L | revenue, expenses, operating expenses, net income/loss | - | Revenue/expense CSV with period filename; print-ready | RPC-056 `fn_accounting_income_statement` | owner, accountant |
| **RPT-14** | `/finance/budget-vs-actual` | Budget-vs-actual from posted GL | planned, actual, variance, variance %, status | - | Comparison CSV with period filename; print-ready | RPC-060 `fn_budget_vs_actual` | owner, accountant |
| **RPT-15** | `/finance/close` | Month-close checklist and statement handoff | pending-price deliveries, unrouted/unclassified/unallocated expenses, aged receivables | - | Statement-review handoff; print-ready; no CSV | `sales`, `sale_collections`, `expenses`, accounting period actions | owner, accountant |
| **RPT-16** | `/finance/periods` | Accounting period lock register | total periods, locked periods, reopened/open periods | - | Accounting-period CSV; print-ready | `accounting_periods`, `fn_close_accounting_period`, `fn_reopen_accounting_period` | owner, accountant |
| **RPT-17** | `/finance/pnl-trend` | GL-backed P&L time series | latest revenue, expenses, net income, cumulative net income | `TrendLineChart` | P&L trend CSV; print-ready | `fn_pnl_timeseries` | owner, accountant |
| **RPT-18** | `/finance/season` | Harvest/revenue season view | delivered tons, receipts, pending-price tons, booked revenue, collected, trader A/R | - | Deliveries and center summary CSV; print-ready | `sales`, `sale_collections`, cost centers | owner, accountant |
| **RPT-19** | `/finance/cost-centers/[id]` | Cost-center 360 | direct expenses, finalized sales, tree net, net per feddan | - | Expense and sales CSV; print-ready | selected cost center, `expenses`, `sales`, rollup views | owner, accountant |
| **RPT-20** | `/farm/offshoots` | Offshoot bank reporting | produced/planted/replanted/sold quantities, valuation estimate | `MultiInsightChart` with `CategoryBarChart` | Movement and expansion CSV; print-ready | offshoot ledger and valuation tables | owner, accountant, farm_manager |
| **RPT-21** | `/weather/dashboard` | Weather risk dashboard | weather readings and threshold risk signals | `TrendLineChart` | Risk-window and advisory CSV; print-ready | weather readings/thresholds | any member |
| **RPT-22** | `/budgets` | Budget overview | budget count, planned total, approved total, available by budget | - | Budget CSV; print-ready | `budgets`, RPC-060 for owner/accountant over-budget signal | owner, accountant, farm_manager |
| **RPT-23** | `/budgets/[budgetId]` | Budget 360 detail | planned, approved, committed + actual, available, lines, linked PRs, category expenses | - | Lines, linked PRs, and finance-expense CSV; print-ready | `budgets`, `budget_lines`, `purchase_requests`, gated `expenses` | owner, accountant, farm_manager; expense tab owner/accountant only |
| **RPT-24** | `/purchase-requests` | Purchase request console | open/submitted/open-order/overdue/stale request counts, remaining qty, needed-by alerts | - | Purchase-request CSV; print-ready | `purchase_requests`, `purchase_request_items`, `inventory_items`, `lib/pr-console.ts` | any member |
| **RPT-25** | `/inventory` | Inventory item directory | item count, reorder threshold flags, uncosted count, standard-cost inventory value | `bar` column | Inventory CSV; print-ready | `inventory_items`, `inventory_bin` | any member |
| **RPT-26** | `/inventory/movements` | Inventory movement audit ledger | last-30-day movement counts by group; latest movement window | - | Inventory movement CSV; print-ready | `inventory_movements`, `inventory_items`, `suppliers` | any member |
| **RPT-27** | `/expenses` | Expense ledger | expense counts by filter, current-month operating expenses, owner drawings when visible | - | Expense CSV; print-ready | `expenses`, `suppliers`, `accounts` | owner, accountant, farm_manager; drawings owner/accountant only |
| **RPT-28** | `/custody` | Custody and payment-request dashboard | custody balance/target/top-up, unpaid post-paid split, payment-request queue | - | Payment-request CSV; print-ready | `custody_accounts`, `custody_movements`, `payment_requests`, `expenses`, RPC `fn_custody_balance` | owner, accountant |
| **RPT-29** | `/transactions` | Unified money ledger | count by expense/sale/collection/custody transaction type, pending-price follow-up count | - | Transaction CSV; print-ready | `expenses`, `sales`, `sale_collections`, `custody_movements`, buyers/suppliers/custody accounts | owner, accountant |
| **RPT-30** | `/people` | Team directory by manager | total people, active people, people assigned to open planned operations | - | People CSV; print-ready | `people`, `plan_operation_assignees`, `plan_operations` | owner, farm_manager, agri_engineer, accountant |
| **RPT-31** | `/suppliers` | Supplier directory | supplier count, suppliers with active purchase-order lines, lead time, open lines | - | Supplier CSV; print-ready | `suppliers`, `purchase_request_items`, `purchase_requests` | any member; create action owner/farm_manager/storekeeper |
| **RPT-32** | `/plans` | Plan register | plan count by all/active/draft/closed status, due operation count | - | Plans CSV; print-ready | `plans`, `plan_operations` | any member; create action owner/farm_manager |
| **RPT-33** | `/plans/dashboard` | Planning and operations readiness dashboard | active plans, due operations, blocked checks, open estimated cost, executed operation cost KPIs | `CategoryDoughnut`, `CategoryBarChart` | Attention-plan, operation-slice, and blocked-check CSV; print-ready | `plans`, `plan_operations`, `plan_checks`, `farm_event`, farm structure | any member; field dashboard link role-gated |
| **RPT-34** | `/farm/pest-scouting` | Red-palm-weevil scouting register | traps needing attention, all traps, weekly catches, suspected incidents | - | CSV per table; print-ready | `pest_traps`, `pest_trap_catches`, `pest_incidents`, farm structure | any member; write owner/farm_manager/agri_engineer/supervisor |
| **RPT-35** | `/plans/[planId]` | Plan 360 detail | plan status, readiness, operation count, estimated cost, check results, operation calendar, assignees, agronomist sign-off state | `OpsCalendar` | Operation, calendar, check, and dose-signoff CSV; print-ready | `plans`, `plan_operations`, `plan_checks`, `plan_operation_assignees`, `people`, `inventory_items`, templates | any member; write controls owner/farm_manager; sign-off owner/agri_engineer |
| **RPT-36** | `/finance/enterprise-scorecard` | Enterprise/crop profitability scorecard | revenue, expenses, profit, margin, ROI, unallocated revenue/expense | - | Enterprise scorecard CSV; print-ready | `v_cost_center_rollup`, finalized `sales`, `lib/entity-pnl.ts`, `lib/pnl-insights.ts` | owner, accountant |
| **RPT-37** | `/finance/sector-scorecard` | Sector profitability benchmark | sector net profit, profit/feddan, best-unit benchmark, upside, unallocated revenue/expense | - | Sector scorecard CSV; print-ready | `v_cost_center_rollup`, finalized `sales`, `lib/entity-pnl.ts`, `lib/pnl-insights.ts` | owner, accountant |
| **RPT-38** | `/farm/dashboard` | Farm structure and field-health overview | sectors, hawshat, Barhi/male palms, attention palms, offshoot availability, palm-count reconciliation | `CategoryBarChart`, `CategoryDoughnut` | Attention, operation, sector, hawsha, and palm-count reconciliation CSV; print-ready | `sectors`, `hawshat`, `assets`, `farm_event`, `offshoot_movements`, `lib/palm-count-reconciliation.ts` | any member; offshoot KPI owner/accountant/farm_manager |
| **RPT-39** | `/inventory/dashboard` | Inventory and purchasing work dashboard | reorder items, submitted PRs, partial receipts, active PRs, supplier count | `CategoryDoughnut` | Work-table CSV; print-ready | `inventory_items`, `inventory_bin`, `purchase_requests`, `suppliers` | any member |
| **RPT-40** | `/people/dashboard` | Team workload and labor dashboard | active people, employment mix, assigned operations, unassigned operations, payroll estimate when permitted | `CategoryBarChart`, `CategoryDoughnut` | Workload, unassigned-operation, and directory CSV; print-ready; payroll estimate no CSV | `people`, `plan_operations`, `plan_operation_assignees`, gated `labor_logs`/`people_compensation` | owner, farm_manager, agri_engineer, accountant; payroll estimate owner/accountant |
| **RPT-41** | `/finance/dashboard` | Finance operating dashboard | approved budget, committed + actual, available budget, operating expenses, open PRs, custody/payment/unpaid/journal queues when permitted | `BudgetDoughnut`, `VarianceChart` | Budget-pressure, expense, purchase-request CSV; accounting-only custody/payment/unpaid/journal CSV; print-ready | `budgets`, `expenses`, `purchase_requests`, `custody_accounts`, RPC-045 `fn_custody_ledger_report`, `payment_requests`, `journal_entries` | owner, accountant, farm_manager; drawings/accounting sections owner/accountant only |

## Chart Catalog

| Chart | Type | Primary use |
|---|---|---|
| `PabChart` | Line | Projected available balance and first shortage marker for stock coverage |
| `VarianceChart` | Bar | Planned vs actual cost by operation or budget category |
| `BudgetDoughnut` | Doughnut | Used vs available budget on owner/finance dashboards |
| `PalmStatusDoughnut` | Doughnut | Palm status distribution on the owner dashboard |
| `CategoryBarChart` | Bar | Category comparisons across revenue, centers, finance insights, farm/planning modules |
| `TrendLineChart` | Line | Time-series financial and weather trends |
| `MultiInsightChart` | Toggle wrapper | Switches one report card between related chart perspectives |

## CSV And Print Coverage

- `FilterableTable` exports the current visible table view: after client-side search and sort.
- CSV uses raw values for spreadsheet work and includes a UTF-8 BOM for Arabic text in Excel.
- `ExportButton` appends `.csv` only when the supplied filename does not already include it.
- The deployed print-ready surfaces are:
  `/dashboard/owner`, `/dashboard/manager`,
  `/accounting`, `/finance/income-statement`, `/finance/balance-sheet`, `/finance/budget-vs-actual`,
  `/finance/close`, `/finance/dashboard`, `/finance/custody-reports`, `/finance/reports`, `/finance/revenue-reports`, `/finance/periods`,
  `/finance/insights`, `/finance/pnl-trend`, `/finance/enterprise-scorecard`, `/finance/sector-scorecard`,
  `/weather/dashboard`,
  `/budgets`, `/finance/season`, `/finance/cost-centers/[id]`, `/budgets/[budgetId]`,
  `/budget/[planId]/check`, `/purchase-requests`, `/inventory`, `/inventory/dashboard`,
  `/inventory/[itemId]/coverage`,
  `/inventory/movements`, `/expenses`, `/custody`, `/transactions`, `/people`, `/people/dashboard`, `/suppliers`,
  `/plans`, `/plans/[planId]`, `/plans/dashboard`, `/reports/[planId]/pva`,
  `/farm/dashboard`, `/farm/pest-scouting`, and `/farm/offshoots`.
- Print CSS hides app chrome, print buttons, filters, result counts, and CSV controls while preserving report
  content, cards, KPIs, charts, and tables.
- Date-aware filenames are live for the statement/report packs where the page has `start/end` or `asOf`
  parameters. All-history reports keep generic names.

## Month-Close Output Pack

The accountant-facing month-close path is now:

1. Clear `/finance/close` live checklist items.
2. Review `/finance/income-statement?start=...&end=...`.
3. Review `/finance/balance-sheet?asOf=...`.
4. Review `/finance/budget-vs-actual?start=...&end=...` when budget comparison is needed.
5. Print or export the statement tables as support.
6. Lock the period in `/finance/periods`.

The clean checklist does not auto-lock. It deliberately hands the accountant to the statements first.

## Known Limitations

- Browser print is live, but there is still no server-generated PDF bundle or signed statement package.
- Cost-center reports are all-history today; their CSV filenames are intentionally generic until a period filter is added.
- Budget-vs-actual remains report-only. It exposes variance and unbudgeted spend but does not enforce caps
  (Decision-0157).
- The report catalog is a current-state index, not a replacement for `RPC-CATALOG.md`, `FEATURE-REGISTRY.md`, or
  the Arabic user manual.

Maintenance: add a new report route as the next `RPT-NN`; add any new chart component to the chart catalog; note
CSV and print coverage when the page is exportable or print-ready.
