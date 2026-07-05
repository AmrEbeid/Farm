import { moneyNumber } from "@/lib/money";

/** One line item on the balance sheet (an account with a nonzero balance as of the date). */
export interface BalanceSheetLine {
  code: string;
  nameAr: string;
  balance: number;
  kind: string | null;
}

/** The parsed `fn_accounting_balance_sheet` payload (SPEC-0004 Slice A). */
export interface BalanceSheet {
  asOf: string | null;
  assets: BalanceSheetLine[];
  liabilities: BalanceSheetLine[];
  equity: BalanceSheetLine[];
  assetsTotal: number;
  liabilitiesTotal: number;
  equityTotal: number;
  drawingsTotal: number;
  revenueTotal: number;
  expenseTotal: number;
  netIncome: number;
  totalEquityInclIncome: number;
  liabilitiesPlusEquity: number;
  balanced: boolean;
}

function toMoney(value: unknown): number {
  if (typeof value === "number" || typeof value === "string") return moneyNumber(value) ?? 0;
  return 0;
}

function toDateString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toLines(value: unknown): BalanceSheetLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      code: typeof row.code === "string" ? row.code : "",
      nameAr: typeof row.name_ar === "string" ? row.name_ar : "",
      balance: toMoney(row.balance),
      kind: typeof row.kind === "string" ? row.kind : null,
    };
  });
}

/**
 * Defensively parse the `fn_accounting_balance_sheet` RPC jsonb. Missing/malformed number fields
 * become 0 (never NaN silently carried into render); missing dates become null. Mirrors lib/owner-pnl.ts.
 */
export function parseBalanceSheet(value: unknown): BalanceSheet {
  const row =
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    asOf: toDateString(row.as_of),
    assets: toLines(row.assets),
    liabilities: toLines(row.liabilities),
    equity: toLines(row.equity),
    assetsTotal: toMoney(row.assets_total),
    liabilitiesTotal: toMoney(row.liabilities_total),
    equityTotal: toMoney(row.equity_total),
    drawingsTotal: toMoney(row.drawings_total),
    revenueTotal: toMoney(row.revenue_total),
    expenseTotal: toMoney(row.expense_total),
    netIncome: toMoney(row.net_income),
    totalEquityInclIncome: toMoney(row.total_equity_incl_income),
    liabilitiesPlusEquity: toMoney(row.liabilities_plus_equity),
    balanced: row.balanced === true,
  };
}
