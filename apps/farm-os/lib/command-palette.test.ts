import { describe, it, expect } from "vitest";
import { searchNav } from "./command-palette";
import { APP_MODULES, visibleModulesForRole } from "./nav";
import type { AppModule } from "./nav";

const FIXTURE_MODULES: AppModule[] = [
  {
    id: "inventory-module",
    label: "المخزون والمشتريات",
    icon: "📦",
    dashboardHref: "/inventory/dashboard",
    pages: [
      { id: "inventory", label: "الأصناف", icon: "📦", href: "/inventory" },
      { id: "purchase", label: "طلبات الشراء", icon: "🧾", href: "/purchase-requests" },
    ],
  },
  {
    id: "settings-module",
    label: "الإعدادات",
    icon: "⚙️",
    dashboardHref: "/settings/dashboard",
    pages: [{ id: "profile", label: "الملف الشخصي", icon: "👤", href: "/profile" }],
  },
];

describe("searchNav", () => {
  it("returns every page (browsable quick-switcher) for an empty or whitespace query", () => {
    const r = searchNav(FIXTURE_MODULES, "");
    expect(r.map((x) => x.id)).toEqual(["inventory", "purchase", "profile"]);
    expect(searchNav(FIXTURE_MODULES, "   ")).toHaveLength(3);
  });

  it("matches directly against page labels, not module labels", () => {
    expect(searchNav(FIXTURE_MODULES, "الأصناف").map((x) => x.id)).toEqual(["inventory"]);
    expect(searchNav(FIXTURE_MODULES, "شراء").map((x) => x.id)).toEqual(["purchase"]);
  });

  it("is Arabic-folded and case-insensitive (reuses lib/filter's normalizeArabic)", () => {
    expect(searchNav(FIXTURE_MODULES, "الملف الشخصى").map((x) => x.id)).toEqual(["profile"]);
  });

  it("carries the owning module's label as a group hint", () => {
    const [hit] = searchNav(FIXTURE_MODULES, "طلبات الشراء");
    expect(hit.moduleLabel).toBe("المخزون والمشتريات");
    expect(hit.href).toBe("/purchase-requests");
  });

  it("returns no results for a query matching nothing", () => {
    expect(searchNav(FIXTURE_MODULES, "xyz-not-a-page")).toEqual([]);
  });

  it("respects a `limit` cap", () => {
    expect(searchNav(FIXTURE_MODULES, "", 1)).toHaveLength(1);
  });

  it("works against the real nav registry, respecting role visibility", () => {
    const supervisorModules = visibleModulesForRole("supervisor");
    const supervisorHits = searchNav(supervisorModules, "الإعدادات");
    expect(supervisorHits).toEqual([]); // supervisor has no settings-module page

    const ownerHits = searchNav(visibleModulesForRole("owner"), "إعدادات المؤسسة");
    expect(ownerHits.map((x) => x.id)).toContain("settings");

    // Sanity: every page in the full registry is findable by its own exact label.
    for (const appModule of APP_MODULES) {
      for (const page of appModule.pages) {
        const hits = searchNav([appModule], page.label);
        expect(hits.map((x) => x.id), page.id).toContain(page.id);
      }
    }
  });
});
