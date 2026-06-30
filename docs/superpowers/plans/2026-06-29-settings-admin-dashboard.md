# Settings/Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Keep the checklist current while working.

**Goal:** Add a dedicated Settings/Admin module dashboard at `/settings/dashboard`, while keeping `/profile` and `/settings` as sub-pages.

**Architecture:** Build an additive read-only Server Component dashboard from existing membership/org reads. Update the module registry so the Settings/Admin module starts with `/settings/dashboard`. No migrations, no RPCs, no member-management build, no package UI changes.

## Constraints

- Arabic RTL first.
- No fabricated admin data; all KPIs must be query-derived.
- No migrations, RPC changes, service-role usage, or writes.
- Do not expose protected PII or compensation.
- Do not change `packages/ui`.
- Do not import chart libraries.
- Validate with targeted lint, `npx tsc --noEmit`, `npx vitest run`, and `npm run build` from `apps/farm-os`.
- Update docs last.
- Do not merge, migrate, deploy, or apply database changes.

## Dashboard Contract

- KPI cards:
  - Accessible org count.
  - Current role.
  - Team members.
  - Owner settings availability.
- Tables:
  - Current organization profile.
  - Role distribution from `organization_member` where readable.
  - Admin quick links.
- Links:
  - `/profile`
  - `/settings` for owners only.

## Tasks

- [x] Create `apps/farm-os/app/(app)/settings/dashboard/page.tsx`.
- [x] Update `apps/farm-os/lib/nav.ts`.
  - Settings module `dashboardHref` becomes `/settings/dashboard`.
  - Add first settings page `settings-dashboard`.
- [x] Update `apps/farm-os/lib/nav.test.ts`.
  - Assert `/settings/dashboard` resolves to `settings-dashboard`.
- [x] Update `apps/farm-os/lib/page-help.ts`.
  - Add `settings-dashboard` help.
- [x] Update `docs/superpowers/specs/2026-06-29-module-navigator-dashboards-360-design.md`.
  - Add eighth-slice note for Settings/Admin.
- [x] Review before validation.
  - Check for writes/RPCs, invalid nested anchors/buttons, protected fields, chart imports, and nav/help drift.
- [x] Validate.
  - [x] `npx eslint ...`
  - [x] `npx tsc --noEmit`
  - [x] `npx vitest run`
  - [x] `npm run build`
- [x] Update `docs/PROJECT-TRACKER.md` and `docs/SESSION-BRIEF.md` last.

## Non-Goals

- No member/role management.
- No auth hook changes.
- No settings mutation.
