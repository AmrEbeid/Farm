import type { Role } from "@/lib/auth";

export interface AppNavItem {
  id: string;
  label: string;
  icon: string;
  href: string;
  roles?: Role[];
  /** Optional visual subsection inside a large workspace. */
  section?: string;
}

export interface AppModule {
  id: string;
  label: string;
  icon: string;
  dashboardHref: string;
  roles?: Role[];
  pages: AppNavItem[];
  /** SPEC-0025 U-5: "tasks" = the always-visible task entries (الرئيسية/سجّل/المعاملات/التقارير);
   *  "admin" = domain administration, rendered under an «الإدارة» section header. Default: admin. */
  group?: "tasks" | "admin";
}

export type MobilePrimaryTab = Pick<AppNavItem, "id" | "href" | "icon"> & { label: string };
export type PrimaryNavItem = MobilePrimaryTab;

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

/** Module-aware primary navigation. `roles` omitted = visible to all roles. */
export const APP_MODULES: AppModule[] = [
  {
    id: "home",
    group: "tasks",
    label: "لوحة المعلومات",
    icon: "🏠",
    dashboardHref: "/dashboard",
    pages: [{ id: "dashboard", label: "لوحة المعلومات", icon: "🏠", href: "/dashboard" }],
  },
  {
    // SPEC-0025 U-1: the task-first launcher — one place to record what happened.
    id: "record-module",
    group: "tasks",
    label: "سجّل",
    icon: "➕",
    dashboardHref: "/record",
    pages: [{ id: "record", label: "سجّل عملية", icon: "➕", href: "/record" }],
  },
  {
    // SPEC-0030 §4.1 — «راجع»: the third daily intent. One inbox for every decision awaiting the user
    // (dose/spray sign-offs + purchase-request + payment-request approvals), so approvals aren't hunted
    // across three modules. Visible to the roles that approve something; the page shows only their sections.
    id: "approvals-module",
    group: "tasks",
    label: "راجع",
    icon: "🖊",
    dashboardHref: "/approvals",
    roles: ["owner", "agri_engineer", "accountant"],
    pages: [{ id: "approvals", label: "ما يحتاج قرارك", icon: "🖊", href: "/approvals", roles: ["owner", "agri_engineer", "accountant"] }],
  },
  {
    // SPEC-0025 U-3: the unified money ledger — every transaction in one place.
    id: "transactions-module",
    group: "tasks",
    label: "المعاملات",
    icon: "📜",
    dashboardHref: "/transactions",
    roles: ["owner", "accountant"],
    pages: [{ id: "transactions", label: "كل المعاملات", icon: "📜", href: "/transactions", roles: ["owner", "accountant"] }],
  },
  {
    // SPEC-0025 U-4: the reports hub — every report, grouped by the question it answers.
    id: "reports-module",
    group: "tasks",
    label: "التقارير",
    icon: "📈",
    dashboardHref: "/reports",
    pages: [{ id: "reports-hub", label: "كل التقارير", icon: "📈", href: "/reports" }],
  },
  {
    // SPEC-0029/0031: «الرؤى» — the insight arc. A first-class destination (the insight pages used to be
    // buried mid-list inside the 20-item finance module). Owner/accountant, finance.read-gated.
    id: "insights-module",
    group: "tasks",
    label: "الرؤى",
    icon: "💡",
    dashboardHref: "/insights",
    roles: ["owner", "accountant"],
    pages: [
      { id: "insights-hub", label: "كل الرؤى", icon: "💡", href: "/insights", roles: ["owner", "accountant"] },
      { id: "insights-summary", label: "ملخّص الرؤى", icon: "🌅", href: "/finance/insights-summary", roles: ["owner", "accountant"] },
      { id: "sector-scorecard", label: "أداء القطاعات", icon: "🏆", href: "/finance/sector-scorecard", roles: ["owner", "accountant"] },
      { id: "enterprise-scorecard", label: "اقتصاد المحاصيل", icon: "🌿", href: "/finance/enterprise-scorecard", roles: ["owner", "accountant"] },
      { id: "finance-insights", label: "رؤى المالك", icon: "💡", href: "/finance/insights", roles: ["owner", "accountant"] },
      { id: "scorecard", label: "بطاقة الأداء", icon: "📊", href: "/insights/scorecard", roles: ["owner", "accountant"] },
      { id: "benchmark", label: "المقارنة الداخلية", icon: "🎯", href: "/insights/benchmark", roles: ["owner", "accountant"] },
      { id: "annual-report", label: "التقرير السنوي", icon: "📖", href: "/insights/annual-report", roles: ["owner", "accountant"] },
      { id: "outlook", label: "النظرة المستقبلية", icon: "🔭", href: "/insights/outlook", roles: ["owner", "accountant"] },
    ],
  },
  {
    id: "farm-module",
    label: "المزرعة",
    icon: "🌴",
    dashboardHref: "/farm/dashboard",
    pages: [
      { id: "farm-dashboard", label: "لوحة المزرعة", icon: "🌴", href: "/farm/dashboard" },
      { id: "farm", label: "هيكل المزرعة", icon: "🌴", href: "/farm" },
      {
        id: "offshoots",
        label: "بنك الفسائل",
        icon: "🌱",
        href: "/farm/offshoots",
        roles: ["owner", "accountant", "farm_manager"],
      },
      { id: "farm-croquis", label: "الكروكي", icon: "🗺️", href: "/farm/croquis" },
      { id: "academy", label: "أكاديمية الرعاية", icon: "📚", href: "/academy" },
      { id: "pest-scouting", label: "مكافحة سوسة النخيل الحمراء", icon: "🐛", href: "/farm/pest-scouting" },
    ],
  },
  {
    id: "planning-module",
    label: "التخطيط والعمليات",
    icon: "🗓️",
    dashboardHref: "/plans/dashboard",
    pages: [
      { id: "plans-dashboard", label: "لوحة التخطيط", icon: "🗓️", href: "/plans/dashboard" },
      { id: "plans", label: "كل الخطط", icon: "🗓️", href: "/plans" },
      {
        id: "plan-approvals",
        label: "اعتمادات مطلوبة",
        icon: "🖊",
        href: "/plans/approvals",
        roles: ["owner", "agri_engineer"],
      },
      {
        id: "mobile",
        label: "الميدان",
        icon: "📱",
        href: "/m",
        roles: ["supervisor", "agri_engineer", "owner", "farm_manager"],
      },
      {
        id: "attendance",
        label: "تسجيل الحضور",
        icon: "🧾",
        href: "/people/attendance",
        roles: ["owner", "farm_manager", "supervisor"],
      },
    ],
  },
  {
    id: "inventory-module",
    label: "المخزون والمشتريات",
    icon: "📦",
    dashboardHref: "/inventory/dashboard",
    pages: [
      {
        id: "inventory-dashboard",
        label: "لوحة المخزون والمشتريات",
        icon: "📦",
        href: "/inventory/dashboard",
      },
      { id: "inventory", label: "الأصناف", icon: "📦", href: "/inventory" },
      { id: "inventory-movements", label: "حركات المخزون", icon: "📜", href: "/inventory/movements" },
      {
        // SPEC-0030 Phase 4 (#778): reconcile the system on-hand to a physical count. Roles match the
        // fn_record_stock_take authz (inventory.write: owner/farm_manager/storekeeper).
        id: "stock-take",
        label: "الجرد",
        icon: "🔢",
        href: "/inventory/stock-take",
        roles: ["storekeeper", "owner", "farm_manager"],
      },
      { id: "purchase", label: "طلبات الشراء", icon: "🧾", href: "/purchase-requests" },
      {
        // F6: storekeeper mobile receive surface. Roles match the desktop `canReceive` set and the
        // fn_post_receipt authz, so it appears only for those who can actually post a receipt.
        id: "m-receive",
        label: "استلام المخزون",
        icon: "📥",
        href: "/m/receive",
        roles: ["storekeeper", "owner", "farm_manager"],
      },
      { id: "suppliers", label: "الموردون", icon: "🏷️", href: "/suppliers" },
    ],
  },
  {
    id: "finance-module",
    label: "المالية",
    icon: "📊",
    dashboardHref: "/finance/dashboard",
    roles: ["owner", "accountant", "farm_manager"],
    pages: [
      {
        id: "finance-dashboard",
        label: "لوحة المالية",
        icon: "📊",
        href: "/finance/dashboard",
        roles: ["owner", "accountant", "farm_manager"],
        section: "نظرة عامة",
      },
      {
        id: "budgets",
        label: "الموازنات",
        icon: "📊",
        href: "/budgets",
        roles: ["owner", "accountant", "farm_manager"],
        section: "التشغيل اليومي",
      },
      {
        id: "expenses",
        label: "المصروفات",
        icon: "💸",
        href: "/expenses",
        roles: ["owner", "accountant", "farm_manager"],
        section: "التشغيل اليومي",
      },
      {
        id: "accounts",
        label: "شجرة الحسابات",
        icon: "📚",
        href: "/finance/accounts",
        roles: ["owner", "accountant"],
        section: "التشغيل اليومي",
      },
      {
        id: "finance-reports",
        label: "تقارير التكلفة",
        icon: "📈",
        href: "/finance/reports",
        roles: ["owner", "accountant"],
        section: "القوائم والتقارير",
      },
      {
        id: "revenue-reports",
        label: "تقارير الإيرادات",
        icon: "🧾",
        href: "/finance/revenue-reports",
        roles: ["owner", "accountant"],
        section: "القوائم والتقارير",
      },
      {
        id: "balance-sheet",
        label: "قائمة المركز المالي",
        icon: "📋",
        href: "/finance/balance-sheet",
        roles: ["owner", "accountant"],
        section: "القوائم والتقارير",
      },
      {
        id: "income-statement",
        label: "قائمة الدخل",
        icon: "📈",
        href: "/finance/income-statement",
        roles: ["owner", "accountant"],
        section: "القوائم والتقارير",
      },
      {
        id: "budget-vs-actual",
        label: "الموازنة مقابل الفعلي",
        icon: "📊",
        href: "/finance/budget-vs-actual",
        roles: ["owner", "accountant"],
        section: "القوائم والتقارير",
      },
      {
        id: "periods",
        label: "الفترات المحاسبية",
        icon: "🔒",
        href: "/finance/periods",
        roles: ["owner", "accountant"],
        section: "الإقفال والرقابة",
      },
      {
        id: "season-dashboard",
        label: "لوحة الموسم",
        icon: "🌾",
        href: "/finance/season",
        roles: ["owner", "accountant"],
        section: "القوائم والتقارير",
      },
      {
        id: "month-close",
        label: "إقفال الشهر",
        icon: "🔏",
        href: "/finance/close",
        roles: ["owner", "accountant"],
        section: "الإقفال والرقابة",
      },
      {
        id: "custody-reports",
        label: "تقارير العهدة",
        icon: "📑",
        href: "/finance/custody-reports",
        roles: ["owner", "accountant"],
        section: "القوائم والتقارير",
      },
      {
        id: "reconciliation",
        label: "مراجعة التسويات",
        icon: "🧮",
        href: "/finance/reconciliation",
        roles: ["owner", "accountant"],
        section: "الإقفال والرقابة",
      },
      {
        id: "accounting",
        label: "المحاسبة",
        icon: "📒",
        href: "/accounting",
        roles: ["owner", "accountant"],
        section: "التشغيل اليومي",
      },
      {
        id: "custody",
        label: "العهدة وطلبات الصرف",
        icon: "💰",
        href: "/custody",
        roles: ["owner", "accountant"],
        section: "التشغيل اليومي",
      },
    ],
  },
  {
    id: "people-module",
    label: "الفريق",
    icon: "👥",
    dashboardHref: "/people/dashboard",
    roles: ["owner", "farm_manager", "agri_engineer", "accountant"],
    pages: [
      {
        id: "people-dashboard",
        label: "لوحة الفريق",
        icon: "👥",
        href: "/people/dashboard",
        roles: ["owner", "farm_manager", "agri_engineer", "accountant"],
      },
      {
        id: "people",
        label: "دليل الفريق",
        icon: "👥",
        href: "/people",
        roles: ["owner", "farm_manager", "agri_engineer", "accountant"],
      },
      {
        // SPEC-0006 slice 3 (migration 20260729090000): close a payroll period into an immutable
        // gross-pay snapshot. Roles match the payroll.read RLS on payroll_runs/payroll_run_lines and
        // fn_close_payroll_run's own authorize() gate — owner/accountant only — so the entry never
        // appears to a role the page would redirect.
        id: "payroll",
        label: "إقفال الرواتب",
        icon: "💵",
        href: "/people/payroll",
        roles: ["owner", "accountant"],
      },
      {
        // SPEC-0006 slice 4: the wage rates the close prices against. SAME two roles as the close
        // itself — `people_compensation`'s comp_rw policy gates both read and write on
        // authorize('payroll.read', org_id) (owner/accountant, migrations 0046/0074), so any other
        // role would see an empty table and be redirected by the page. Wage data appears on no
        // other nav surface.
        id: "payroll-compensation",
        label: "أجور الفريق",
        icon: "🧮",
        href: "/people/payroll/compensation",
        roles: ["owner", "accountant"],
      },
      {
        // SPEC-0006 / docs/PILOT-READINESS.md: the pre-pilot preparation sheet + three
        // VALIDATION-ONLY templates. Same owner/accountant pair as the close and the wage editor —
        // the templates rehearse wage/labor shapes, and their descriptors carry the identical
        // allowedRoles which the import API re-enforces server-side. It imports nothing.
        id: "payroll-readiness",
        label: "جاهزية الرواتب",
        icon: "🧷",
        href: "/people/payroll/readiness",
        roles: ["owner", "accountant"],
      },
    ],
  },
  {
    // SPEC-0032 — Marketing module: 5 nav pages consolidating the 25 legacy export-marketing
    // tracking areas. Owner/accountant/farm_manager only — matches the marketing_* RLS/RPC role
    // gate exactly (an explicit inline check, not authorize()), so no other role ever sees a page
    // it cannot read.
    id: "marketing-module",
    label: "التسويق",
    icon: "📣",
    dashboardHref: "/marketing",
    roles: ["owner", "accountant", "farm_manager"],
    pages: [
      { id: "marketing-overview", label: "نظرة عامة", icon: "📣", href: "/marketing", roles: ["owner", "accountant", "farm_manager"] },
      { id: "marketing-product", label: "المنتج", icon: "🌴", href: "/marketing/product", roles: ["owner", "accountant", "farm_manager"] },
      { id: "marketing-markets", label: "الأسواق", icon: "📈", href: "/marketing/markets", roles: ["owner", "accountant", "farm_manager"] },
      { id: "marketing-pipeline", label: "خط المبيعات", icon: "🧭", href: "/marketing/pipeline", roles: ["owner", "accountant", "farm_manager"] },
      { id: "marketing-campaigns", label: "الحملات", icon: "📨", href: "/marketing/campaigns", roles: ["owner", "accountant", "farm_manager"] },
    ],
  },
  {
    id: "weather-module",
    label: "الطقس والمخاطر",
    icon: "🌤️",
    dashboardHref: "/weather/dashboard",
    pages: [
      { id: "weather-dashboard", label: "لوحة الطقس والمخاطر", icon: "🌤️", href: "/weather/dashboard" },
      { id: "weather", label: "الطقس", icon: "🌤️", href: "/weather" },
      {
        id: "weather-thresholds",
        label: "عتبات الطقس",
        icon: "🌡️",
        href: "/weather/thresholds",
        roles: ["owner", "farm_manager"],
      },
    ],
  },
  {
    id: "settings-module",
    label: "الإعدادات",
    icon: "⚙️",
    dashboardHref: "/settings/dashboard",
    pages: [
      { id: "settings-dashboard", label: "لوحة الإدارة", icon: "⚙️", href: "/settings/dashboard" },
      { id: "profile", label: "الملف الشخصي", icon: "👤", href: "/profile" },
      { id: "settings", label: "إعدادات المؤسسة", icon: "⚙️", href: "/settings", roles: ["owner"] },
      { id: "website", label: "الموقع", icon: "🌐", href: "/website", roles: ["owner"] },
      { id: "enquiries", label: "طلبات العملاء", icon: "📬", href: "/enquiries", roles: ["owner"] },
    ],
  },
];

/** Flat compatibility projection for existing drift guards and page help. */
export const APP_NAV: AppNavItem[] = APP_MODULES.flatMap((m) => m.pages);

const ACTIVE_ROUTE_ALIASES: { pattern: RegExp; navId: string }[] = [
  { pattern: /^\/finance\/cost-centers\/[^/]+(?:\/)?$/, navId: "finance-reports" },
  { pattern: /^\/finance\/buyers\/[^/]+(?:\/)?$/, navId: "revenue-reports" },
  { pattern: /^\/budget\/[^/]+\/check(?:\/)?$/, navId: "budgets" },
  { pattern: /^\/reports\/[^/]+\/pva(?:\/)?$/, navId: "plans" },
];

export function visibleModulesForRole(role: Role): AppModule[] {
  return APP_MODULES.flatMap((module) => {
    if (!visibleToRole(module, role)) return [];
    const pages = module.pages.filter((page) => visibleToRole(page, role));
    return pages.length > 0 ? [{ ...module, pages }] : [];
  });
}

const PRIMARY_IDS_BY_ROLE: Record<Role, readonly string[]> = {
  owner: ["dashboard", "record", "approvals", "transactions", "reports-hub"],
  accountant: ["dashboard", "record", "approvals", "transactions", "reports-hub"],
  agri_engineer: ["dashboard", "record", "approvals", "mobile", "reports-hub"],
  farm_manager: ["dashboard", "record", "mobile", "reports-hub"],
  supervisor: ["dashboard", "record", "mobile", "reports-hub"],
  storekeeper: ["dashboard", "record", "inventory-dashboard", "reports-hub"],
};

const PRIMARY_LABELS: Record<string, string> = {
  dashboard: "الرئيسية",
  record: "سجّل",
  approvals: "راجع",
  transactions: "المعاملات",
  mobile: "الميدان",
  "inventory-dashboard": "المخزون",
  "reports-hub": "التقارير",
};

/** One role-gated task spine shared by desktop and phone. */
export function primaryNavigationForRole(role: Role): PrimaryNavItem[] {
  const visiblePages = visibleModulesForRole(role).flatMap((module) => module.pages);
  const pageById = new Map(visiblePages.map((page) => [page.id, page]));
  return PRIMARY_IDS_BY_ROLE[role].flatMap((id) => {
    const page = pageById.get(id);
    return page ? [{ id, href: page.href, icon: page.icon, label: PRIMARY_LABELS[id] }] : [];
  });
}

/** Secondary workspaces keep every role-allowed deep route, collapsed in the sidebar. */
export function workspaceModulesForRole(role: Role): AppModule[] {
  const financeLauncherOrder = [
    "finance-dashboard",
    "expenses",
    "budgets",
    "custody",
    "accounting",
    "reconciliation",
    "month-close",
  ];
  const financeLauncherIds = new Set(financeLauncherOrder);
  return visibleModulesForRole(role)
    .filter((module) => (module.group ?? "admin") === "admin" && module.id !== "insights-module")
    .map((module) => module.id === "finance-module"
      ? {
          ...module,
          pages: module.pages
            .filter((page) => financeLauncherIds.has(page.id))
            .sort((a, b) => financeLauncherOrder.indexOf(a.id) - financeLauncherOrder.indexOf(b.id)),
        }
      : module);
}

const REPORT_ROUTE_PREFIXES = [
  "/insights",
  "/finance/insights",
  "/finance/insights-summary",
  "/finance/sector-scorecard",
  "/finance/enterprise-scorecard",
  "/finance/reports",
  "/finance/revenue-reports",
  "/finance/balance-sheet",
  "/finance/income-statement",
  "/finance/budget-vs-actual",
  "/finance/season",
  "/finance/custody-reports",
] as const;

/** Canonical active state for routes folded behind a primary destination. */
export function primaryNavIdForPath(role: Role, pathname: string): string | null {
  if (
    role === "storekeeper" &&
    (
      pathname === "/inventory" ||
      pathname.startsWith("/inventory/") ||
      pathname === "/m/receive" ||
      pathname.startsWith("/m/receive/")
    )
  ) {
    return "inventory-dashboard";
  }
  if (
    REPORT_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ||
    pathname.startsWith("/finance/buyers/") ||
    pathname.startsWith("/finance/cost-centers/") ||
    pathname.startsWith("/reports/")
  ) {
    return "reports-hub";
  }
  const activeId = findActiveNavItem(pathname)?.id;
  return primaryNavigationForRole(role).some((item) => item.id === activeId) ? activeId ?? null : null;
}

/** The phone spine resolves against the same role-filtered pages as the desktop sidebar. */
export function mobilePrimaryTabsForRole(role: Role): MobilePrimaryTab[] {
  return primaryNavigationForRole(role);
}

export function findActiveNavItem(pathname: string): AppNavItem | null {
  const alias = ACTIVE_ROUTE_ALIASES.find((entry) => entry.pattern.test(pathname));
  if (alias) return APP_NAV.find((item) => item.id === alias.navId) ?? null;
  const sorted = [...APP_NAV].sort((a, b) => b.href.length - a.href.length);
  return sorted.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)) ?? null;
}

export function isKnownRole(role: string): role is Role {
  return ALL_ROLES.includes(role as Role);
}

export const SEED_PLAN_ID = "5d5d302e-c385-5d0b-94f5-3dc2c9948e79";
export const POTASSIUM_ID = "39e22867-fbe2-5cd9-8a76-ce5871a8e8f4";
