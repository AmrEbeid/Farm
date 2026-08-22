import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Role } from "./auth";
import {
  APP_MODULES,
  APP_NAV,
  findActiveNavItem,
  isKnownRole,
  mobilePrimaryTabsForRole,
  primaryNavigationForRole,
  primaryNavIdForPath,
  visibleModulesForRole,
  workspaceModulesForRole,
} from "./nav";

const ROLES: Role[] = ["owner", "farm_manager", "agri_engineer", "accountant", "supervisor", "storekeeper"];
const APP_DIR = join(process.cwd(), "app", "(app)");

function routeFileForHref(href: string): string {
  const clean = href.replace(/^\/+/, "");
  return join(APP_DIR, clean, "page.tsx");
}

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return pageFiles(path);
    return entry === "page.tsx" ? [path] : [];
  });
}

function routeSampleForPage(pageFile: string): string {
  const route = relative(APP_DIR, pageFile)
    .split(sep)
    .slice(0, -1)
    .map((part) => part.replace(/^\[(.+)\]$/, "$1-1"))
    .join("/");
  return `/${route}`;
}

describe("APP_MODULES", () => {
  it("has unique module ids, page ids, and non-empty labels", () => {
    const moduleIds = APP_MODULES.map((m) => m.id);
    expect(new Set(moduleIds).size).toBe(moduleIds.length);
    const pageIds = APP_NAV.map((i) => i.id);
    expect(new Set(pageIds).size).toBe(pageIds.length);
    for (const appModule of APP_MODULES) {
      expect(appModule.label.trim().length).toBeGreaterThan(0);
      expect(appModule.pages.length).toBeGreaterThan(0);
      for (const item of appModule.pages) expect(item.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("every href is a safe relative path", () => {
    for (const item of APP_NAV) {
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.href).not.toMatch(/^[a-z]+:/i);
    }
  });

  it("role-gated modules and pages list only known roles", () => {
    for (const appModule of APP_MODULES) {
      for (const r of appModule.roles ?? []) expect(ROLES).toContain(r);
      for (const item of appModule.pages) {
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

    const managerFinancePages = visibleModulesForRole("farm_manager")
      .find((m) => m.id === "finance-module")
      ?.pages.map((p) => p.id);
    expect(managerFinancePages).toContain("expenses");
    expect(managerFinancePages).not.toContain("accounts");
    expect(managerFinancePages).not.toContain("finance-reports");
    expect(managerFinancePages).not.toContain("revenue-reports");
    expect(managerFinancePages).not.toContain("custody-reports");
    expect(managerFinancePages).not.toContain("finance-insights");
    expect(managerFinancePages).not.toContain("accounting");
    expect(managerFinancePages).not.toContain("custody");
  });

  it("keeps APP_NAV as a flat compatibility projection", () => {
    expect(APP_NAV.map((i) => i.id)).toEqual(APP_MODULES.flatMap((m) => m.pages.map((p) => p.id)));
  });

  it("starts every module with its configured dashboard page", () => {
    for (const appModule of APP_MODULES) {
      expect(appModule.pages[0]?.href, appModule.id).toBe(appModule.dashboardHref);
    }
  });

  it("starts every role-filtered module with its dashboard page", () => {
    for (const role of ROLES) {
      for (const appModule of visibleModulesForRole(role)) {
        expect(appModule.pages[0]?.href, `${role}:${appModule.id}`).toBe(appModule.dashboardHref);
      }
    }
  });

  it("derives one at-most-five primary spine for desktop and phone", () => {
    const expected: Record<Role, string[]> = {
      owner: ["/dashboard", "/record", "/approvals", "/transactions", "/reports"],
      accountant: ["/dashboard", "/record", "/approvals", "/transactions", "/reports"],
      agri_engineer: ["/dashboard", "/record", "/approvals", "/m", "/reports"],
      farm_manager: ["/dashboard", "/record", "/m", "/reports"],
      supervisor: ["/dashboard", "/record", "/m", "/reports"],
      storekeeper: ["/dashboard", "/record", "/inventory/dashboard", "/reports"],
    };
    for (const role of ROLES) {
      const tabs = mobilePrimaryTabsForRole(role);
      const desktop = primaryNavigationForRole(role);
      const visibleHrefs = new Set(visibleModulesForRole(role).flatMap((module) => module.pages.map((page) => page.href)));

      expect(tabs.length, role).toBeLessThanOrEqual(5);
      expect(tabs, role).toEqual(desktop);
      expect(tabs.map((tab) => tab.href), role).toEqual(expected[role]);
      for (const tab of tabs) expect(visibleHrefs.has(tab.href), `${role}:${tab.href}`).toBe(true);
    }
  });

  it("keeps eight owner workspaces and folds insights under the reports hub", () => {
    expect(workspaceModulesForRole("owner").map((module) => module.label)).toEqual([
      "المزرعة",
      "التخطيط والعمليات",
      "المخزون والمشتريات",
      "المالية",
      "الفريق",
      "التسويق",
      "الطقس والمخاطر",
      "الإعدادات",
    ]);
    expect(workspaceModulesForRole("owner").map((module) => module.id)).not.toContain("insights-module");
    expect(visibleModulesForRole("owner").map((module) => module.id)).toContain("insights-module");
  });

  it("reduces finance to seven launchers while preserving the full searchable registry", () => {
    const finance = workspaceModulesForRole("owner").find((module) => module.id === "finance-module");
    expect(finance?.pages.map((page) => page.id)).toEqual([
      "finance-dashboard",
      "expenses",
      "budgets",
      "custody",
      "accounting",
      "reconciliation",
      "month-close",
    ]);
    expect(visibleModulesForRole("owner").find((module) => module.id === "finance-module")?.pages).toHaveLength(16);
  });

  it("maps folded and task-specific routes to the correct primary state", () => {
    for (const path of [
      "/inventory",
      "/inventory/item-1",
      "/inventory/item-1/coverage",
      "/inventory/movements",
      "/inventory/stock-take",
      "/m/receive",
    ]) {
      expect(primaryNavIdForPath("storekeeper", path), path).toBe("inventory-dashboard");
    }
    for (const path of [
      "/insights/annual-report",
      "/finance/income-statement",
      "/finance/buyers/buyer-1",
      "/finance/cost-centers/center-1",
      "/reports/plan-1/pva",
    ]) {
      expect(primaryNavIdForPath("owner", path), path).toBe("reports-hub");
    }
    expect(primaryNavIdForPath("supervisor", "/m/execute/op-1")).toBe("mobile");
    expect(primaryNavIdForPath("storekeeper", "/m")).toBeNull();
  });

  it("has a route file for every nav href", () => {
    for (const item of APP_NAV) {
      expect(existsSync(routeFileForHref(item.href)), `${item.id} -> ${item.href}`).toBe(true);
    }
  });

  it("finds the most specific active nav item", () => {
    expect(findActiveNavItem("/inventory/dashboard")?.id).toBe("inventory-dashboard");
    expect(findActiveNavItem("/inventory/abc")?.id).toBe("inventory");
    expect(findActiveNavItem("/inventory/abc/coverage")?.id).toBe("inventory");
    expect(findActiveNavItem("/farm/dashboard")?.id).toBe("farm-dashboard");
    expect(findActiveNavItem("/farm/croquis")?.id).toBe("farm-croquis");
    expect(findActiveNavItem("/farm/sector/123")?.id).toBe("farm");
    expect(findActiveNavItem("/farm/hawsha/123")?.id).toBe("farm");
    expect(findActiveNavItem("/farm/line/123")?.id).toBe("farm");
    expect(findActiveNavItem("/farm/palm/123")?.id).toBe("farm");
    expect(findActiveNavItem("/plans/dashboard")?.id).toBe("plans-dashboard");
    expect(findActiveNavItem("/plans/123")?.id).toBe("plans");
    expect(findActiveNavItem("/reports/123/pva")?.id).toBe("plans");
    expect(findActiveNavItem("/purchase-requests/123")?.id).toBe("purchase");
    expect(findActiveNavItem("/suppliers/123")?.id).toBe("suppliers");
    expect(findActiveNavItem("/finance/dashboard")?.id).toBe("finance-dashboard");
    expect(findActiveNavItem("/budgets/123")?.id).toBe("budgets");
    expect(findActiveNavItem("/expenses/123")?.id).toBe("expenses");
    expect(findActiveNavItem("/finance/accounts")?.id).toBe("accounts");
    expect(findActiveNavItem("/finance/reports")?.id).toBe("finance-reports");
    expect(findActiveNavItem("/finance/revenue-reports")?.id).toBe("revenue-reports");
    expect(findActiveNavItem("/finance/reconciliation")?.id).toBe("reconciliation");
    expect(findActiveNavItem("/finance/reconciliation/batch-1")?.id).toBe("reconciliation");
    expect(findActiveNavItem("/finance/custody-reports")?.id).toBe("custody-reports");
    expect(findActiveNavItem("/finance/insights")?.id).toBe("finance-insights");
    expect(findActiveNavItem("/accounting")?.id).toBe("accounting");
    expect(findActiveNavItem("/budget/123/check")?.id).toBe("budgets");
    expect(findActiveNavItem("/people/dashboard")?.id).toBe("people-dashboard");
    expect(findActiveNavItem("/people/123")?.id).toBe("people");
    expect(findActiveNavItem("/weather/dashboard")?.id).toBe("weather-dashboard");
    expect(findActiveNavItem("/weather")?.id).toBe("weather");
    expect(findActiveNavItem("/settings/dashboard")?.id).toBe("settings-dashboard");
    expect(findActiveNavItem("/nope")).toBeNull();
  });

  it("resolves every dynamic app page to an active nav item", () => {
    const dynamicSamples = pageFiles(APP_DIR).map(routeSampleForPage).filter((route) => route.includes("-1"));

    expect(dynamicSamples.length).toBeGreaterThan(0);
    for (const route of dynamicSamples) {
      expect(findActiveNavItem(route)?.id, route).toBeDefined();
    }
  });
});
