import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Role } from "./auth";
import {
  APP_MODULES,
  APP_NAV,
  findActiveNavItem,
  isKnownRole,
  visibleModulesForRole,
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
