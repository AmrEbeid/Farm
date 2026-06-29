# Farm Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Keep the checklist current while working.

**Goal:** Add a dedicated Farm module dashboard at `/farm/dashboard`, while keeping `/farm` as the structure directory and linking dashboard tables into the existing sector/hawsha/palm 360 pages.

**Architecture:** Build an additive read-only Server Component dashboard from existing RLS-scoped farm structure and event tables. Update the module registry so the Farm module starts with `/farm/dashboard`; keep `/farm` as "هيكل المزرعة". No migrations, no RPCs, no charts, no package UI changes.

## Constraints

- Arabic RTL first.
- No fabricated farm or financial data; all KPIs must be query-derived.
- No migrations, RPC changes, service-role usage, or writes.
- Do not change `packages/ui`.
- Do not import chart libraries.
- Validate with targeted lint, `npx tsc --noEmit`, `npx vitest run`, and `npm run build` from `apps/farm-os`.
- Update docs last.
- Do not merge, migrate, deploy, or apply database changes.

## Tasks

- [x] Create `apps/farm-os/app/(app)/farm/dashboard/page.tsx`.
  - Query `sectors`, `hawshat`, `assets`, and `farm_event` through the existing server Supabase client.
  - Show KPI cards for sector count, hawsha count, Barhi palms, and attention palms.
  - Show tables for attention palms, latest operations, sectors, and hawshat.
  - Link rows to existing 360 pages: `/farm/sector/[id]`, `/farm/hawsha/[id]`, `/farm/palm/[id]`.
  - Keep the page read-only.
- [x] Update `apps/farm-os/lib/nav.ts`.
  - Farm module `dashboardHref` becomes `/farm/dashboard`.
  - Add first Farm page `farm-dashboard`.
  - Rename `/farm` page label to "هيكل المزرعة".
- [x] Update `apps/farm-os/lib/nav.test.ts`.
  - Assert `/farm/dashboard` resolves to `farm-dashboard`.
  - Preserve `/farm/palm/123` resolving to `farm`.
- [x] Update `apps/farm-os/lib/page-help.ts`.
  - Add `farm-dashboard` help.
  - Keep `farm` help focused on structure editing/directory.
- [x] Update research/spec note.
  - Add third-slice note to `docs/superpowers/specs/2026-06-29-module-navigator-dashboards-360-design.md`.
- [x] Review before validation.
  - Check for invalid nested anchors/buttons, writes/RPCs, fabricated placeholders, chart imports, and nav/help drift.
- [x] Validate.
  - [x] `npx eslint ...`
  - [x] `npx tsc --noEmit`
  - [x] `npx vitest run`
  - [x] `npm run build`
- [x] Update `docs/PROJECT-TRACKER.md` and `docs/SESSION-BRIEF.md` last.

## Non-Goals

- No dashboard interactivity beyond table links in this slice.
- No schema changes or new Supabase policies.
- No rewrite of the existing `/farm` structure directory.
