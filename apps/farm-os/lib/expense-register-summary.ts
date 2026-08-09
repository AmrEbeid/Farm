import { parseDecimal, sumDecimals, type DecimalString } from "./decimal";

export const EXPENSE_REGISTER_DISPLAY_CAP = 200;

export interface ExpenseRegisterSummary {
  expenseCount: number;
  monthCount: number;
  operatingCount: number;
  drawingCount: number | null;
  unroutedCount: number;
  unclassifiedCount: number;
  uncenteredCount: number;
  /** Sum over every visible non-drawing row (operating AND capex) in the current month — never operating-only. */
  monthNonDrawingTotal: DecimalString;
  monthNonDrawingUnknownCount: number;
  monthDrawingTotal: DecimalString | null;
  monthDrawingUnknownCount: number | null;
  unpaidOperatingCount: number;
  unpaidOperatingTotal: DecimalString;
  unpaidOperatingUnknownCount: number;
  unpaidCapexCount: number;
  unpaidCapexTotal: DecimalString;
  unpaidCapexUnknownCount: number;
  unpaidDrawingCount: number | null;
  unpaidDrawingTotal: DecimalString | null;
  unpaidDrawingUnknownCount: number | null;
}

function requireCount(row: Record<string, unknown>, key: string): number {
  const raw = row[key];
  const value = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`expense register summary: field "${key}" must be a non-negative safe integer`);
  }
  return value as number;
}

function requireMoney(row: Record<string, unknown>, key: string): DecimalString {
  const value = typeof row[key] === "string" ? parseDecimal(row[key]) : null;
  if (value == null || value.startsWith("-")) {
    throw new Error(`expense register summary: field "${key}" must be non-negative decimal text`);
  }
  return value;
}

// Drawing-scoped fields are JSON null when the caller lacks finance.read (never a fabricated
// zero — a farm_manager must not learn "there are zero drawings" any more than a real count).
function optionalCount(row: Record<string, unknown>, key: string): number | null {
  if (row[key] == null) return null;
  return requireCount(row, key);
}

function optionalMoney(row: Record<string, unknown>, key: string): DecimalString | null {
  if (row[key] == null) return null;
  return requireMoney(row, key);
}

export function parseExpenseRegisterSummary(value: unknown): ExpenseRegisterSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expense register summary: RPC returned no object payload");
  }
  const row = value as Record<string, unknown>;
  return {
    expenseCount: requireCount(row, "expense_count"),
    monthCount: requireCount(row, "month_count"),
    operatingCount: requireCount(row, "operating_count"),
    drawingCount: optionalCount(row, "drawing_count"),
    unroutedCount: requireCount(row, "unrouted_count"),
    unclassifiedCount: requireCount(row, "unclassified_count"),
    uncenteredCount: requireCount(row, "uncentered_count"),
    monthNonDrawingTotal: requireMoney(row, "month_non_drawing_total"),
    monthNonDrawingUnknownCount: requireCount(row, "month_non_drawing_unknown_count"),
    monthDrawingTotal: optionalMoney(row, "month_drawing_total"),
    monthDrawingUnknownCount: optionalCount(row, "month_drawing_unknown_count"),
    unpaidOperatingCount: requireCount(row, "unpaid_operating_count"),
    unpaidOperatingTotal: requireMoney(row, "unpaid_operating_total"),
    unpaidOperatingUnknownCount: requireCount(row, "unpaid_operating_unknown_count"),
    unpaidCapexCount: requireCount(row, "unpaid_capex_count"),
    unpaidCapexTotal: requireMoney(row, "unpaid_capex_total"),
    unpaidCapexUnknownCount: requireCount(row, "unpaid_capex_unknown_count"),
    unpaidDrawingCount: optionalCount(row, "unpaid_drawing_count"),
    unpaidDrawingTotal: optionalMoney(row, "unpaid_drawing_total"),
    unpaidDrawingUnknownCount: optionalCount(row, "unpaid_drawing_unknown_count"),
  };
}

export function unpaidExpenseCount(summary: ExpenseRegisterSummary): number {
  return summary.unpaidOperatingCount + summary.unpaidCapexCount + (summary.unpaidDrawingCount ?? 0);
}

export function unpaidKnownTotal(summary: ExpenseRegisterSummary): DecimalString {
  return sumDecimals([
    summary.unpaidOperatingTotal,
    summary.unpaidCapexTotal,
    summary.unpaidDrawingTotal ?? "0",
  ]).total;
}

export function unpaidUnknownCount(summary: ExpenseRegisterSummary): number {
  return (
    summary.unpaidOperatingUnknownCount +
    summary.unpaidCapexUnknownCount +
    (summary.unpaidDrawingUnknownCount ?? 0)
  );
}

type FinanceExpenseRegisterSummary = ExpenseRegisterSummary & {
  unpaidDrawingCount: number;
  unpaidDrawingTotal: DecimalString;
  unpaidDrawingUnknownCount: number;
};

export function assertFinanceUnpaidSummary(
  summary: ExpenseRegisterSummary,
): asserts summary is FinanceExpenseRegisterSummary {
  if (
    summary.unpaidDrawingCount == null ||
    summary.unpaidDrawingTotal == null ||
    summary.unpaidDrawingUnknownCount == null
  ) {
    throw new Error("expense register summary: finance caller received withheld drawing fields");
  }
}

export function isExpenseRegisterTruncated(totalCount: number): boolean {
  return totalCount > EXPENSE_REGISTER_DISPLAY_CAP;
}

export type ExpenseFilter =
  | "all"
  | "month"
  | "operating"
  | "drawing"
  | "undated"
  | "unrouted"
  | "unclassified"
  | "uncentered";

export function parseExpenseFilter(raw: string | undefined): ExpenseFilter {
  switch (raw) {
    case "month":
    case "operating":
    case "drawing":
    case "undated":
    case "unrouted":
    case "unclassified":
    case "uncentered":
      return raw;
    default:
      return "all";
  }
}

/**
 * The exact register-wide count matching a chip/filter, read from the RPC summary — never the
 * length of the bounded 200-row page. `drawingCount` is `null` (not 0) for a caller without
 * finance.read; the page never routes that caller onto the "drawing" filter, so the `?? 0`
 * fallback here is purely defensive.
 */
export function expenseFilterCount(filter: ExpenseFilter, summary: ExpenseRegisterSummary): number {
  switch (filter) {
    case "all":
      return summary.expenseCount;
    case "month":
      return summary.monthCount;
    case "operating":
      return summary.operatingCount;
    case "drawing":
      return summary.drawingCount ?? 0;
    case "undated":
      throw new Error("undated filter count must come from its exact filtered query");
    case "unrouted":
      return summary.unroutedCount;
    case "unclassified":
      return summary.unclassifiedCount;
    case "uncentered":
      return summary.uncenteredCount;
  }
}

const CAIRO_YEAR_MONTH = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
});

/**
 * Deterministic current-month bounds (start inclusive, end exclusive) as ISO date strings, derived
 * from a real server `Date` in the farm's Cairo operating timezone — never `current_date` inside
 * the database, and never the server process's own (possibly UTC) local time, which could disagree
 * with Cairo's calendar day for a few hours around midnight. Passed to
 * fn_expense_register_summary and reused as the "month" filter's row-query predicate so the chip
 * count and the bounded row list agree on the exact same range.
 */
export function currentMonthBounds(now: Date = new Date()): { start: string; end: string } {
  const parts = CAIRO_YEAR_MONTH.formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) {
    throw new Error("currentMonthBounds: could not resolve the Cairo calendar month");
  }
  const y = Number(year);
  const m = Number(month); // 1-indexed
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${y}-${pad(m)}-01`;
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  return { start, end };
}
