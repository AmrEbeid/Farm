import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
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

const columns: SimpleColumn[] = [
  { id: "period", header: "الفترة" },
  { id: "revenue", header: "الإيرادات", kind: "money", numeric: true },
  { id: "expenses", header: "المصروفات", kind: "money", numeric: true },
  { id: "netIncome", header: "صافي الربح", kind: "money", numeric: true },
  { id: "cumulativeNetIncome", header: "الصافي التراكمي", kind: "money", numeric: true },
];

const verdictIcons: Record<Verdict, string> = { good: "🟢", mixed: "🟡", bad: "🔴" };

function verdictIcon(metricKey: string, previous: number | undefined, current: number | undefined): string {
  if (previous === undefined || current === undefined) return "";
  const verdict = verdictForChange(metricKey, pctChange(previous, current));
  return verdict ? verdictIcons[verdict] : "";
}

export async function FinancePnlTrend({ orgId, grain }: { orgId: string; grain: "month" | "year" }) {
  const sb = await createClient();
  const today = new Date();
  const from =
    grain === "year"
      ? `${today.getFullYear() - 4}-01-01`
      : isoDate(new Date(today.getFullYear(), today.getMonth() - 11, 1));
  const to = isoDate(today);
  const res = await sb.rpc("fn_pnl_timeseries", { p_org: orgId, p_grain: grain, p_from: from, p_to: to });
  if (res.error) throw res.error;

  const timeseries = parsePnlTimeseries(res.data);
  const periods = timeseries.periods;
  const hasData = periods.some((period) => period.revenue !== 0 || period.expenses !== 0);
  const latest = periods[periods.length - 1];
  const previous = periods.length >= 2 ? periods[periods.length - 2] : undefined;
  const narrative = latest && previous ? narratePeriods(previous, latest) : null;
  const thesis = costDisciplineThesis(timeseries);
  const grainLabel = grain === "year" ? "سنوي" : "شهري";
  const otherGrain = grain === "year" ? "month" : "year";
  const otherGrainLabel = grain === "year" ? "شهري" : "سنوي";

  const chartData = periods.map((period) => ({
    period: period.period,
    "الإيرادات": period.revenue,
    "المصروفات": period.expenses,
    "صافي الربح": period.net_income,
    "الصافي التراكمي": period.cumulative_net_income,
  }));
  const tableRows: SimpleRow[] = periods.map((period) => ({
    id: period.period,
    period: period.period,
    revenue: period.revenue,
    expenses: period.expenses,
    netIncome: period.net_income,
    cumulativeNetIncome: period.cumulative_net_income,
  }));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">قائمة الدخل (الأرباح والخسائر)</h1>
          <p style={mutedStyle}>
            اتجاه الإيرادات والمصروفات وصافي الربح ({grainLabel}) من القيود المُرحّلة. مسحوبات المالك لا تظهر هنا.
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <Link href="/finance/income-statement" className="rounded-md px-3 py-2 text-sm font-semibold" style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
            عرض القائمة
          </Link>
          <PrintButton label="طباعة الاتجاه" />
          <Link href={`/finance/income-statement?view=trend&grain=${otherGrain}`} className="rounded-md px-3 py-2 text-sm font-semibold" style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
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
            <KpiCard label={`إيرادات ${latest.period} ${verdictIcon("revenue", previous?.revenue, latest.revenue)}`} value={egp(latest.revenue)} icon="🧾" />
            <KpiCard label={`مصروفات ${latest.period} ${verdictIcon("expenses", previous?.expenses, latest.expenses)}`} value={egp(latest.expenses)} icon="📉" />
            <KpiCard label={`صافي ${latest.period}`} value={egp(latest.net_income)} icon="📈" deltaDirection={latest.net_income >= 0 ? "up" : "down"} />
            <KpiCard label="الصافي التراكمي" value={egp(latest.cumulative_net_income)} icon="🏦" deltaDirection={latest.cumulative_net_income >= 0 ? "up" : "down"} />
          </section>
          {thesis && <Alert tone="warning" title={thesis.title} description={thesis.body} />}
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
              caption="الإيرادات والمصروفات وصافي الربح لكل فترة، مع منحنى الصافي التراكمي الذي يوضح نقطة التعادل."
              columnHeader="الفترة"
            />
          </Card>
          <Card title="بيانات الاتجاه">
            <FilterableTable columns={columns} rows={tableRows} ariaLabel="بيانات اتجاه الأرباح والخسائر" exportFilename={`pnl-trend-${grain}`} minRowsForSearch={1} empty="لا توجد فترات" />
          </Card>
          <p className="text-sm" style={mutedStyle}>
            صافي الربح يطابق عرض القائمة لنفس الفترة. القيود المعكوسة والمسحوبات لا تُحتسب.
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
