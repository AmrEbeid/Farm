# Planning/Operations Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Keep the checklist current while working.

**Goal:** Add a dedicated Planning/Operations module dashboard at `/plans/dashboard`, while keeping `/plans` as the plan directory and linking dashboard rows into existing plan 360 pages.

**Architecture:** Build an additive read-only Server Component dashboard from existing RLS-scoped `plans`, `plan_operations`, and `plan_checks` tables. Update the module registry so the Planning/Operations module starts with `/plans/dashboard`; keep `/plans` as "كل الخطط". No migrations, no RPCs, no charts, no package UI changes.

## Research Inputs

- Prior Admin Panel lesson: dashboard cards should summarize and filter operational work; rows open a canonical 360 page.
- Farmbrite: task/work management combines team communication, calendar, schedule, tasks, checklists, reminders, notifications, and reporting (`https://www.farmbrite.com/`).
- Agworld: separates planning, scheduling, in-season execution, and performance; its examples surface due-today work, recommended inputs, costs, observations, and notes (`https://www.agworld.com/`).
- John Deere Operations Center: emphasizes planning work to reduce errors, monitoring job quality/productivity near real time, and analyzing results for the next season (`https://www.deere.com/en/technology-products/precision-ag-technology/operations-center/`).

## Constraints

- Arabic RTL first.
- No fabricated farm or financial data; all KPIs must be query-derived.
- No migrations, RPC changes, service-role usage, or writes.
- Do not change `packages/ui`.
- Do not import chart libraries.
- Validate with targeted lint, `npx tsc --noEmit`, `npx vitest run`, and `npm run build` from `apps/farm-os`.
- Update docs last.
- Do not merge, migrate, deploy, or apply database changes.

## Dashboard Contract

- KPI cards:
  - Active plans.
  - Operations due today or overdue.
  - Blocked plan checks.
  - Estimated planned cost.
- Tables:
  - Plans needing attention: active plans with blocked checks or open operations.
  - Upcoming operations: next planned operations, grouped by plan link.
  - Blocked checks: stock/budget/weather/labor/responsibility blocks.
- Links:
  - Plan rows link to `/plans/[planId]`.
  - Quick links point to `/plans` and `/m`.

## Tasks

- [x] Create `apps/farm-os/app/(app)/plans/dashboard/page.tsx`.
  - Query `plans`, `plan_operations` with embedded `plans`, and `plan_checks` with embedded `plans`.
  - Compute query-derived KPIs only.
  - Use `KpiCard`, `Card`, `EmptyState`, and `SimpleTable`.
  - Keep the page read-only.
- [x] Update `apps/farm-os/lib/nav.ts`.
  - Planning module `dashboardHref` becomes `/plans/dashboard`.
  - Add first planning page `plans-dashboard`.
  - Rename `/plans` page label to "كل الخطط".
- [x] Update `apps/farm-os/lib/nav.test.ts`.
  - Assert `/plans/dashboard` resolves to `plans-dashboard`.
  - Preserve `/plans/[planId]` resolving to `plans`.
- [x] Update `apps/farm-os/lib/page-help.ts`.
  - Add `plans-dashboard` help.
  - Keep `plans` help focused on the plan directory.
- [x] Update `docs/superpowers/specs/2026-06-29-module-navigator-dashboards-360-design.md`.
  - Add fourth-slice note for Planning/Operations.
- [x] Review before validation.
  - Check for writes/RPCs, invalid nested anchors/buttons, fabricated placeholders, chart imports, and nav/help drift.
- [x] Validate.
  - [x] `npx eslint ...`
  - [x] `npx tsc --noEmit`
  - [x] `npx vitest run`
  - [x] `npm run build`
- [x] Update `docs/PROJECT-TRACKER.md` and `docs/SESSION-BRIEF.md` last.

## Non-Goals

- No plan editing changes.
- No check-running automation.
- No calendar drag/drop UI.
- No schema changes or migrations.
