# Module Dashboard/360 Owner Review Checklist

Date: 2026-06-29
Scope: local, uncommitted app/docs batch for the module navigator, module dashboards, and entity 360 pages.

## Included scope

- Module registry and grouped sidebar: `apps/farm-os/lib/nav.ts`, `components/ModuleSidebar.tsx`, `components/AppChrome.tsx`, `app/globals.css`.
- Shared dashboard/filter/help primitives: `DashboardKpiLink`, `CurrentFilterCard`, `HelpDrawer`, `lib/page-help.ts`, `lib/labels.ts`.
- Module dashboards: Farm, Planning, Inventory/Purchasing, Finance, People, Weather/Risk, Settings/Admin.
- Entity 360/detail pages and polish: inventory item, supplier, budget, expense, person, purchase request, plan, and existing farm structure/workflow detail help.
- Workstream docs under `docs/superpowers/specs/2026-06-29-module-navigator-dashboards-360-design.md` and `docs/superpowers/plans/2026-06-29-*.md`.
- Living docs: `docs/PROJECT-TRACKER.md` and `docs/SESSION-BRIEF.md`.

## Explicitly excluded

- `docs/SPEC-0018-custody-and-payment-requests.md` is untracked and unrelated to this batch. Do not stage it with the module dashboard/360 review.
- No Supabase migrations, tests, seeds, or config are part of this batch.
- Do not use the Docker-backed local Supabase stack for this review. Farm OS migrations are handled directly in
  Supabase and remain Owner-gated.
- No package/dependency manifest changes are part of this batch.
- No production deploy, migration apply, commit, push, or merge has been done.

## Review gates before owner approval

- Verify the grouped sidebar by role: owner, farm manager, agri engineer, accountant, supervisor, storekeeper.
- Verify dashboards open first inside each module and KPI cards filter the visible table via `?filter=`.
- Spot-check canonical drill-through:
  - inventory dashboard/list -> item 360 -> stock coverage
  - finance dashboard/budgets -> budget 360 -> expense and PR links
  - suppliers -> supplier 360 -> item, PR, expense links
  - people dashboard/list -> person 360
  - farm dashboard -> sector/hawsha/palm 360 pages
  - planning dashboard -> plan 360, budget check, planned-vs-actual, field execution
- Confirm Arabic-safe labels for unknown statuses/types render as `غير معروف`, `عملية`, or `نشاط`, not raw DB strings.
- Confirm no fabricated KPI values: cards are derived from existing RLS-scoped reads or existing provider responses.
- Confirm mobile layout: sidebar drawer is tappable, topbar wraps, KPI grids do not squeeze labels on small screens.
- Confirm Help Drawer content is route-specific for dashboard, 360, and workflow detail pages.

## Automated evidence already green

- Final code-level owner-readiness pass completed on 2026-06-29 after the farm timeline/status fallback patch.
- Independent explorer-agent audit completed after the final readiness pass. Findings fixed: storekeeper `/dashboard`
  now lands on `/inventory/dashboard`; expense list/detail pages enforce the finance module roles
  (`owner`/`accountant`/`farm_manager`); `/farm`, `/plans`, and `/inventory` are visibly secondary list/detail
  surfaces with header links back to their module dashboards.
- Final standards/spec review findings fixed: settings role fallback no longer leaks raw role codes; planning
  "عمليات مستحقة" filters to the due-operation queue; the farm Barhi total is a plain aggregate instead of a fake
  filter; finance separates displayed operating expenses from owner drawings using existing expense text fields
  until a stronger discriminator exists.
- Legacy mutating Playwright wedge setup is now guarded so it refuses non-local Supabase URLs unless an explicit
  local-reset env flag is present; this prevents accidental resets against a direct Supabase target.
- Targeted blocker searches clean for nested `Link`/`Button` controls, placeholder `href="#"` links, TODO/FIXME/mock/sample markers in the touched app surface, and literal hardcoded KPI values.
- Arabic-safe label search is clean for farm event/status enum leaks; the only remaining raw fallback pattern is `health_status`, which is intentionally free-text capable for field-entered Arabic health notes.
- Touched-file ESLint: clean across the latest dashboard-first/access-control patch files.
- `npx tsc --noEmit`: clean.
- `npx vitest run lib/nav.test.ts lib/page-help.test.ts`: 17/17.
- Full `npx vitest run`: 177/177.
- `npm run build`: green; route list includes all new dashboard and 360 routes.
- `git diff --check`: clean after docs-last update.

## Known limitation

Browser/auth visual smoke is still blocked in this environment. Owner clarified that Farm OS should not use the
Docker-backed Supabase local stack and that migrations are handled directly in Supabase. Do the visual pass in an
already-authenticated browser/session or define a separate non-Docker smoke path before commit/push/merge.

## Safe staging guidance

When the owner approves staging, use selective paths only. Do not use `git add .`.

Include:

- `apps/farm-os/app/(app)/...` dashboard/360/list/workflow page changes in this workstream.
- `apps/farm-os/components/AppChrome.tsx`
- `apps/farm-os/components/HelpDrawer.tsx`
- `apps/farm-os/components/ModuleSidebar.tsx`
- `apps/farm-os/components/DashboardKpiLink.tsx`
- `apps/farm-os/components/CurrentFilterCard.tsx`
- `apps/farm-os/app/globals.css`
- `apps/farm-os/lib/nav.ts`
- `apps/farm-os/lib/nav.test.ts`
- `apps/farm-os/lib/page-help.ts`
- `apps/farm-os/lib/page-help.test.ts`
- `apps/farm-os/lib/labels.ts`
- `docs/superpowers/specs/2026-06-29-module-navigator-dashboards-360-design.md`
- `docs/superpowers/plans/2026-06-29-*.md`
- `docs/PROJECT-TRACKER.md`
- `docs/SESSION-BRIEF.md`

Exclude:

- `docs/SPEC-0018-custody-and-payment-requests.md`
- any `apps/farm-os/supabase/**` file unless a separate owner-approved migration task exists
- package manifests and lockfiles unless a separate owner-approved dependency task exists
