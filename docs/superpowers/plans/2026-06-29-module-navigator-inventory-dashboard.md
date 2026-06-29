# Module Navigator + Inventory Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first safe slice of the Farm OS module navigator: a typed module registry, grouped app-side sidebar, and a read-only Inventory/Purchasing dashboard that proves the KPI-card-to-table-to-360 pattern.

**Architecture:** Keep `@amrebeid/ui` unchanged in this slice. Add app-side navigation primitives around the existing `AppShell` sidebar area, derive flat `APP_NAV` compatibility from a new `APP_MODULES` registry, and add `/inventory/dashboard` as a server-rendered page using existing RLS-scoped reads. Dashboard KPI cards link to URL filters; the table links to existing coverage and PR 360/detail routes.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Supabase RLS reads, `@amrebeid/ui`, Vitest.

## Global Constraints

- Farm OS rules: Arabic RTL first; no fabricated farm/financial data; all KPIs must be query-derived or omitted.
- Security: no migrations, no RPC changes, no direct client DML, no prod data mutation, no service-role usage.
- Scope: first slice only covers module registry, grouped sidebar rendering, `/inventory/dashboard`, page help/tests/docs.
- Route stability: do not rename existing routes; new route is additive.
- UI package boundary: do not modify `packages/ui` in this slice.
- Chart boundary: do not import Recharts or chart wrappers on the new dashboard.
- Validation: run `npx tsc --noEmit`, targeted Vitest for touched tests, and `npm run build` from `apps/farm-os` if local deps permit.
- Documentation: update living docs last after implementation and validation.
- Owner gates: do not merge, migrate, deploy, or apply database changes.

---

## File Structure

- Modify `apps/farm-os/lib/nav.ts`: introduce `APP_MODULES`, helper functions, and derive existing `APP_NAV` compatibility list.
- Modify `apps/farm-os/lib/nav.test.ts`: cover module/page id uniqueness, safe hrefs, role validity, flat compatibility, and active matching.
- Create `apps/farm-os/components/ModuleSidebar.tsx`: app-side grouped sidebar rendered inside the existing shell sidebar via CSS override.
- Modify `apps/farm-os/components/AppChrome.tsx`: use `APP_MODULES`, `findActiveNavItem`, and `ModuleSidebar`; keep `HelpDrawer` keyed by active page.
- Create `apps/farm-os/app/(app)/inventory/dashboard/page.tsx`: read-only dashboard for inventory/purchasing.
- Modify `apps/farm-os/lib/page-help.ts`: add help entry for `inventory-dashboard`.
- Modify `apps/farm-os/lib/page-help.test.ts`: validate help completeness against `APP_NAV`.
- Update `docs/superpowers/specs/2026-06-29-module-navigator-dashboards-360-design.md`: mark first slice selected and note implementation plan.
- Update `docs/PROJECT-TRACKER.md` and `docs/SESSION-BRIEF.md` last after code validation.

---

### Task 1: Module Registry

**Files:**
- Modify: `apps/farm-os/lib/nav.ts`
- Modify: `apps/farm-os/lib/nav.test.ts`

**Interfaces:**
- Produces: `APP_MODULES: AppModule[]`
- Produces: `APP_NAV: AppNavItem[]`
- Produces: `visibleModulesForRole(role: Role): AppModule[]`
- Produces: `findActiveNavItem(pathname: string): AppNavItem | null`
- Consumes: `Role` from `@/lib/auth`

- [ ] **Step 1: Replace `apps/farm-os/lib/nav.ts` with module-aware registry**

```ts
import type { Role } from "@/lib/auth";

export interface AppNavItem {
  id: string;
  label: string;
  icon: string;
  href: string;
  roles?: Role[];
}

export interface AppModule {
  id: string;
  label: string;
  icon: string;
  dashboardHref: string;
  roles?: Role[];
  pages: AppNavItem[];
}

const ALL_ROLES: Role[] = [
  "owner",
  "farm_manager",
  "agri_engineer",
  "accountant",
  "supervisor",
  "storekeeper",
];

function visibleToRole(item: { roles?: Role[] }, role: Role): boolean {
  return !item.roles || item.roles.includes(role);
}

export const APP_MODULES: AppModule[] = [
  {
    id: "home",
    label: "لوحة التحكم",
    icon: "🏠",
    dashboardHref: "/dashboard",
    pages: [{ id: "dashboard", label: "لوحة التحكم", icon: "🏠", href: "/dashboard" }],
  },
  {
    id: "farm-module",
    label: "المزرعة",
    icon: "🌴",
    dashboardHref: "/farm",
    pages: [
      { id: "farm", label: "لوحة المزرعة", icon: "🌴", href: "/farm" },
      { id: "farm-croquis", label: "الكروكي", icon: "🗺️", href: "/farm/croquis" },
    ],
  },
  {
    id: "planning-module",
    label: "التخطيط والعمليات",
    icon: "🗓️",
    dashboardHref: "/plans",
    pages: [
      { id: "plans", label: "لوحة التخطيط", icon: "🗓️", href: "/plans" },
      { id: "mobile", label: "الميدان", icon: "📱", href: "/m", roles: ["supervisor", "agri_engineer", "owner", "farm_manager"] },
    ],
  },
  {
    id: "inventory-module",
    label: "المخزون والمشتريات",
    icon: "📦",
    dashboardHref: "/inventory/dashboard",
    pages: [
      { id: "inventory-dashboard", label: "لوحة المخزون والمشتريات", icon: "📦", href: "/inventory/dashboard" },
      { id: "inventory", label: "الأصناف", icon: "📦", href: "/inventory" },
      { id: "purchase", label: "طلبات الشراء", icon: "🧾", href: "/purchase-requests" },
      { id: "suppliers", label: "الموردون", icon: "🏷️", href: "/suppliers" },
    ],
  },
  {
    id: "finance-module",
    label: "المالية",
    icon: "📊",
    dashboardHref: "/budgets",
    roles: ["owner", "accountant", "farm_manager"],
    pages: [
      { id: "budgets", label: "الموازنات", icon: "📊", href: "/budgets", roles: ["owner", "accountant", "farm_manager"] },
      { id: "expenses", label: "المصروفات", icon: "💸", href: "/expenses", roles: ["owner", "accountant", "farm_manager"] },
    ],
  },
  {
    id: "people-module",
    label: "الفريق",
    icon: "👥",
    dashboardHref: "/people",
    roles: ["owner", "farm_manager", "agri_engineer", "accountant"],
    pages: [
      { id: "people", label: "الأشخاص", icon: "👥", href: "/people", roles: ["owner", "farm_manager", "agri_engineer", "accountant"] },
    ],
  },
  {
    id: "weather-module",
    label: "الطقس والمخاطر",
    icon: "🌤️",
    dashboardHref: "/weather",
    pages: [{ id: "weather", label: "الطقس", icon: "🌤️", href: "/weather" }],
  },
  {
    id: "settings-module",
    label: "الإعدادات",
    icon: "⚙️",
    dashboardHref: "/profile",
    pages: [
      { id: "profile", label: "الملف الشخصي", icon: "👤", href: "/profile" },
      { id: "settings", label: "إعدادات المؤسسة", icon: "⚙️", href: "/settings", roles: ["owner"] },
    ],
  },
];

export const APP_NAV: AppNavItem[] = APP_MODULES.flatMap((m) => m.pages);

export function visibleModulesForRole(role: Role): AppModule[] {
  return APP_MODULES.flatMap((module) => {
    if (!visibleToRole(module, role)) return [];
    const pages = module.pages.filter((page) => visibleToRole(page, role));
    return pages.length > 0 ? [{ ...module, pages }] : [];
  });
}

export function findActiveNavItem(pathname: string): AppNavItem | null {
  const sorted = [...APP_NAV].sort((a, b) => b.href.length - a.href.length);
  return sorted.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)) ?? null;
}

export function isKnownRole(role: string): role is Role {
  return ALL_ROLES.includes(role as Role);
}

export const SEED_PLAN_ID = "5d5d302e-c385-5d0b-94f5-3dc2c9948e79";
export const POTASSIUM_ID = "39e22867-fbe2-5cd9-8a76-ce5871a8e8f4";
```

- [ ] **Step 2: Replace `apps/farm-os/lib/nav.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  APP_MODULES,
  APP_NAV,
  findActiveNavItem,
  isKnownRole,
  visibleModulesForRole,
} from "./nav";

const ROLES = ["owner", "farm_manager", "agri_engineer", "accountant", "supervisor", "storekeeper"];

describe("APP_MODULES", () => {
  it("has unique module ids, page ids, and non-empty labels", () => {
    const moduleIds = APP_MODULES.map((m) => m.id);
    expect(new Set(moduleIds).size).toBe(moduleIds.length);
    const pageIds = APP_NAV.map((i) => i.id);
    expect(new Set(pageIds).size).toBe(pageIds.length);
    for (const module of APP_MODULES) {
      expect(module.label.trim().length).toBeGreaterThan(0);
      expect(module.pages.length).toBeGreaterThan(0);
      for (const item of module.pages) expect(item.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("every href is a safe relative path", () => {
    for (const item of APP_NAV) {
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.href).not.toMatch(/^[a-z]+:/i);
    }
  });

  it("role-gated modules and pages list only known roles", () => {
    for (const module of APP_MODULES) {
      for (const r of module.roles ?? []) expect(ROLES).toContain(r);
      for (const item of module.pages) {
        for (const r of item.roles ?? []) expect(ROLES).toContain(r);
      }
    }
    for (const r of ROLES) expect(isKnownRole(r)).toBe(true);
    expect(isKnownRole("unknown")).toBe(false);
  });

  it("filters modules and pages by role", () => {
    const supervisor = visibleModulesForRole("supervisor");
    expect(supervisor.flatMap((m) => m.pages).map((p) => p.id)).toContain("mobile");
    expect(supervisor.flatMap((m) => m.pages).map((p) => p.id)).not.toContain("settings");
    expect(supervisor.map((m) => m.id)).not.toContain("finance-module");

    const owner = visibleModulesForRole("owner");
    expect(owner.flatMap((m) => m.pages).map((p) => p.id)).toContain("settings");
    expect(owner.map((m) => m.id)).toContain("finance-module");
  });

  it("keeps APP_NAV as a flat compatibility projection", () => {
    expect(APP_NAV.map((i) => i.id)).toEqual(APP_MODULES.flatMap((m) => m.pages.map((p) => p.id)));
  });

  it("finds the most specific active nav item", () => {
    expect(findActiveNavItem("/inventory/dashboard")?.id).toBe("inventory-dashboard");
    expect(findActiveNavItem("/inventory/abc/coverage")?.id).toBe("inventory");
    expect(findActiveNavItem("/farm/croquis")?.id).toBe("farm-croquis");
    expect(findActiveNavItem("/farm/palm/123")?.id).toBe("farm");
    expect(findActiveNavItem("/nope")).toBeNull();
  });
});
```

- [ ] **Step 3: Run targeted test**

Run: `cd apps/farm-os && npx vitest run lib/nav.test.ts`

Expected: PASS.

- [ ] **Step 4: Re-read diff**

Run: `git diff -- apps/farm-os/lib/nav.ts apps/farm-os/lib/nav.test.ts`

Expected: only module registry and tests changed.

---

### Task 2: Grouped App Sidebar

**Files:**
- Create: `apps/farm-os/components/ModuleSidebar.tsx`
- Modify: `apps/farm-os/components/AppChrome.tsx`

**Interfaces:**
- Consumes: `AppModule`, `findActiveNavItem`, `visibleModulesForRole` from `@/lib/nav`
- Produces: `<ModuleSidebar modules activeNavId onNavigate />`

- [ ] **Step 1: Create `apps/farm-os/components/ModuleSidebar.tsx`**

```tsx
"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import type { AppModule } from "@/lib/nav";

export function ModuleSidebar({
  modules,
  activeNavId,
  onNavigate,
}: {
  modules: AppModule[];
  activeNavId: string;
  onNavigate: () => void;
}) {
  const initialOpen = useMemo(
    () => new Set(modules.filter((m) => m.pages.some((p) => p.id === activeNavId)).map((m) => m.id)),
    [modules, activeNavId],
  );
  const [open, setOpen] = useState<Set<string>>(initialOpen);

  function toggle(moduleId: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }

  return (
    <nav className="fos-sidebarnav farm-module-nav" aria-label="التنقل الرئيسي">
      <ul className="fos-sidebarnav__list">
        {modules.map((module) => {
          const moduleOpen = open.has(module.id) || module.pages.some((p) => p.id === activeNavId);
          return (
            <li key={module.id} className="farm-module-nav__module">
              <button
                type="button"
                className="farm-module-nav__toggle"
                aria-expanded={moduleOpen}
                onClick={() => toggle(module.id)}
              >
                <span className="fos-navitem__icon" aria-hidden="true">{module.icon}</span>
                <span className="farm-module-nav__label">{module.label}</span>
                <span className="farm-module-nav__chevron" aria-hidden="true">{moduleOpen ? "▾" : "◂"}</span>
              </button>
              {moduleOpen && (
                <ul className="farm-module-nav__pages">
                  {module.pages.map((page) => {
                    const active = page.id === activeNavId;
                    return (
                      <li key={page.id}>
                        <Link
                          href={page.href}
                          className={`fos-navitem farm-module-nav__page${active ? " fos-navitem--active" : ""}`}
                          aria-current={active ? "page" : undefined}
                          onClick={onNavigate}
                        >
                          <span className="fos-navitem__icon" aria-hidden="true">{page.icon}</span>
                          <span className="fos-navitem__label">{page.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 2: Modify `apps/farm-os/components/AppChrome.tsx`**

Replace the imports and nav calculation with:

```tsx
import { AppShell, Tag, Button } from "@/components/ui";
import { ModuleSidebar } from "@/components/ModuleSidebar";
import { findActiveNavItem, visibleModulesForRole } from "@/lib/nav";
```

Replace `navItems` and `activeNavId` with:

```tsx
  const modules = visibleModulesForRole(role as never);
  const activeNavId = findActiveNavItem(pathname)?.id ?? "dashboard";
```

Pass an empty flat nav to `AppShell` and render the module sidebar at the top of `children` using an app-side CSS
position override:

```tsx
      <AppShell
        navItems={[]}
        activeNavId={activeNavId}
        navAriaLabel="التنقل الرئيسي"
        menuButtonLabel="فتح القائمة"
        sidebarOpen={sidebarOpen}
        onSidebarOpenChange={setSidebarOpen}
        brand={<span className="font-bold">نظام تشغيل المزارع</span>}
        topbar={/* existing topbar unchanged */}
      >
        <ModuleSidebar
          modules={modules}
          activeNavId={activeNavId}
          onNavigate={() => setSidebarOpen(false)}
        />
        <div id="main" tabIndex={-1}>
          {children}
        </div>
      </AppShell>
```

Remove the old `onNavSelect` block because navigation now happens through `Link`.

- [ ] **Step 3: Add CSS in `apps/farm-os/app/globals.css`**

Append:

```css
/* App-side grouped module navigation. This keeps @amrebeid/ui unchanged while
   replacing the empty default SidebarNav rendered by AppShell in this slice. */
.fos-appshell__sidebar > .fos-sidebarnav {
  display: none;
}

.fos-appshell__main > .farm-module-nav {
  grid-area: unset;
  position: fixed;
  inset-block-start: var(--topbar-h);
  inset-block-end: 0;
  inset-inline-start: 0;
  inline-size: var(--sidebar-w);
  padding: var(--space-3);
  overflow: auto;
  background: var(--surface-raised);
  border-inline-end: 1px solid var(--line);
  z-index: calc(var(--z-sticky) + 1);
}

[dir="rtl"] .fos-appshell__main > .farm-module-nav {
  inset-inline-start: auto;
  inset-inline-end: 0;
  border-inline-end: 0;
  border-inline-start: 1px solid var(--line);
}

.farm-module-nav__module {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.farm-module-nav__toggle {
  width: 100%;
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 9px var(--space-3);
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-weight: var(--weight-bold);
  cursor: pointer;
  text-align: start;
}

.farm-module-nav__toggle:hover {
  background: var(--surface-sunken);
}

.farm-module-nav__toggle:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.farm-module-nav__label {
  flex: 1 1 auto;
}

.farm-module-nav__chevron {
  color: var(--ink-muted);
}

.farm-module-nav__pages {
  list-style: none;
  margin: 0;
  padding: 0 0 0 var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

[dir="rtl"] .farm-module-nav__pages {
  padding: 0 var(--space-3) 0 0;
}

.farm-module-nav__page {
  min-height: 36px;
  font-size: var(--text-sm);
}

@media (max-width: 799px) {
  .fos-appshell__main > .farm-module-nav {
    display: none;
  }

  .fos-appshell--drawer-open .fos-appshell__main > .farm-module-nav {
    display: block;
    inline-size: min(80vw, 300px);
    z-index: calc(var(--z-drawer) + 1);
  }
}
```

- [ ] **Step 4: Run typecheck**

Run: `cd apps/farm-os && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Re-read diff**

Run: `git diff -- apps/farm-os/components/AppChrome.tsx apps/farm-os/components/ModuleSidebar.tsx apps/farm-os/app/globals.css`

Expected: app-side grouped sidebar only; no package UI changes.

---

### Task 3: Inventory/Purchasing Dashboard

**Files:**
- Create: `apps/farm-os/app/(app)/inventory/dashboard/page.tsx`

**Interfaces:**
- Consumes: `requireMembership`, `createClient`, `KpiCard`, `Card`, `FilterableTable`, `num`, `fmtDate`
- Produces: route `/inventory/dashboard`

- [ ] **Step 1: Create `apps/farm-os/app/(app)/inventory/dashboard/page.tsx`**

```tsx
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Card, KpiCard, Button } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";

const PR_STATUS_AR: Record<string, string> = {
  draft: "مسودة",
  submitted: "مرسل",
  approved: "معتمد",
  rejected: "مرفوض",
  received: "مُستلم",
  partially_received: "مُستلم جزئيًا",
};

export default async function InventoryDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  await requireMembership();
  const { filter = "all" } = await searchParams;
  const sb = await createClient();

  const [
    { data: items, error: itemsError },
    { data: prs, error: prsError },
    { data: suppliers, error: suppliersError },
  ] = await Promise.all([
    sb
      .from("inventory_items")
      .select("id, name, category, unit, min_stock, reorder_point, inventory_bin(on_hand, reserved)")
      .order("name"),
    sb
      .from("purchase_requests")
      .select("id, code, status, reason, needed_by")
      .order("code", { ascending: false }),
    sb
      .from("suppliers")
      .select("id, name, lead_time_days")
      .order("name"),
  ]);
  if (itemsError) throw itemsError;
  if (prsError) throw prsError;
  if (suppliersError) throw suppliersError;

  const itemRows = (items ?? []).map((it) => {
    const bin = (Array.isArray(it.inventory_bin) ? it.inventory_bin[0] : it.inventory_bin) as
      | { on_hand?: number; reserved?: number }
      | null;
    const onHand = Number(bin?.on_hand ?? 0);
    const reserved = Number(bin?.reserved ?? 0);
    const available = onHand - reserved;
    const threshold = Number(it.reorder_point ?? it.min_stock ?? 0);
    const needsReorder = threshold > 0 && available < threshold;
    return {
      id: it.id,
      href: `/inventory/${it.id}/coverage`,
      kind: "item",
      name: it.name,
      category: it.category ?? "—",
      status: needsReorder ? "إعادة الطلب" : "جيد",
      metric: `${num(available)} ${it.unit ?? ""}`.trim(),
      date: "—",
      filterKey: needsReorder ? "reorder" : "all",
      sortWeight: needsReorder ? 0 : 3,
    };
  });

  const prRows = (prs ?? []).map((pr) => {
    const active = pr.status === "submitted" || pr.status === "approved" || pr.status === "partially_received";
    return {
      id: pr.id,
      href: `/purchase-requests/${pr.id}`,
      kind: "pr",
      name: pr.code,
      category: pr.reason ?? "—",
      status: PR_STATUS_AR[pr.status] ?? pr.status,
      metric: pr.status === "partially_received" ? "استلام جزئي" : "طلب شراء",
      date: pr.needed_by ? fmtDate(pr.needed_by) : "—",
      filterKey:
        pr.status === "submitted"
          ? "submitted"
          : pr.status === "partially_received"
            ? "partial"
            : active
              ? "active-pr"
              : "all",
      sortWeight: pr.status === "submitted" ? 1 : pr.status === "partially_received" ? 2 : active ? 3 : 4,
    };
  });

  const allRows = [...itemRows, ...prRows].sort((a, b) => a.sortWeight - b.sortWeight);
  const filteredRows = filter === "all" ? allRows : allRows.filter((row) => row.filterKey === filter);

  const submittedPrs = prRows.filter((row) => row.filterKey === "submitted").length;
  const partialReceipts = prRows.filter((row) => row.filterKey === "partial").length;
  const reorderItems = itemRows.filter((row) => row.filterKey === "reorder").length;
  const activePrs = prRows.filter((row) => row.filterKey === "active-pr" || row.filterKey === "submitted" || row.filterKey === "partial").length;

  const columns: SimpleColumn[] = [
    { id: "name", header: "العنصر" },
    { id: "category", header: "التفصيل" },
    { id: "status", header: "الحالة", kind: "status" },
    { id: "metric", header: "المؤشر" },
    { id: "date", header: "التاريخ" },
  ];

  const rows: SimpleRow[] = filteredRows.map((row) => ({
    id: row.id,
    href: row.href,
    name: row.name,
    category: row.category,
    status: row.status,
    metric: row.metric,
    date: row.date,
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">لوحة المخزون والمشتريات</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            مؤشرات قابلة للتصفية؛ اضغط على البطاقة لتصفية جدول العمل.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/inventory">
            <Button variant="ghost" size="sm">الأصناف</Button>
          </Link>
          <Link href="/purchase-requests">
            <Button variant="ghost" size="sm">طلبات الشراء</Button>
          </Link>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardKpi href="/inventory/dashboard?filter=reorder" active={filter === "reorder"}>
          <KpiCard label="أصناف تحت حد إعادة الطلب" value={num(reorderItems)} deltaDirection={reorderItems ? "down" : "none"} />
        </DashboardKpi>
        <DashboardKpi href="/inventory/dashboard?filter=submitted" active={filter === "submitted"}>
          <KpiCard label="طلبات بانتظار الاعتماد" value={num(submittedPrs)} deltaDirection={submittedPrs ? "up" : "none"} />
        </DashboardKpi>
        <DashboardKpi href="/inventory/dashboard?filter=partial" active={filter === "partial"}>
          <KpiCard label="استلامات جزئية" value={num(partialReceipts)} deltaDirection={partialReceipts ? "up" : "none"} />
        </DashboardKpi>
        <DashboardKpi href="/inventory/dashboard?filter=active-pr" active={filter === "active-pr"}>
          <KpiCard label="طلبات نشطة" value={num(activePrs)} />
        </DashboardKpi>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card title="ملخص الموردين">
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            {num(suppliers?.length ?? 0)} مورّد مسجّل. تُستخدم مدد التوريد في توصيات التغطية عندما تكون متاحة.
          </p>
          <Link href="/suppliers" className="mt-3 inline-block font-medium underline underline-offset-4" style={{ color: "var(--brand)" }}>
            فتح الموردين
          </Link>
        </Card>
        <Card title="نطاق هذه اللوحة">
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            هذه قراءة تشغيلية من المخزون وطلبات الشراء فقط. توقعات النقص التفصيلية تبقى داخل صفحة تغطية كل صنف.
          </p>
        </Card>
        <Card title="الفلتر الحالي">
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            {filter === "all" ? "كل العناصر" : `فلتر: ${filter}`}
          </p>
          {filter !== "all" && (
            <Link href="/inventory/dashboard" className="mt-3 inline-block font-medium underline underline-offset-4" style={{ color: "var(--brand)" }}>
              مسح الفلتر
            </Link>
          )}
        </Card>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">جدول العمل</h2>
          <span className="text-sm tabular-nums" style={{ color: "var(--ink-muted)" }}>
            {num(rows.length)} عنصر
          </span>
        </div>
        <FilterableTable
          columns={columns}
          rows={rows}
          empty="لا توجد عناصر لهذا الفلتر"
          searchColumns={["name", "category", "status"]}
          placeholder="ابحث في المخزون والطلبات…"
          minRowsForSearch={1}
        />
      </section>
    </div>
  );
}

function DashboardKpi({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className="block rounded-md outline-offset-2"
      style={{
        boxShadow: active ? "0 0 0 2px var(--brand)" : undefined,
      }}
    >
      {children}
    </Link>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/farm-os && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Re-read diff**

Run: `git diff -- 'apps/farm-os/app/(app)/inventory/dashboard/page.tsx'`

Expected: read-only dashboard; no mutations, no RPCs, no charts.

---

### Task 4: Page Help and Drift Tests

**Files:**
- Modify: `apps/farm-os/lib/page-help.ts`
- Modify: `apps/farm-os/lib/page-help.test.ts`

**Interfaces:**
- Consumes: `APP_NAV`
- Produces: `PAGE_HELP.inventory-dashboard`

- [ ] **Step 1: Add `inventory-dashboard` help entry**

Add this object to `PAGE_HELP`:

```ts
  "inventory-dashboard": {
    title: "لوحة المخزون والمشتريات",
    what: "لوحة تشغيلية تجمع مؤشرات المخزون وطلبات الشراء في جدول عمل واحد.",
    why: "لتعرف سريعًا ما يحتاج إعادة طلب أو اعتماد أو متابعة استلام.",
    when: "في بداية اليوم أو قبل مراجعة طلبات الشراء.",
    how: "اضغط على بطاقة مؤشر لتصفية الجدول، ثم افتح الصنف أو الطلب من الصف.",
    avoid: "لا تعتبرها بديلًا عن صفحة تغطية الصنف؛ توقع النقص التفصيلي يبقى في محرك التغطية.",
    related: ["inventory", "purchase", "suppliers"],
  },
```

- [ ] **Step 2: Keep `page-help.test.ts` unchanged unless it fails**

The existing drift test loops over `APP_NAV`, so adding `inventory-dashboard` to the registry should require the new
help entry automatically.

- [ ] **Step 3: Run targeted help tests**

Run: `cd apps/farm-os && npx vitest run lib/nav.test.ts lib/page-help.test.ts`

Expected: PASS.

---

### Task 5: Docs Update and Validation

**Files:**
- Modify: `docs/superpowers/specs/2026-06-29-module-navigator-dashboards-360-design.md`
- Modify: `docs/PROJECT-TRACKER.md`
- Modify: `docs/SESSION-BRIEF.md`

**Interfaces:**
- Consumes: implementation result and validation output.
- Produces: current docs that describe what changed and what remains gated.

- [ ] **Step 1: Update design spec implementation status**

In the design spec, add a short note under section 8:

```md
Implementation note: the first slice selected for build is Inventory/Purchasing. It is intentionally read-only and
does not add migrations, RPCs, prod changes, accounting, academy, AI, or real registry import.
```

- [ ] **Step 2: Run validation**

Run from `apps/farm-os`:

```bash
npx tsc --noEmit
npx vitest run lib/nav.test.ts lib/page-help.test.ts
npm run build
```

Expected: all PASS. If build fails for an environmental reason, record the exact failure in the session brief and
final report.

- [ ] **Step 3: Update `docs/PROJECT-TRACKER.md`**

Add a newest entry at the top noting:

```md
> **2026-06-29 — Module navigator + Inventory/Purchasing dashboard first slice.** Added a module-based nav design
> spec and implementation plan, then built the read-only first slice: typed module registry, grouped app-side sidebar,
> and `/inventory/dashboard` with query-derived KPI filters over inventory items and purchase requests. No migrations,
> no RPC changes, no prod mutation. Validation: <fill exact command results>.
```

- [ ] **Step 4: Update `docs/SESSION-BRIEF.md` last**

Add a newest section with:

```md
## 2026-06-29 — Module navigator + Inventory/Purchasing dashboard first slice
**Where we are.** Built the read-only first slice of the module navigator/dashboard/360 direction: module registry,
grouped sidebar, `/inventory/dashboard`, and help coverage. No migrations/RPC/prod/data mutation.

**Validation.** <fill exact command results>.

**Still open.** Independent review before any merge; no migration needed. Next recommended slice: Item 360 shell or
Farm/Structure module dashboard after reviewing this first slice.
```

- [ ] **Step 5: Final self-review**

Run:

```bash
git diff --stat
git diff -- apps/farm-os docs
```

Expected: changes match plan; no unrelated files touched.
