// SPEC-0031 — التقرير السنوي: the year's story in one page. A magazine-style cover (record revenue + growth),
// the multi-year revenue/profit journey, sector contribution, and lifetime stats — all DB-derived (#1): the
// financials from fn_pnl_timeseries (posted journal, drawings excluded #6), sector profit from computeSectorPnl,
// planted area from the «عام» cost centers. No hardcoded/modeled figures. Server Component; role owner/accountant.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { StoryLine } from "@/components/StoryLine";
import { TrendLineChart } from "@/components/charts";
import { PrintButton } from "@/components/print-button";
import { egp, num, pct } from "@/lib/money";
import { parsePnlTimeseries, pctChange } from "@/lib/pnl-insights";
import { computeSectorPnl } from "@/lib/entity-pnl";
import type { CostCenterInsightRollup } from "@/lib/finance-insights";

const mutedStyle = { color: "var(--ink-muted)" } as const;
type SaleRow = { cost_center_id: string | null; total: number | null; price_status: string };
type AreaRow = { area_feddan: number | null };

export default async function AnnualReportPage() {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const nowYear = new Date().getFullYear();

  const [tsRes, rollupRes, salesRes, areaRes] = await Promise.all([
    sb.rpc("fn_pnl_timeseries", { p_org: m.orgId, p_grain: "year", p_from: "2017-01-01", p_to: `${nowYear}-12-31` }),
    sb.from("v_cost_center_rollup").select("*").eq("org_id", m.orgId).order("sort_order", { ascending: true }),
    sb.from("sales").select("cost_center_id, total, price_status").eq("org_id", m.orgId).eq("price_status", "finalized"),
    sb.from("cost_centers").select("area_feddan").eq("org_id", m.orgId).eq("active", true).eq("enterprise", "عام").not("area_feddan", "is", null),
  ]);
  if (tsRes.error) throw tsRes.error;
  if (rollupRes.error) throw rollupRes.error;
  if (salesRes.error) throw salesRes.error;

  const ts = parsePnlTimeseries(tsRes.data);
  const withRevenue = ts.periods.filter((p) => p.revenue > 0);
  const report = withRevenue[withRevenue.length - 1]; // latest year with actual revenue = the "report year"
  const prev = withRevenue.length >= 2 ? withRevenue[withRevenue.length - 2] : undefined;
  const revGrowth = prev ? pctChange(prev.revenue, report?.revenue ?? 0) : null;

  const activeYears = ts.periods.filter((p) => p.revenue !== 0 || p.expenses !== 0);
  const lifetimeRevenue = activeYears.reduce((s, p) => s + p.revenue, 0);
  const cumulativeProfit = activeYears.length ? activeYears[activeYears.length - 1].cumulative_net_income : 0;
  const yearsOfOps = activeYears.length;

  const rollup = (rollupRes.data ?? []) as CostCenterInsightRollup[];
  const sales = (salesRes.data ?? []) as SaleRow[];
  const { sectors } = computeSectorPnl(rollup, sales);
  const topSectors = [...sectors].sort((a, b) => b.net - a.net).slice(0, 6);
  const maxSectorNet = Math.max(1, ...topSectors.map((s) => Math.abs(s.net)));

  const plantedFeddan = ((areaRes.data ?? []) as AreaRow[]).reduce((s, r) => s + (r.area_feddan ?? 0), 0);

  const chartData = activeYears.map((p) => ({
    period: p.period,
    "الإيرادات": p.revenue,
    "صافي الربح": p.net_income,
    "التراكمي": p.cumulative_net_income,
  }));

  if (!report) {
    return (
      <div className="p-6">
        <Card title="التقرير السنوي">
          <EmptyState title="لا توجد سنة مكتملة بإيراد مُرحّل لعرض تقريرها بعد." />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="no-print flex items-center justify-end">
        <PrintButton label="طباعة التقرير" />
      </header>

      {/* Cover */}
      <Card>
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <div className="text-sm font-bold" style={mutedStyle}>مزارع عبيد · تقرير الأداء السنوي {report.period}</div>
          <div className="text-xs" style={mutedStyle}>مزرعة نخيل برحي · صعيد مصر</div>
          <div className="mt-3 text-xs font-bold" style={mutedStyle}>الإيراد</div>
          <div className="text-4xl font-black" dir="ltr" style={{ color: "var(--ink)" }}>{egp(report.revenue)}</div>
          <div className="text-sm font-bold" style={{ color: report.net_income >= 0 ? "var(--brand, #1e6b3a)" : "#b91c1c" }}>
            صافي الربح {egp(report.net_income)}
            {revGrowth != null ? ` · نمو الإيراد ${revGrowth >= 0 ? "▲" : "▼"} ${pct(Math.abs(revGrowth) / 100)}` : ""}
          </div>
        </div>
      </Card>

      <StoryLine
        lead={
          `في ${report.period} بلغت إيرادات المزرعة ${egp(report.revenue)}` +
          (revGrowth != null ? ` بنمو ${pct(Math.abs(revGrowth) / 100)} عن العام السابق` : "") +
          `، وصافي ربح ${egp(report.net_income)}. الربح التراكمي منذ بداية التشغيل ${egp(cumulativeProfit)}.`
        }
      />

      {/* Revenue journey */}
      <Card title={`رحلة الإيرادات · ${activeYears[0]?.period}–${activeYears[activeYears.length - 1]?.period}`}>
        <TrendLineChart
          data={chartData}
          categoryKey="period"
          series={[
            { dataKey: "الإيرادات", name: "الإيرادات" },
            { dataKey: "صافي الربح", name: "صافي الربح" },
          ]}
          overlaySeries={[{ dataKey: "التراكمي", name: "الربح التراكمي" }]}
          ariaLabel="رحلة الإيرادات وصافي الربح عبر السنوات"
          caption="الإيرادات وصافي الربح لكل سنة مع منحنى الربح التراكمي."
          columnHeader="السنة"
        />
      </Card>

      {/* Sector contribution */}
      <Card title="مساهمة القطاعات في الربح">
        <div className="flex flex-col gap-2 p-1">
          {topSectors.map((s) => {
            const w = Math.max(2, (Math.abs(s.net) / maxSectorNet) * 100);
            const positive = s.net >= 0;
            return (
              <div key={s.id} className="flex items-center gap-3">
                <div className="w-32 shrink-0 truncate text-sm font-semibold" style={{ color: "var(--ink)" }}>{s.name}</div>
                <div className="h-4 flex-1 overflow-hidden rounded" style={{ background: "var(--surface-sunken, #eef1ef)" }}>
                  <div className="h-full rounded" style={{ width: `${w}%`, background: positive ? "var(--brand, #1e6b3a)" : "#b91c1c" }} />
                </div>
                <div className="w-24 shrink-0 text-start text-sm font-bold" dir="ltr" style={{ color: positive ? "var(--ink)" : "#b91c1c" }}>{egp(s.net)}</div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Lifetime stats */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="سنوات بها نشاط" value={num(yearsOfOps)} icon="📅" />
        <KpiCard label="إجمالي الإيرادات" value={egp(lifetimeRevenue)} icon="💰" />
        <KpiCard label="الربح التراكمي" value={egp(cumulativeProfit)} icon="🏦" deltaDirection={cumulativeProfit >= 0 ? "up" : "down"} />
        <KpiCard label="المساحة المزروعة" value={`${num(plantedFeddan, 1)} فدان`} icon="🗺️" />
      </section>

      <p className="text-sm" style={mutedStyle}>
        كل الأرقام من القيود المُرحّلة؛ مسحوبات المالك ورؤوس الأموال ليست ضمن الأرباح.{" "}
        <Link href="/insights/benchmark" className="no-print font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>
          المقارنة الداخلية ←
        </Link>
        {" · "}
        <Link href="/farm/offshoots" className="no-print font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>
          بنك الفسائل ←
        </Link>
      </p>
    </div>
  );
}
