# Report Catalog — Farm OS

*Phase 2 of the Product Knowledge System ([`SPEC-0015`](SPEC-0015-product-knowledge-system.md)). Every report,
dashboard, and chart on `main`, with its purpose, metrics, filters, data source, chart, and access. Reconciled
2026-06-27 (verified page code + `components/charts.tsx` + `FilterableTable.tsx`/`lib/filter.ts`). Maturity **L3**.
Feature: FEAT-018 (+ FEAT-007 coverage, FEAT-014 planned-vs-actual).*

## Reports & dashboards
| RPT | Route | Purpose | Metrics | Chart | Data source | Access |
|---|---|---|---|---|---|---|
| **RPT-01** | `/dashboard` | Role router (no UI) | — | — | role → owner/manager/`/m`/`/inventory` | `requireMembership` |
| **RPT-02** | `/dashboard/owner` | Owner overview | pending PRs; over-budget lines; budget-line cards (used vs approved); PR table | — | `purchase_requests`, `budget_lines` | owner, accountant |
| **RPT-03** | `/dashboard/manager` | Plan readiness | plan ops, done, blocking checks, **readiness %** (progress bar) | — (Progress) | `plan_operations`, `plan_checks` (SEED_PLAN_ID) | farm_manager, agri_engineer |
| **RPT-04** | `/inventory/[itemId]/coverage` | **Stock coverage (the wedge)** | available, coverage days, reorder point, recommended qty, verdict banner; conditional Create-PR | **PabChart** (projected available balance over 8 weeks; marks first shortage) | RPC-007 `fn_stock_coverage` | any member (reserve = owner/farm_manager/storekeeper) |
| **RPT-05** | `/budget/[planId]/check` | Budget gate for a plan | approved, actual, committed, available, utilization %, verdict (block/approval-needed/ok) | — (Progress) | `budget_lines`, `plan_operations` | any member |
| **RPT-06** | `/reports/[planId]/pva` | **Planned-vs-actual** (FEAT-014) | total planned, total actual, variance + trend; per-op breakdown table | **VarianceChart** (planned vs actual cost per operation) | `plan_operations` + done `farm_event` actuals + `plans` | any member |
| **RPT-07** | `/finance/revenue-reports` | **Revenue + A/R aging** (FEAT-023) | finalized revenue, period collections, pending-price deliveries, outstanding A/R, 30+ A/R; buyer/crop rollups; sales/collections tables | **CategoryBarChart** in `MultiInsightChart` (buyer vs crop) | RPC-053 `fn_revenue_sales_report` | owner, accountant |

## Charts (`components/charts.tsx`, code-split via `@amrebeid/ui/charts`)
| Chart | Type | Plots | Used by |
|---|---|---|---|
| `PabChart` | LineChart | Projected available balance across the planning horizon; highlights first shortage period | RPT-04 |
| `VarianceChart` | BarChart | Planned vs actual cost, two bars per operation subtype | RPT-06 |
| `CategoryBarChart` + `MultiInsightChart` | BarChart + toggle | Revenue and outstanding A/R by buyer or by crop/season | RPT-07 |

## List filtering (`FilterableTable.tsx` + `lib/filter.ts`)
- Client-side live search; **Arabic-aware normalization** (strips tashkeel/tatweel, folds alef/ya/ta-marbuta variants)
  so variant spellings still match. Shows a result count (`N من M نتيجة`); only appears when rows ≥ 8.
- **Current limitation:** the infrastructure exists and is unit-tested (`filter.test.ts`) but is **not yet wired onto
  the list pages** — list pages render server-side reads without the filter wrapper. (Tracker notes search/filter as
  reusable; deployment across lists is pending.)

## Known limitations (reconcile honesty)
- **Single-plan mode:** RPT-03 (manager) and RPT-05 (budget check) reference a hardcoded `SEED_PLAN_ID`, and RPT-05
  is hardcoded to the `أسمدة` (fertilization) category — these are MVP shortcuts, not general multi-plan views.
- **No PDF export:** reports now use CSV export where wired; PDF/export packaging is still a market table-stakes gap.
- **Chart suite is expanding:** PAB, variance, and finance report category charts are live; broader analytics remain incremental.
- **Cross-cutting cost analytics** (P&L by sector/crop) depend on the draft accounting work (FEAT-023, PR #368) —
  not on `main`.

Maintenance: a new report → next `RPT-NN` + its `FEAT`; a new chart → add to `charts.tsx` then here.
