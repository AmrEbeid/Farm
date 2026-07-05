import { moneyNumber } from "@/lib/money";

/** One category row on the budget-vs-actual report. */
export interface BudgetVsActualLine {
  category: string;
  planned: number;
  actual: number;
  variance: number; // planned − actual (positive = under budget)
  overBudget: boolean;
  unbudgeted: boolean; // posted spend with no budget line
}

/** The parsed `fn_budget_vs_actual` payload (SPEC-0004 Slice A). */
export interface BudgetVsActual {
  periodStart: string | null;
  periodEnd: string | null;
  lines: BudgetVsActualLine[];
  plannedTotal: number;
  actualTotal: number;
  varianceTotal: number;
}

function toMoney(value: unknown): number {
  if (typeof value === "number" || typeof value === "string") return moneyNumber(value) ?? 0;
  return 0;
}

function toDateString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toLines(value: unknown): BudgetVsActualLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      category: typeof row.category === "string" ? row.category : "",
      planned: toMoney(row.planned),
      actual: toMoney(row.actual),
      variance: toMoney(row.variance),
      overBudget: row.over_budget === true,
      unbudgeted: row.unbudgeted === true,
    };
  });
}

/**
 * Defensively parse the `fn_budget_vs_actual` RPC jsonb. Missing/malformed numbers become 0 (never NaN);
 * missing dates become null. Mirrors lib/income-statement.ts.
 */
export function parseBudgetVsActual(value: unknown): BudgetVsActual {
  const row =
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    periodStart: toDateString(row.period_start),
    periodEnd: toDateString(row.period_end),
    lines: toLines(row.lines),
    plannedTotal: toMoney(row.planned_total),
    actualTotal: toMoney(row.actual_total),
    varianceTotal: toMoney(row.variance_total),
  };
}
