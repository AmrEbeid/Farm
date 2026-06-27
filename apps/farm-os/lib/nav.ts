import type { Role } from "@/lib/auth";

export interface AppNavItem {
  id: string;
  label: string;
  icon: string;
  href: string;
  roles?: Role[];
}

/** Role-aware primary navigation. `roles` omitted = visible to all. */
export const APP_NAV: AppNavItem[] = [
  { id: "dashboard", label: "لوحة التحكم", icon: "🏠", href: "/dashboard" },
  { id: "farm", label: "المزرعة", icon: "🌴", href: "/farm" },
  { id: "weather", label: "الطقس", icon: "🌤️", href: "/weather" },
  { id: "plans", label: "الخطط", icon: "🗓️", href: "/plans" },
  { id: "inventory", label: "المخزون", icon: "📦", href: "/inventory" },
  { id: "purchase", label: "طلبات الشراء", icon: "🧾", href: "/purchase-requests" },
  { id: "suppliers", label: "الموردون", icon: "🏷️", href: "/suppliers" },
  { id: "expenses", label: "المصروفات", icon: "💸", href: "/expenses", roles: ["owner", "accountant", "farm_manager"] },
  { id: "budgets", label: "الموازنات", icon: "📊", href: "/budgets", roles: ["owner", "accountant", "farm_manager"] },
  { id: "people", label: "الفريق", icon: "👥", href: "/people", roles: ["owner", "farm_manager", "agri_engineer", "accountant"] },
  { id: "academy", label: "الأكاديمية", icon: "📚", href: "/academy" },
  { id: "mobile", label: "الميدان", icon: "📱", href: "/m", roles: ["supervisor", "agri_engineer", "owner", "farm_manager"] },
  { id: "settings", label: "الإعدادات", icon: "⚙️", href: "/settings", roles: ["owner"] },
];

export const SEED_PLAN_ID = "5d5d302e-c385-5d0b-94f5-3dc2c9948e79";
export const POTASSIUM_ID = "39e22867-fbe2-5cd9-8a76-ce5871a8e8f4";
