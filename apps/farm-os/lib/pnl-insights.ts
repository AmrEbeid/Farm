// Deterministic P&L insight engine (SPEC-0029 Phase 1) over fn_pnl_timeseries output.
//
// Pure functions, NO LLM, NO fabrication: a traffic-light verdict engine, a templated Arabic narrator, and
// the cost-discipline thesis detector. Honest-null (#1) throughout — a metric with no usable baseline yields
// `null` (the UI renders "—"/neutral), never a fabricated grade or figure. All money/number formatting goes
// through lib/money (Arabic-Indic, honest-null). Owner drawings never enter these numbers — they come from
// fn_pnl_timeseries, which excludes equity by construction (#6).

import { egp, num } from "./money";

export interface PnlPeriod {
  period: string; // "YYYY" or "YYYY-MM"
  revenue: number;
  expenses: number;
  operating_expenses: number;
  net_income: number;
  cumulative_net_income: number;
}

export interface PnlTimeseries {
  grain: "month" | "year";
  period_start: string;
  period_end: string;
  periods: PnlPeriod[];
}

export type Verdict = "good" | "mixed" | "bad";

/** Net margin as a FRACTION (0..1), or null when there is no revenue base — 0/0 is "unknown", not "fine" (#1). */
export function marginFraction(p: Pick<PnlPeriod, "revenue" | "net_income">): number | null {
  return p.revenue > 0 ? p.net_income / p.revenue : null;
}

/** Percent change from→to, or null when there is no usable baseline (honest-null). Uses |from| so the sign is
 *  intuitive even if the baseline is negative. */
export function pctChange(from: number, to: number): number | null {
  if (!Number.isFinite(from) || from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

// Metrics where an INCREASE is unfavourable (cost-like) → the verdict is inverted (a cost rise is "bad").
const COST_LIKE = new Set(["expenses", "operating_expenses", "cost", "costs", "costPerFeddan"]);

/** Traffic-light verdict for a metric's period-over-period change. `margin` is special (percentage POINTS).
 *  A null/NaN change → null verdict (no baseline; the caller renders neutral/"—") — never a fabricated grade. */
export function verdictForChange(metricKey: string, change: number | null): Verdict | null {
  if (change === null || !Number.isFinite(change)) return null;
  if (metricKey === "margin") {
    if (change > 1) return "good";
    if (change > -3) return "mixed";
    return "bad";
  }
  const effective = COST_LIKE.has(metricKey) ? -change : change;
  if (effective > 5) return "good";
  if (effective > -2) return "mixed";
  return "bad";
}

/** Format a percent number as Arabic-Indic with 1 dp + ٪, honest-null. */
export function pctAr(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "—" : `${num(n, 1)}٪`;
}

/** Deterministic Arabic narrator paragraph comparing two periods — the analyst's voice, grounded + auditable
 *  (no LLM). Three branches: both-profit / turnaround (loss→profit) / loss-year. Figures via lib/money. */
export function narratePeriods(prev: PnlPeriod, curr: PnlPeriod): string {
  const revChange = pctChange(prev.revenue, curr.revenue);
  const costChange = pctChange(prev.expenses, curr.expenses);
  const mPrev = marginFraction(prev);
  const mCurr = marginFraction(curr);

  if (curr.net_income > 0 && prev.net_income > 0) {
    const profitDir = curr.net_income >= prev.net_income ? "ارتفع" : "انخفض";
    const marginDir = mPrev != null && mCurr != null ? (mCurr >= mPrev ? "تتوسّع" : "تنكمش") : "—";
    const discipline =
      revChange != null && costChange != null && costChange > revChange
        ? "نمو التكاليف تجاوز نمو الإيرادات — راقب انضباط التكلفة (العمالة والمشتريات تحديدًا)."
        : "نمو الإيرادات تجاوز التكاليف — رافعة تشغيلية قوية.";
    return (
      `شهد ${curr.period} نمو الإيرادات بنسبة ${pctAr(revChange)} إلى ${egp(curr.revenue)}، ` +
      `بينما نمت التكاليف ${pctAr(costChange)}. ${profitDir} صافي الربح إلى ${egp(curr.net_income)}، ` +
      `والهوامش ${marginDir} من ${pctAr(mPrev == null ? null : mPrev * 100)} إلى ` +
      `${pctAr(mCurr == null ? null : mCurr * 100)}. ${discipline}`
    );
  }

  if (curr.net_income > 0 && prev.net_income <= 0) {
    return (
      `تحوّل في ${curr.period}: انتقلت المزرعة من خسارة ${egp(Math.abs(prev.net_income))} ` +
      `إلى ربح ${egp(curr.net_income)}. نمت الإيرادات ${pctAr(revChange)} والتكاليف ${pctAr(costChange)}.`
    );
  }

  const revDir = revChange != null && revChange >= 0 ? "نمت" : "تراجعت";
  return (
    `${curr.period} كان صعبًا بصافي خسارة ${egp(Math.abs(curr.net_income))}. ` +
    `${revDir} الإيرادات ${pctAr(revChange == null ? null : Math.abs(revChange))} ` +
    `والتكاليف عند ${egp(curr.expenses)}. ركّز على ضبط المصروفات ورفع إنتاجية القطاعات الأضعف.`
  );
}

export interface Thesis {
  key: string;
  severity: "watch" | "info";
  title: string;
  body: string;
}

/** Cost-discipline thesis (SPEC-0029 detector #5): fires when cost growth outpaces revenue growth across the
 *  series. Deterministic + grounded; returns null when there is no baseline or costs did not outpace (honest). */
export function costDisciplineThesis(series: PnlTimeseries): Thesis | null {
  const ps = series.periods;
  if (ps.length < 2) return null;
  const first = ps[0];
  const last = ps[ps.length - 1];
  const revChange = pctChange(first.revenue, last.revenue);
  const costChange = pctChange(first.expenses, last.expenses);
  if (revChange == null || costChange == null) return null;
  if (costChange <= revChange) return null;
  return {
    key: "cost_watch",
    severity: "watch",
    title: "مراقبة انضباط التكلفة",
    body:
      `نمت التكاليف ${pctAr(costChange)} مقابل نمو الإيرادات ${pctAr(revChange)} خلال الفترة — ` +
      `نسبة التكلفة إلى الإيراد ترتفع. هل هذا استثمار للنمو أم تراجع في الكفاءة؟ راقب النسبة عن قرب.`,
  };
}
