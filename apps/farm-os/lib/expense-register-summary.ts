import { moneyNumber } from "./money";

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
  monthNonDrawingTotal: number;
  monthNonDrawingUnknownCount: number;
  monthDrawingTotal: number | null;
  monthDrawingUnknownCount: number | null;
}

function requireNumber(row: Record<string, unknown>, key: string): number {
  const raw = row[key];
  if (typeof raw !== "number" && typeof raw !== "string") {
    throw new Error(`expense register summary: field "${key}" must be numeric`);
  }
  const value = moneyNumber(raw);
  if (value == null || !Number.isFinite(value)) {
    throw new Error(`expense register summary: field "${key}" must be finite`);
  }
  return value;
}

function requireCount(row: Record<string, unknown>, key: string): number {
  const value = requireNumber(row, key);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`expense register summary: field "${key}" must be a non-negative safe integer`);
  }
  return value;
}

// Drawing-scoped fields are JSON null when the caller lacks finance.read (never a fabricated
// zero — a farm_manager must not learn "there are zero drawings" any more than a real count).
function optionalCount(row: Record<string, unknown>, key: string): number | null {
  if (row[key] == null) return null;
  return requireCount(row, key);
}

function optionalNumber(row: Record<string, unknown>, key: string): number | null {
  if (row[key] == null) return null;
  return requireNumber(row, key);
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
    monthNonDrawingTotal: requireNumber(row, "month_non_drawing_total"),
    monthNonDrawingUnknownCount: requireCount(row, "month_non_drawing_unknown_count"),
    monthDrawingTotal: optionalNumber(row, "month_drawing_total"),
    monthDrawingUnknownCount: optionalCount(row, "month_drawing_unknown_count"),
  };
}

export function isExpenseRegisterTruncated(totalCount: number): boolean {
  return totalCount > EXPENSE_REGISTER_DISPLAY_CAP;
}

export type ExpenseFilter =
  | "all"
  | "month"
  | "operating"
  | "drawing"
  | "unrouted"
  | "unclassified"
  | "uncentered";

export function parseExpenseFilter(raw: string | undefined): ExpenseFilter {
  switch (raw) {
    case "month":
    case "operating":
    case "drawing":
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
