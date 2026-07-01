import Link from "next/link";
import { Card } from "@/components/ui";

interface ChecklistStep {
  icon: string;
  title: string;
  description: string;
  href: string;
  cta: string;
}

// Fixed setup order (docs/agents/domain-style rationale, not a config table — this
// is a short static list, not a feature): structure before stock, stock before a
// plan that consumes it, team last since assigning responsibility only matters once
// there's something to be responsible for. Every href is a real, existing route;
// nothing here is a placeholder for a page that doesn't exist yet.
const STEPS: ChecklistStep[] = [
  {
    icon: "🌴",
    title: "عرّف هيكل المزرعة",
    description: "أضف القطاعات والأحواش والخطوط — أساس كل تقرير وخطة لاحقة.",
    href: "/farm",
    cta: "هيكل المزرعة",
  },
  {
    icon: "📦",
    title: "راجع المخزون والمشتريات",
    description: "تابع الأصناف وأنشئ أول طلب شراء لتغطية احتياجات المزرعة.",
    href: "/inventory/dashboard",
    cta: "لوحة المخزون",
  },
  {
    icon: "🗓️",
    title: "أنشئ أول خطة",
    description: "خطط الري أو التسميد أو المكافحة — تُبنى على هيكل المزرعة أعلاه.",
    href: "/plans",
    cta: "الخطط",
  },
  {
    icon: "👥",
    title: "راجع فريقك",
    description: "دليل العاملين بالمزرعة — أضِف من يتابع الخطط والعمليات ميدانيًا.",
    href: "/people",
    cta: "الفريق",
  },
];

/**
 * First-run guidance for a genuinely empty org. Gated by the caller on real,
 * already-fetched data (e.g. zero palms AND zero plans) — no persisted "dismissed"
 * flag: once the org has real data the emptiness check fails and this stops
 * rendering on its own, so there's nothing to remember or clean up.
 */
export function OnboardingChecklist() {
  return (
    <Card>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">ابدأ هنا</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>
          مؤسستك جديدة ولا تحتوي بعد على نخيل أو خطط مسجّلة. هذه الخطوات المقترحة للبدء بالترتيب.
        </p>
      </div>
      <ol className="grid gap-3 sm:grid-cols-2">
        {STEPS.map((step, i) => (
          <li key={step.href}>
            <Link href={step.href} className="block h-full transition-opacity hover:opacity-90">
              <div
                className="flex h-full items-start gap-3 rounded-md p-3"
                style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
              >
                <span
                  className="grid shrink-0 place-items-center rounded-full text-lg"
                  style={{ width: 36, height: 36, background: "color-mix(in srgb, var(--brand) 12%, var(--surface))" }}
                  aria-hidden="true"
                >
                  {step.icon}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {i + 1}. {step.title}
                  </div>
                  <p className="mt-0.5 text-sm" style={{ color: "var(--ink-muted)" }}>
                    {step.description}
                  </p>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
