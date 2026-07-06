// P&L trend (اتجاه الأرباح) — the first insight-layer surface (SPEC-0029 Phase 1). Reads the GL-backed
// fn_pnl_timeseries and turns it into a trend + cumulative (J-curve) chart, a deterministic Arabic narrator
// paragraph comparing the two latest periods, per-KPI traffic-light verdicts, and the cost-discipline thesis.
// No LLM, no fabrication — every figure is a posted-journal SUM (drawings excluded #6); honest-null throughout.
// Server Component; role enforced here AND in the RPC (finance.read).

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, Card, EmptyState, KpiCard } from "@/components/ui";
import { StoryLine } from "@/components/StoryLine";
import { FilterableTable } from "@/components/FilterableTable";
import { TrendLineChart } from "@/components/charts";
import { PrintButton } from "@/components/print-button";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { egp } from "@/lib/money";
import {
  parsePnlTimeseries,
  narratePeriods,
  costDisciplineThesis,
  pctChange,
  verdictForChange,
  type Verdict,
} from "@/lib/pnl-insights";

const mutedStyle = { color: "var(--ink-muted)" } as const;

const PNL_TREND_COLUMNS: SimpleColumn[] = [
  { id: "period", header: "الفترة" },
  { id: "revenue", header: "الإيرادات", kind: "money", numeric: true },
  { id: "expenses", header: "المصروفات", kind: "money", numeric: true },
  { id: "netIncome", header: "صافي الربح", kind: "money", numeric: true },
  { id: "cumulativeNetIncome", header: "الصافي التراكمي", kind: "money", numeric: true },
];

const VERDICT_ICON: Record<Verdict, string> = { good: "🟢", mixed: "🟡", bad: "🔴" };
function verdictIcon(metricKey: string, prev: number | undefined, curr: number | undefined): string {
  if (prev === undefined || curr === undefined) return "";
  const v = verdictForChange(metricKey, pctChange(prev, curr));
  return v ? VERDICT_ICON[v] : "";
}

export default async function FinancePnlTrendPage({
  searchParams,
}: {
  searchParams: Promise<{ grain?: string }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const params = await searchParams;
  const grain: "month" | "year" = params.grain === "year" ? "year" : "month";

  const today = new Date();
  const from =
    grain === "year"
      ? `${today.getFullYear() - 4}-01-01`
      : isoDate(new Date(today.getFullYear(), today.getMonth() - 11, 1));
  const to = isoDate(today);

  const res = await sb.rpc("fn_pnl_timeseries", { p_org: m.orgId, p_grain: grain, p_from: from, p_to: to });
  if (res.error) throw res.error;
  const ts = parsePnlTimeseries(res.data);
  const ps = ts.periods;
  const hasData = ps.some((p) => p.revenue !== 0 || p.expenses !== 0);
  const latest = ps[ps.length - 1];
  const prev = ps.length >= 2 ? ps[ps.length - 2] : undefined;

  const narrative = latest && prev ? narratePeriods(prev, latest) : null;
  const thesis = costDisciplineThesis(ts);

  const chartData = ps.map((p) => ({
    period: p.period,
    "الإيرادات": p.revenue,
    "المصروفات": p.expenses,
    "صافي الربح": p.net_income,
    "الصافي التراكمي": p.cumulative_net_income,
  }));
  const tableRows: SimpleRow[] = ps.map((p) => ({
    id: p.period,
    period: p.period,
    revenue: p.revenue,
    expenses: p.expenses,
    netIncome: p.net_income,
    cumulativeNetIncome: p.cumulative_net_income,
  }));

  const grainLabel = grain === "year" ? "سنوي" : "شهري";
  const otherGrain = grain === "year" ? "month" : "year";
  const otherGrainLabel = grain === "year" ? "شهري" : "سنوي";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">اتجاه الأرباح والخسائر</h1>
          <p style={mutedStyle}>
            الإيرادات والمصروفات وصافي الربح عبر الفترات ({grainLabel}) — من واقع القيود المُرحّلة. مسحوبات المالك
            ليست مصروفًا ولا تظهر هنا.
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <PrintButton label="طباعة الاتجاه" />
          <Link
            href={`/finance/pnl-trend?grain=${otherGrain}`}
            className="rounded-md px-3 py-2 text-sm font-semibold"
            style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
          >
            العرض {otherGrainLabel}
          </Link>
        </div>
      </header>

      {!hasData || !latest ? (
        <Card title="اتجاه الأرباح">
          <EmptyState title="لا توجد قيود مُرحّلة في هذه الفترة — لا اتجاه لعرضه بعد." />
        </Card>
      ) : (
        <>
          {narrative && <StoryLine lead={narrative} />}

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label={`إيرادات ${latest.period} ${verdictIcon("revenue", prev?.revenue, latest.revenue)}`} value={egp(latest.revenue)} icon="🧾" />
            <KpiCard label={`مصروفات ${latest.period} ${verdictIcon("expenses", prev?.expenses, latest.expenses)}`} value={egp(latest.expenses)} icon="📉" />
            <KpiCard label={`صافي ${latest.period}`} value={egp(latest.net_income)} icon="📈" deltaDirection={latest.net_income >= 0 ? "up" : "down"} />
            <KpiCard label="الصافي التراكمي" value={egp(latest.cumulative_net_income)} icon="🏦" deltaDirection={latest.cumulative_net_income >= 0 ? "up" : "down"} />
          </section>

          {thesis && (
            <Alert tone="warning" title={thesis.title} description={thesis.body} />
          )}

          <Card title="الاتجاه عبر الفترات">
            <TrendLineChart
              data={chartData}
              categoryKey="period"
              series={[
                { dataKey: "الإيرادات", name: "الإيرادات" },
                { dataKey: "المصروفات", name: "المصروفات" },
                { dataKey: "صافي الربح", name: "صافي الربح" },
              ]}
              overlaySeries={[{ dataKey: "الصافي التراكمي", name: "الصافي التراكمي (منحنى J)" }]}
              ariaLabel="اتجاه الإيرادات والمصروفات وصافي الربح"
              caption="الإيرادات والمصروفات وصافي الربح لكل فترة، مع منحنى الصافي التراكمي (منحنى J — يوضح نقطة التعادل)."
              columnHeader="الفترة"
            />
          </Card>

          <Card title="بيانات الاتجاه">
            <FilterableTable
              columns={PNL_TREND_COLUMNS}
              rows={tableRows}
              ariaLabel="بيانات اتجاه الأرباح والخسائر"
              exportFilename={`pnl-trend-${grain}`}
              minRowsForSearch={1}
              empty="لا توجد فترات"
            />
          </Card>

          <p className="text-sm" style={mutedStyle}>
            صافي الربح هنا يطابق صافي الربح في قائمة الدخل لنفس الفترة. القيود المعكوسة والمسحوبات لا تُحتسب.
            {" "}
            <Link href="/finance/income-statement" className="no-print font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>
              قائمة الدخل ←
            </Link>
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
