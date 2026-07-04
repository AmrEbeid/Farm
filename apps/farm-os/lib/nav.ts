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
  /** SPEC-0025 U-5: "tasks" = the always-visible task entries (الرئيسية/سجّل/المعاملات/التقارير);
   *  "admin" = domain administration, rendered under an «الإدارة» section header. Default: admin. */
  group?: "tasks" | "admin";
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
      },
      {
        id: "budgets",
        label: "الموازنات",
        icon: "📊",
        href: "/budgets",
        roles: ["owner", "accountant", "farm_manager"],
      },
      {
        id: "expenses",
        label: "المصروفات",
        icon: "💸",
        href: "/expenses",
        roles: ["owner", "accountant", "farm_manager"],
      },
      {
        id: "accounts",
        label: "شجرة الحسابات",
        icon: "📚",
        href: "/finance/accounts",
        roles: ["owner", "accountant"],
      },
      {
        id: "finance-reports",
        label: "تقارير التكلفة",
        icon: "📈",
        href: "/finance/reports",
        roles: ["owner", "accountant"],
      },
      {
        id: "revenue-reports",
        label: "تقارير الإيرادات",
        icon: "🧾",
        href: "/finance/revenue-reports",
        roles: ["owner", "accountant"],
      },
      {
        id: "custody-reports",
        label: "تقارير العهدة",
        icon: "📑",
        href: "/finance/custody-reports",
        roles: ["owner", "accountant"],
      },
      {
        id: "finance-insights",
        label: "رؤى المالك",
        icon: "💡",
        href: "/finance/insights",
        roles: ["owner", "accountant"],
      },
      {
        id: "accounting",
        label: "المحاسبة",
        icon: "📒",
        href: "/accounting",
        roles: ["owner", "accountant"],
      },
      {
        id: "custody",
        label: "العهدة وطلبات الصرف",
        icon: "💰",
        href: "/custody",
        roles: ["owner", "accountant"],
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
