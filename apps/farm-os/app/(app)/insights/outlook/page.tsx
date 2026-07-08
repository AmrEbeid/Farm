// SPEC-0031 — النظرة المستقبلية: forward scenarios. HONESTY IS THE WHOLE POINT (#1): every number here is a
// PROJECTION, labeled «تقديري», derived transparently from the historical revenue CAGR of the posted journal —
// never presented as a recorded figure. The maturity reframe (young palms haven't peaked) is an agronomic
// template pending a named agronomist's sign-off (#4). Server Component; role owner/accountant.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, Card, EmptyState } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { egp, pct } from "@/lib/money";
import { parsePnlTimeseries } from "@/lib/pnl-insights";

const mutedStyle = { color: "var(--ink-muted)" } as const;

interface Scenario {
  key: string;
  label: string;
  rate: number; // annual growth fraction
  color: string;
}

function projectYears(base: number, rate: number, baseYear: number, count: number): { year: number; value: number }[] {
  return Array.from({ length: count }, (_, i) => ({
    year: baseYear + i + 1,
    value: base * Math.pow(1 + rate, i + 1),
  }));
}

export default async function OutlookPage() {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const nowYear = new Date().getFullYear();
  const res = await sb.rpc("fn_pnl_timeseries", { p_org: m.orgId, p_grain: "year", p_from: "2017-01-01", p_to: `${nowYear}-12-31` });
  if (res.error) throw res.error;

  const ts = parsePnlTimeseries(res.data);
  const withRevenue = ts.periods.filter((p) => p.revenue > 0);
  const first = withRevenue[0];
  const base = withRevenue[withRevenue.length - 1]; // latest full year with revenue
  const firstYear = first ? Number(first.period) : null;
  const baseYear = base ? Number(base.period) : null;
  const spanYears = firstYear != null && baseYear != null ? baseYear - firstYear : 0;

  // Historical CAGR — honest-null when there is no usable base (#1).
  const cagr =
    first && base && first.revenue > 0 && spanYears > 0
      ? Math.pow(base.revenue / first.revenue, 1 / spanYears) - 1
      : null;

  const scenarios: Scenario[] =
    cagr == null
      ? []
      : [
          { key: "cons", label: "متحفّظ", rate: Math.max(0, cagr * 0.5), color: "#b45309" },
          { key: "base", label: "أساسي", rate: cagr, color: "var(--brand, #1e6b3a)" },
          { key: "opt", label: "متفائل", rate: cagr * 1.4, color: "#2563eb" },
        ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>
            النظرة المستقبلية
          </h1>
          <p style={mutedStyle}>ثلاثة سيناريوهات للإيراد للسنوات القادمة — مبنية على النمو التاريخي.</p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <PrintButton label="طباعة النظرة" />
        </div>
      </header>

      <Alert
        tone="warning"
        title="أرقام تقديرية — ليست مسجّلة"
        description="كل الأرقام في هذه الصفحة توقّعات تُحسب من متوسط النمو السنوي التاريخي للإيراد (من القيود المُرحّلة). ليست أرقامًا مسجّلة ولا وعدًا — الواقع يعتمد على الأسعار والطقس والأسواق ونضج النخيل."
      />

      {scenarios.length === 0 || !base ? (
        <Card title="النظرة المستقبلية">
          <EmptyState title="تحتاج سنتين على الأقل بإيراد مُرحّل لبناء توقّع." />
        </Card>
      ) : (
        <>
          <p className="text-sm" style={mutedStyle}>
            الأساس: إيراد {base.period} = <span dir="ltr">{egp(base.revenue)}</span> · متوسط النمو السنوي التاريخي (
            {firstYear}–{baseYear}) ≈ <span dir="ltr">{pct(cagr ?? 0)}</span>.
          </p>

          <section className="grid gap-3 md:grid-cols-3">
            {scenarios.map((s) => {
              const proj = projectYears(base.revenue, s.rate, baseYear!, 3);
              const threeYearGrowth = Math.pow(1 + s.rate, 3) - 1;
              return (
                <Card key={s.key}>
                  <div className="flex flex-col gap-2 p-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold" style={{ color: s.color }}>{s.label}</span>
                      <span className="text-xs font-bold" dir="ltr" style={mutedStyle}>+{pct(threeYearGrowth)} / 3س</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {proj.map((p) => (
                        <div key={p.year} className="flex items-center justify-between border-b py-1 text-sm" style={{ borderColor: "var(--line)" }}>
                          <span dir="ltr" style={mutedStyle}>{p.year}E</span>
                          <span className="font-bold" dir="ltr" style={{ color: "var(--ink)" }}>{egp(p.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              );
            })}
          </section>

          <Alert
            tone="info"
            title="لماذا النمو متوقّع؟ لأن النخيل ما زال يكبر"
            description="القطاعات الأصغر لم تبلغ ذروة إنتاجها؛ نخيل البرحي يصل ذروته بين 8–12 سنة. مع نضج القطاعات ودخول موجات الفسائل الإنتاج، يميل الإيراد للارتفاع دون توسّع في الأرض. (منحنى نضج النخيل قالب إرشادي حتى اعتماد مهندس زراعي — CLAUDE.md #4.)"
          />

          <p className="text-sm" style={mutedStyle}>
            التقدير يفترض استمرار نمط النمو السابق دون صدمات. راجع الأداء الفعلي في{" "}
            <Link href="/insights/annual-report" className="no-print font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>
              التقرير السنوي ←
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
