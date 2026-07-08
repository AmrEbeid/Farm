// SPEC-0029/0031 — بطاقة الأداء: a year-vs-year scorecard. Two periods, one glance: each core metric with a
// traffic-light verdict + the deterministic Arabic narrator paragraph (the analyst's voice, no LLM). Every
// figure is a posted-journal SUM from fn_pnl_timeseries (drawings excluded #6, honest-null #1). Per-feddan is
// deliberately NOT shown at farm level: overlapping enterprises share the same land, so a farm-total feddan
// denominator would be a fabricated ratio (#1) — per-feddan lives at the sector level where each center's own
// area is honest. Server Component; role enforced here AND in the RPC (finance.read).

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState } from "@/components/ui";
import { StoryLine } from "@/components/StoryLine";
import { PrintButton } from "@/components/print-button";
import { egp } from "@/lib/money";
import {
  parsePnlTimeseries,
  narratePeriods,
  marginFraction,
  pctChange,
  pctAr,
  verdictForChange,
  type PnlPeriod,
  type Verdict,
} from "@/lib/pnl-insights";

const VERDICT_ICON: Record<Verdict, string> = { good: "🟢", mixed: "🟡", bad: "🔴" };
const mutedStyle = { color: "var(--ink-muted)" } as const;

interface MetricRow {
  key: string;
  label: string;
  format: (v: number) => string;
  valueA: number;
  valueB: number;
  /** already-computed change (percent, or percentage-points for margin) */
  change: number | null;
  /** display of the change */
  changeText: string;
}

function buildRows(a: PnlPeriod, b: PnlPeriod): MetricRow[] {
  const mA = marginFraction(a);
  const mB = marginFraction(b);
  const marginPoints = mA != null && mB != null ? (mB - mA) * 100 : null;
  return [
    {
      key: "revenue",
      label: "إجمالي الإيرادات",
      format: egp,
      valueA: a.revenue,
      valueB: b.revenue,
      change: pctChange(a.revenue, b.revenue),
      changeText: pctAr(pctChange(a.revenue, b.revenue)),
    },
    {
      key: "expenses",
      label: "إجمالي المصروفات",
      format: egp,
      valueA: a.expenses,
      valueB: b.expenses,
      change: pctChange(a.expenses, b.expenses),
      changeText: pctAr(pctChange(a.expenses, b.expenses)),
    },
    {
      key: "net_income",
      label: "صافي الربح",
      format: egp,
      valueA: a.net_income,
      valueB: b.net_income,
      change: pctChange(a.net_income, b.net_income),
      changeText: pctAr(pctChange(a.net_income, b.net_income)),
    },
    {
      key: "margin",
      label: "هامش الربح",
      format: (v) => pctAr(v),
      valueA: mA == null ? NaN : mA * 100,
      valueB: mB == null ? NaN : mB * 100,
      change: marginPoints,
      changeText: marginPoints == null ? "—" : `${marginPoints >= 0 ? "+" : ""}${pctAr(marginPoints)}`,
    },
  ];
}

export default async function ScorecardPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const params = await searchParams;

  const nowYear = new Date().getFullYear();
  const res = await sb.rpc("fn_pnl_timeseries", {
    p_org: m.orgId,
    p_grain: "year",
    p_from: "2017-01-01",
    p_to: `${nowYear}-12-31`,
  });
  if (res.error) throw res.error;
  const ts = parsePnlTimeseries(res.data);
  const withData = ts.periods.filter((p) => p.revenue !== 0 || p.expenses !== 0);
  const years = withData.map((p) => p.period);

  const byPeriod = new Map(withData.map((p) => [p.period, p]));
  const defaultB = years[years.length - 1];
  const defaultA = years.length >= 2 ? years[years.length - 2] : defaultB;
  const yearA = params.a && byPeriod.has(params.a) ? params.a : defaultA;
  const yearB = params.b && byPeriod.has(params.b) ? params.b : defaultB;
  const a = byPeriod.get(yearA);
  const b = byPeriod.get(yearB);

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>
            بطاقة الأداء
          </h1>
          <p style={mutedStyle}>
            سنة مقابل سنة، بلمحة واحدة — كل مؤشر بإشارة ملوّنة وملخّص مكتوب. الأرقام من القيود المُرحّلة؛
            مسحوبات المالك ليست مصروفًا.
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <PrintButton label="طباعة البطاقة" />
        </div>
      </header>

      {years.length < 2 || !a || !b ? (
        <Card title="بطاقة الأداء">
          <EmptyState title="تحتاج سنتين بهما قيود مُرحّلة على الأقل للمقارنة." />
        </Card>
      ) : (
        <>
          <Card>
            <form method="get" className="no-print flex flex-wrap items-end gap-3 p-1">
              <label className="flex flex-col gap-1 text-sm">
                <span style={mutedStyle}>السنة (أ)</span>
                <select name="a" defaultValue={yearA} dir="ltr" className="rounded-md px-3 py-2" style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </label>
              <span className="pb-2 font-bold" style={mutedStyle}>مقابل</span>
              <label className="flex flex-col gap-1 text-sm">
                <span style={mutedStyle}>السنة (ب)</span>
                <select name="b" defaultValue={yearB} dir="ltr" className="rounded-md px-3 py-2" style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </label>
              <button type="submit" className="rounded-md px-4 py-2 text-sm font-bold" style={{ background: "var(--brand)", color: "#fff" }}>
                قارن
              </button>
            </form>
          </Card>

          <StoryLine lead={narratePeriods(a, b)} />

          <Card title={`${yearA} ← → ${yearB}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" dir="rtl">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--line)" }}>
                    <th className="p-2 text-start font-bold" style={mutedStyle}>المقياس</th>
                    <th className="p-2 text-start font-bold" dir="ltr" style={{ color: "var(--ink-muted)" }}>{yearA}</th>
                    <th className="p-2 text-start font-bold" dir="ltr" style={{ color: "var(--ink)" }}>{yearB}</th>
                    <th className="p-2 text-start font-bold" style={mutedStyle}>التغيّر</th>
                    <th className="p-2 text-center font-bold" style={mutedStyle}>⬤</th>
                  </tr>
                </thead>
                <tbody>
                  {buildRows(a, b).map((row) => {
                    const v = verdictForChange(row.key, row.change);
                    return (
                      <tr key={row.key} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td className="p-2 font-semibold" style={{ color: "var(--ink)" }}>{row.label}</td>
                        <td className="p-2" dir="ltr" style={mutedStyle}>{Number.isFinite(row.valueA) ? row.format(row.valueA) : "—"}</td>
                        <td className="p-2 font-bold" dir="ltr" style={{ color: "var(--ink)" }}>{Number.isFinite(row.valueB) ? row.format(row.valueB) : "—"}</td>
                        <td className="p-2" dir="ltr" style={mutedStyle}>{row.changeText}</td>
                        <td className="p-2 text-center">{v ? VERDICT_ICON[v] : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <p className="text-sm" style={mutedStyle}>
            صافي الربح يطابق قائمة الدخل لنفس السنة.{" "}
            <Link href="/finance/income-statement" className="no-print font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>
              قائمة الدخل ←
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
