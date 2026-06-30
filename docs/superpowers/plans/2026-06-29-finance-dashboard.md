# Finance Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Keep the checklist current while working.

**Goal:** Add a dedicated Finance module dashboard at `/finance/dashboard`, while keeping `/budgets` and `/expenses` as finance sub-pages.

**Architecture:** Build an additive read-only Server Component dashboard from existing RLS-scoped `budgets`, `expenses`, and `purchase_requests` tables. Update the module registry so the Finance module starts with `/finance/dashboard`. No migrations, no RPCs, no accounting/P&L draft work, no charts, no package UI changes.

## Research Inputs

- Prior Admin Panel lesson: KPI cards should surface risk/action buckets; tables are the work surface; rows open the relevant file/workflow.
- Farm finance products commonly emphasize budget vs actual, cash/spend tracking, payable/approval queues, and category-level variance.
- Farmbrite finance/product pages emphasize expense tracking and farm business records (`https://www.farmbrite.com/`).
- Traction Ag and farm accounting products emphasize operational financial visibility without mixing it with task execution (`https://www.tractionag.com/`).
- Conservis/Bushel Farm-style farm management products emphasize field-level profitability and operational cost visibility (`https://www.conservis.ag/`).

## Constraints

- Arabic RTL first.
- No fabricated financial data; all KPIs must be query-derived.
- No migrations, RPC changes, service-role usage, or writes.
- Do not use draft accounting/P&L routes or tables that are not on `main`.
- Do not change `packages/ui`.
- Do not import chart libraries.
- Validate with targeted lint, `npx tsc --noEmit`, `npx vitest run`, and `npm run build` from `apps/farm-os`.
- Update docs last.
- Do not merge, migrate, deploy, or apply database changes.

## Dashboard Contract

- KPI cards:
  - Approved budget.
  - Committed + actual spend.
  - Available budget.
  - Submitted purchase requests.
- Tables:
  - Budget pressure: budgets with lowest available budget first.
  - Recent expenses.
  - Purchase requests awaiting approval/follow-up.
- Links:
  - Quick links point to `/budgets`, `/expenses`, and `/purchase-requests`.
  - PR rows link to `/purchase-requests/[prId]`.

## Tasks

- [x] Create `apps/farm-os/app/(app)/finance/dashboard/page.tsx`.
  - Query `budgets`, `expenses` with embedded supplier names, and `purchase_requests`.
  - Compute query-derived KPIs only.
  - Use `KpiCard`, `Card`, `EmptyState`, and `SimpleTable`.
  - Keep the page read-only.
- [x] Update `apps/farm-os/lib/nav.ts`.
  - Finance module `dashboardHref` becomes `/finance/dashboard`.
  - Add first finance page `finance-dashboard`.
  - Keep `/budgets` and `/expenses` as sub-pages.
- [x] Update `apps/farm-os/lib/nav.test.ts`.
  - Assert `/finance/dashboard` resolves to `finance-dashboard`.
- [x] Update `apps/farm-os/lib/page-help.ts`.
  - Add `finance-dashboard` help.
- [x] Update `docs/superpowers/specs/2026-06-29-module-navigator-dashboards-360-design.md`.
  - Add fifth-slice note for Finance.
- [x] Review before validation.
  - Check for writes/RPCs, invalid nested anchors/buttons, fabricated placeholders, chart imports, and nav/help drift.
- [x] Validate.
  - [x] `npx eslint ...`
  - [x] `npx tsc --noEmit`
  - [x] `npx vitest run`
  - [x] `npm run build`
- [x] Update `docs/PROJECT-TRACKER.md` and `docs/SESSION-BRIEF.md` last.

## Non-Goals

- No accounting/P&L build.
- No new approval actions.
- No schema changes or migrations.
