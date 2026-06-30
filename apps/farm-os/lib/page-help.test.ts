import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { APP_NAV } from "./nav";
import { PAGE_HELP, helpFor, helpForPath } from "./page-help";

const APP_DIR = join(process.cwd(), "app", "(app)");

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

describe("page help completeness (SPEC-0014 A1 / Documentation Health Score)", () => {
  it("has a help entry for every primary nav page (drift guard)", () => {
    for (const item of APP_NAV) {
      expect(PAGE_HELP[item.id], `missing page help for nav id "${item.id}"`).toBeDefined();
    }
  });

  it("every help entry answers all five questions (non-empty)", () => {
    for (const [id, h] of Object.entries(PAGE_HELP)) {
      for (const field of ["title", "what", "why", "when", "how", "avoid"] as const) {
        expect(h[field].trim().length, `${id}.${field} is empty`).toBeGreaterThan(0);
      }
      expect(Array.isArray(h.related), `${id}.related must be an array`).toBe(true);
    }
  });

  it("related ids reference real nav pages", () => {
    const navIds = new Set(APP_NAV.map((i) => i.id));
    for (const [id, h] of Object.entries(PAGE_HELP)) {
      for (const rel of h.related) {
        expect(navIds.has(rel), `${id}.related "${rel}" is not a nav id`).toBe(true);
      }
    }
  });

  it("helpFor returns an entry for a known id and null otherwise", () => {
    expect(helpFor("inventory")?.title.length).toBeGreaterThan(0);
    expect(helpFor("nonexistent")).toBeNull();
  });

  it("returns 360-specific help for dynamic detail routes", () => {
    expect(helpForPath("/farm/sector/sector-1", "farm")?.title).toBe("ملف القطاع 360");
    expect(helpForPath("/farm/hawsha/hawsha-1", "farm")?.title).toBe("ملف الحوشة 360");
    expect(helpForPath("/farm/line/line-1", "farm")?.title).toBe("ملف الخط 360");
    expect(helpForPath("/farm/palm/palm-1", "farm")?.title).toBe("ملف النخلة 360");
    expect(helpForPath("/inventory/item-1/coverage", "inventory")?.title).toBe("تغطية المخزون");
    expect(helpForPath("/m/execute/op-1", "mobile")?.title).toBe("تنفيذ عملية ميدانية");
    expect(helpForPath("/budget/plan-1/check", "budgets")?.title).toBe("فحص الموازنة");
    expect(helpForPath("/reports/plan-1/pva", "plans")?.title).toBe("المخطط مقابل الفعلي");
    expect(helpForPath("/inventory/item-1", "inventory")?.title).toBe("ملف الصنف 360");
    expect(helpForPath("/plans/plan-1", "plans")?.title).toBe("ملف الخطة 360");
    expect(helpForPath("/purchase-requests/pr-1", "purchase")?.title).toBe("ملف طلب الشراء 360");
    expect(helpForPath("/suppliers/supplier-1", "suppliers")?.title).toBe("ملف المورد 360");
    expect(helpForPath("/budgets/budget-1", "budgets")?.title).toBe("ملف الموازنة 360");
    expect(helpForPath("/expenses/expense-1", "expenses")?.title).toBe("ملف المصروف 360");
    expect(helpForPath("/people/person-1", "people")?.title).toBe("ملف الشخص 360");
  });

  it("falls back to active nav help outside 360 detail routes", () => {
    expect(helpForPath("/inventory/dashboard", "inventory-dashboard")?.title).toBe("لوحة المخزون والمشتريات");
    expect(helpForPath("/reports", "dashboard")?.title).toBe("لوحة المعلومات");
  });

  it("has route-specific help for every dynamic app page", () => {
    const fallbackTitle = helpFor("dashboard")?.title;
    const dynamicSamples = pageFiles(APP_DIR).map(routeSampleForPage).filter((route) => route.includes("-1"));

    expect(dynamicSamples.length).toBeGreaterThan(0);
    for (const route of dynamicSamples) {
      expect(helpForPath(route, "dashboard")?.title, route).not.toBe(fallbackTitle);
    }
  });
});
