import Link from "next/link";
import { requireMembership } from "@/lib/auth";
import { Card } from "@/components/ui";

// SPEC-0025 U-1 — «سجّل»: the task-first launcher. The user states what happened; each card opens the
// flow that does the bookkeeping. Cards are role-aware: you only see what your role can actually do.

interface ActionCard {
  href: string;
  icon: string;
  title: string;
  hint: string;
  roles: string[];
}

const ACTIONS: ActionCard[] = [
  {
    href: "/record/expense",
    icon: "💸",
    title: "دفعت مصروفًا",
    hint: "اشتريت أو دفعت مقابل شيء — سجّله وصنّفه ووجّه دفعه في خطوة واحدة",
    roles: ["owner", "accountant"],
  },
  {
    href: "/finance/revenue-reports",
    icon: "🌴",
    title: "سلّمت محصولًا / بعت",
    hint: "سجّل التسليم الآن وحدّد السعر لاحقًا — النظام يتابع الأسعار المعلّقة",
    roles: ["owner", "accountant"],
  },
  {
    href: "/finance/revenue-reports",
    icon: "💰",
    title: "حصّلت فلوسًا من عميل",
    hint: "سجّل تحصيلًا كاملًا أو جزئيًا على بيع سابق",
    roles: ["owner", "accountant"],
  },
  {
    href: "/m/receive",
    icon: "📥",
    title: "استلمت بضاعة",
    hint: "وصلت أصناف من مورد — أدخلها إلى المخزون",
    roles: ["owner", "farm_manager", "storekeeper"],
  },
  {
    href: "/custody",
    icon: "🤝",
    title: "استلمت عهدة من المالك",
    hint: "سجّل نقدية دخلت العهدة",
    roles: ["owner", "accountant"],
  },
  {
    href: "/people/attendance",
    icon: "🧾",
    title: "سجّلت حضور عمالة",
    hint: "حضور اليوم ومهام العمالة",
    roles: ["owner", "farm_manager", "supervisor"],
  },
];

export default async function RecordLauncherPage() {
  const m = await requireMembership();
  const visible = ACTIONS.filter((a) => a.roles.includes(m.role));

  return (
    <div className="flex flex-col gap-4 p-6">
      <header>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>
          ماذا تريد أن تسجّل؟
        </h1>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          احكِ ما حدث — والنظام يتولى الدفاتر والتصنيف والتوجيه.
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((a) => (
          <Link key={a.title} href={a.href} className="block">
            <Card>
              <div className="flex items-start gap-3 p-1">
                <span className="text-2xl" aria-hidden>
                  {a.icon}
                </span>
                <div>
                  <div className="font-bold" style={{ color: "var(--ink)" }}>
                    {a.title}
                  </div>
                  <div className="text-sm" style={{ color: "var(--ink-muted)" }}>
                    {a.hint}
                  </div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
