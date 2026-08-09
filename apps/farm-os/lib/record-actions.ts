import type { Role } from "@/lib/auth";

export type ActionGroupId = "cash-in" | "cash-out" | "on-account" | "sales" | "operations";

export interface ActionCard {
  href: string;
  icon: string;
  title: string;
  hint: string;
  roles: Role[];
  group: ActionGroupId;
}

export interface ActionGroup {
  id: ActionGroupId;
  title: string;
  hint: string;
}

// Money direction is the accountant's primary scan order; operational work remains separate.
export const ACTION_GROUPS: ActionGroup[] = [
  { id: "cash-in", title: "نقدية داخلة", hint: "فلوس دخلت من عميل أو من المالك" },
  { id: "cash-out", title: "نقدية خارجة", hint: "مصروف دُفع الآن من العهدة" },
  { id: "on-account", title: "آجل / على الحساب", hint: "مصروف سُجّل الآن وسيُدفع لاحقًا" },
  { id: "sales", title: "مبيعات قبل التحصيل", hint: "أثبت التسليم وحدّد السعر قبل دخول النقدية" },
  { id: "operations", title: "تشغيل المزرعة", hint: "التنفيذ والمخزون والخطة والعمالة" },
];

export const ACTIONS: ActionCard[] = [
  {
    href: "/record/expense?payment=custody",
    icon: "💸",
    title: "دفعت مصروفًا من العهدة",
    hint: "سجّل المصروف وخصمه من العهدة",
    roles: ["owner", "accountant"],
    group: "cash-out",
  },
  {
    href: "/record/expense?payment=later",
    icon: "🧾",
    title: "سجّلت مصروفًا آجلًا",
    hint: "أثبت المصروف الآن وسدّده لاحقًا",
    roles: ["owner", "accountant"],
    group: "on-account",
  },
  {
    href: "/record/scale",
    icon: "⚖️",
    title: "سلّمت حمولة (الميزان)",
    hint: "عبوات ← وزن ← بون مرقّم — والسعر يُحدد لاحقًا",
    roles: ["owner", "accountant"],
    group: "sales",
  },
  {
    href: "/record/price",
    icon: "🏷️",
    title: "حدّدت سعر بيع",
    hint: "سعّر التسليمات المعلّقة — القيد يدخل الدفاتر فورًا",
    roles: ["owner", "accountant"],
    group: "sales",
  },
  {
    href: "/record/collect",
    icon: "💰",
    title: "حصّلت فلوسًا من عميل",
    hint: "اختر البيع وسجّل تحصيلًا كاملًا أو جزئيًا — القيد تلقائي",
    roles: ["owner", "accountant"],
    group: "cash-in",
  },
  {
    href: "/m",
    icon: "✅",
    title: "نفّذت عملية",
    hint: "سجّل تنفيذ عملية مخططة من واجهة الميدان",
    roles: ["owner", "farm_manager", "agri_engineer", "supervisor"],
    group: "operations",
  },
  {
    href: "/record/activity",
    icon: "📝",
    title: "سجّلت نشاطًا غير مخطط",
    hint: "عمل في الحقل خارج الخطة — فحص أو ملاحظة أو عملية",
    roles: ["owner", "farm_manager", "agri_engineer", "supervisor"],
    group: "operations",
  },
  {
    href: "/m/receive",
    icon: "📥",
    title: "استلمت بضاعة",
    hint: "وصلت أصناف من مورد — أدخلها إلى المخزون",
    roles: ["owner", "farm_manager", "storekeeper"],
    group: "operations",
  },
  {
    href: "/record/custody-in",
    icon: "🤝",
    title: "استلمت عهدة من المالك",
    hint: "سجّل نقدية دخلت العهدة",
    roles: ["owner", "accountant"],
    group: "cash-in",
  },
  {
    href: "/record/plan",
    icon: "🗓️",
    title: "أخطّط الأسبوع/الشهر",
    hint: "أنشئ خطة للمزرعة كلها أو لجزء منها — سطرًا لكل عملية بتفاصيلها",
    roles: ["owner", "farm_manager"],
    group: "operations",
  },
  {
    href: "/people/attendance",
    icon: "🧾",
    title: "سجّلت حضور عمالة",
    hint: "حضور اليوم ومهام العمالة",
    roles: ["owner", "farm_manager", "supervisor"],
    group: "operations",
  },
];

export interface GroupedActions extends ActionGroup {
  actions: ActionCard[];
}

export function groupVisibleActions(role: Role): GroupedActions[] {
  const visible = ACTIONS.filter((action) => action.roles.includes(role));
  return ACTION_GROUPS.map((group) => ({
    ...group,
    actions: visible.filter((action) => action.group === group.id),
  })).filter((group) => group.actions.length > 0);
}
