import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Role } from "./auth";
import { visibleModulesForRole } from "./nav";
import { buildBreadcrumbs, routeDepth } from "./breadcrumbs";

const ROLES: Role[] = ["owner", "farm_manager", "agri_engineer", "accountant", "supervisor", "storekeeper"];
const APP_DIR = join(process.cwd(), "app", "(app)");

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return pageFiles(path);
    return entry === "page.tsx" ? [path] : [];
  });
}

/** `/farm/palm/[id]/page.tsx` → `/farm/palm/id-1` (same convention as nav.test.ts). */
function routeSampleForPage(pageFile: string): string {
  const route = relative(APP_DIR, pageFile)
    .split(sep)
    .slice(0, -1)
    .map((part) => part.replace(/^\[(.+)\]$/, "$1-1"))
    .join("/");
  return `/${route}`;
}

/** Every route in the app, with dynamic segments filled in — the full surface a role can land on. */
const ALL_ROUTES = pageFiles(APP_DIR).map(routeSampleForPage);

/** Destinations `role` may open, per the nav registry (the same source the sidebar renders from). */
function visibleHrefsForRole(role: Role): Set<string> {
  return new Set(visibleModulesForRole(role).flatMap((m) => m.pages.map((p) => p.href)));
}

describe("routeDepth", () => {
  it("counts path segments, ignoring slashes and the query string", () => {
    expect(routeDepth("/")).toBe(0);
    expect(routeDepth("/expenses")).toBe(1);
    expect(routeDepth("/expenses/")).toBe(1);
    expect(routeDepth("/expenses?filter=open")).toBe(1);
    expect(routeDepth("/finance/revenue-reports")).toBe(2);
    expect(routeDepth("/farm/palm/id-1")).toBe(3);
    expect(routeDepth("/finance/reconciliation/batch-1/acceptance")).toBe(4);
  });
});

describe("buildBreadcrumbs", () => {
  it("renders no trail on a depth-1 route, for every role", () => {
    // A depth-1 route is a primary destination — the sidebar (or the bottom tab bar) already says
    // where you are, so the trail is pure vertical cost above the h1.
    for (const role of ROLES) {
      for (const href of visibleHrefsForRole(role)) {
        if (routeDepth(href) !== 1) continue;
        expect(buildBreadcrumbs(href, role), `${role}:${href}`).toEqual([]);
      }
    }
    expect(buildBreadcrumbs("/expenses", "owner")).toEqual([]);
    expect(buildBreadcrumbs("/transactions", "accountant")).toEqual([]);
    expect(buildBreadcrumbs("/m", "supervisor")).toEqual([]);
  });

  it("renders no trail on the role home", () => {
    for (const role of ROLES) {
      expect(buildBreadcrumbs("/dashboard", role), role).toEqual([]);
      expect(buildBreadcrumbs("/dashboard/owner", role), role).toEqual([]);
      expect(buildBreadcrumbs("/dashboard/manager", role), role).toEqual([]);
    }
  });

  it("renders no trail for a route outside the nav registry", () => {
    expect(buildBreadcrumbs("/nope/deeper", "owner")).toEqual([]);
  });

  it("keeps the full trail on a deep route", () => {
    expect(buildBreadcrumbs("/finance/revenue-reports", "owner")).toEqual([
      { id: "home", label: "الرئيسية", href: "/dashboard" },
      { id: "finance-module", label: "المالية", href: "/finance/dashboard" },
      { id: "revenue-reports", label: "تقارير الإيرادات" },
    ]);
  });

  it("keeps the trail on a deep dynamic (360) route", () => {
    expect(buildBreadcrumbs("/farm/palm/id-1", "farm_manager")).toEqual([
      { id: "home", label: "الرئيسية", href: "/dashboard" },
      { id: "farm-module", label: "المزرعة", href: "/farm/dashboard" },
      { id: "farm", label: "هيكل المزرعة" },
    ]);
    expect(buildBreadcrumbs("/inventory/id-1/coverage", "storekeeper").map((c) => c.id)).toEqual([
      "home",
      "inventory-module",
      "inventory",
    ]);
  });

  it("omits the module crumb when the page IS the module dashboard", () => {
    expect(buildBreadcrumbs("/finance/dashboard", "accountant")).toEqual([
      { id: "home", label: "الرئيسية", href: "/dashboard" },
      { id: "finance-dashboard", label: "لوحة المالية" },
    ]);
  });

  it("never offers a crumb to a destination the role cannot see", () => {
    // The defect this replaces: the trail was built from the raw APP_MODULES registry and the
    // component was never passed the role, so the module crumb could link to a module dashboard the
    // role's own requireRole guard rejects.
    let checked = 0;
    for (const role of ROLES) {
      const visible = visibleHrefsForRole(role);
      for (const route of ALL_ROUTES) {
        for (const crumb of buildBreadcrumbs(route, role)) {
          if (crumb.href === undefined) continue;
          checked += 1;
          expect(visible.has(crumb.href), `${role}:${route} -> ${crumb.href}`).toBe(true);
        }
      }
    }
    // Guard the guard: a bug that returned [] everywhere would otherwise pass vacuously.
    expect(checked).toBeGreaterThan(100);
  });

  it("renders nothing when the current page itself is forbidden to the role", () => {
    expect(buildBreadcrumbs("/finance/revenue-reports", "supervisor")).toEqual([]);
    expect(buildBreadcrumbs("/people/payroll/readiness", "storekeeper")).toEqual([]);
  });

  it("drops the entire forbidden people trail for a supervisor but keeps it for an owner", () => {
    // /people/dashboard is requireRole(["owner","farm_manager","agri_engineer","accountant"]) —
    // a supervisor offered this crumb would be bounced by the page guard.
    expect(buildBreadcrumbs("/people/personId-1", "supervisor")).toEqual([]);
    expect(buildBreadcrumbs("/people/personId-1", "owner").map((c) => c.href)).toEqual([
      "/dashboard",
      "/people/dashboard",
      undefined,
    ]);
  });

  it("produces unique crumb ids and leaves the current page unlinked", () => {
    for (const role of ROLES) {
      for (const route of ALL_ROUTES) {
        const crumbs = buildBreadcrumbs(route, role);
        if (crumbs.length === 0) continue;
        const ids = crumbs.map((c) => c.id);
        expect(new Set(ids).size, `${role}:${route}`).toBe(ids.length);
        expect(crumbs[crumbs.length - 1].href, `${role}:${route}`).toBeUndefined();
        expect(crumbs[0]).toEqual({ id: "home", label: "الرئيسية", href: "/dashboard" });
      }
    }
  });
});

describe("bottom navigation reserve", () => {
  // MobileTabBar is position:fixed, so the scroll container must reserve the same height or the last
  // row / primary button of every phone page sits underneath it. These assertions keep the bar's
  // visibility, its height and the reserve in ONE media block so they cannot drift apart.
  const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
  const tabBar = readFileSync(join(process.cwd(), "components", "MobileTabBar.tsx"), "utf8");
  const TOKEN = "--farm-bottom-nav-h";
  const BREAKPOINT = "@media (max-width: 39.99rem)";

  /** The `{ … }` body that follows `marker`, matched by brace depth. */
  function blockAfter(source: string, marker: string): string {
    const start = source.indexOf(marker);
    expect(start, marker).toBeGreaterThan(-1);
    const open = source.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) return source.slice(open + 1, i);
      }
    }
    throw new Error(`unterminated block for ${marker}`);
  }

  it("defines the shared height token once", () => {
    expect(css.match(new RegExp(`${TOKEN}:`, "g"))).toHaveLength(1);
    expect(css).toMatch(new RegExp(`${TOKEN}:\\s*[\\d.]+rem;`));
  });

  it("sizes the bar and reserves the same space in one media block", () => {
    expect(css.match(new RegExp(BREAKPOINT.replace(/[.()]/g, "\\$&"), "g"))).toHaveLength(1);
    const block = blockAfter(css, BREAKPOINT);
    const reserve = `calc(var(${TOKEN}) + env(safe-area-inset-bottom, 0px))`;
    expect(block).toContain(".farm-bottom-nav");
    expect(block).toContain("box-sizing: border-box");
    expect(block).toContain(`block-size: ${reserve}`);
    expect(block).not.toContain(`min-block-size: ${reserve}`);
    expect(block).toContain("padding-block-end: env(safe-area-inset-bottom, 0px)");
    expect(block).toContain(".fos-appshell__main");
    expect(block).toContain(`padding-block-end: ${reserve}`);
  });

  it("keeps the bar hidden by default so the reserve and the bar share one breakpoint", () => {
    expect(blockAfter(css, ".farm-bottom-nav {")).toContain("display: none");
    expect(tabBar).toContain("farm-bottom-nav");
    expect(tabBar).not.toContain("sm:hidden");
  });

  it("still pads the bar by the device safe area", () => {
    const block = blockAfter(css, BREAKPOINT);
    expect(block).toContain("padding-block-end: env(safe-area-inset-bottom, 0px)");
    expect(tabBar).not.toContain("env(safe-area-inset-bottom)");
  });
});
