# Weather/Risk Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Keep the checklist current while working.

**Goal:** Add a dedicated Weather/Risk module dashboard at `/weather/dashboard`, while keeping `/weather` as the detailed forecast/advisory page.

**Architecture:** Build an additive read-only Server Component dashboard from the existing server-only `getForecast()` boundary and pure `computeGates()` logic. Update the module registry so the Weather/Risk module starts with `/weather/dashboard`; keep `/weather` as the forecast page. No migrations, no RPCs, no provider changes, no charts, no package UI changes.

## Research Inputs

- Prior Admin Panel lesson: dashboards should summarize action/risk buckets and route to the detailed surface.
- Farm operations/weather products commonly emphasize spray windows, rain/wind risk, heat stress, and advisory status before field execution.
- John Deere Operations Center positions weather/field-condition awareness as part of planning and monitoring work (`https://www.deere.com/en/technology-products/precision-ag-technology/operations-center/`).

## Constraints

- Arabic RTL first.
- No fabricated weather data; when provider is unconfigured or unavailable, show explicit unknown/configuration states.
- No migrations, RPC changes, service-role usage, or writes.
- Do not change `packages/ui`.
- Do not import chart libraries.
- Validate with targeted lint, `npx tsc --noEmit`, `npx vitest run`, and `npm run build` from `apps/farm-os`.
- Update docs last.
- Do not merge, migrate, deploy, or apply database changes.

## Dashboard Contract

- KPI cards:
  - Forecast days available.
  - Advisory days.
  - Heat-stress days.
  - Service state.
- Tables:
  - Risk window by day with spray/pollination/harvest advisory state.
  - Advisory reasons by day.
- Links:
  - Quick link to `/weather` detailed forecast.
  - Quick link to `/plans/dashboard`.

## Tasks

- [x] Create `apps/farm-os/app/(app)/weather/dashboard/page.tsx`.
- [x] Update `apps/farm-os/lib/nav.ts`.
  - Weather module `dashboardHref` becomes `/weather/dashboard`.
  - Add first weather page `weather-dashboard`.
- [x] Update `apps/farm-os/lib/nav.test.ts`.
  - Assert `/weather/dashboard` resolves to `weather-dashboard`.
  - Preserve `/weather` resolving to `weather`.
- [x] Update `apps/farm-os/lib/page-help.ts`.
  - Add `weather-dashboard` help.
- [x] Update `docs/superpowers/specs/2026-06-29-module-navigator-dashboards-360-design.md`.
  - Add seventh-slice note for Weather/Risk.
- [x] Review before validation.
  - Check for writes/RPCs, invalid nested anchors/buttons, fabricated placeholders, chart imports, and nav/help drift.
- [x] Validate.
  - [x] `npx eslint ...`
  - [x] `npx tsc --noEmit`
  - [x] `npx vitest run`
  - [x] `npm run build`
- [x] Update `docs/PROJECT-TRACKER.md` and `docs/SESSION-BRIEF.md` last.

## Non-Goals

- No weather provider configuration changes.
- No hard operation blocking.
- No agronomy threshold changes.
