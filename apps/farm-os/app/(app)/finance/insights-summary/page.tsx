// Owner insights summary (ملخّص رؤى المالك) — SPEC-0029 Phase 2 cohesive cockpit. The executive one-screen:
// composes the deterministic engine's outputs — the P&L narrator, the best-unit-benchmark growth punchline, and
// every strategic thesis that fires (cost-discipline / concentration / crop-ROI) — over the audited GL, then
// links to the detailed views. Pure composition of tested lib functions (lib/pnl-insights + lib/entity-pnl);
// no LLM, no fabrication — a thesis is null (absent) when the data doesn't support it (#1). Drawings excluded.
// Server Component; role owner/accountant.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, Card, EmptyState, KpiCard } from "@/components/ui";
import { StoryLine } from "@/components/StoryLine";
import { egp } from "@/lib/money";
import {
  parsePnlTimeseries,
  narratePeriods,
  costDisciplineThesis,
  bestUnitBenchmark,
  concentrationThesis,
  cropRoi,
  cropRoiThesis,
  type Thesis,
} from "@/lib/pnl-insights";
import { computeSectorPnl, computeEnterprisePnl, type SaleLite } from "@/lib/entity-pnl";
import type { CostCenterInsightRollup } from "@/lib/finance-insights";

const mutedStyle = { color: "var(--ink-muted)" } as const;

const DETAILS = [
  { href: "/finance/pnl-trend", icon: "📊", label: "اتجاه الأرباح", desc: "الإيراد والتكلفة والصافي عبر الفترات + منحنى J" },
  { href: "/finance/sector-scorecard", icon: "🏆", label: "أداء القطاعات", desc: "ترتيب القطاعات بالربح/فدان والفرصة الكامنة" },
  { href: "/finance/enterprise-scorecard", icon: "🌱", label: "اقتصاد المحاصيل", desc: "ربحية كل محصول وعائده على التكلفة" },
];

export default async function InsightsSummaryPage() {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const today = new Date();
  const from = `${today.getFullYear() - 4}-01-01`;
  const to = isoDate(today);

  const [tsRes, rollupRes, salesRes] = await Promise.all([
    sb.rpc("fn_pnl_timeseries", { p_org: m.orgId, p_grain: "year", p_from: from, p_to: to }),
    sb.from("v_cost_center_rollup").select("*").eq("org_id", m.orgId).order("sort_order", { ascending: true }),
    sb.from("sales").select("cost_center_id, total, price_status").eq("org_id", m.orgId).eq("price_status", "finalized"),
  ]);
  if (tsRes.error) throw tsRes.error;
  if (rollupRes.error) throw rollupRes.error;
  if (salesRes.error) throw salesRes.error;

  const ts = parsePnlTimeseries(tsRes.data);
  const ps = ts.periods;
  const latest = ps[ps.length - 1];
  const prev = ps.length >= 2 ? ps[ps.length - 2] : undefined;
  const narrative = latest && prev ? narratePeriods(prev, latest) : null;

  const rollup = (rollupRes.data ?? []) as CostCenterInsightRollup[];
  const sales = (salesRes.data ?? []) as SaleLite[];
  const { sectors } = computeSectorPnl(rollup, sales);
  const { enterprises } = computeEnterprisePnl(rollup, sales);
  const benchmark = bestUnitBenchmark(sectors);
  const cropRows = cropRoi(enterprises);

  // Every thesis that actually fires (each is null when the data doesn't support it — honest, no fabrication).
  const theses: Thesis[] = [costDisciplineThesis(ts), concentrationThesis(sectors), cropRoiThesis(cropRows)].filter(
    (t): t is Thesis => t != null,
  );

  const benchmarkPunchline =
    benchmark &&
    `لو بلغت كل القطاعات إنتاجية «${benchmark.benchmarkName}» (${egp(benchmark.benchmarkPerFeddan)} لكل فدان) ` +
      `لأضافت المزرعة فرصة قدرها ${egp(benchmark.impliedUpside)} — المزرعة في مرحلة نمو، والقطاع الأنضج يثبت نجاح النموذج.`;

  const hasAny = Boolean(narrative) || theses.length > 0 || Boolean(benchmark);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">ملخّص رؤى المالك</h1>
        <p style={mutedStyle}>
          أهمّ ما تقوله أرقام المزرعة الآن — من واقع القيود المُرحّلة والمبيعات المُسعّرة. المسحوبات لا تُحتسب،
          ولا تظهر أي رؤية إلا إذا دعمتها البيانات.
        </p>
      </header>

      {!hasAny ? (
        <Card title="ملخّص الرؤى">
          <EmptyState title="لا تتوفر بيانات كافية بعد لعرض رؤى — سجّل مبيعات ومصروفات موزّعة على المراكز أولًا." />
        </Card>
      ) : (
        <>
          {narrative && <StoryLine lead={narrative} />}

          {benchmark && (
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard label="القطاع الأفضل" value={benchmark.benchmarkName} icon="👑" />
              <KpiCard label="أفضل ربح/فدان" value={egp(benchmark.benchmarkPerFeddan)} icon="📈" />
              <KpiCard label="فرصة النمو الكامنة" value={egp(benchmark.impliedUpside)} icon="🚀" deltaDirection="up" />
            </section>
          )}

          {benchmarkPunchline && <Alert tone="info" title="النموذج والفرصة" description={benchmarkPunchline} />}

          {theses.map((t) => (
            <Alert key={t.key} tone={t.severity === "watch" ? "warning" : "info"} title={t.title} description={t.body} />
          ))}

          <Card title="اذهب إلى التفاصيل">
            <div className="grid gap-3 sm:grid-cols-3">
              {DETAILS.map((d) => (
                <Link
                  key={d.href}
                  href={d.href}
                  className="flex flex-col gap-1 rounded-md p-3"
                  style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
                >
                  <span className="font-semibold">{d.icon} {d.label}</span>
                  <span className="text-sm" style={mutedStyle}>{d.desc}</span>
                </Link>
              ))}
            </div>
          </Card>

          <p className="text-sm" style={mutedStyle}>
            الرؤى مبنية على قواعد ثابتة على أرقام فعلية — لا على تنبؤ ولا على ذكاء اصطناعي. تظهر كل رؤية فقط عند
            تحقق شرطها في البيانات.
          </p>
        </>
      )}
    </div>
  );
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
