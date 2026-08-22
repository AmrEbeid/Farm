import type { Role } from "@/lib/auth";
import { findActiveNavItem, visibleModulesForRole } from "@/lib/nav";

// SPEC-0025 U-13 — the registry-derived breadcrumb trail («أين أنا؟» plus one tap up), extracted from
// AutoBreadcrumbs so it is a PURE function: the app's vitest environment is `node` (no DOM), so trail
// construction is only testable once it is separated from rendering.
//
// Two rules this module owns, both fixes rather than restatements of the previous inline logic:
//
// 1. ROLE-AWARE. The module crumb is resolved from `visibleModulesForRole(role)`, not the raw
//    APP_MODULES registry. The previous inline lookup was role-blind and was never passed the role at
//    all, so it could offer a module dashboard the current role's own `requireRole` guard rejects —
//    e.g. a supervisor on a person 360 was offered «الفريق» → /people/dashboard, which is gated to
//    owner/farm_manager/agri_engineer/accountant.
// 2. DEPTH-GATED. A depth-1 route is a primary destination: the sidebar (or the bottom tab bar on a
//    phone) already says where you are, so a three-crumb trail above the h1 is pure vertical cost on
//    the exact pages that must feel compact. Deep routes keep their full trail unchanged.
//
// Deep links and route URLs are untouched — this only decides what the trail renders.

/** The home crumb's destination: the role router, reachable by every authenticated member. */
const HOME_HREF = "/dashboard";

export interface BreadcrumbCrumb {
  /** Stable key; also what `onSelect` echoes back. */
  id: string;
  /** Visible Arabic label. */
  label: string;
  /** Link target; omitted on the current page. */
  href?: string;
}

/**
 * Path segments, ignoring leading/trailing slashes and the query string:
 * `/expenses` → 1, `/finance/revenue-reports` → 2, `/farm/palm/<id>` → 3.
 */
export function routeDepth(pathname: string): number {
  return pathname.split("?")[0].split("/").filter(Boolean).length;
}

/**
 * Build the breadcrumb trail for `pathname` as seen by `role`. Returns an empty array when no trail
 * should render (depth-1 routes, the role home, and any route outside the nav registry).
 */
export function buildBreadcrumbs(pathname: string, role: Role): BreadcrumbCrumb[] {
  if (routeDepth(pathname) < 2) return [];

  const item = findActiveNavItem(pathname);
  // Unknown route, or the role home itself (/dashboard/owner and /dashboard/manager both resolve to
  // the «لوحة المعلومات» entry) — stay out of the way, exactly as before.
  if (!item || item.href === HOME_HREF) return [];

  const visibleModules = visibleModulesForRole(role);
  const module_ = visibleModules.find((m) => m.pages.some((p) => p.id === item.id));
  // The active item came from the global registry. Do not expose even its label when that page is not
  // present in this role's filtered registry; the route guard will handle the unauthorized request.
  if (!module_) return [];

  const crumbs: BreadcrumbCrumb[] = [{ id: "home", label: "الرئيسية", href: HOME_HREF }];

  if (module_.dashboardHref !== item.href) {
    // `visibleModulesForRole` keeps a module whose pages are only PARTLY visible, so also confirm the
    // dashboard page itself survived the role filter before linking to it.
    const dashboardHref = module_.dashboardHref;
    if (module_.pages.some((p) => p.href === dashboardHref)) {
      crumbs.push({ id: module_.id, label: module_.label, href: dashboardHref });
    }
  }

  crumbs.push({ id: item.id, label: item.label });
  return crumbs;
}
