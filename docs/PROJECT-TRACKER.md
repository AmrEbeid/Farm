# Project Tracker — Farm OS      Last updated: 2026-06-29 by Claude (for Owner: Amr Ebeid)

> **2026-06-29 — Owner-review packaging checklist + final code-readiness pass.** Inventoried the full local
> worktree for the module navigator/dashboard/360 batch, confirmed no dependency manifests, env files, Vercel/proxy
> files, or Supabase migration/test/config files are in scope, and ran a secret-pattern scan over the app/docs diff
> with no hits. Added `docs/superpowers/plans/2026-06-29-module-dashboard-360-owner-review-checklist.md` to separate
> included scope, explicit exclusions, review gates, validation evidence, known browser-auth limitation, and safe
> selective staging guidance. Final review then patched the remaining farm timeline/status raw enum fallbacks on the
> farm list/dashboard and sector/hawsha/line/palm 360 pages; line/palm now use the shared `SUBTYPE_AR` label map.
> Independent explorer-agent audit then found and fixed three readiness issues: storekeeper `/dashboard` now routes
> to `/inventory/dashboard`, expense list/detail pages enforce the same finance roles as the sidebar, and `/farm`,
> `/plans`, and `/inventory` now present as secondary structure/list surfaces with links back to their module
> dashboards. Added a role-filtered dashboard-first nav guard plus explicit active-nav assertions for current 360
> routes. The legacy mutating Playwright wedge setup now refuses non-local Supabase URLs unless an explicit local
> reset env flag is present, preventing accidental data resets against a direct Supabase target.
> Final standards/spec review found and fixed four issues: settings role fallback no longer shows raw unknown role
> codes; planning's due-operations KPI now filters to the due queue; the Farm Barhi total is no longer a fake filter;
> and finance now separates displayed operating expenses from owner drawings using existing expense text fields until
> a stronger schema discriminator exists.
> Targeted blocker searches are clean for invalid nested controls, placeholder links, hardcoded KPI literals, and
> farm event/status enum leaks (the `health_status` raw fallback remains intentionally allowed for field-entered
> free-text Arabic). **Validation:** touched-file ESLint clean; `npx tsc --noEmit` clean; `npx vitest run
> lib/nav.test.ts lib/page-help.test.ts` **17/17**; full `npx vitest run` **177/177**; `npm run build` green.
> Browser/auth visual smoke remains open; Owner clarified not to use the Docker-backed local Supabase stack and that
> migrations are handled directly in Supabase, so any remaining visual pass should use an already-authenticated
> browser/session or a separately approved non-Docker path.
> `docs/SPEC-0018-custody-and-payment-requests.md` remains unrelated and must not be staged with this batch. No
> migrations, RPCs, prod mutation, commit, merge, or deploy.

> **2026-06-29 — 360 table drill-through hardening.** Reviewed `SimpleTable`/`FilterableTable` row-link behavior and
> dashboard/360 row definitions for missing canonical detail affordances. Budget 360 and Supplier 360 expense rows
> now link to Expense 360 (`/expenses/[expenseId]`), matching the dashboard/360 contract that operational table rows
> drill into the relevant file when one exists. Rows without a backing detail route remain non-clickable.
> **Validation:** touched-file ESLint clean; `npx tsc --noEmit` clean; `npx vitest run lib/nav.test.ts
> lib/page-help.test.ts` **16/16**; full `npx vitest run` **176/176**; `npm run build` green. No migrations, RPCs,
> prod mutation, commit, merge, or deploy.

> **2026-06-29 — Mobile/accessibility layout hardening.** Ran a focused review of the module sidebar, topbar, KPI
> grids, and dashboard/360 responsive layout. Changed KPI sections from two columns on the smallest screens to
> one-column default / two-column `sm` / four-column desktop, added `aria-controls` to module toggles, changed active
> KPI filter links to `aria-current="page"`, allowed the topbar controls to wrap, and added sidebar label
> overflow wrapping so long Arabic labels do not push the drawer width. **Validation:** touched-file ESLint clean;
> `npx tsc --noEmit` clean; `npx vitest run lib/nav.test.ts lib/page-help.test.ts` **16/16**; full
> `npx vitest run` **176/176**; `npm run build` green. No migrations, RPCs, prod mutation, commit, merge, or deploy.

> **2026-06-29 — Pre-merge UX label/markup hardening.** Ran a focused review over the module dashboard/360 batch for
> nested interactive markup, placeholder links, duplicated label maps, and raw DB enum fallbacks. Fixed remaining
> `Link > Button` patterns on `/m` and the manager dashboard, centralized `EMP_TYPE_AR` and `PR_STATUS_AR` in
> `lib/labels.ts`, and replaced raw fallback rendering for unknown people, plan, operation, PR, movement, and expense
> event statuses with Arabic-safe labels. **Validation:** touched-file ESLint clean; `npx tsc --noEmit` clean;
> `npx vitest run lib/nav.test.ts lib/page-help.test.ts` **16/16**; full `npx vitest run` **176/176**;
> `npm run build` green. No migrations, RPCs, prod mutation, commit, merge, or deploy.

> **2026-06-29 — Module navigator spec aligned with enforced guards.** Updated the module navigator/dashboard/360
> design spec so it now documents the implemented dashboard filter contract, shared dashboard filter primitives,
> route-specific Help Drawer requirement, dynamic active-nav requirement, and the filesystem-backed Vitest guards in
> `lib/nav.test.ts` and `lib/page-help.test.ts`. This was a docs-only alignment pass after the latest validated code
> state; no migrations, RPCs, prod mutation, commit, merge, or deploy.

> **2026-06-29 — Dynamic active-nav drift guard added.** Added a filesystem-backed `lib/nav.test.ts` guard that
> samples every dynamic `app/(app)` page and asserts it resolves to an active nav item, preventing future 360 or
> workflow routes from silently losing module/sidebar context. **Validation:** `npx vitest run lib/nav.test.ts`
> **9/9**; touched-file ESLint clean; `npx tsc --noEmit` clean; full `npx vitest run` **176/176**; `npm run build`
> green.

> **2026-06-29 — Workflow active-nav aliases added.** Added explicit active-nav aliases so dynamic workflow pages
> outside normal nav prefixes keep the correct module/sidebar context: `/budget/[planId]/check` now highlights
> `budgets`, and `/reports/[planId]/pva` highlights `plans` instead of falling back to the global dashboard. Covered
> by `lib/nav.test.ts`. **Validation:** `npx vitest run lib/nav.test.ts lib/page-help.test.ts` **15/15**;
> touched-file ESLint clean; `npx tsc --noEmit` clean; full `npx vitest run` **175/175**; `npm run build` green.

> **2026-06-29 — Workflow Arabic fallback hardening.** Removed raw DB/string fallbacks from the dynamic workflow
> pages touched by the Help Drawer pass: `/m/execute/[opId]` now falls back to Arabic labels for unknown subtype,
> status, and unit; `/reports/[planId]/pva` falls back to Arabic "عملية" in table/chart labels; and
> `/inventory/[itemId]/coverage` uses Arabic `كجم` as the missing-unit fallback. **Validation:** touched-file
> ESLint clean; `npx tsc --noEmit` clean; full `npx vitest run` **175/175**; `npm run build` green.

> **2026-06-29 — Dynamic route-help drift guard strengthened.** Added a filesystem-backed
> `lib/page-help.test.ts` guard that samples every dynamic `app/(app)` page and fails if it falls back to generic
> dashboard help. This converts route-specific Help Drawer coverage from a manually reviewed checklist into an
> enforced test as new 360/workflow pages are added. **Validation:** `npx vitest run lib/page-help.test.ts` **7/7**;
> touched-file ESLint clean; `npx tsc --noEmit` clean; full `npx vitest run` **175/175**; `npm run build` green.

> **2026-06-29 — Workflow detail help coverage added.** Closed more Documentation Health gaps for dynamic
> user-facing workflow pages: `/inventory/[itemId]/coverage`, `/m/execute/[opId]`, `/budget/[planId]/check`, and
> `/reports/[planId]/pva` now resolve to route-specific Arabic Help Drawer content instead of generic parent help.
> Added route drift tests for all four. Also fixed an existing invalid `Link > Button` pattern on
> `/budget/[planId]/check` by using a styled link for the PR approval CTA. **Validation:** `npx vitest run
> lib/page-help.test.ts` **6/6**; touched-file ESLint clean; `npx tsc --noEmit` clean; full `npx vitest run`
> **174/174**; `npm run build` green. No migrations, no RPC changes, no prod mutation.

> **2026-06-29 — Dashboard filter UI factored.** Added shared `CurrentFilterCard` and replaced duplicated
> current-filter/clear-filter markup across inventory, farm, finance, planning, people, weather, and settings
> dashboards. This keeps the newly interactive KPI-filter behavior consistent without changing data access or route
> behavior. **Validation:** touched-dashboard ESLint clean; `npx tsc --noEmit` clean; full `npx vitest run`
> **174/174**; `npm run build` green.

> **2026-06-29 — Farm structure 360 help coverage added.** Closed the remaining Help Drawer gap for existing
> farm structure detail pages: `/farm/sector/[id]`, `/farm/hawsha/[id]`, `/farm/line/[id]`, and `/farm/palm/[id]`
> now resolve to route-specific Arabic 360 help instead of inheriting generic farm-structure help. Added drift
> coverage in `lib/page-help.test.ts` for all four routes. **Validation:** `npx vitest run lib/page-help.test.ts`
> **6/6**; touched-file ESLint clean; `npx tsc --noEmit` clean; full `npx vitest run` **174/174**; `npm run build`
> green. No migrations, no RPC changes, no prod mutation.

> **2026-06-29 — Dashboard KPI filters added across modules.** Completed the follow-up UX hardening from the
> aggregate review: added shared `DashboardKpiLink` and wired KPI cards to `?filter=` section filters on
> `/farm/dashboard`, `/finance/dashboard`, `/plans/dashboard`, `/people/dashboard`, `/weather/dashboard`, and
> `/settings/dashboard`; `/inventory/dashboard` now uses the shared wrapper while preserving its existing work-table
> filters. Each dashboard shows an Arabic "current filter" card and a clear-filter link. This makes KPI cards
> interactive across modules without adding writes, RPCs, migrations, dependencies, or charts. **Validation:**
> touched-dashboard ESLint clean; `npx tsc --noEmit` clean; full `npx vitest run` **174/174**; `npm run build`
> green.

> **2026-06-29 — Module dashboard/360 hardening review.** Performed an aggregate review of the current
> module navigator/dashboard/360 batch, including an independent explorer-agent pass. Fixed the main review
> findings before stopping: dynamic 360 routes now get route-specific Help Drawer content (`item`, `plan`,
> `purchase request`, `supplier`, `budget`, `expense`, `person`) while the sidebar still highlights the parent
> module/list; `PAGE_HELP`/`helpForPath` tests now cover 360 routing and dashboard fallback. Added shared Arabic
> labels for plan type/status, movement type, budget status, expense status, and payment method; removed raw
> filter/status/type leaks from the new dashboard/360 surfaces. Tightened misleading capped KPI wording/sources:
> farm attention uses an exact count, finance budget totals no longer use the 30-row cap, planning labels say
> "معروضة" for capped work queues, and supplier PR-line count uses exact count with a capped-table note. **Validation:** touched-file ESLint clean; `npx tsc --noEmit` clean; targeted nav/page-help Vitest
> **14/14**; full `npx vitest run` **174/174**; `npm run build` green. No migrations, no RPC changes, no prod
> mutation, no commit/merge.

> **2026-06-29 — Module navigator + Inventory/Purchasing dashboard first slice.** Added
> [`2026-06-29-module-navigator-dashboards-360-design`](superpowers/specs/2026-06-29-module-navigator-dashboards-360-design.md)
> and
> [`2026-06-29-module-navigator-inventory-dashboard`](superpowers/plans/2026-06-29-module-navigator-inventory-dashboard.md),
> then built the read-only first slice: typed `APP_MODULES` registry, grouped app-side sidebar, and
> `/inventory/dashboard` with query-derived KPI filters over inventory items and purchase requests. Also added
> page-help coverage for the new dashboard and croquis sub-page. **No migrations, no RPC changes, no prod mutation,
> no `@amrebeid/ui` package changes.** Independent review found two sidebar CSS blockers (undefined shell vars +
> breakpoint mismatch); both fixed by explicit shell fallbacks and matching the UI package's `48rem` drawer
> breakpoint. **Validation:** ESLint touched TS/TSX clean; `npx vitest run` **170/170**; `npx tsc --noEmit` clean
> when run serially after build; `npm run build` green and includes `/inventory/dashboard`. Browser smoke was
> attempted, but authenticated app smoke is blocked in this environment because the dev seed-auth route is disabled
> unless `NEXT_PUBLIC_SUPABASE_URL` points at local Supabase.

> **2026-06-29 — Item 360 shell added under Inventory/Purchasing.** Built the next read-only slice:
> `/inventory/[itemId]` is now the canonical item overview, while existing `/inventory/[itemId]/coverage` remains
> the Health/Risk deep dive. Inventory list and dashboard item rows now land on the item 360 page. The page reads
> existing RLS-scoped `inventory_items`, `inventory_bin`, `inventory_movements`, and `purchase_request_items` data;
> shows query-derived stock KPIs, item profile/reorder policy, recent movements, linked PRs, and a coverage CTA.
> Independent review found invalid nested `Link > Button`, stale list copy, and nondeterministic PR-line ordering;
> all fixed. **Validation:** targeted ESLint clean; `npx tsc --noEmit` clean; `npx vitest run` **170/170**;
> `npm run build` green and route list includes `/inventory/[itemId]`. No migrations, no RPC changes, no charts,
> no prod mutation.

> **2026-06-29 — Farm Dashboard module entry added.** Built the next read-only module dashboard:
> `/farm/dashboard` is now the Farm module entry point, while `/farm` remains the structure directory. The dashboard
> reads existing RLS-scoped `sectors`, `hawshat`, `assets`, and `farm_event` data; shows query-derived KPIs for
> sectors, hawshat, Barhi palms, and palms needing attention; and links tables into the existing sector, hawsha,
> and palm 360 pages. Updated module nav, active-route tests, page help, and the dashboard/360 design spec.
> **Validation:** targeted ESLint clean; `npx tsc --noEmit` clean; `npx vitest run` **170/170**; `npm run build`
> green and route list includes `/farm/dashboard`. No migrations, no RPC changes, no charts, no prod mutation.

> **2026-06-29 — Planning/Operations Dashboard module entry added.** Built the next read-only module dashboard:
> `/plans/dashboard` is now the Planning/Operations module entry point, while `/plans` remains the plan directory.
> The dashboard follows the Admin Panel + market pattern of status KPIs over a work table: active plans, due/open
> operations, blocked checks, and estimated open cost from existing RLS-scoped `plans`, `plan_operations`, and
> `plan_checks` reads. Rows link into existing plan 360 pages and the field surface remains available via `/m`.
> Updated module nav, active-route tests, page help, plan, and the dashboard/360 design spec. **Validation:**
> targeted ESLint clean; `npx tsc --noEmit` clean; `npx vitest run` **170/170**; `npm run build` green and route
> list includes `/plans/dashboard`. No migrations, no RPC changes, no charts, no prod mutation.

> **2026-06-29 — Finance Dashboard module entry added.** Built the next read-only module dashboard:
> `/finance/dashboard` is now the Finance module entry point, while `/budgets` and `/expenses` remain sub-pages.
> The dashboard reads existing RLS-scoped `budgets`, `expenses`, and `purchase_requests`; shows query-derived KPIs
> for approved budget, committed+actual spend, available budget, and submitted PRs; and surfaces budget pressure,
> recent expenses, and PR follow-up tables. It explicitly avoids draft accounting/P&L work that is not on `main`.
> Updated module nav, active-route tests, page help, plan, and the dashboard/360 design spec. **Validation:**
> targeted ESLint clean; `npx tsc --noEmit` clean; `npx vitest run` **170/170**; `npm run build` green and route
> list includes `/finance/dashboard`. No migrations, no RPC changes, no charts, no prod mutation.

> **2026-06-29 — People Dashboard + Person 360 added.** Built the next read-only module slice:
> `/people/dashboard` is now the People module entry point, `/people` remains the team directory, and
> `/people/[personId]` is the canonical non-PII person 360 page. The dashboard reads existing RLS-scoped `people`
> and `plan_operations` data; shows query-derived active-headcount/work-assignment KPIs; and surfaces workload,
> unassigned operations, and directory tables. Person 360 reads only non-PII `people`, `plan_operations`, and
> `farm_event` data; it does not select phone, email, or compensation. Updated directory row links, module nav,
> active-route tests, page help, plan, and the dashboard/360 design spec. **Validation:** targeted ESLint clean;
> `npx tsc --noEmit` clean; `npx vitest run` **170/170**; `npm run build` green and route list includes
> `/people/dashboard` and `/people/[personId]`. No migrations, no RPC changes, no charts, no prod mutation.

> **2026-06-29 — Weather/Risk Dashboard module entry added.** Built the next read-only module dashboard:
> `/weather/dashboard` is now the Weather/Risk module entry point, while `/weather` remains the detailed forecast
> page. The dashboard reuses the existing server-only `getForecast()` boundary and pure `computeGates()` logic;
> shows query/provider-derived KPIs for forecast days, advisory days, heat-stress days, and service state; and
> surfaces daily operation-gate and advisory-reason tables. It does not change provider config, thresholds, or
> hard-block operations. Updated module nav, active-route tests, page help, plan, and the dashboard/360 design spec.
> **Validation:** targeted ESLint clean; `npx tsc --noEmit` clean; `npx vitest run` **170/170**; `npm run build`
> green and route list includes `/weather/dashboard`. No migrations, no RPC changes, no charts, no prod mutation.

> **2026-06-29 — Settings/Admin Dashboard module entry added.** Built the next read-only module dashboard:
> `/settings/dashboard` is now the Settings/Admin module entry point, while `/profile` and `/settings` remain
> sub-pages. The dashboard reads existing membership/org/team data; shows query-derived KPIs for accessible orgs,
> current role, active team members, and settings availability; and surfaces organization profile, role
> distribution, and admin quick-link tables. It does not add member management, auth-hook changes, or settings
> mutation. Updated module nav, active-route tests, page help, plan, and the dashboard/360 design spec.
> **Validation:** targeted ESLint clean; `npx tsc --noEmit` clean; `npx vitest run` **170/170**; `npm run build`
> green and route list includes `/settings/dashboard`. No migrations, no RPC changes, no charts, no prod mutation.

> **2026-06-29 — Supplier 360 added.** Built the next read-only entity 360:
> `/suppliers/[supplierId]` is now the canonical supplier file and supplier list rows open it. The page reads
> existing RLS-scoped supplier, preferred inventory item, PR line, expense, and inventory movement data; shows
> query-derived KPIs for preferred items, purchase lines, recent expenses, and movements; and links rows back to
> item 360 and PR 360 where available. **Validation:** targeted ESLint clean; `npx tsc --noEmit` clean;
> `npx vitest run` **170/170**; `npm run build` green and route list includes `/suppliers/[supplierId]`.
> No migrations, no RPC changes, no charts, no prod mutation.

> **2026-06-29 — Budget 360 added.** Built the next read-only finance entity 360:
> `/budgets/[budgetId]` is now the canonical budget file and budget list rows open it. The page reads existing
> RLS-scoped `budgets`, `budget_lines`, `expenses`, and `purchase_requests`; shows query-derived KPIs for planned,
> approved, committed+actual, and available budget; and surfaces budget lines, same-category expenses, and linked
> PRs. It does not use draft accounting/P&L work. **Validation:** targeted ESLint clean; `npx tsc --noEmit` clean;
> `npx vitest run` **170/170**; `npm run build` green and route list includes `/budgets/[budgetId]`.
> No migrations, no RPC changes, no charts, no prod mutation.

> **2026-06-29 — Expense 360 added.** Built the next read-only finance entity 360:
> `/expenses/[expenseId]` is now the canonical expense file and expense list rows open it. The page reads existing
> RLS-scoped `expenses` plus supplier, plan, farm/sector/hawsha, and linked event data; shows query-derived KPIs
> for total, quantity, unit price, and linked scope count; and surfaces profile, related links, and linked event
> details. Finance Dashboard recent-expense rows now open Expense 360. It does not use draft accounting/P&L work. **Validation:** targeted ESLint clean; `npx tsc --noEmit`
> clean; `npx vitest run` **170/170**; `npm run build` green and route list includes `/expenses/[expenseId]`.
> No migrations, no RPC changes, no charts, no prod mutation.

> **2026-06-29 — Purchase Request 360 polished.** Updated existing `/purchase-requests/[prId]` to match the
> dashboard/360 convention: added query-derived KPI cards for line count, estimated cost, received quantity, and
> remaining quantity/open lines, and linked PR line rows to Item 360 (`/inventory/[itemId]`). Mixed-unit requests
> do not sum incompatible units; they show an explicit mixed-unit state. Approval and receipt actions were not
> changed. **Validation:** targeted ESLint clean; `npx tsc --noEmit` clean; `npx vitest run` **170/170**;
> `npm run build` green. No migrations, no RPC changes, no charts, no prod mutation.

> **2026-06-29 — Plan 360 polished.** Updated existing `/plans/[planId]` to match the dashboard/360 convention:
> added query-derived KPI cards for operation count, estimated cost, checks run, and blocked checks, and replaced
> invalid nested `Link > Button` quick actions with styled links. Operation creation/check-running behavior was not
> changed. **Validation:** targeted ESLint clean; `npx tsc --noEmit` clean; `npx vitest run` **170/170**;
> `npm run build` green. No migrations, no RPC changes, no charts, no prod mutation.

> **2026-06-29 — Navigator drift guards strengthened.** Added unit coverage that every module's first page matches
> its `dashboardHref` and every nav href has a backing route file under `app/(app)`. **Validation:** targeted
> nav/page-help Vitest **12/12**, full `npx vitest run` **172/172**, `npx tsc --noEmit` clean, `npm run build`
> green. No runtime behavior, migration, RPC, or prod changes.

> **2026-06-27 (newest) — Owner-authorized PUSH + MIGRATE + MERGE.** Knowledge System (16 docs) + SPEC-0014
> Tier A code committed/pushed/merged to `main` (branch `feat/knowledge-system-spec0014-tierA`, independent
> review APPROVE-WITH-NITS, nit fixed, tsc 0 / Vitest 159/159). **Prod migrated `0084` → `0089`** (`0085`
> active-org, `0086` org-settings, `0089` palm-guard) via MCP — exact repo versions, 0 stray rows, advisors show
> only pre-existing intentional WARNs; this **fixes the live org-switcher/settings errors**. Draft PRs #366/#368
> (academy `0087` / accounting `0088`) **deliberately NOT merged** — unmet human-expert gates + would 500 prod.
> Still Owner-only: 🔴 service-role key rotation; enable the `custom_access_token_hook` in the dashboard to
> activate active-org; ratify SPEC-0013.

> **2026-06-27 (latest) — ground-truth audit + commercialization specced (docs only; no code/migration/prod).**
> An external commercial-readiness assessment was **reconciled against `main`** and found to have evaluated a
> **stale prototype schema**, not the live code: the operating loop (Plan→Coverage→Budget→Approval→Execute→
> Cost→Report) and the multi-tenant / inventory / event / planning / PR foundation are **already built + live**.
> Created **[`RECONCILE-001`](RECONCILE-001-main-ground-truth-2026-06-27.md)** — now the **canonical capability
> map** (37 tables, ~38 RPCs, 26 pages, 89 pgTAP files; every capability → migration/RPC/route/lib + status +
> confidence). The one genuinely-missing layer → **[`SPEC-0013` Commercial SaaS Layer](SPEC-0013-commercial-saas-layer.md)**
> (subscriptions / tiers / limits / onboarding / import wizard / admin console / billing; **Draft**, High risk,
> 8 reviewable slices; **per-farm not per-seat**; real-data import behind Stage M privacy review). Also
> recommended (Owner-gated): a legacy banner on `docs/03` so its prototype schema examples aren't re-mistaken
> for production. **Next real Owner decision: ratify SPEC-0013 — esp. plan tiers + billing provider.**
> Also this session (Owner: "go for both, keep scope tight"): **[`SPEC-0014` Knowledge / Living Documentation
> System](SPEC-0014-knowledge-living-documentation.md)** scoped to **Tier A only** (page-level `pageMeta` help
> drawer + **rule-based** "Why?" over `lib/errors.ts` + a Documentation Health Score) — manual-generation,
> walkthroughs, videos, and the **AI Expert (blocked behind Stage 11)** are explicitly deferred — and a
> **CLAUDE.md Definition-of-Done amendment** adding the Documentation Health Score (blocking for user-facing
> pages, advisory for internal/admin/infra). Docs only; no app code/migration/AI route.
>
> **2026-06-27 (also) — canonical [`PRODUCT-MASTER-FILE.md`](PRODUCT-MASTER-FILE.md) written** (reconciled to
> `main`): the full product description (20 sections — modules, page-by-page manual of all ~26 verified routes,
> personas, permissions, data model, RPCs, workflows, built/partial/missing, roadmap). **Reconcile corrections
> it records vs older docs:** (1) **planned-vs-actual IS built** (`reports/[planId]/pva`) — corrects a stale
> RECONCILE-001 line; (2) **`/accounting` P&L + `lib/pnl.ts` + `sales` and `/academy` are NOT on `main`** (draft
> PRs #368/#366); (3) **README's prod "`0048`" is stale** — prod is `0084` (HELD), `main` `0089`. Treat the
> master file + RECONCILE-001 as ground truth.
>
> **2026-06-27 (also) — [`SPEC-0015` Product Knowledge System](SPEC-0015-product-knowledge-system.md) written +
> master file made the hub.** Designs a 6-phase "Knowledge Operating System" (FEAT/BR/TERM **traceability model**
> + L0–L5 **maturity levels**), but **scopes only Tier 1** for build: **Feature Registry + Business Rules Catalog
> + Domain Dictionary** (all code-anchored, Health-Score-tracked). Explicitly **deferred** (phase-gated by a real
> consumer): Notification/Automation/Import-Export/Metrics/Training/Customer-Success/AI-Knowledge-Graph + the
> RPC/Event/Report catalogs. Added a **Knowledge System Index** to [`PRODUCT-MASTER-FILE.md`](PRODUCT-MASTER-FILE.md)
> (hub; body not expanded).
>
> **2026-06-27 (also, under Owner `/goal`) — Tier-1 catalogs BUILT (L3, code-anchored).** Via 3 read-only Explore
> agents: **[`FEATURE-REGISTRY.md`](FEATURE-REGISTRY.md)** (27 FEAT-IDs), **[`BUSINESS-RULES-CATALOG.md`](BUSINESS-RULES-CATALOG.md)**
> (~50 BR-IDs from ~68 extracted constraints, each → enforcing object + migration + test + FEAT; powers the
> rule-based "Why?"), **[`DOMAIN-DICTIONARY.md`](DOMAIN-DICTIONARY.md)** (~40 terms, verified Arabic). Hub index
> flipped to ✅. **Reconcile fixes applied this session:** RECONCILE-001 corrected (planned-vs-actual IS built at
> `reports/[planId]/pva`; `/accounting`+`lib/pnl.ts` are draft-PR not on `main`); README given a ground-truth
> banner (its "`0048`" was stale; `main`=`0089`, prod=`0084`). Docs only — no app code/migration/AI/deploy.
>
> **2026-06-27 (also, under `/goal`) — Knowledge System Phase 2 BUILT (5 engineering catalogs, L3).** Via parallel
> Explore agents: [`RPC-CATALOG.md`](RPC-CATALOG.md) (28 RPCs + 9 trigger fns), [`DATA-DICTIONARY.md`](DATA-DICTIONARY.md)
> (38 tables, TBL-IDs), [`PERMISSIONS-MATRIX.md`](PERMISSIONS-MATRIX.md) (roles×perms×pages + SoD),
> [`EVENT-CATALOG.md`](EVENT-CATALOG.md), [`REPORT-CATALOG.md`](REPORT-CATALOG.md) (6 reports + 2 charts). Tier-1
> catalogs also adversarially verified (12/12 BR claims; 2 test-number typos fixed). Component catalog = Storybook
> (linked). Phases 3–6 remain consumer-gated. Docs only — no app code/migration/AI/deploy.
>
> **2026-06-27 (also, under `/goal`) — SPEC-0014 Tier A *content* drafted as docs.** [`PAGE-HELP.md`](PAGE-HELP.md)
> (5-question block per page), [`WHY-CATALOG.md`](WHY-CATALOG.md) (rule-based "Why?" grounded in `lib/errors.ts`),
> [`DOCUMENTATION-HEALTH.md`](DOCUMENTATION-HEALTH.md) (DoD scorecard baseline; core-loop pages at L3). 16 knowledge docs.
>
> **2026-06-27 (also, under `/goal`) — SPEC-0014 Tier A BUILT in app code + verified.** First running product this
> session: `lib/page-help.ts` (Arabic `pageMeta`), `lib/why.ts` (rule-based "Why?"), `HelpDrawer.tsx`/`WhyButton.tsx`
> (via `@amrebeid/ui` Drawer), wired once into `AppChrome` topbar; A4 Health-Score = **Vitest drift-guards**
> (`page-help.test.ts`/`why.test.ts` — new nav page/error code fails CI until its help/Why exists). **Verified: tsc 0,
> ESLint 0, Vitest 159/159.** Low-risk (presentational + pure logic; no schema/AI/access). **Local/uncommitted; not
> deployed** (deploy/commit Owner-gated). Stage **K** now: SPEC-0014 Tier A done; Tiers B/C deferred (C behind Stage 11).
>
> **2026-06-27 (earlier) — palm archived-hawsha guard merged (`0089`, prod HELD) + market scan → SPEC-0012 + profile page.**
> (1) **`fn_save_palm` data-integrity fix** — an EDIT could re-parent a live palm into an *archived* hawsha
> (vanishes from live views; NOT tenant-isolation). Merged as **PR #373**: migration **`0089`**
> (`palm_no_archived_hawsha`, rejects re-parent into archived hawsha → `22023`) + pgTAP **test `89`** (9 assns).
> Independent review: APPROVE-WITH-NITS. Renumbered `0087`→`0089` to yield to in-flight #366(0087)/#368(0088).
> **Owner decision: prod apply HELD** — prod stays `0084`; `0089` + the pending `0085`/`0086` access-control
> chain await that chain's independent review. (2) **Market/UX research** → [`SPEC-0012`](SPEC-0012-account-admin-and-ux-gaps.md)
> (member/role UI, profile, theme, `/m` offline audit). Owner ratified **role model = existing 5 roles**.
> Shipped via **PR #376**: **S3 read-only `/profile`** + nav; **S1 `/m` offline audit** (offline-*tolerant*, not
> offline-*capable* — no SW/PWA/queue). **Next:** S2 member/role admin (migration `0090` + invite-mechanism
> decision + independent review).
>
> **2026-06-27 (product UI + Stage 1/0) — Stage 1 closed; four backend-but-no-UI gaps shipped as pages.**
> **Stage 1 (SaaS foundation) is DONE** — active-org RLS narrowing + org switcher + org settings
> (#348/#357/#359/#360, migrations `0085`/`0086`; independently reviewed, all four acceptance criteria met).
> **Stage 0 is Owner-deferred** (#365): runbook ready, new repo verified secret-clean, leaked-password
> protection confirmed off; the five credential/external steps are tracked in issue **#362** (to be done
> before real data). Filled four product-surface gaps that had schema but no front-end — live, RLS-enforced,
> role-gated: **Suppliers** (#367), **Expenses** (#369), **Team/People** read-only directory (#370),
> **Budgets** overview (#371). **24 in-app pages** now. Note: prod DB is behind `main` (active-org `0085`/`0086`
> + later not yet pushed) — a prod `db push` + redeploy is needed for these to go live.
>
> **2026-06-27 (latest) — back-half stages advanced to the buildable limit; Owner closed 4 ratification gates in-session.**
> The Owner (Amr Ebeid) **ratified SPEC-0003 / 0005 / 0006 / 0007 + the 5-sector decision** in writing this session
> (recorded → PR #363), closing the ratification gates for Stages 5/8/9/11. Delivered: **Stage 9 weather** (PR #350,
> ready; needs API key); **Stage 5 croquis re-landed** (PR #364 — #347 had been orphaned when #344's base branch was
> deleted on merge); the **payroll** + **P&L** + **academy** + **AI-policy** safe cores; and, per the Owner's "build on
> synthetic, gated" directive, the **Stage 7 accounting framework** (PR #368 — `expenses.kind` #6 + `sales` + P&L report,
> migration `0088`) and the **Stage 10 academy editor** (PR #366 — content store + #4 sign-off gate + `/academy`, migration
> `0087`). All verified (pgTAP 660–666, tsc/eslint/build 0). **Two gates remain OPEN by design — they are real-world expert
> acts no AI can perform or fabricate:** Stage 7's **7-yr Excel reconciliation + privacy review**, and Stage 10's
> **licensed-agronomist + Egyptian pesticide-registration sign-off**. Also still binding: **independent review** before the
> Stage 8 payroll RPC + the Stage 11 AI build reach prod. PRs are drafts; apply migrations `0087`/`0088` WITH the merge
> (same ordering discipline that kept 2/3/4 from breaking prod); #366 & #368 need a trivial allowlist/types merge.
>
> **2026-06-27 (earlier) — Stages 2/3/4 SHIPPED + applied to prod; prod head = `0084`, in sync with `main`.**
> Merged **#344** (Stages 2/3/4), **#346** + **#351** (list search/filter — reusable `FilterableTable` +
> unit-tested `lib/filter.ts`, across inventory / purchase-requests / plans). Applied migrations
> **`0080`–`0084`** to prod via the Supabase MCP under their exact repo versions (0 stray rows) +
> **`storage-policies.sql`** (`farm-media` bucket + org-scoped storage RLS). Verified live: struct/event/plan
> RPCs + `attachments` (forced RLS) present, ledger clean, `get_advisors` only pre-existing WARNs. A
> frontend audit this session confirmed the MVP-0 UI is essentially complete (recommendation panel,
> PR-approval UI, palm grid, #187 Arabic errors, loading skeleton were all already built). **Owner-gated
> next:** independent review of the `0081`/`0084` RLS re-emits (access-control; actor ≠ reviewer); regen
> `database.types.ts` vs prod `0084`. New stages (5/7/8/9/10/11) remain SPEC-ratification-gated — not started.

> **2026-06-27 — Stages 2/3/4 BUILT + reconciled onto `main` (verified), on branch
> `feat/stages-2-3-4-structure-events-plans`.** Editable farm structure + per-node 360 pages + photos/docs
> (Stage 2, [`SPEC-0003`](SPEC-0003-farm-structure-and-palm-registry-import.md) §9); ad-hoc activity
> recording (Stage 3, [`SPEC-0010`](SPEC-0010-activity-event-recording.md)); plan creation/assign/labor +
> `/plans` (Stage 4, [`SPEC-0011`](SPEC-0011-planning-workspace.md)). Built on a stale 0050 base, then
> **renumbered to migrations `0078`–`0082`** (tests `80`/`81`/`82`) and **rebased onto `origin/main`
> (prod `0077`)** — 1 ahead/0 behind. Verified on the rebased branch: **pgTAP 627/627, tsc, Vitest 110/110,
> `next build` green**. One real fix the reconcile caught: explicit `attachments` grant (audit-leak
> invariant). **Owner-gated next:** push + PR; then apply `0078`–`0082` + `storage-policies.sql` to prod +
> regen types. See [`RECONCILE-stages-2-3-4-to-0077.md`](RECONCILE-stages-2-3-4-to-0077.md).

> **2026-06-26 — #155 / SPEC-0009 partial receipts COMPLETE end-to-end (model + UI):** the partial-receipt
> UI (SPEC-0009 slice 5) merged as **#285** — `components/ReceiveForm.tsx` (per-line received-qty inputs,
> default/max = remaining, partial + receive-all, over-receipt 23514→Arabic, double-submit guard), the
> PR-detail received/remaining columns + `partially_received` status, and `recordReceipt` passing
> `p_lines`. With slices 1–3 already shipped as migration **`0045`**, **#155 is complete end-to-end**.
> Only slice 4 (retire the forgeable `app.posting_receipt` GUC) remains, now **optional/low-priority** —
> the writes it guarded are already independently locked down (movements RPC-only via `0030`,
> `received_qty` column-revoked via `0045`), so a forged GUC achieves nothing. **App-only — prod migration
> number unchanged at `0048`.**

> **2026-06-26 (later) — prod pushed to `0035`, IN SYNC with `main` (live-verified):** applied
> **`0032`** (`pr_items_lock_and_version_bump`), **`0033`** (`fn_post_movement_floor_lock`, CONC-1),
> **`0034`** (`engine_stale_po_guard`, ENGINE-STALE-1 #197) and **`0035`** (`authorize_org_scoped`,
> AUTHZ-2 #181) to the prod Supabase (`veezkmytervjnpxcrbkw`) via the MCP, recorded under their exact repo
> versions. Verified live: `list_migrations` → `0035`; the `fn_stock_coverage` guard + `fn_post_movement`
> `FOR UPDATE` lock present; `authorize` is now the 2-arg org-scoped overload (1-arg dropped) and all 7
> policies + the 2 RPCs call it (`multi_org_members = 0`, so zero behavior change on current data);
> baseline coverage correct; `get_advisors` shows only pre-existing WARNs (no new regressions).
> **Authoritative current prod state: `0048`** — after the `0035` push, **`0036`** (FK perf indexes, #230)
> and **`0037`** (`authz3_reserve_wrapper`, AUTHZ-3 #182 — `fn_post_movement` made internal + gated
> `fn_reserve_stock` wrapper) were also applied + verified (fn_post_movement no longer
> authenticated-executable; the wrapper enforces inventory.write); then **`0038`** (`fn_add_plan_operation`,
> #196 — atomic plan-operation RPC); then **`0039`** (`fn_update_palm_status`, #238 — op.execute-gated
> atomic palm-status RPC), **`0040`** (`engine_rec1_fix`, #184 — removed the recommendation's period-1
> receipts double-subtract) and **`0041`** (`inventory_unit_cost`, #89-B — manual unit_cost, NULL when
> unknown, removes the fabricated *84) were applied + verified. Since then the **`0042`–`0046`** batch was
> applied + verified: **`0042`** plan_req_rolegate, **`0043`** budget_rolegate, **`0044`** expenses_rolegate
> (the Owner's RLS role-gates on plan-req/budget/expenses, closing the no-role-gate class B2/AUTHZ-1), **`0045`**
> partial_receipts (#155 — received_qty + partially_received + remaining-based projection + received_qty
> column-UPDATE lockdown), **`0046`** people_compensation (PII-1 #173 wage slice — `payroll.read` perm,
> `people_compensation` table, `people.rate` dropped). **Then `0047`** engine_nulldate_guard (#198 — `fn_stock_coverage`
> now coalesces a NULL `planned_at` to period 1 so null-dated demand is never silently dropped) was applied + verified
> (no-op for dated ops; potassium recommendation unchanged at 600). **Then `0048`** contact_pii_lockdown (PII-1 #173
> phone/email slice — deny-by-default: `revoke select on people from authenticated` + re-grant all columns except phone/email;
> phone column retained for service-role linking) was applied + verified (members can no longer read phone/email; non-PII still
> readable). **#173/PII-1 is now FULLY DONE — both the wage slice `0046` and the contact slice `0048`.**
> Verified (`list_migrations` → `20260622000048`); pgTAP 421/421.
> Also merged app-only (no migration): the `/m` field-view fixes (#268 — dropped a hardcoded plot name, corrected the
> "today" heading, subtype-derived execute defaults) and the plans-page fixes (#269 — plan-block labeled by real cause
> budget-vs-stock, not-found guard, stepper state). A comprehensive app bug-sweep this session confirmed
> auth/middleware/inventory/farm-sector/all action files clean.
> A duplicate non-repo perf-index record (`20260626053743`) was removed so prod history matches the repo exactly.
> *(This session prod went stale-docs→`0031`→`0034`→`0035`→`0037`→`0038`→`0041`→`0046`→`0047`→`0048`.)*
> This supersedes the stale figures elsewhere — the `0028`/`0029` prod claims in older entries (and `0023`
> in the READMEs) were mid-push or lagging snapshots, now corrected. No code/schema changed in this
> reconciliation. (Also surfaced this session: a local-only branch `feat/stage-2-farm-structure` holds
> **unratified** Stage 2 WIP — farm-structure read-views + a registry reconciliation oracle that hardcodes
> **5 sectors**, an open Owner decision per SPEC-0003; do not merge before SPEC-0003 ratification + the
> 4-vs-5 sector call. And three app-layer findings filed: **#187** (AR-ERR-1 Arabic error-mapping gaps,
> non-gated), **#188** (CREATE-1-RESERVE orphaned reservation, review-gated), plus a note on **#89**
> (hardcoded `needed_by` has an engine-projection consequence).)

> **2026-06-25 — Storybook 10 toolchain upgrade + `@amrebeid/ui` 1.2.0 published (merged):** the deferred
> Storybook major (Dependabot #131, ERESOLVE) landed properly via **PR #154** (`chore/storybook-10`).
> Whole Storybook stack `8.6.14`→`10.4.6` (`@storybook/react-vite` + core `storybook`), `@storybook/addon-essentials`
> **removed** (Storybook 9+ folded essentials into core — no v9/v10 release exists, by design; **not** an
> upstream block). `.storybook/main.ts`+`preview.ts` migrated (renderer→framework import; `backgrounds`
> `values`→`options`+`initialGlobals`); all **49** `*.stories.tsx` imports moved to `@storybook/react-vite`.
> Lockfile updated **surgically** to preserve `@types/react` hoisting (kept the `apps/farm-os` typecheck
> green); **no `--force`/`--legacy-peer-deps`**. All CI green (build job incl. **build-storybook**; app job;
> pgTAP) locally + on GitHub. Owner merged #154 (#131 auto-closed). The changesets flow then published
> **`@amrebeid/ui@1.2.0`** to npm + tag `@amrebeid/ui@1.2.0` (release PR #162), carrying this upgrade + the
> 4 queued UI changesets (a11y, datatable-mobile, recharts code-split, reduced-motion); `packages/ui` now `1.2.0`.
> Also merged by Owner this session (not authored here): **#163** (`#158`, lock `inventory_movements` INSERT
> to the RPC path — forgeable ENGINE-DC bypass) and **#164** (`#159`, floor `on_hand` at 0 in
> `fn_post_movement`) — both stock-engine/security fixes on `main` (HEAD `52fa7b0`); **confirm prod migration
> state separately before relying on them in prod.**
>
> **2026-06-25 — DB hardening session (merged + APPLIED to prod):** the queued security caveats
> from the prod-push assurance are now **closed in code and live on prod**. Prod Supabase
> (`veezkmytervjnpxcrbkw`) advanced **`0024`→`0028`**, fully in sync with `main` — all migrations
> applied + verified live; the full pgTAP suite is green locally and in CI at every step. Each landed
> as its own CI-green PR:
> - **AUTHZ-1 Option B** — PR #146, migration `0025_operation_tables_rls_authz`: REST-layer role gate on
>   the operation tables. `farm_event` (+ partitions) / `event_locations` / `quantities` gated to
>   `op.execute` (preserving the RLS-H1 parent-org `EXISTS` check); `plan_operations` gated to
>   `plan.write` (matches the planning action). Closes the direct-PostgREST forge-a-done-operation
>   surface. (test `26`)
> - **ENGINE-DC** — PR #144, migration `0026_engine_dc_constraint`: a `BEFORE INSERT` trigger on
>   `inventory_movements` (`type='receipt'`) rejecting a receipt while an approved-not-received PO for
>   the same `(org,item)` still exists — turns `0018`'s disjointness invariant into a hard DB control.
>   `fn_post_receipt` is claim-first so the legit path is safe. (test `27`)
> - **DELETE-posture** — PR #140, migration `0027_delete_posture_remediation`: `REVOKE DELETE` from
>   `authenticated,anon` on **27 tenant tables**; `plan_checks` intentionally kept deletable (the only
>   legit client delete). (test `28`)
> - **D1 FORCE RLS** — PR #142, migration `0028_force_rls_tenant_tables`: `FORCE ROW LEVEL SECURITY` on
>   all **35** RLS-enabled tenant tables. (test `29`)
>
> **pgTAP now 217 assertions, all green** (Docker-free shim harness + CI). **B2 inventory receipt
> role-gating assessed = ALREADY COVERED** (`fn_post_receipt` + the `0015` policy both enforce
> `inventory.write`) — no migration needed. **AP-5 insert-side SoD** (#76 item 2) confirmed **ALREADY
> merged earlier** (migration `0023`, test `21`) — **RESOLVED**. Other PRs merged this session: **#111**
> (generated Supabase types + typed clients), **#127** (`@playwright/test` patch), **#129**
> (`react`/`react-dom` → 19.2.7); #123/#125/#85/#139 merged earlier in the day. **Live verification:**
> manager login OK; authenticated reads (`farms`/`plans`) HTTP 200; DELETE `expenses` as manager →
> HTTP 403 (permission denied). Demo login fixed earlier — all 6 `@ebeid.test` accounts reset to
> `farm-os-pilot`. **Prod hygiene:** dropped the stray `pgtap` extension from prod `public` (a Supabase
> advisor WARN). **Dependabot majors DEFERRED** (open, commented): #128 TypeScript 6.0 (tsconfig
> `baseUrl` deprecation hard-errors), #130 ESLint 10 (`eslint-plugin-react` incompatible with the v10
> rule API), #131 Storybook 10 (ERESOLVE across the 8.6.x addon stack). **🔴 Still NOT done — KEY
> ROTATION** (blocked on tooling: no `SUPABASE_ACCESS_TOKEN`, supabase not linked, no Vercel CLI, MCP
> has no key-rotation tool) — needs the Owner to rotate `service_role` + DB password (+
> `NEXT_PUBLIC_SUPABASE_ANON_KEY` if the JWT secret rotates), update Vercel env, redeploy; and to
> enable **Leaked Password Protection** (HaveIBeenPwned) via the Auth dashboard toggle. Detail:
> [`SECURITY-REVIEW-FOLLOWUP-2026-06-25.md`](SECURITY-REVIEW-FOLLOWUP-2026-06-25.md).
>
> **2026-06-25 follow-up security review (merged):** a second independent pass closed **B2.1**
> (append-only stock ledger, migration `0016`, #42), **AP-5** (PR self-approval SoD trigger,
> migration `0017`, #47), **EXE-1** (idempotent operation execute / claim-first, #51), **RCP-1**
> (idempotent PR receipt / claim-first, #57), **ENGINE-DC** (stock-coverage receipt double-count
> → fixed via direction #2: scheduled receipts sourced from approved POs, migration `0018`, #61), and
> **CREATE-1** (idempotent PR-create / find-or-create, #63), and **AUDIT-1** (audit
> `organization_member` changes, migration `0019`, #68) — plus a lint fix (#43), findings/runbook docs
> (#45/#49/#54/#55/#58/#59/#60/#62/#64/#65/#66), the ENGINE-DC TODO regression (#56) + engine
> round-trip test (#67), and the **SPEC-0002 authorization-enforcement DRAFT (#69, Owner-gated)**. All
> merged to `main` after independent diff review + local pgTAP/e2e verification; **pgTAP 103/103** (17
> files) + wedge-loop e2e green. **Prod DB still at `0013`** — pushing `0015`/`0016`/`0017`/`0018`/`0019`
> remains an Owner hard-stop (**`0018` is the core-engine change — ratify specifically**; the
> EXE-1/RCP-1/CREATE-1 fixes are app code, no migration). Open findings (all Owner-gated / deferred):
> **AUTHZ-1** (app-layer `op.execute` gate landed #71; authoritative RLS enforcement — SPEC-0002
> Option A — awaits Owner ratification, then a migration), **DEP-1** (`postcss<8.5.10` transitive via
> `next`, build-time only), **BUD-1** (INFO — the budget gate is decision-support + owner-approval, not
> a hard DB spend cap; `committed` is display-only), **CREATE-2** (LOW — `addPlanOperation`
> non-idempotent/non-atomic, planning-path, conservative). SoD finding renamed AP-3→AP-5
> (AP-3 = the PR version-guard). Detail:
> [`SECURITY-REVIEW-FOLLOWUP-2026-06-25.md`](SECURITY-REVIEW-FOLLOWUP-2026-06-25.md).
>
> **2026-06-25 prod-push (applied):** after an 8-agent adversarial prod-push assurance returned
> **GO-WITH-CAVEATS**, migrations `0015`→`0022` were applied to the prod Supabase project via the
> Supabase MCP (`0018` engine change Owner-ratified). **Prod DB is now at `0022`** (`0001–0013` +
> `0015–0022`), fully seeded (1 org, 6 org members, 12 auth.users, full synthetic dataset; transactional
> tables empty — correct pilot state). New this session on branch `fix/authz-1-execute-rpc` (PR #75,
> commit `31ad992`): **`0021`** (lock SECURITY DEFINER EXECUTE grants — revoke `anon` on write RPCs
> `fn_execute_operation`/`fn_post_movement`; revoke public+anon+authenticated on trigger fns
> `pr_guard_approval`/`fn_audit`/`fn_audit_org_member`) and **`0022`** (revoke UPDATE on
> `inventory_movements`/`inventory_bin` → ledger fully append-only, closes #76 item 1), with pgTAP
> tests `19`+`20`. **pgTAP now 126/126** on a clean reset (was 103). Residual caveats (QUEUED, not
> blocking, not live-exploitable on synthetic single-tenant data): **AUTHZ-1 Option B** (gate operation
> tables `plan_operations`/`farm_event`/`event_locations`/`quantities` at the REST layer, not only in
> the `0020` RPC); **AP-5 insert-side SoD** (#76 item 2 — a born-approved PR sidesteps the BEFORE UPDATE
> trigger); **ENGINE-DC** disjointness is convention-enforced, not DB-constraint-enforced. PRs #75/#77
> are both green; merging either = prod deploy = **Owner gate**.
>
> **2026-06-25 — phone-OTP removed:** auth is **email + password only**. The phone-OTP UI skeleton
> (login footnote) is gone and `[auth.sms]` stays disabled in `supabase/config.toml`; Twilio / any SMS
> provider is **dropped from MVP-0 scope** (OWNER-DECISIONS §2 resolved). The seed `phone` field stays
> as a demo-linking key + contact data — it is not auth. (branch `chore/remove-phone-otp`.)

## Current focus
One private monorepo `github.com/AmrEbeid/Farm` (`packages/ui` + `apps/farm-os` + `docs/`). The **design system** (`@amrebeid/ui` **v1.1.0, published** to GitHub Packages, green CI) and the **Farm OS MVP-0 app** are both **BUILT** and on `main`. The **independent security review is DONE + merged** (RLS/grants/engine fixes, the `db-tests` pgTAP CI gate, the `fn_post_movement` B1 primitive). The full inventory path (B1 rewiring + **D2 ledger-backed `reserved`**) is **merged + verified** (74/74 pgTAP + the Playwright wedge-loop e2e pass on the real Supabase stack). The app is now **DEPLOYED + LIVE** (2026-06-24) on **farm-ui-one.vercel.app** + **ebeidfarm.business** with a dedicated Supabase project — login + RLS + the stock-coverage engine verified on prod (see `DEPLOY-STATUS.md`). **What's left:** **Key rotation — deferred to project end (Owner, 2026-06-24):** rotate the Supabase DB password + service_role key (pasted in the deploy chat) + reset the demo password — but do it **before any real data** regardless (the exposed service_role key bypasses RLS). **Pilot validation — considered DONE (Owner):** customer research was completed pre-project (it produced the plan + dummy data). **Near-term: nothing required** — MVP-0 is *deployed + security-reviewed + e2e-verified*, live and stable on synthetic data. **Deferred to project end (Owner):** key rotation, legacy **Stage 0** secret remediation, real-data migration (after a privacy review). **Done this session (2026-06-25):** AUTHZ-1 Option B, ENGINE-DC DB-constraint, the DELETE-exposure remediation, and D1 FORCE RLS — all merged + applied to prod (`0028`), pgTAP 217 green (see top banner). **Optional, agent-doable:** B3 (decision-gated minor); in-browser wedge walkthrough.

## Stages (risk-tiered; see MASTER-PLAN.md §4 for full plan)
| Stage | Title | Type | Risk | Status | Notes |
|---|---|---|---|---|---|
| R | Research & strategy | Research | Low | **Done** | 4 cited streams; white-space confirmed (docs 01) |
| D | Designs / prototypes | Documentation | Low | **Done** | `ebeid-farm-os-demo.html`, `farm-os-prototype.html`, `farm-os-full-demo.html` (mocks) |
| DS | Design system + component library | Execution | Low/Med | **Done (v1.2.0 published)** | `@amrebeid/ui` ~40 components, white-label theming, token-purity gate, Changesets, **green CI**. **`1.2.0` published to npm + tagged (2026-06-25)** — a11y, datatable-mobile, recharts code-split, reduced-motion + **Storybook 10 toolchain upgrade** (PR #154). (Catalog expanded beyond the 9 synced to Claude Design — re-sync pending.) |
| 0 | Security remediation & data cleanup | Execution+Apply | **Critical/High** | **Owner-deferred (2026-06-27)** | Prepped to the boundary by the agent: runbook (`STAGE-0-REMEDIATION-RUNBOOK.md`) complete, new repo verified secret-clean (gitleaks gate + manual scan), leaked-password protection confirmed OFF via advisor. The five remaining steps are Owner-only credential/external actions (rotate prod service_role + DB password, rotate/retire legacy keys, purge old-repo history, scrub spreadsheet + Google password, enable leaked-password protection) — **deferred by Owner decision; must be done before real Ebeid data**. Tracked with exact commands in issue #362. |
| **MVP-0** | **Proof-of-value pilot (1 reference tenant)** | Execution | **Low/Med** | **BUILT (local) — pending review+validation** | `apps/farm-os`: all 14 screens, wedge loop e2e passing, 36 pgTAP + 11 Vitest. Plan: `docs/superpowers/plans/2026-06-21-farm-os-mvp0.md`. Local DB only; needs security review + pilot validation + deploy. |
| 1 | SaaS foundation (orgs/RLS/roles/audit) | Execution | **High** | **Done (2026-06-27)** | All four acceptance criteria met + independently reviewed. (a) **Cross-tenant isolation** — RLS deny-by-default `to authenticated`, `org_id` indexed, proven by `01_rls_isolation` + the invariants `08`/`22`/`24`/`27`/`81` (no-permissive-policy, every cross-org FK org-validated, every SECURITY DEFINER fn pins search_path); (b) **consultant multi-org per-org role** — **active-org** narrowing at the RLS layer (migration `0085`: `user_org_ids()` narrows to a membership-validated `active_org_id` JWT claim, fail-closed; `0086` org settings) + app **org switcher** + `getActiveMembership` reads the active claim (tests `82`); (c) **member removal revokes instantly** (membership-join RLS); (d) **audit_log immutable** (no update/delete policy + `02`/`79`). Org **settings** = owner-gated `fn_update_org_settings`. Farm-setup wizard covered by the editable structure feature. Independent adversarial review of the active-org core: no cross-org leak/escalation. |
| 2 | Farm structure + palm registry import | Execution | Medium | **Done (2026-06-27, merged #344 + live)** | Editable structure (add/edit/remove sector/hawsha/line/palm) + per-node 360 pages + media + **croquis map** (re-landed #364); migrations `0080`–`0084` applied to prod. **SPEC-0003 RATIFIED (Owner 2026-06-27), 5 sectors.** Real Nov-2025 registry bulk import = Stage M. |
| 3 | Activity/event model + operations | Execution | Medium | **Done (merged #344 + live)** | Ad-hoc event recording + follow-ups (SPEC-0010); migration `0083`. |
| 4 | Planning workspace | Execution | Low/Med | **Done (merged #344 + live)** | Plan create/assign/labor + `/plans` (SPEC-0011); migration `0084`. |
| 5 | Inventory + **stock-coverage engine** | Execution | Medium | Todo | The wedge — define checks first (SPEC-0001) |
| 6 | Budget + approvals + purchase requests | Execution | **High** | Todo | Approval/entitlement logic |
| 7 | Accounting (expenses/sales/vouchers) | Execution | **High** | **Framework built on synthetic (2026-06-27, draft PR #368)** | `expenses.kind` (#6 drawings/capex separation) + `sales` + `fn_save_sale`/`fn_set_expense_kind` (budget.write) + the pure P&L engine (`lib/pnl.ts`) + `/accounting` report. Migration `0088` draft (Owner applies). pgTAP 660/660. **GATES STILL OPEN:** the dual-run reconciliation vs the real 7-yr Excel + privacy review (Stage M) + **independent review of the money logic** before prod. |
| 8 | People & labor/payroll | Execution | **High** | **SPEC-0006 RATIFIED (2026-06-27); engine built, full build review-gated** | **PII-1 #173 FULLY DONE** (`0046` wage slice + `0048` contact slice). Payroll computation engine + reconciliation oracle (`lib/payroll.ts`, draft PR #352). **Ratify unblocks the synthetic `labor_logs` + payroll-run RPC build — NOT YET BUILT; needs independent access review + real PII behind Stage M.** |
| 9 | Weather integration | Execution | Medium | **Built (2026-06-27, PR #350 ready); SPEC-0007 RATIFIED** | Untrusted-safe forecast ingest (`lib/weather.ts`) + advisory operation gates + `/weather`. **Go-live = Owner sets server-side `WEATHER_API_KEY`/`WEATHER_API_URL` in Vercel.** |
| 10 | Care Academy content | Documentation | Med/High | **Editor built on synthetic (2026-06-27, draft PR #366)** | Content store + the **#4 authoritativeness gate** (`lib/academy.ts`) + sign-off workflow + `/academy` editor. Migration `0087` draft. pgTAP 666/666. **GATE STILL OPEN:** a **licensed agronomist + current Egyptian pesticide-registration sign-off** — content stays advisory ("قالب استرشادي") until then; editing content RESETS any sign-off. |
| 11 | AI assistant عبدالجليل | Execution | **High** | **SPEC-0005 RATIFIED (2026-06-27); boundary built, AI build review-gated** | Trifecta capability boundary (`lib/assistant-policy.ts`, draft PR #356) — deny-by-default, read-only/RLS-scoped/no-PII/no-outbound. **The AI itself (chat route, model, ingest) is NOT built — it requires independent security review per slice (highest risk).** |
| UX | Account admin & UX-gap closure | Execution | Medium | **Active** | [`SPEC-0012`](SPEC-0012-account-admin-and-ux-gaps.md) — from the 2026-06-27 market scan. **Done:** S1 `/m` offline audit, S3 read-only `/profile` (PR #376). **Next:** S2 member/role admin (5-role model ratified; migration `0090` + invite mechanism + review), S4 true offline, S5 theme. Does NOT rebuild Stage-1 items. |
| C | Commercial SaaS layer (subscriptions/onboarding/admin) | Execution | **High** | **Todo — [`SPEC-0013`](SPEC-0013-commercial-saas-layer.md) DRAFT** | The largest remaining product gap (RECONCILE-001): billing/plan-tiers/tenant-limits/self-serve signup/onboarding/import wizard/demo tenant/admin console/trials/feature-flags. **None in schema/app today.** 8 slices; per-farm not per-seat; entitlements enforced in Postgres; real-data import gated on Stage M. Prereq: SPEC-0012 S2 invite (`0090`). |
| K | Knowledge / living documentation system | Execution | Low/Med | **Tier A BUILT + verified (2026-06-27, local)** | [`SPEC-0014`](SPEC-0014-knowledge-living-documentation.md): in-app Help drawer (`pageMeta`, 5 questions) + **rule-based "Why?"** (`lib/page-help.ts`/`lib/why.ts`/`HelpDrawer.tsx`/`WhyButton.tsx`, wired in `AppChrome`) + Health-Score **Vitest drift-guards**. tsc/lint/159 green; not deployed (Owner-gated). Plus the full knowledge system ([`SPEC-0015`](SPEC-0015-product-knowledge-system.md), 16 docs). **Deferred:** manual-gen/walkthroughs/videos (Tier B) + **AI Expert (Stage 11)** (Tier C). |
| M | Ebeid real-data migration (reference tenant) | External Apply | **High** | Todo | Real financials + PII |
| P | Production deploy (Vercel) | External Apply | **Critical** | **In progress** | MVP-0 deployed: Vercel `farm-ui` + dedicated non-Zeal Supabase `veezkmytervjnpxcrbkw`; **prod DB at `0048`** (`0001–0013` + `0015–0048`, **in sync with `main`**; `0032`–`0048` pushed + live-verified via `list_migrations`, incl. ENGINE-STALE-1 #197 + AUTHZ-2 #181 + AUTHZ-3 #182 + atomic plan-op #196 + FK perf indexes + palm-status RPC #238 + ENGINE-REC1 #184 + inventory unit_cost #89-B + the Owner RLS role-gate trio `0042`–`0044` (plan-req/budget/expenses) + partial receipts `0045` #155 + wage-confidentiality `0046` PII-1 #173 wage slice + engine null-date guard `0047` #198 + contact-PII lockdown `0048` PII-1 #173 phone/email slice) + full synthetic seed (transactional tables empty); backend verified (manager login + RLS; authenticated reads HTTP 200; DELETE `expenses` → HTTP 403; anon denied); pgTAP 421/421. Pending: **🔴 security rotation (DB pw + service key shared in chat) — only red item left** + enable Leaked Password Protection. (Twilio OTP dropped per Owner.) See [DEPLOY-STATUS.md](DEPLOY-STATUS.md). |

Status legend: Todo / Active / Blocked / In review / Done

## Pilot validation gates (MVP-0)
> **Owner (2026-06-24): considered SATISFIED** — the customer research/validation was done *before*
> the project (it produced the plan + the dummy/seed data), so this is not a remaining blocker.
> (Original ≥5/7 criteria + demo/interview plan retained for reference in [`PILOT-READINESS.md`](PILOT-READINESS.md) / [06 §10](06-MVP-0-BUILD-SPEC.md).)

## Definition of Done (paste per stage; see [10 §16](10-operations-and-readiness.md))
- [ ] Code complete · tests pass · RLS verified · Arabic-RTL · mobile · audit events · no secrets · Owner reviewed · reviewer approved (High/Critical) · tracker/spec/session updated · rollback documented

## Open gates / decisions needed
> **See [`OWNER-DECISIONS-2026-06-24.md`](OWNER-DECISIONS-2026-06-24.md)** — consolidated path-to-finish with a recommendation per decision (deploy infra, phone-OTP, Stage 0 runbook, B3 cost source, role model, pricing, pilot).
- [x] **Independent security review of the MVP-0 build — DONE + MERGED to main 2026-06-23** (PR #2; `@amrebeid/ui@1.1.0` published via PR #1/#3). On main (migrations `0010`/`0011` + tests `05`/`06`/`07`, **65/65 pgTAP** via the `db-tests` CI gate): GRANT-C1 unauthenticated `anon` DML+EXECUTE incl. the SECURITY DEFINER engine (CRITICAL); RLS-H1 child tables didn't validate parent org (cross-tenant write, HIGH); ENGINE-C1 expiry double-counted (CRITICAL); ENGINE-H1 phantom purchase rec (HIGH); ENGINE-H2/SS/M1; HIGH-1 org_member write lockdown; B4 input validation; B5 coverage-NaN; `fn_post_movement` (B1 RPC primitive); D3 RLS reference-columns. **PR #4 (B1 action rewiring) + PR #8 (D2 ledger-backed `reserved`) MERGED + e2e-verified** — **74/74 pgTAP + the Playwright wedge-loop e2e PASS on the real Supabase stack** (Docker repaired 2026-06-23; the full receipt/issue/reserve/release path now routes through `fn_post_movement`). **Remaining (decision-gated, minor):** D1 FORCE RLS (low value on Supabase — `postgres` is `bypassrls`), B2 inventory role-gating (needs role-model decision — supervisors execute ops), B3 hardcoded execution date/price (needs cost-source decision). — owner: Amr
- [x] **Cloud infra — DONE (2026-06-24):** dedicated non-Zeal Supabase project (`veezkmytervjnpxcrbkw`) + Vercel deployed and LIVE (farm-ui-one.vercel.app + ebeidfarm.business). Auth = email/password (no SMS — phone-OTP/Twilio dropped per Owner). **Key rotation deferred to project end (rotate before real data).** — owner: Amr
- [ ] **🔴 Rotate the Supabase `service_role` key + DB password** (both pasted in the deploy chat) — the demo password is already reset; this is the **only red item** left from the 2026-06-25 prod-push assurance; do before any real data (the service_role key bypasses RLS). **Blocked on tooling this session** (no `SUPABASE_ACCESS_TOKEN`, supabase not linked, no Vercel CLI, MCP has no key-rotation tool): the Owner rotates via the Supabase dashboard (or provides an access token + Vercel token), then updates Vercel env (`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` if the JWT secret rotated) and redeploys. — owner: Amr
- [ ] **Enable Supabase Auth Leaked Password Protection** (HaveIBeenPwned) — a dashboard toggle (advisor item). — owner: Amr
- [x] **Merge PRs #75 and #77** — done earlier; the prod DB has since advanced to `0028` (see banner). — owner: Amr
- [x] **AUTHZ-1 Option B + AP-5 insert-side SoD + ENGINE-DC DB-constraint — RESOLVED (2026-06-25).** AUTHZ-1 Option B = migration `0025` (#146, REST-layer role gate on `plan_operations`/`farm_event`/`event_locations`/`quantities`); ENGINE-DC = migration `0026` (#144, BEFORE INSERT receipt-vs-open-PO trigger); AP-5 insert-side SoD confirmed already merged (migration `0023`, test `21`). All applied to prod (`0028`), pgTAP 217 green. — owner: Amr
- [x] **DELETE/role posture for tenant tables — RESOLVED (2026-06-25):** migration `0027` (#140) `REVOKE DELETE` from `authenticated,anon` on the **27** exposed tenant tables (keeping `plan_checks` deletable for the plan builder); migration `0028` (#142) also `FORCE`s RLS on all 35 RLS tables. Live-verified: DELETE `expenses` as manager → HTTP 403. Full finding in [`SECURITY-FINDING-delete-exposure-2026-06-25.md`](SECURITY-FINDING-delete-exposure-2026-06-25.md). — owner: Amr
- [ ] **Owner sign-off on canonical palm count** (registry says 4,380/299) — owner: Amr
- [ ] **Approve Stage 0 security remediation** (key rotation + history purge) — owner: Amr
- [ ] **Confirm 4-vs-5 sector labels** and enterprise/crop list — owner: Amr
- [ ] **Engage a local agronomist** to sign off Academy numbers + Egyptian pesticide registrations — owner: Amr
- [ ] **Schedule 5 design-partner farm interviews** (close the Arabic customer-voice gap) — owner: Amr
- [ ] **Decide EGP pricing & setup-fee** anchors with those farms — owner: Amr
- [ ] **Ratify [`SPEC-0013`](SPEC-0013-commercial-saas-layer.md) (Commercial SaaS Layer)** — esp. **plan tiers + limit dimensions** (farms/area/assets/storage/AI — not per-seat) and **billing provider** (Paymob/Fawry/Kashier/Stripe, gated by EGP support); self-serve trial vs white-glove only; platform-operator identity model. — owner: Amr
- [ ] **WhatsApp owner-approval** — wanted or not? Recurs in external assessments; it is a **Hard Stop** (external send + lethal-trifecta) and SMS/Twilio was dropped from MVP-0. — owner: Amr
- [ ] **Review/accept the BUILT [`SPEC-0015`](SPEC-0015-product-knowledge-system.md) Tier-1 catalogs** ([Feature Registry](FEATURE-REGISTRY.md) + [Business Rules](BUSINESS-RULES-CATALOG.md) + [Domain Dictionary](DOMAIN-DICTIONARY.md), built 2026-06-27 under `/goal`); confirm L4–L5 maturity target (CI-validated/generated) as the long-term goal; sequence Phase 2+ vs SPEC-0013. — owner: Amr
- [ ] **Review + deploy/commit [`SPEC-0014`](SPEC-0014-knowledge-living-documentation.md) Tier A** (BUILT + verified local 2026-06-27 under `/goal`: Help drawer + rule-based "Why?" + Health-Score Vitest guards; tsc/lint/159 green). Remaining = the Owner-gated **commit/deploy** + (optional) a standalone CI lint config; interactive in-browser check pending a logged-in session. Tier C (AI) stays behind Stage 11. — owner: Amr

## Known risks (live register — full version in MASTER-PLAN.md §6)
- **Exposed secret in public repo / accounting sheet** (Gmail + anon key + Vercel project id) — *status: OPEN, Stage 0 fixes it.* 🔴
- **Cross-tenant data leak via weak RLS** — *mitigation: RLS-first, independent review on Stage 1.* 
- **AI assistant lethal trifecta** — *mitigation: read-only RPCs, no mass outbound, untrusted-input handling (Stage 11).*
- **Agronomy/pesticide liability** — *mitigation: templates + expert sign-off (Stage 10).*
- **Real financial/PII data into third-party model** — *mitigation: privacy review before migration (Stage M).*
- **Onboarding friction → churn** (industry #1) — *mitigation: white-glove Arabic onboarding (GTM doc).*
