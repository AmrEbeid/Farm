# Design — Module Navigator, Dashboards, and 360 Pages
*Status: Draft for Owner review · Date: 2026-06-29 · Owner: Amr Ebeid*

## 1. Context

Farm OS currently has a flat primary navigation in `apps/farm-os/lib/nav.ts` and verified routes under
`apps/farm-os/app/(app)` for dashboards, farm structure, plans, inventory, purchasing, expenses, people, weather,
field mode, profile, and settings. The flat nav made sense for the MVP wedge. The next product layer should make the
app feel like an operating system: grouped modules, each with a dashboard, sub-pages, and canonical 360 pages for the
main entities.

This started as a design/spec only. The current implementation remains app/read-only: it does not authorize
migrations, production deploys, or data changes.

## 2. Research Inputs

### Prior Admin Panel research

Local source reviewed:

- `/Users/amrebeid/Documents/Claude/Projects/Admin/Zeal-Command-Center/PRODUCT-ARCHITECTURE-RECOMMENDATION.md`
- `/Users/amrebeid/Documents/Claude/Projects/Admin/Zeal-Command-Center/lovable-operations-dashboard/LOVABLE-EDIT-MERCHANT-360-PHASE1.md`
- `/Users/amrebeid/Documents/Claude/Projects/Admin/CHURN-RISK-ISO-DASHBOARD-LOVABLE-PROMPT.md`
- `/Users/amrebeid/Documents/Claude/Projects/Admin/Zeal-Command-Center/lovable-operations-dashboard/src/components/operations/churn/MerchantRiskTable.tsx`
- `/Users/amrebeid/Documents/Claude/Projects/Admin/Zeal-Command-Center/lovable-operations-dashboard/src/components/operations/churn/MerchantChurnDetail.tsx`

The Admin folder is not a git repository, but it contains the prior Zeal Command Center / Lovable admin-panel work.
The most reusable product decisions were:

- Use one canonical 360 page per entity. Do not create several competing detail pages for the same entity.
- Keep 360 pages nested under the entity directory; they are drill-down routes, not primary nav items.
- Module dashboards should start with KPI cards and make the cards interactive filters for the table below.
- The table is the operational surface: sort, filter, scan, click through to 360, and act.
- 360 pages should answer the entity's story through tabs: overview, activity, related records, risk/health,
  workflow, and timeline.
- Each page should answer one operational question, not become a general dumping ground.

### Market research inputs

Public product pages reviewed for current market patterns:

- John Deere Operations Center: operations visibility, field work, maps, and planning.
  https://www.deere.com/en/technology-products/precision-ag-technology/operations-center/
- Climate FieldView: field data, maps, scouting, and reports.
  https://climate.com/
- AGRIVI: farm management suite positioning across planning, records, inventory, finance, and analytics.
  https://www.agrivi.com/
- FarmERP: ERP-style farm modules across operations, inventory, procurement, traceability, and finance.
  https://www.farmerp.com/
- Croptracker: crop operations, traceability, labor, inventory, and reporting.
  https://www.croptracker.com/

Market takeaway: strong farm systems organize around modules, operational dashboards, maps/field context, records,
inventory/procurement, labor/team, finance, traceability/compliance, and reports. Farm OS should not copy generic BI.
It should use dashboards as working queues: what is blocked, at risk, overdue, understocked, over budget, or ready to
execute.

## 3. Product Principles

1. **Module first, then sub-pages.** The sidebar shows modules. Each module starts with a dashboard and expands into
   sub-pages.
2. **Dashboard before list.** A module's dashboard is the default landing page and gives the user the state of that
   domain before they open lists.
3. **Cards are filters.** KPI cards are actionable controls. Clicking a card filters the module's main table.
4. **One canonical 360 per entity.** Sector, hawsha, line, palm, plan, item, supplier, purchase request, budget,
   expense, person, and weather/advisory entities should each have one authoritative page.
5. **Do not fabricate metrics.** Every KPI is query-derived from existing tables/RPCs, or the card is absent.
6. **Arabic RTL and mobile field use remain primary.** Dashboards must scan well in Arabic and degrade cleanly on
   mobile.
7. **Postgres remains the authority.** Dashboards read from RLS-scoped data. Writes stay behind existing server
   actions / SECURITY DEFINER RPCs.
8. **No broad analytics before the operational loop.** Charts are used where they answer a decision. Tables and
   queues remain the core.

## 4. Recommended Information Architecture

The current flat nav should become a typed module registry.

```text
لوحة التحكم

المزرعة
  لوحة المزرعة
  الكروكي
  القطاعات
  الحوش
  الخطوط
  النخيل

التخطيط والعمليات
  لوحة التخطيط
  الخطط
  عمليات اليوم
  التنفيذ الميداني
  مخطط مقابل فعلي

المخزون والمشتريات
  لوحة المخزون والمشتريات
  الأصناف
  تغطية المخزون
  طلبات الشراء
  الموردون

المالية
  لوحة المالية
  الموازنات
  المصروفات
  مخطط مقابل فعلي

الفريق
  لوحة الفريق
  الأشخاص
  المسؤوليات

الطقس والمخاطر
  لوحة الطقس والمخاطر
  التوقعات
  التنبيهات

الإعدادات
  الملف الشخصي
  إعدادات المؤسسة
```

Routes do not need to be renamed in the first implementation slice. The module registry can map module entries to
existing routes first, then introduce new dashboard routes incrementally.

## 5. Module Dashboard Contract

Every module dashboard follows the same contract:

| Region | Purpose | Behavior |
|---|---|---|
| Header | Name, short status, primary action | Includes module title, date/scope picker when needed, and one primary action |
| KPI row | Immediate orientation | 4-6 cards, all query-derived; clicking a card filters the table |
| Focus panel | What changed or needs attention | Small list/chart of highest-risk or highest-priority records |
| Main table | Operational work surface | Searchable/filterable; row links to 360; supports status tags and compact action buttons |
| Help/Why | Explain rules | Reuse SPEC-0014 page help and rule-based Why entries |

Charts are optional. They must be lazy/code-split like the existing coverage and variance charts if they require
Recharts.

Dashboard KPI cards are not decorative metrics. When a dashboard includes a main table, each KPI that represents a
work queue should link to a URL filter and the page should show the current Arabic filter state plus a clear-filter
path. Shared dashboard primitives should be used where the pattern repeats so modules do not drift.

## 6. Module Designs

### 6.1 المزرعة

Default route proposal: `/farm/dashboard`, with current `/farm` preserved as the structure directory until migration.

Dashboard question: **What part of the farm needs attention?**

KPI cards:

- Total palms from real asset rows when full registry import exists; until then show only current database counts.
- Palms in watch/sick/dead/removed states.
- Open follow-ups or unresolved events by structure scope.
- Archived or blocked structure nodes.
- Media/documents added recently.

Main tables:

- Palms needing attention, linking to `/farm/palm/[id]`.
- Structure nodes with status roll-up, linking to sector/hawsha/line 360 routes.
- Recent farm events by location.

360 pages:

- Sector 360: identity, hawshat roll-up, palm status distribution, recent events, attachments, timeline.
- Hawsha 360: counts, lines, palm health, operations history, issues/follow-ups, attachments.
- Line 360: palms in the line, operation history, status changes.
- Palm 360: identity, status history, event timeline, media, follow-ups, notes.

### 6.2 التخطيط والعمليات

Default route proposal: `/plans/dashboard`.

Dashboard question: **Can the current plan be executed?**

KPI cards:

- Active plans.
- Operations planned this week.
- Overdue operations.
- Blocked plan checks.
- Plan readiness percentage.
- Done operations in the selected period.

Main tables:

- Operations queue, linking to the plan or field execution route.
- Blocked checks, linking to stock coverage or budget check.
- Active plans, linking to `/plans/[planId]`.

360 pages:

- Plan 360: overview, operations, material requirements, labor requirements, checks, purchasing links,
  planned-vs-actual, timeline.
- Operation 360: planned data, target scope, materials, labor, execution result, attachments, audit timeline.

### 6.3 المخزون والمشتريات

Default route proposal: `/inventory/dashboard`.

Dashboard question: **What stock or purchase decision needs action now?**

KPI cards:

- Items below reorder point.
- Items with projected shortage from `fn_stock_coverage`.
- Reserved quantity / available risk.
- Submitted purchase requests.
- Partial receipts.
- Supplier lead-time exceptions if the data exists.

Main tables:

- Inventory item risk table, linking to item 360 / coverage.
- Purchase request queue, linking to `/purchase-requests/[prId]`.
- Supplier table, linking to supplier 360.

360 pages:

- Item 360: stock position, on-hand/reserved/available, coverage forecast, movements, PRs, suppliers,
  expiry/batches when present, timeline.
- Purchase Request 360: header, lines, approval state, SoD status, receipt progress, budget impact, audit.
- Supplier 360: profile, lead time, linked items, PR/receipt history, reliability metrics when data exists.

This is the best first implementation slice because current routes and data already cover inventory, coverage,
purchase requests, and suppliers.

### 6.4 المالية

Default route proposal: `/finance/dashboard`.

Dashboard question: **Where is the farm over budget or financially unclear?**

KPI cards:

- Budget lines over approved amount.
- Budget utilization.
- Expenses this period.
- Owner drawings separated from operating expenses.
- Pending or uncategorized finance records if the data exists.

Main tables:

- Budget lines, linking to budget detail.
- Expenses, linking to expense 360.
- Plans with budget checks, linking to `/budget/[planId]/check`.

360 pages:

- Budget 360: approved/committed/actual, utilization, related plans, PRs, expenses, timeline.
- Expense 360: kind, category, scope, attachments, approval/audit state.
- Planned-vs-actual 360 remains plan-scoped at `/reports/[planId]/pva` until broader accounting ships.

Constraint: `/accounting`, `sales`, and P&L are not on `main`; do not design current dashboards as if they exist.

### 6.5 الفريق

Default route proposal: `/people/dashboard`.

Dashboard question: **Do we have the right people assigned to the work?**

KPI cards:

- Active people.
- People with system users.
- Missing responsibility assignments, if assignment data exists.
- Operations assigned this week.
- PII-protected compensation card only for roles with `payroll.read`.

Main tables:

- Team directory, linking to person 360.
- Assignment coverage, grouped by scope/person.
- Upcoming assigned operations.

360 pages:

- Person 360: identity, role, assigned scopes, assigned operations, event history, safe contact fields.
- Compensation/payroll tab is hidden unless permitted and should never leak PII through aggregate cards.

### 6.6 الطقس والمخاطر

Default route proposal: `/weather/dashboard`.

Dashboard question: **What weather or operational risk should change today's plan?**

KPI cards:

- Advisory level today.
- Heat/wind/rain risk windows where API data exists.
- Operations affected by advisory gates.
- Missing weather API/config state.

Main tables:

- Upcoming operations with weather-sensitive status.
- Advisory history when persisted later.

360 pages:

- Advisory 360: date, weather inputs, affected operations, recommendation, rule explanation.

Constraint: current weather page is advisory and API-key-dependent. It must not present agronomy prescriptions.

### 6.7 الإعدادات والحساب

Default route proposal: keep `/profile` and `/settings`, grouped under settings.

Dashboard question: **What organization/account setup is incomplete?**

KPI cards:

- Active org selected.
- Members in current org.
- Settings completeness.
- Open setup gates when stored in app state or docs only as static guidance.

360 pages:

- Organization 360: profile, members, settings, audit, billing later under SPEC-0013.
- Member 360: role, active org, permissions, audit.

Constraint: member admin and invites are planned under SPEC-0012 S2 and are not on `main`.

## 7. Technical Design

### 7.1 Module registry

Replace the flat-only nav shape with a typed registry that can still render the current sidebar.

Conceptual shape:

```ts
interface AppModule {
  id: string;
  label: string;
  icon: string;
  dashboardHref: string;
  roles?: Role[];
  pages: AppModulePage[];
}

interface AppModulePage {
  id: string;
  label: string;
  href: string;
  roles?: Role[];
  hiddenFromSidebar?: boolean;
}
```

`APP_NAV` can be derived from `APP_MODULES` during migration so existing `AppChrome`, `page-help`, and drift tests
can be upgraded safely.

### 7.2 Sidebar behavior

Desktop:

- Modules render as expandable groups.
- The active route opens its module automatically.
- Each module's first item is its dashboard.
- Keep the topbar org switcher, help drawer, role tag, and sign-out controls.

Mobile:

- Sidebar remains a drawer.
- Groups should be simple disclosure buttons with large touch targets.
- The active sub-page stays visible after navigation.

### 7.3 Dashboard building blocks

Create reusable app-side primitives before repeating dashboard code:

- `ModuleDashboardShell`
- `DashboardKpiFilterGrid`
- `DashboardFilterCard`
- `DashboardMainTable`
- `Entity360Shell`
- `Entity360Tabs`
- `EntityTimeline`

Use existing components where possible:

- `KpiCard`
- `Card`
- `SimpleTable`
- `FilterableTable`
- `StatusPill`
- `Tag`
- `Progress`
- chart wrappers only on chart routes

### 7.4 URL and filtering behavior

KPI card filters should be URL-addressable:

```text
/inventory/dashboard?filter=shortage
/plans/dashboard?filter=blocked
/farm/dashboard?filter=palms-watch
```

This preserves browser back/forward behavior and makes shared links meaningful.

The implementation uses query parameters, not client-only state, for the dashboard filter contract. The reusable
`DashboardKpiLink` and `CurrentFilterCard` components keep the interaction consistent across module dashboards.

### 7.5 360 shell

All entity 360 pages should share a structure:

| Tab | Purpose |
|---|---|
| Overview | Identity, status, core KPIs, next action |
| Activity | Events, operations, movement, or usage history |
| Related | Linked records such as PRs, plans, people, structure nodes |
| Health/Risk | Domain-specific checks, coverage, budget, weather, or status |
| Workflow | Approvals, execution, follow-up, or case state |
| Timeline | Chronological audit/activity feed |

Not every entity needs every tab on day one. Empty tabs should not render unless they have real data or a clear
empty state.

### 7.6 Help and active-route coverage

Every dashboard, list, workflow detail, and 360 route must resolve to useful Arabic Help Drawer content. Dynamic
routes should get route-specific help instead of inheriting a generic parent-page entry when the entity or workflow
has distinct rules, risks, or next actions.

Every dynamic app route should also resolve to an active nav item so the sidebar keeps module context on 360 and
workflow pages. Routes that intentionally live outside the normal nav prefix should use explicit active-route
aliases rather than being left unhighlighted.

These requirements are enforced by filesystem-backed Vitest drift guards:

- `apps/farm-os/lib/page-help.test.ts` samples dynamic `app/(app)` pages and fails if they fall back to generic
  dashboard help.
- `apps/farm-os/lib/nav.test.ts` samples dynamic `app/(app)` pages and fails if no active nav item is resolved.

## 8. First Implementation Slice

Recommended first slice: **Inventory/Purchasing module**.

Implementation note: the first slice selected for build is Inventory/Purchasing. It is intentionally read-only and
does not add migrations, RPCs, prod changes, accounting, academy, AI, or real registry import.

Second-slice note: Item 360 is the next read-only slice. `/inventory/[itemId]` becomes the canonical overview route;
the existing coverage route remains the Health/Risk deep dive.

Third-slice note: Farm Dashboard is the next read-only module dashboard. `/farm/dashboard` becomes the Farm module
entry point, while `/farm` remains the structure directory. Dashboard rows link into existing sector, hawsha, and
palm 360 pages.

Fourth-slice note: Planning/Operations Dashboard is the next read-only module dashboard. `/plans/dashboard` becomes
the Planning module entry point, while `/plans` remains the plan directory. Dashboard rows link into existing plan
360 pages and the field execution surface.

Fifth-slice note: Finance Dashboard is the next read-only module dashboard. `/finance/dashboard` becomes the Finance
module entry point, while `/budgets` and `/expenses` remain finance sub-pages. The slice intentionally excludes the
draft accounting/P&L work that is not on `main`.

Sixth-slice note: People Dashboard + Person 360 is the next read-only module slice. `/people/dashboard` becomes the
People module entry point, while `/people` remains the team directory and `/people/[personId]` becomes the canonical
non-PII person 360 page.

Seventh-slice note: Weather/Risk Dashboard is the next read-only module dashboard. `/weather/dashboard` becomes the
Weather/Risk module entry point, while `/weather` remains the detailed forecast and advisory page.

Eighth-slice note: Settings/Admin Dashboard is the next read-only module dashboard. `/settings/dashboard` becomes
the Settings/Admin module entry point, while `/profile` and `/settings` remain sub-pages.

Supplier 360 follow-up note: `/suppliers/[supplierId]` becomes the canonical supplier file. Supplier list rows now
open the 360 page, which connects preferred inventory items, PR lines, expenses, and inventory movements.

Budget 360 follow-up note: `/budgets/[budgetId]` becomes the canonical budget file. Budget list rows now open the
360 page, which connects budget totals, budget lines, same-category expenses, and linked purchase requests.

Expense 360 follow-up note: `/expenses/[expenseId]` becomes the canonical expense file. Expense list rows now open
the 360 page, which connects supplier, plan, structure scope, event, amount, quantity, payment method, and status.

Purchase Request 360 polish note: `/purchase-requests/[prId]` now follows the same 360 convention with KPI cards
for line count, estimated cost, received quantity when line units match, and remaining quantity/open lines. PR line
rows link to Item 360.

Plan 360 polish note: `/plans/[planId]` now follows the same 360 convention with KPI cards for operation count,
estimated cost, checks run, and blocked checks. Quick-action links no longer use nested `Link > Button` markup.

Why:

- Existing data and routes are already on `main`: `/inventory`, `/inventory/[itemId]/coverage`,
  `/purchase-requests`, `/purchase-requests/[prId]`, `/suppliers`.
- It exercises the full pattern: dashboard KPIs, item risk table, purchase queue, item 360, PR 360, supplier 360.
- It is close to Farm OS's core wedge: stock coverage and purchase action.
- It avoids speculative finance/accounting features not yet on `main`.

Slice scope:

1. Add module registry and grouped sidebar rendering.
2. Add `/inventory/dashboard`.
3. Add dashboard KPI filters: shortages, low stock/reorder, submitted PRs, partial receipts.
4. Convert inventory and PR lists to `FilterableTable` if they are not already using it.
5. Add item 360 shell or extend coverage route as the first item detail.
6. Update `page-help` and tests for the new module dashboard.

Out of scope for the first slice:

- New migrations.
- New inventory math.
- Applying migrations to prod.
- Accounting/P&L.
- Academy/agronomy content.
- AI features.
- Real registry import.

## 9. Risks and Controls

| Risk | Control |
|---|---|
| Sidebar gets too complex on mobile | Use simple disclosure groups and verify mobile navigation manually |
| Dashboard cards become fake BI | Query-derived cards only; absent if data is not available |
| Recharts leaks into global bundle | Only chart pages import chart wrappers; preserve existing code-split checks |
| Help/nav drift | Enforce route-specific Help Drawer coverage and active-nav coverage with filesystem-backed Vitest guards |
| 360 pages duplicate existing detail routes | Canonical route per entity; old detail routes either become the 360 or redirect later |
| Scope creep into migrations | First slice is app/navigation/read-only unless a separate approved plan says otherwise |

## 10. Validation Plan

For the first implementation plan, expected checks:

- `npx tsc --noEmit` from `apps/farm-os`
- `npx eslint <touched files>` from `apps/farm-os`
- `npx vitest run` from `apps/farm-os`
- `npm run build` from `apps/farm-os`
- Manual browser check for desktop and mobile sidebar behavior
- If any DB/migration work is later introduced: `bash apps/farm-os/supabase/test-shims/run-pgtap-local.sh`

Current automated guards for this workstream:

- `lib/nav.test.ts`: module/page uniqueness, route-file existence, dashboard-first ordering, active-route matching,
  active-route aliases, and dynamic route active-nav coverage.
- `lib/page-help.test.ts`: nav help completeness and dynamic route-specific help coverage.

## 11. Open Decisions

1. Confirm first slice: Inventory/Purchasing module.
2. Confirm whether `لوحة التحكم` remains a global role-router or becomes an executive cross-module dashboard later.
3. Confirm whether 360 URLs should use existing routes where possible or introduce explicit `/[module]/[entity]/[id]`
   aliases over time.
4. Confirm whether dashboards should use a global period/scope picker in the first slice or defer it until multiple
   plans/seasons are generalized.

## 12. Recommendation

Proceed with the registry-first approach:

1. Design and implement the grouped module navigator without renaming existing routes.
2. Build Inventory/Purchasing as the proof module.
3. Reuse the Admin panel's best pattern: KPI cards as filters, table as work surface, row to canonical 360.
4. Roll the same pattern module-by-module after validation.
