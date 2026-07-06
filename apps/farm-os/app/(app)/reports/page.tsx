import Link from "next/link";
import { requireMembership } from "@/lib/auth";
import { Card } from "@/components/ui";

// SPEC-0025 U-4 — «التقارير»: ONE hub where every report in the system is a card, grouped by the
// QUESTION it answers (not by the module that owns it). Role-aware: you see what you may open.
// This page adds no data logic — each card links to the existing report page.

interface ReportCard {
  href: string;
  icon: string;
  title: string;
  hint: string;
  roles: string[];
}
interface ReportGroup {
  question: string;
  cards: ReportCard[];
}

const FIN = ["owner", "accountant"];
const OPS = ["owner", "accountant", "farm_manager"];

const GROUPS: ReportGroup[] = [
  {
    question: "أين تذهب الفلوس؟",
    cards: [
      { href: "/finance/income-statement", icon: "📈", title: "قائمة الدخل من القيود", hint: "الإيرادات ناقص المصروفات وصافي الربح للفترة — البيان الرسمي من القيود", roles: FIN },
      { href: "/finance/balance-sheet", icon: "📋", title: "قائمة المركز المالي", hint: "الموارد والالتزامات وحقوق المالك حتى تاريخ — قائمة متوازنة", roles: FIN },
      { href: "/finance/reports", icon: "📊", title: "تقارير التكلفة", hint: "المصروفات حسب الحساب ومركز التكلفة والفترة", roles: FIN },
      { href: "/finance/pnl", icon: "🧾", title: "ملخص التشغيل القديم", hint: "عرض تشغيلي سابق؛ اعتمد قائمة الدخل من القيود للتقرير الرسمي", roles: FIN },
      { href: "/budgets", icon: "🎯", title: "الموازنات", hint: "المخطط مقابل الفعلي لكل بند", roles: OPS },
      { href: "/accounting", icon: "📒", title: "المحاسبة وميزان المراجعة", hint: "الحسابات والقيود الفعلية", roles: FIN },
      { href: "/finance/budget-vs-actual", icon: "📊", title: "الموازنة مقابل الفعلي", hint: "المخطط مقابل الفعلي الحيّ من القيود لكل فئة", roles: FIN },
      { href: "/finance/pnl-trend", icon: "📈", title: "اتجاه الأرباح", hint: "اتجاه الربح والخسارة عبر الفترات — رسم بياني من القيود", roles: FIN },
    ],
  },
  {
    question: "من أين تأتي الفلوس؟",
    cards: [
      { href: "/finance/revenue-reports", icon: "💰", title: "تقارير الإيرادات", hint: "المبيعات حسب المحصول والمشتري + الأسعار المعلّقة + الذمم", roles: FIN },
      { href: "/finance/season", icon: "🌾", title: "لوحة الموسم", hint: "الحصاد لحظة بلحظة: أطنان، بونات، معلّق، محصَّل، وإنتاج كل فدان", roles: FIN },
      { href: "/finance/close", icon: "🔏", title: "إقفال الشهر", hint: "قائمة المعلّقات المولَّدة — الشهر يُقفل حين تفرغ", roles: FIN },
      { href: "/finance/periods", icon: "🔒", title: "الفترات المحاسبية", hint: "إقفال أو إعادة فتح فترة بعد مراجعة القوائم", roles: FIN },
      { href: "/farm/offshoots", icon: "🌱", title: "بنك الفسائل", hint: "حركة الفسائل والتقدير", roles: OPS },
    ],
  },
  {
    question: "أين النقدية؟",
    cards: [
      { href: "/finance/custody-reports", icon: "💼", title: "تقارير العهدة", hint: "أرصدة العهد وحركاتها وطلبات الصرف", roles: FIN },
      { href: "/custody", icon: "🤝", title: "العهدة وطلبات الصرف", hint: "الحالة الحية للعهد والطلبات", roles: FIN },
    ],
  },
  {
    question: "كيف حال المزرعة والمخزون؟",
    cards: [
      { href: "/finance/insights", icon: "💡", title: "رؤى المالك", hint: "المؤشرات الاستراتيجية والاتجاهات", roles: FIN },
      { href: "/inventory/dashboard", icon: "📦", title: "تغطية المخزون", hint: "الأصناف والنواقص وطلبات الشراء", roles: ["owner", "farm_manager", "storekeeper", "accountant"] },
      { href: "/farm/dashboard", icon: "🌴", title: "لوحة المزرعة", hint: "النخيل والصحة والهيكل", roles: ["owner", "farm_manager", "agri_engineer", "supervisor", "accountant", "storekeeper"] },
      { href: "/plans/dashboard", icon: "🗓️", title: "لوحة التخطيط", hint: "تقدّم الخطط والعمليات (ومنها تقرير المخطط/الفعلي لكل خطة)", roles: ["owner", "farm_manager", "agri_engineer", "supervisor", "accountant", "storekeeper"] },
      { href: "/people/dashboard", icon: "👥", title: "لوحة الفريق", hint: "الحضور والعمالة", roles: ["owner", "farm_manager", "agri_engineer", "accountant"] },
      { href: "/weather/dashboard", icon: "🌤️", title: "الطقس والمخاطر", hint: "التوقعات وعتبات التشغيل", roles: ["owner", "farm_manager", "agri_engineer", "supervisor", "accountant", "storekeeper"] },
    ],
  },
];

export default async function ReportsHubPage() {
  const m = await requireMembership();
  const groups = GROUPS.map((g) => ({ ...g, cards: g.cards.filter((c) => c.roles.includes(m.role)) })).filter(
    (g) => g.cards.length > 0,
  );

  return (
    <div className="flex flex-col gap-5 p-6">
      <header>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>
          التقارير
        </h1>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          كل تقارير النظام في مكان واحد — مرتّبة حسب السؤال الذي تجيب عنه.
        </p>
      </header>
      {groups.map((g) => (
        <section key={g.question} className="flex flex-col gap-2">
          <h2 className="text-base font-bold" style={{ color: "var(--ink)" }}>
            {g.question}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.cards.map((c) => (
              <Link key={c.href + c.title} href={c.href} className="block">
                <Card>
                  <div className="flex items-start gap-3 p-1">
                    <span className="text-2xl" aria-hidden>
                      {c.icon}
                    </span>
                    <div>
                      <div className="font-bold" style={{ color: "var(--ink)" }}>
                        {c.title}
                      </div>
                      <div className="text-sm" style={{ color: "var(--ink-muted)" }}>
                        {c.hint}
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
