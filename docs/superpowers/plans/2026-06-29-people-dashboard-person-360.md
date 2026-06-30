# People Dashboard + Person 360 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Keep the checklist current while working.

**Goal:** Add a dedicated People module dashboard at `/people/dashboard` and a read-only Person 360 route at `/people/[personId]`, while keeping `/people` as the team directory.

**Architecture:** Build additive read-only Server Components from existing RLS-scoped `people`, `plan_operations`, and `farm_event` tables. Update the module registry so the People module starts with `/people/dashboard`; keep `/people` as "دليل الفريق". No migrations, no RPCs, no compensation/PII exposure, no charts, no package UI changes.

## Research Inputs

- Prior Admin Panel lesson: each operational actor needs a canonical 360 page; dashboards use KPI cards and work tables as entry points.
- Workforce products typically emphasize active headcount, assignments, unassigned work, recent activity, and responsibility chains.
- Farmbrite and farm workforce management tools emphasize staff/task coordination and records (`https://www.farmbrite.com/`).
- Agworld-style farm operations tools emphasize connecting work plans, execution, observations, and people responsible (`https://www.agworld.com/`).

## Constraints

- Arabic RTL first.
- No fabricated people/workload data; all KPIs must be query-derived.
- No migrations, RPC changes, service-role usage, or writes.
- Do not select or render `people.email`, `people.phone`, or `people_compensation`.
- Do not change `packages/ui`.
- Do not import chart libraries.
- Validate with targeted lint, `npx tsc --noEmit`, `npx vitest run`, and `npm run build` from `apps/farm-os`.
- Update docs last.
- Do not merge, migrate, deploy, or apply database changes.

## Dashboard Contract

- KPI cards:
  - Active team members.
  - Permanent/seasonal/daily/contractor mix where present.
  - Assigned open operations.
  - Unassigned open operations.
- Tables:
  - Workload by person, linking to `/people/[personId]`.
  - Unassigned open operations, linking to the plan where possible.
  - Team directory preview, linking to person 360 pages.

## Person 360 Contract

- Header/profile without PII: name, position, employment type, manager, active state.
- KPI cards: assigned open operations, completed/performed events, assigned events, direct reports.
- Tables: assigned operations, recent performed events, direct reports.

## Tasks

- [x] Create `apps/farm-os/app/(app)/people/dashboard/page.tsx`.
- [x] Create `apps/farm-os/app/(app)/people/[personId]/page.tsx`.
- [x] Update `apps/farm-os/app/(app)/people/page.tsx`.
  - Link team rows to `/people/[personId]`.
- [x] Update `apps/farm-os/lib/nav.ts`.
  - People module `dashboardHref` becomes `/people/dashboard`.
  - Add first people page `people-dashboard`.
  - Rename `/people` page label to "دليل الفريق".
- [x] Update `apps/farm-os/lib/nav.test.ts`.
  - Assert `/people/dashboard` resolves to `people-dashboard`.
  - Assert `/people/[personId]` resolves to `people`.
- [x] Update `apps/farm-os/lib/page-help.ts`.
  - Add `people-dashboard` help.
  - Keep `people` help focused on the directory.
- [x] Update `docs/superpowers/specs/2026-06-29-module-navigator-dashboards-360-design.md`.
  - Add sixth-slice note for People Dashboard + Person 360.
- [x] Review before validation.
  - Check for writes/RPCs, PII/compensation selects, invalid nested anchors/buttons, fabricated placeholders, chart imports, and nav/help drift.
- [x] Validate.
  - [x] `npx eslint ...`
  - [x] `npx tsc --noEmit`
  - [x] `npx vitest run`
  - [x] `npm run build`
- [x] Update `docs/PROJECT-TRACKER.md` and `docs/SESSION-BRIEF.md` last.

## Non-Goals

- No payroll/compensation view.
- No people editing/invites.
- No schema changes or migrations.
