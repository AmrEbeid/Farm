import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { Card } from "@/components/ui";

// SPEC-0029 / SPEC-0031 — «الرؤى»: the insight arc. One destination that walks the owner through the
// farm's story as an ordered set of chapters, each answering a single question (never a page to hunt for).
// Every chapter reads only the audited GL / registry / offshoot ledger (non-negotiable #1: no fabricated
// data; forecasts, when they arrive, are labeled تقديري). Chapters not yet built render as «قريبًا» — an
// honest roadmap marker, not a broken link — and flip live as each slice lands.

interface Chapter {
  n: number;
  icon: string;
  title: string;
  question: string;
  /** null until the chapter's page exists. */
  href: string | null;
}

const CHAPTERS: Chapter[] = [
  { n: 1, icon: "🌅", title: "نظرة عامة", question: "كيف تسير المزرعة هذا العام؟", href: "/finance/insights-summary" },
  { n: 2, icon: "🏆", title: "أداء القطاعات", question: "أي قطاع يكسب، وأيها يحتاج اهتمامًا؟", href: "/finance/sector-scorecard" },
  { n: 3, icon: "🌱", title: "بنك الفسائل", question: "كم تساوي الفسائل، وكيف تنمو؟", href: "/farm/offshoots" },
  { n: 4, icon: "📊", title: "بطاقة الأداء", question: "سنة مقابل سنة — ما الذي تغيّر؟", href: null },
  { n: 5, icon: "🎯", title: "المقارنة الداخلية", question: "ماذا لو أدى كل فدان مثل الأفضل؟", href: null },
  { n: 6, icon: "📖", title: "التقرير السنوي", question: "قصة السنة كاملة في صفحة واحدة.", href: null },
  { n: 7, icon: "🔭", title: "النظرة المستقبلية", question: "إلى أين تتجه المزرعة؟", href: null },
];

// Deeper cuts that already exist — kept reachable so nothing is lost in the move to «الرؤى».
const MORE: { icon: string; title: string; hint: string; href: string }[] = [
  { icon: "🌾", title: "لوحة الموسم", hint: "الحصاد لحظة بلحظة: أطنان، بونات، معلّق، ومحصَّل", href: "/finance/season" },
  { icon: "🌿", title: "اقتصاد المحاصيل", hint: "هامش وعائد كل محصول", href: "/finance/enterprise-scorecard" },
  { icon: "📈", title: "اتجاه الأرباح", hint: "الربح والخسارة عبر الفترات", href: "/finance/pnl-trend" },
  { icon: "💡", title: "رؤى المالك", hint: "مؤشرات مراكز التكلفة والتنبيهات", href: "/finance/insights" },
];

function ChapterCard({ chapter }: { chapter: Chapter }) {
  const inner = (
    <Card>
      <div className="flex items-start gap-3 p-1">
        <span className="text-2xl" aria-hidden>
          {chapter.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold" style={{ color: "var(--ink-muted)" }} dir="ltr">
              {chapter.n}
            </span>
            <span className="font-bold" style={{ color: "var(--ink)" }}>
              {chapter.title}
            </span>
            {!chapter.href && (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                style={{ background: "var(--surface-sunken, #eef1ef)", color: "var(--ink-muted)" }}
              >
                قريبًا
              </span>
            )}
          </div>
          <div className="mt-0.5 text-sm" style={{ color: "var(--ink-muted)" }}>
            {chapter.question}
          </div>
        </div>
      </div>
    </Card>
  );
  if (!chapter.href) return <div aria-disabled className="block opacity-70">{inner}</div>;
  return (
    <Link href={chapter.href} className="block">
      {inner}
    </Link>
  );
}

export default async function InsightsHubPage() {
  await requireRole(["owner", "accountant"]);

  return (
    <div className="flex flex-col gap-5 p-6">
      <header>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>
          الرؤى
        </h1>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          قصة المزرعة في فصول مرتّبة — كل فصل يجيب عن سؤال واحد. كل الأرقام من القيود الفعلية.
        </p>
      </header>

      <section className="flex flex-col gap-2">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CHAPTERS.map((c) => (
            <ChapterCard key={c.n} chapter={c} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-bold" style={{ color: "var(--ink)" }}>
          تفاصيل إضافية
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MORE.map((c) => (
            <Link key={c.href} href={c.href} className="block">
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
    </div>
  );
}
