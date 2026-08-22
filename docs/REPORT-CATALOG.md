# Report Catalog - Farm OS

Phase 2 of the Product Knowledge System ([SPEC-0015](SPEC-0015-product-knowledge-system.md)).
Reconciled against `main` on 2026-07-06 after finance statement package PDF coverage. Maturity: **L3**.

This catalog tracks reporting surfaces on `main`: dashboards, financial statements, operational
reports, charts, CSV extracts, print-ready pages, data sources, and access rules.

## Reports And Dashboards

| RPT | Route | Purpose | Metrics | Chart | Extract / print | Data source | Access |
|---|---|---|---|---|---|---|---|
| **RPT-01** | `/dashboard` | Role router | - | - | - | membership role | `requireMembership` |
| **RPT-02** | `/dashboard/owner` | Owner daily decision home | approval/deadline attention, budget snapshot, operation readiness, stock risk, palm health, bounded causal drivers; prior comparison is explicitly unavailable | - | Print-ready; every exception drills to source records | RPC-083 `fn_owner_home_snapshot`, one exact active-org owner-only snapshot with at most 8 rows per driver set | owner |
| **RPT-03** | `/dashboard/manager` | Plan readiness and assigned work | active operations, done operations, blocking checks, readiness %, open/due/unassigned tasks | Progress | Assigned-task and active-operation CSV; print-ready | `plans`, `plan_operations`, `plan_checks`, `plan_operation_assignees` | farm_manager, agri_engineer |
| **RPT-04** | `/inventory/[itemId]/coverage` | Stock coverage and reorder decision | available, coverage days, reorder point, recommended quantity, verdict | `PabChart` | Coverage summary and projection CSV; print-ready | RPC-007 `fn_stock_coverage` | any member; reserve action owner/farm_manager/storekeeper |
| **RPT-05** | `/budget/[planId]/check` | Plan budget gate | approved, this-plan cost, review ceiling, utilization %, verdict, finance-review flag | Progress | Budget category CSV; print-ready | `budget_lines` static ceilings, planned `plan_operations`, `lib/budget-check.ts` | any member |
| **RPT-06** | `/reports/[planId]/pva` | Planned-vs-actual execution report | planned cost, actual cost, variance, variance %, assignees, role-gated planned labor cost per operation | `VarianceChart` | Detail CSV; print-ready | `plan_operations`, done `farm_event` actuals, `plans`, role-gated `people_compensation` | any member; labor-cost columns owner/accountant |
| **RPT-07** | `/finance/revenue-reports` | Revenue, collections, pending-price deliveries, A/R aging | finalized revenue, collections, outstanding A/R, 30+ A/R, pending count/qty | `MultiInsightChart` with `CategoryBarChart` by buyer or crop/season; whole-chart precision fallback | CSV per table with period/as-of filenames; print-ready; exact decimal table rendering | RPC-073 `fn_revenue_sales_report_exact` delegates RPC-053 | owner, accountant |
| **RPT-08** | `/finance/custody-reports` | Exact atomic custody and settlement pack | exact full opening/period/closing custody, period cash expenses, current unpaid obligations and 30+ exceptions, period owner funding; unknown dates/amounts explicit | - | Complete-table CSV only; any detail set above the 400-row sample disables its CSV; print-ready | RPC-077 `fn_custody_reports_snapshot` | owner, accountant |
| **RPT-09** | `/finance/reports` | Cost-center economics and reconciliation | exact posted subtree expense/revenue/net, activity counts, unallocated lines, review flags and net per feddan; annual mode adds exact year matrix | `MultiInsightChart` with hierarchy-safe `CategoryBarChart`; annual mode adds `TrendLineChart` | Exact CSV per visible table; print-ready | RPC-082 one atomic snapshot; all filters carry the same subtree scope through rollup, chart, flags and annual evidence | owner, accountant |
| **RPT-10** | `/finance/insights` | Owner finance insight summary | allocation score, posted centers, unallocated net, review flags, operating net | `CategoryBarChart` | Center insight CSV; print-ready | `v_cost_center_rollup`, `v_cost_center_reconciliation_flags`, RPC-065 exact posted-sale revenue | owner, accountant |
| **RPT-11** | `/accounting` | Accounting ledger overview | custody cash, owner funding, operating expenses, capex, drawings, trial balance, recent entries/lines | - | Complete trial-balance CSV; recent entry/line samples are display-only; print-ready | RPC-074 `fn_accounting_ledger_snapshot` | owner, accountant |
| **RPT-12** | `/finance/balance-sheet` | Trusted balance sheet | assets, liabilities, equity incl. net income, cumulative net income, balanced flag | - | Assets/liabilities/equity CSV with as-of filename; print-ready; single-statement server PDF; combined statement package PDF | RPC-055 `fn_accounting_balance_sheet` | owner, accountant |
| **RPT-13** | `/finance/income-statement` | Canonical trusted income statement / P&L with statement and monthly/annual trend views | revenue, expenses, operating expenses, net income/loss, cumulative net income | `TrendLineChart` in trend view | Revenue/expense and trend CSVs; print-ready; combined statement package PDF from statement view | RPC-056 `fn_accounting_income_statement`, `fn_pnl_timeseries` | owner, accountant |
| **RPT-14** | `/finance/budget-vs-actual` | Budget-vs-actual from posted GL | planned, actual, variance, variance %, status | - | Comparison CSV only when budget and ledger sources are verified; otherwise actual-only CSV carries a coverage label; print-ready | RPC-060 `fn_budget_vs_actual`, `data_authority_status` | owner, accountant |
| **RPT-15** | `/finance/close` | Exact dated month-close checklist and statement handoff | blocking pending-price/undated/unrouted/unclassified/unallocated items; nonblocking aged-receivable follow-up; unknown expense amounts | - | Exact undated-expense remediation link; matching inline period lock; statement-review handoff; print-ready; no CSV | RPC-062, RPC-063, accounting period actions | owner, accountant |
| **RPT-16** | `/finance/periods` | Accounting period lock register | total periods, locked periods, reopened/open periods | - | Accounting-period CSV; print-ready | `accounting_periods`, `fn_close_accounting_period`, `fn_reopen_accounting_period` | owner, accountant |
| **RPT-17** | `/finance/pnl-trend` | Compatibility alias; owner/accountant-gated redirect to RPT-13 trend view | - | - | - | no data read on alias | owner, accountant |
| **RPT-18** | `/finance/season` | Exact atomic harvest/revenue season view | exact full physical deliveries, pending-price tons, booked revenue, collected, trader A/R, invalid-revenue-journal exceptions, harvested-vs-delivered crates and exact center summaries | - | Delivery CSV only when the newest-400 sample is complete; center CSV remains exact; print-ready | RPC-076 `fn_season_dashboard_snapshot` | owner, accountant |
| **RPT-19** | `/finance/cost-centers/[id]` | Cost-center 360 | direct expenses, finalized sales, tree net, net per feddan | - | Expense and sales CSV; print-ready | selected cost center, `expenses`, `sales`, rollup views | owner, accountant |
| **RPT-20** | `/farm/offshoots` | Offshoot bank reporting | produced/planted/replanted/sold quantities, valuation estimate | `MultiInsightChart` with `CategoryBarChart` | Numerical report/export hidden until the source ledger is verified; capture/import remains available | offshoot ledger, valuation, `data_authority_status` | owner, accountant, farm_manager |
| **RPT-21** | `/weather/dashboard` | Weather risk dashboard | weather readings and threshold risk signals | `TrendLineChart` | Risk-window and advisory CSV; print-ready | weather readings/thresholds | any member |
| **RPT-22** | `/budgets` | Budget overview | budget count, planned total, approved total, available by budget | - | Report/export hidden until an authoritative budget source is verified | `budgets`, RPC-060, `data_authority_status` | owner, accountant, farm_manager |
| **RPT-23** | `/budgets/[budgetId]` | Budget 360 detail | planned, approved, committed + actual, available, lines, linked PRs, category expenses | - | Detail and exports hidden until an authoritative budget source is verified | `budgets`, `budget_lines`, `purchase_requests`, gated `expenses`, `data_authority_status` | owner, accountant, farm_manager; expense tab owner/accountant only |
| **RPT-24** | `/purchase-requests` | Purchase request console | open/submitted/open-order/overdue/stale request counts, remaining qty, needed-by alerts | - | Purchase-request CSV; print-ready | `purchase_requests`, `purchase_request_items`, `inventory_items`, `lib/pr-console.ts` | any member |
| **RPT-25** | `/inventory` | Inventory item directory | item count, reorder threshold flags, uncosted count, standard-cost inventory value | `bar` column | Inventory CSV; print-ready | `inventory_items`, `inventory_bin` | any member |
| **RPT-26** | `/inventory/movements` | Inventory movement audit ledger | last-30-day movement counts by group; latest movement window | - | Inventory movement CSV; print-ready | `inventory_movements`, `inventory_items`, `suppliers` | any member |
| **RPT-27** | `/expenses`, `/expenses/[expenseId]` | Exact atomic expense ledger and 360 detail | exact full expense counts by filter, current-month non-drawing total, owner drawings when visible, bounded newest matching rows; atomic exact expense/event/payment detail | - | Expense CSV only when the selected view is complete within 200 rows; truncation disclosed; print-ready | RPC-080 `fn_expense_daily_snapshot`, RPC-081 `fn_expense_detail_snapshot` | owner, accountant, farm_manager; drawings, accounts and payment evidence owner/accountant only |
| **RPT-28** | `/custody` | Custody and payment-request dashboard | exact custody balance/target/top-up, unpaid known totals and unknown counts, full request/movement counts, bounded newest detail | - | Bounded payment-request CSV only when complete; truncation disclosed; print-ready | RPC-079 `fn_custody_daily_snapshot` | owner, accountant |
| **RPT-29** | `/transactions` | Unified money ledger | exact full count by expense/sale/collection/custody type; exact pending-price follow-up count | - | CSV only when the current filtered/all view is complete within its 400-row-per-source sample; truncated search/export is disclosed; print-ready | RPC-075 `fn_transactions_snapshot` | owner, accountant |
| **RPT-30** | `/people` | Team directory by manager | total people, active people, people assigned to open planned operations | - | People CSV; print-ready | `people`, `plan_operation_assignees`, `plan_operations` | owner, farm_manager, agri_engineer, accountant |
| **RPT-31** | `/suppliers` | Supplier directory | supplier count, suppliers with active purchase-order lines, lead time, open lines | - | Supplier CSV; print-ready | `suppliers`, `purchase_request_items`, `purchase_requests` | any member; create action owner/farm_manager/storekeeper |
| **RPT-32** | `/plans` | Plan register | plan count by all/active/draft/closed status, due operation count | - | Plans CSV; print-ready | `plans`, `plan_operations` | any member; create action owner/farm_manager |
| **RPT-33** | `/plans/dashboard` | Planning and operations readiness dashboard | active plans, due operations, blocked checks, open estimated cost, executed operation cost KPIs | `CategoryDoughnut`, `CategoryBarChart` | Attention-plan, operation-slice, and blocked-check CSV; print-ready | `plans`, `plan_operations`, `plan_checks`, `farm_event`, farm structure | any member; field dashboard link role-gated |
| **RPT-34** | `/farm/pest-scouting` | Red-palm-weevil scouting register | traps needing attention, all traps, weekly catches, suspected incidents | - | CSV per table; print-ready | `pest_traps`, `pest_trap_catches`, `pest_incidents`, farm structure | any member; write owner/farm_manager/agri_engineer/supervisor |
| **RPT-35** | `/plans/[planId]` | Plan 360 detail | plan status, readiness, operation count, estimated cost, check results, operation calendar, assignees, agronomist sign-off state | `OpsCalendar` | Operation, calendar, check, and dose-signoff CSV; print-ready | `plans`, `plan_operations`, `plan_checks`, `plan_operation_assignees`, `people`, `inventory_items`, templates | any member; write controls owner/farm_manager; sign-off owner/agri_engineer |
| **RPT-36** | `/finance/enterprise-scorecard` | Enterprise/crop profitability scorecard | revenue, expenses, profit, margin, ROI, unallocated revenue/expense | - | Enterprise scorecard CSV; print-ready | `v_cost_center_rollup`, RPC-065 exact posted-sale revenue, `lib/entity-pnl.ts`, `lib/pnl-insights.ts` | owner, accountant |
| **RPT-37** | `/finance/sector-scorecard` | Sector profitability benchmark | sector net profit, profit/feddan, best-unit benchmark, upside, unallocated revenue/expense | - | Sector scorecard CSV; print-ready | `v_cost_center_rollup`, RPC-065 exact posted-sale revenue, `lib/entity-pnl.ts`, `lib/pnl-insights.ts` | owner, accountant |
| **RPT-38** | `/farm/dashboard` | Farm structure and field-health overview | sectors, hawshat, Barhi/male palms, attention palms, offshoot availability, palm-count reconciliation | `CategoryBarChart`, `CategoryDoughnut` | Palm, offshoot, and operations numbers and related exports fail closed until each domain is verified | structure/event tables, `data_authority_status`, `lib/palm-count-reconciliation.ts` | any member; offshoot KPI owner/accountant/farm_manager |
| **RPT-39** | `/inventory/dashboard` | Inventory and purchasing work dashboard | reorder items, submitted PRs, partial receipts, active PRs, supplier count | `CategoryDoughnut` | Work-table CSV; print-ready | `inventory_items`, `inventory_bin`, `purchase_requests`, `suppliers` | any member |
| **RPT-40** | `/people/dashboard` | Team workload and labor dashboard | active people, employment mix, assigned operations, unassigned operations, payroll estimate when permitted | `CategoryBarChart`, `CategoryDoughnut` | Workload, unassigned-operation, and directory CSV; print-ready; payroll estimate no CSV | `people`, `plan_operations`, `plan_operation_assignees`, gated `labor_logs`/`people_compensation` | owner, farm_manager, agri_engineer, accountant; payroll estimate owner/accountant |
| **RPT-41** | `/finance/dashboard` | Role-aware finance home | Accountant: exact ledger gaps, pending pricing, staged reconciliation batches, receivables, period/custody/payment state and gated month comparison. Owner/farm manager: existing budget, expense and request operating view. | Legacy owner/manager charts only; no decorative chart on Accountant home | Accountant evidence lists are bounded; exact counts remain complete; money and comparison are hidden until ledger authority is verified | RPC-084 for accountant; RPC-078 for owner/farm manager | owner, accountant, farm_manager; accountant RPC is accountant-only |
| **RPT-42** | `/finance/insights-summary` | One-screen deterministic owner insight narrative | P&L narrative, benchmark opportunity, concentration/cost/crop theses | - | Screen only | P&L time series, cost-center rollup, RPC-065 exact posted-sale revenue, tested insight selectors | owner, accountant |
| **RPT-43** | `/insights/annual-report` | Annual GL narrative with all-history sector context | annual revenue/profit/cumulative result, area, leading sector context | `TrendLineChart`, `CategoryBarChart` | Print-ready | annual P&L time series, farm area, cost-center rollup, RPC-065 exact all-history posted-sale revenue | owner, accountant |
| **RPT-44** | `/insights/benchmark` | Internal best-sector benchmark | profit/feddan, best-unit upside, concentration, unallocated revenue/expense | - | Print-ready | cost-center rollup, RPC-065 exact posted-sale revenue, tested benchmark selectors | owner, accountant |

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
  `/finance/insights`, `/finance/income-statement?view=trend`, `/finance/enterprise-scorecard`, `/finance/sector-scorecard`,
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
5. Download the combined statement package PDF or print/export the statement tables as support.
6. Lock the period in `/finance/periods`.

The clean checklist does not auto-lock. It deliberately hands the accountant to the statements first.

## Known Limitations

- Server-generated PDF is live for the balance sheet and combined income-statement/balance-sheet package. The signed/archive
  workflow is still future work, and budget-vs-actual remains a separate print/CSV report.
- Cost-center reports are all-history today; their CSV filenames are intentionally generic until a period filter is added.
- Budget-vs-actual remains report-only. It exposes variance and unbudgeted spend but does not enforce caps
  (Decision-0157).
- The report catalog is a current-state index, not a replacement for `RPC-CATALOG.md`, `FEATURE-REGISTRY.md`, or
  the Arabic user manual.

Maintenance: add a new report route as the next `RPT-NN`; add any new chart component to the chart catalog; note
CSV and print coverage when the page is exportable or print-ready.
