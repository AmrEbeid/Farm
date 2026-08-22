import { moneyNumber } from "./money";

export const DIRECT_DISPLAY_CAP = 200;

export interface CostCenterDirectSummary {
  directExpenseTotal: number;
  directExpenseCount: number;
  unknownExpenseCount: number;
  expenseCount: number;
  directSaleRevenue: number;
  finalizedSaleCount: number;
  pendingSaleCount: number;
  saleCount: number;
}

function requireNumber(row: Record<string, unknown>, key: string): number {
  const raw = row[key];
  if (typeof raw !== "number" && typeof raw !== "string") {
    throw new Error(`cost-center summary: field "${key}" must be numeric`);
  }
  const value = moneyNumber(raw);
  if (value == null || !Number.isFinite(value)) {
    throw new Error(`cost-center summary: field "${key}" must be finite`);
  }
  return value;
}

function requireCount(row: Record<string, unknown>, key: string): number {
  const value = requireNumber(row, key);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`cost-center summary: field "${key}" must be a non-negative safe integer`);
  }
  return value;
}

export function parseCostCenterDirectSummary(value: unknown): CostCenterDirectSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("cost-center summary: RPC returned no object payload");
  }
  const row = value as Record<string, unknown>;
  return {
    directExpenseTotal: requireNumber(row, "direct_expense_total"),
    directExpenseCount: requireCount(row, "direct_expense_count"),
    unknownExpenseCount: requireCount(row, "unknown_expense_count"),
    expenseCount: requireCount(row, "expense_count"),
    directSaleRevenue: requireNumber(row, "direct_sale_revenue"),
    finalizedSaleCount: requireCount(row, "finalized_sale_count"),
    pendingSaleCount: requireCount(row, "pending_sale_count"),
    saleCount: requireCount(row, "sale_count"),
  };
}

export function isDirectTableTruncated(totalCount: number): boolean {
  return totalCount > DIRECT_DISPLAY_CAP;
}
