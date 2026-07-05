import { moneyNumber } from "@/lib/money";

/** One line on the income statement (a revenue or expense account with activity in the period). */
export interface IncomeStatementLine {
  code: string;
  nameAr: string;
  amount: number;
  kind: string | null;
}

/** The parsed `fn_accounting_income_statement` payload (SPEC-0004 Slice A). */
export interface IncomeStatement {
  periodStart: string | null;
  periodEnd: string | null;
  revenue: IncomeStatementLine[];
  expenses: IncomeStatementLine[];
  revenueTotal: number;
  expensesTotal: number;
  operatingExpenses: number;
  netIncome: number;
}

function toMoney(value: unknown): number {
  if (typeof value === "number" || typeof value === "string") return moneyNumber(value) ?? 0;
  return 0;
}

function toDateString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toLines(value: unknown): IncomeStatementLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      code: typeof row.code === "string" ? row.code : "",
      nameAr: typeof row.name_ar === "string" ? row.name_ar : "",
      amount: toMoney(row.amount),
      kind: typeof row.kind === "string" ? row.kind : null,
    };
  });
}

/**
 * Defensively parse the `fn_accounting_income_statement` RPC jsonb. Missing/malformed number fields become 0
 * (never NaN into render); missing dates become null. Mirrors lib/balance-sheet.ts.
 */
export function parseIncomeStatement(value: unknown): IncomeStatement {
  const row =
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    periodStart: toDateString(row.period_start),
    periodEnd: toDateString(row.period_end),
    revenue: toLines(row.revenue),
    expenses: toLines(row.expenses),
    revenueTotal: toMoney(row.revenue_total),
    expensesTotal: toMoney(row.expenses_total),
    operatingExpenses: toMoney(row.operating_expenses),
    netIncome: toMoney(row.net_income),
  };
}
