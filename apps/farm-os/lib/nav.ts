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
  { id: "plans", label: "الخطة الشهرية", icon: "🗓️", href: "/plans/5d5d302e-c385-5d0b-94f5-3dc2c9948e79" },
  { id: "inventory", label: "المخزون", icon: "📦", href: "/inventory" },
  { id: "purchase", label: "طلبات الشراء", icon: "🧾", href: "/purchase-requests" },
  { id: "mobile", label: "الميدان", icon: "📱", href: "/m", roles: ["supervisor", "agri_engineer", "owner", "farm_manager"] },
];

export const SEED_PLAN_ID = "5d5d302e-c385-5d0b-94f5-3dc2c9948e79";
export const POTASSIUM_ID = "39e22867-fbe2-5cd9-8a76-ce5871a8e8f4";
export const HASWA_SECTOR_ID = "2aa10e7e-d6fe-5f6b-88f0-1c3c01bc1d23";
export const FERT_OP_ID = "37c9cce6-6ec4-570a-97a4-b263e2faf5d0";
