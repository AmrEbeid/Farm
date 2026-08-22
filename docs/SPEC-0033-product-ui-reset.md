# SPEC-0033 — Product-wide UI reset

*Status: execution plan. Created 2026-08-22 from the Owner's request to rebuild Farm OS navigation,
dashboards and 360 pages after the Marketing release. Builds on SPEC-0025 and SPEC-0030; it does not replace
their task-first product decisions.*

## 1. Outcome

Farm OS must feel like one calm Arabic operating tool, not a collection of modules. A user should always know:

1. what needs attention now;
2. what changed and why it matters;
3. the one next action they can take;
4. where the supporting record lives.

The reset preserves route URLs, role gates, RLS/RPC contracts, financial definitions, Marketing provenance,
real-data-only behavior and the existing Readex Pro/Tajawal identity. This is an Operate interface: speed,
scanability and correct action outrank decoration.

## 2. Verified baseline

Current main at the start of this program is `59df05d`.

- 101 authenticated application pages, 22 dynamic detail/action pages and 10 dashboard routes.
- 17/22 dynamic pages use `Entity360Header`; 11 use URL-driven `EntityTabs`.
- Owner navigation exposes 14 groups / 66 pages. Accountant exposes 14 / 57. Farm manager exposes 11 / 35.
- Desktop uses an empty design-system sidebar plus a second fixed `ModuleSidebar` rendered inside
  `<main>`; app CSS hides the first and positions the second. Mobile has a separate hard-coded tab model.
- The fixed mobile tab bar has no matching content inset, so the final approximately 56px of a phone page can
  sit behind it. Breadcrumbs use unfiltered modules and appear even on depth-1 routes.
- Page headings are implemented route-by-route (`text-xl`, `text-2xl`, custom margins), so hierarchy and
  vertical rhythm drift.
- Ten dashboards repeat large KPI grids. StoryLine/drill-down patterns exist, but coverage and next-action
  behavior are inconsistent.
- No open pull request existed when the program started.

## 3. Users and home stories

### Owner

Lead with decisions and exceptions, then money and operating health. Never make the Owner inspect every module.
The home answers: what needs my decision, what changed, where is risk, and what should happen next.

### Accountant

Lead with unposted/unpriced/unreconciled work, custody and receivables, then period truth. Every amount drills
to the ledger, source record and evidence. Owner drawings remain separate from operating expense.

### Farm manager

Lead with today's work, blockers, stock constraints, overdue operations and team assignment. Do not foreground
absolute finance values that the role does not need to act.

### Agronomist

Lead with checks/sign-offs, crop risks and field follow-up. Agronomy remains an editable template pending named
sign-off and current Egyptian registration, never a prescription.

### Supervisor

Lead with assigned work and fast recording. Phone-first, plain Arabic, large controls and no accounting terms.

### Storekeeper

Lead with receive, issue, stock-take and shortage work. No mobile route may bounce to a role-forbidden page.

## 4. Target information architecture

Desktop and mobile derive from one role-gated navigation model.

### Primary spine

At most five direct destinations:

- **الرئيسية** — role home;
- **سجّل** — action launcher;
- **راجع** — only for roles with a legal review/approval action;
- **المعاملات** for finance roles or **الميدان / المخزون** for field/store roles;
- **التقارير** — canonical answer and insight hub.

### Workspaces

All other routes remain available as secondary workspaces, collapsed by default except the active one:

- المزرعة;
- العمليات;
- المخزون والمشتريات;
- المال;
- الفريق;
- التسويق;
- الطقس;
- الإعدادات.

Search/command palette remains the expert fast path. Deep links and bookmarks do not change. Duplicate
dashboard/report/insight launchers are removed from navigation only after their canonical destination is clear.

## 5. Shared page anatomy

Every standard page uses the same compact structure:

1. breadcrumb on deep routes only;
2. compact page header: identity, state and one primary action;
3. one live-data situation sentence;
4. exceptions / next actions;
5. decision-useful summary or comparison;
6. detail table, timeline or form;
7. related records and next suggested destination.

Headers do not exceed two text lines on mobile. Header actions collapse into a menu when they cannot fit.
Unknown values remain `—` / «غير معروف» and never become zero.

## 6. Dashboard contract

Dashboards tell one story in this order:

1. **يحتاج انتباهك** — actionable exceptions, ordered by urgency;
2. **ما تغيّر** — comparison against a valid prior period or target;
3. **الحالة الآن** — no more than four primary measures;
4. **لماذا** — the drivers behind the change;
5. **التفاصيل** — ranked table and drill-down links.

No chart exists merely to decorate a KPI. Use:

- a line only for four or more real time points;
- a target/progress view only where an approved target exists;
- bars for ranked comparison;
- a table when precise comparison matters more than shape.

Every chart has an Arabic takeaway, visible values, an accessible data alternative and a route to the underlying
records. Empty, loading, permission and partial-data states are first-class.

## 7. List and 360 contract

### Lists

- saved role-relevant default view;
- search, bounded filters and exact count;
- row-level status and next action;
- mobile reflow with no horizontal page overflow;
- row opens the 360 page without losing filter context.

### 360 pages

- compact shared identity header;
- semantic status, ownership and freshness;
- overview, activity, related work, documents and finance tabs only when the entity supports them;
- one legal next action inline;
- timeline and source/evidence links;
- sticky mobile action bar for frequent field actions;
- related 360 pages preserve context through URLs.

The five dynamic pages missing the shared header are migrated. Existing tabbed pages retain server-rendered
panels and the server-safe tab ID helpers.

## 8. Design-system direction

- Preserve the calm light visual identity, current Arabic fonts and role/status tokens.
- Replace emoji navigation controls with Lucide icons and accessible labels.
- Use compact 8px-or-less cards only for repeated records or framed tools; do not nest cards.
- Use whitespace and type weight for hierarchy rather than oversized headings.
- Keep controls at least 44px for phone field use; desk density may be tighter without reducing hit targets.
- Use semantic green, amber, red and blue as status accents, not a one-hue page theme.
- Motion is subtle and functional, respects reduced motion, and never hides server-rendered content.

## 9. Performance and accessibility budgets

- Route change must show immediate pending feedback; no silent multi-second wait.
- Keep the shell/navigation bundle free of chart code.
- Dashboard data access is part of this reset, not an assumed healthy baseline. Eight dashboard routes still
  aggregate unbounded table reads in application code. Owner home reads all live palm statuses; inventory home
  reads all items, purchase requests and suppliers. R3 must replace unbounded landing-page reads with bounded
  or exact aggregate contracts before performance can be accepted.
- Lighthouse authenticated target: performance >= 80, accessibility >= 95, best practices >= 95.
- Core Web Vitals target: LCP <= 2.5s, CLS <= 0.1, INP <= 200ms on a representative production-like run.
- Keyboard, focus visibility, landmarks, headings, reduced motion, Arabic bidi and 200% zoom must pass.
- Validate 390px, 768px, 1024px and 1440px; no horizontal document overflow. The current repository has no
  authenticated Lighthouse/axe/mobile Playwright harness: R0/R1 use focused automated tests plus authenticated
  Owner-run browser evidence; a dedicated QA-harness slice must make these budgets repeatable before R5.

## 10. Release sequence

### R0 — Mobile clearance and breadcrumb compactness

Reserve bottom-tab space including the safe area. Make breadcrumbs pure, role-aware and visible only on deep
routes. App-only, no design-system or route/data change.

### R1a — Design-system shell

Add one real sidebar slot, repair overlay/sidebar stacking, use a Lucide menu icon and compact the topbar.
Packages/UI only, with rebuilt tracked distribution.

### R1b — App shell adoption

Move the app navigation into the real sidebar slot, remove the fixed-sidebar workaround, derive desktop/mobile
primary navigation from one model, and add shared compact page/360 headers. No route, query, role or data change.

### R2 — Navigation consolidation

Reduce the role spine to at most five destinations, split the 16-item finance list, fold the 9-item insights arc
under its canonical hub, and remove duplicate launchers while preserving deep routes.

### R3 — Role homes

Owner and accountant first, then manager/agronomist/supervisor/storekeeper. Apply the attention/change/state/
driver/detail story. Replace unbounded dashboard reads in the same release that owns each page. Use only
existing, verified data.

### R4 — Lists, workspaces and 360 pages

Start with the five dynamic pages missing the shared 360 header and the six raw-table pages, then migrate
Finance, Marketing, Farm, Operations, Inventory and People by workspace. Marketing exact-source drafts remain
separate from operational records.

### R5 — Product-wide closure

No-dead-end audit, loading/error/empty coverage, mobile/RTL/keyboard/axe/Lighthouse checks, authenticated role
acceptance, documentation and production verification.

Each release is independently reviewed, committed, pushed, merged and deployed. A release with a migration
follows migrate-first; UI-only releases must not create migrations.

## 11. R0 write scope and gates

Exact R0 write scope:

- `apps/farm-os/app/globals.css`;
- `apps/farm-os/components/AppChrome.tsx`;
- `apps/farm-os/components/MobileTabBar.tsx`;
- `apps/farm-os/components/AutoBreadcrumbs.tsx`;
- `apps/farm-os/lib/breadcrumbs.ts` and focused tests;
- `docs/SPEC-0033-product-ui-reset.md` for the approved program contract and release gates.

Required gates: focused breadcrumb tests; app TypeScript; touched ESLint; full Vitest; Farm production build;
Recharts, client-boundary and service-role guards; `git diff --check`; empty `packages/ui` diff. Authenticated
Owner-run evidence at 390px confirms final content clears the bottom bar, depth-1 pages have no breadcrumb, and
deep 360 routes retain valid role-visible trails.

## 12. Completion

Before R2, the six role journeys in §3 must be expanded into explicit 5–8-step acceptance scripts with allowed
and denied outcomes; otherwise completion is not falsifiable.

The reset is 100% only when all six roles pass the agreed role journey on desktop and mobile, every authenticated
route has the shared shell and a coherent page anatomy, all 22 dynamic pages satisfy the 360 contract, dashboard
drill-downs reach real records, accessibility/performance budgets pass, and the exact production deployment is
verified. A polished shell alone is not completion.
