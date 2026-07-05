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

const numberOf = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};

/** Safely parse the fn_pnl_timeseries jsonb payload into a typed PnlTimeseries. Defensive (the RPC returns
 *  numeric JSON as strings/numbers); a malformed/empty payload yields an empty periods array, never a throw. */
export function parsePnlTimeseries(raw: unknown): PnlTimeseries {
  const o = (raw ?? {}) as Record<string, unknown>;
  const grain = o.grain === "year" ? "year" : "month";
  const rawPeriods = Array.isArray(o.periods) ? o.periods : [];
  const periods: PnlPeriod[] = rawPeriods
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p) => ({
      period: typeof p.period === "string" ? p.period : "",
      revenue: numberOf(p.revenue),
      expenses: numberOf(p.expenses),
      operating_expenses: numberOf(p.operating_expenses),
      net_income: numberOf(p.net_income),
      cumulative_net_income: numberOf(p.cumulative_net_income),
    }))
    .filter((p) => p.period !== "");
  return {
    grain,
    period_start: typeof o.period_start === "string" ? o.period_start : "",
    period_end: typeof o.period_end === "string" ? o.period_end : "",
    periods,
  };
}

// ── Per-center (per-sector) performance: the best-unit benchmark + concentration theses (SPEC-0029) ──
// The `net` these consume MUST be the center's real PROFIT (revenue − expenses). ⚠️ Do NOT pass
// `v_cost_center_rollup.net` directly: that column is `sum(debit) − sum(credit)` over the expense/revenue
// lines *tagged to the center*, and revenue is NOT posted to cost-center journal lines (it's a reporting
// dimension on `sales`; the GL posts revenue to summary accounts) — so the rollup net is EXPENSES-only and
// positive. A caller must build profit itself (sales revenue grouped by cost_center_id − tagged expenses) at
// a consistent granularity, and surface unallocated costs/revenue honestly (#1). Feeding cost as profit would
// invert the ranking and fabricate a per-sector figure — the exact sin these theses exist to avoid.

export interface CenterPerf {
  id: string;
  name: string;
  net: number; // the center's PROFIT (revenue − expenses) — see the ⚠️ above; NOT v_cost_center_rollup.net
  areaFeddan: number; // > 0 for a real sector; 0/unknown → excluded from per-feddan math
}

/** Profit per feddan, or null when there is no area to normalize by (honest-null — never net/0). */
export function profitPerFeddan(c: CenterPerf): number | null {
  return c.areaFeddan > 0 ? c.net / c.areaFeddan : null;
}

export type SectorStatus = "crown" | "strong" | "recovering" | "attention";

/** Auto status badge for a sector, relative to the best-unit benchmark (the prototype's Crown Jewel /
 *  Recovering / Needs Attention ladder). Null when it can't be graded (no per-feddan or no positive benchmark). */
export function sectorStatus(perFeddan: number | null, benchmarkPerFeddan: number): SectorStatus | null {
  if (perFeddan == null || !Number.isFinite(perFeddan) || !(benchmarkPerFeddan > 0)) return null;
  const ratio = perFeddan / benchmarkPerFeddan;
  if (ratio >= 0.9) return "crown";
  if (ratio >= 0.4) return "strong";
  if (perFeddan > 0) return "recovering";
  return "attention";
}

export interface BenchmarkRow {
  id: string;
  name: string;
  perFeddan: number;
  gap: number; // benchmark − this center's perFeddan
  upside: number; // max(0, gap × area) — the EGP this center would add at benchmark productivity
}

export interface BenchmarkResult {
  benchmarkName: string;
  benchmarkPerFeddan: number;
  totalArea: number;
  currentTotalNet: number;
  fullPotential: number; // totalArea × benchmarkPerFeddan
  impliedUpside: number; // max(0, fullPotential − currentTotalNet)
  rows: BenchmarkRow[];
}

/** Internal "best-unit" benchmark (the prototype's crown-jewel thesis): take the top profit/feddan among
 *  centers WITH area, and compute each center's gap-to-best and implied upside (gap × area). Returns null when
 *  there are <2 comparable units or the best unit isn't profitable (no honest upside story to tell). */
export function bestUnitBenchmark(centers: CenterPerf[]): BenchmarkResult | null {
  const withArea = centers.filter((c) => c.areaFeddan > 0 && Number.isFinite(c.net));
  if (withArea.length < 2) return null;
  const perF = withArea.map((c) => ({ c, pf: c.net / c.areaFeddan }));
  const best = perF.reduce((a, b) => (b.pf > a.pf ? b : a));
  if (!(best.pf > 0)) return null;
  const totalArea = withArea.reduce((s, c) => s + c.areaFeddan, 0);
  const currentTotalNet = withArea.reduce((s, c) => s + c.net, 0);
  const fullPotential = totalArea * best.pf;
  return {
    benchmarkName: best.c.name,
    benchmarkPerFeddan: best.pf,
    totalArea,
    currentTotalNet,
    fullPotential,
    impliedUpside: Math.max(0, fullPotential - currentTotalNet),
    rows: perF.map(({ c, pf }) => ({
      id: c.id,
      name: c.name,
      perFeddan: pf,
      gap: best.pf - pf,
      upside: Math.max(0, (best.pf - pf) * c.areaFeddan),
    })),
  };
}

/** Concentration / crown-jewel thesis: fires when one center contributes a dominant share (≥40%) of total
 *  POSITIVE net — the "the model works, others are maturing" framing. Returns null when nothing is
 *  concentrated (or no positive net at all — honest, no fabricated leader). */
export function concentrationThesis(centers: CenterPerf[]): Thesis | null {
  const positive = centers.filter((c) => c.net > 0);
  if (positive.length < 2) return null;
  const totalNet = positive.reduce((s, c) => s + c.net, 0);
  if (totalNet <= 0) return null;
  const top = positive.reduce((a, b) => (b.net > a.net ? b : a));
  const share = top.net / totalNet;
  if (share < 0.4) return null;
  const totalArea = centers.reduce((s, c) => s + (c.areaFeddan > 0 ? c.areaFeddan : 0), 0);
  const areaShare = totalArea > 0 && top.areaFeddan > 0 ? top.areaFeddan / totalArea : null;
  const onArea = areaShare != null ? ` على ${pctAr(areaShare * 100)} فقط من المساحة` : "";
  return {
    key: "concentration",
    severity: "info",
    title: "قطاع الصدارة",
    body:
      `${top.name} يحقق ${pctAr(share * 100)} من صافي الربح${onArea} — النموذج الأنضج والأعلى إنتاجية. ` +
      `مع نضج باقي القطاعات يمكن أن تقترب من نفس الإنتاجية.`,
  };
}

// ── Crop / enterprise ROI (SPEC-0029 detector #3) ──────────────────────────────────────────────────
// Same honesty contract as CenterPerf: `revenue`/`expenses` MUST be the real per-enterprise figures the caller
// attributes (revenue from sales via the sale's cost center's `enterprise`; expenses from cost-center rollup
// grouped by `enterprise`). margin = profit/revenue, roi = profit/expenses — both null with no base (#1).

export interface EnterprisePerf {
  key: string; // enterprise / crop label (نخيل / بنجر / موالح …)
  revenue: number;
  expenses: number;
}

export interface CropRoiRow {
  key: string;
  revenue: number;
  expenses: number;
  profit: number;
  margin: number | null; // profit / revenue
  roi: number | null; // profit / expenses
}

/** Per-enterprise profit, margin and ROI. Deterministic; honest-null where there is no base to divide by. */
export function cropRoi(enterprises: EnterprisePerf[]): CropRoiRow[] {
  return enterprises.map((e) => {
    const profit = e.revenue - e.expenses;
    return {
      key: e.key,
      revenue: e.revenue,
      expenses: e.expenses,
      profit,
      margin: e.revenue > 0 ? profit / e.revenue : null,
      roi: e.expenses > 0 ? profit / e.expenses : null,
    };
  });
}

/** Crop-mix ROI-imbalance thesis: fires when the highest-REVENUE crop earns a much lower ROI than the
 *  best-ROI crop (the prototype's "dates are prestige, the rotation crop is the profit engine" finding).
 *  Returns null when there's no imbalance, <2 comparable crops, or the leader is also the best ROI. */
export function cropRoiThesis(rows: CropRoiRow[]): Thesis | null {
  const withRoi = rows.filter((r) => r.roi != null && r.revenue > 0);
  if (withRoi.length < 2) return null;
  const byRevenue = withRoi.reduce((a, b) => (b.revenue > a.revenue ? b : a));
  const byRoi = withRoi.reduce((a, b) => ((b.roi ?? -Infinity) > (a.roi ?? -Infinity) ? b : a));
  if (byRevenue.key === byRoi.key) return null;
  // require a meaningful gap: the best ROI is at least ~2× the leader's, and the leader's ROI is positive-ish.
  if ((byRoi.roi ?? 0) < (byRevenue.roi ?? 0) * 2) return null;
  return {
    key: "crop_roi",
    severity: "info",
    title: "توازن المحاصيل",
    body:
      `«${byRevenue.key}» هو المحصول الأكبر إيرادًا لكن عائده على التكلفة ${pctAr((byRevenue.roi ?? 0) * 100)} فقط، ` +
      `بينما «${byRoi.key}» يحقق ${pctAr((byRoi.roi ?? 0) * 100)} — فكّر في التوسّع في المحاصيل الأعلى عائدًا حيث تسمح المساحات.`,
  };
}
