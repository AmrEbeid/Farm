import { moneyNumber } from "./money";
import { decimalToSafeNumber, parseDecimal, sumDecimals, type DecimalString } from "./decimal";

export type CostCenterReportView = "overview" | "history";

export interface CostCenterTrialBalanceRow {
  accountId: string;
  code: string;
  nameAr: string;
  accountType: string;
  debit: number;
  credit: number;
}

export interface CostCenterReportTotals {
  expenseTotal: number;
  revenueTotal: number;
  profit: number;
}

export interface CostCenterHistoryRow {
  year: string;
  accountId: string;
  accountCode: string;
  accountNameAr: string;
  accountType: "expense" | "revenue";
  costCenterId: string;
  centerCode: string;
  centerNameAr: string;
  amount: DecimalString;
}

export interface CostCenterYearMatrixColumn {
  id: string;
  header: string;
  kind?: "status" | "money-exact";
  numeric?: boolean;
  decimal?: boolean;
}

export interface CostCenterYearMatrixRow {
  id: string;
  [key: string]: string | number;
}

export interface CostCenterYearTrendRow {
  year: string;
  مصروفات: number;
  إيرادات: number;
  صافي: number;
  [key: string]: string | number;
}

export interface CostCenterHierarchyRow {
  costCenterId: string;
  parentId: string | null;
}

const COST_CENTER_HISTORY_VERSION = "farm-os.cost-center-history.v1";

export function parseCostCenterReportView(
  value: string | undefined
): CostCenterReportView {
  return value === "history" ? "history" : "overview";
}

export function costCenterDescendantIds(
  rows: CostCenterHierarchyRow[],
  rootId: string,
): Set<string> {
  const ids = new Set([rootId]);
  for (let pass = 0; pass < rows.length; pass += 1) {
    let changed = false;
    for (const row of rows) {
      if (row.parentId && ids.has(row.parentId) && !ids.has(row.costCenterId)) {
        ids.add(row.costCenterId);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return ids;
}

export function topmostVisibleCostCenters<T extends CostCenterHierarchyRow>(
  rows: T[],
  hierarchyRows: CostCenterHierarchyRow[] = rows,
): T[] {
  const visibleIds = new Set(rows.map((row) => row.costCenterId));
  const parentById = new Map(hierarchyRows.map((row) => [row.costCenterId, row.parentId]));
  return rows.filter((row) => {
    const visited = new Set([row.costCenterId]);
    let parentId = row.parentId;
    while (parentId) {
      if (visibleIds.has(parentId)) return false;
      if (visited.has(parentId)) throw new Error("cost center report: hierarchy contains a cycle");
      visited.add(parentId);
      parentId = parentById.get(parentId) ?? null;
    }
    return true;
  });
}

export function parseCostCenterTrialBalance(
  value: unknown
): CostCenterTrialBalanceRow[] {
  if (!Array.isArray(value)) {
    throw new Error(
      "cost center report: trial balance payload must be an array"
    );
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(
        `cost center report: trial balance row ${index} is invalid`
      );
    }
    const row = entry as Record<string, unknown>;
    const accountId = typeof row.account_id === "string" ? row.account_id : "";
    const code = typeof row.code === "string" ? row.code : "";
    const nameAr = typeof row.name_ar === "string" ? row.name_ar : "";
    const accountType =
      typeof row.account_type === "string" ? row.account_type : "";
    const debit =
      typeof row.debit === "number" || typeof row.debit === "string"
        ? moneyNumber(row.debit)
        : null;
    const credit =
      typeof row.credit === "number" || typeof row.credit === "string"
        ? moneyNumber(row.credit)
        : null;
    if (
      !accountId ||
      !code ||
      !nameAr ||
      !accountType ||
      debit == null ||
      credit == null
    ) {
      throw new Error(
        `cost center report: trial balance row ${index} is incomplete`
      );
    }
    return { accountId, code, nameAr, accountType, debit, credit };
  });
}

export function summarizeCostCenterTrialBalance(
  rows: CostCenterTrialBalanceRow[]
): CostCenterReportTotals {
  let expenseTotal = 0;
  let revenueTotal = 0;
  for (const row of rows) {
    if (row.accountType === "expense") expenseTotal += row.debit - row.credit;
    if (row.accountType === "revenue") revenueTotal += row.credit - row.debit;
  }
  return { expenseTotal, revenueTotal, profit: revenueTotal - expenseTotal };
}

export function parseCostCenterHistorySummary(value: unknown): CostCenterHistoryRow[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("cost center report: history payload must be an object");
  }
  const payload = value as Record<string, unknown>;
  if (payload.version !== COST_CENTER_HISTORY_VERSION) {
    throw new Error("cost center report: history payload version is invalid");
  }
  if (!Array.isArray(payload.rows)) {
    throw new Error("cost center report: history rows must be an array");
  }

  return payload.rows.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`cost center report: history row ${index} is invalid`);
    }
    const row = entry as Record<string, unknown>;
    const year = typeof row.year === "number" && Number.isInteger(row.year) ? String(row.year) : "";
    const accountId = text(row.account_id);
    const accountCode = text(row.account_code);
    const accountNameAr = text(row.account_name_ar);
    const accountType = row.account_type === "expense" || row.account_type === "revenue" ? row.account_type : null;
    const costCenterId = text(row.cost_center_id);
    const centerCode = text(row.center_code);
    const centerNameAr = text(row.center_name_ar);
    const amount = typeof row.amount === "string" ? parseDecimal(row.amount) : null;
    if (
      !/^\d{4}$/.test(year) ||
      !accountId ||
      !accountCode ||
      !accountNameAr ||
      !accountType ||
      !costCenterId ||
      !centerCode ||
      !centerNameAr ||
      amount == null
    ) {
      throw new Error(`cost center report: history row ${index} is incomplete`);
    }
    return {
      year,
      accountId,
      accountCode,
      accountNameAr,
      accountType,
      costCenterId,
      centerCode,
      centerNameAr,
      amount,
    };
  });
}

export function buildCostCenterYearMatrix(
  historyRows: CostCenterHistoryRow[],
): { columns: CostCenterYearMatrixColumn[]; rows: CostCenterYearMatrixRow[] } {
  const years = new Set<string>();
  const rows = new Map<
    string,
    {
      account: string;
      type: string;
      center: string;
      amounts: Map<string, DecimalString[]>;
    }
  >();
  for (const historyRow of historyRows) {
    years.add(historyRow.year);
    const key = `${historyRow.accountId}:${historyRow.centerCode}`;
    const row = rows.get(key) ?? {
      account: `${historyRow.accountCode} · ${historyRow.accountNameAr}`,
      type: historyRow.accountType === "expense" ? "مصروف" : "إيراد",
      center: `${historyRow.centerCode} · ${historyRow.centerNameAr}`,
      amounts: new Map<string, DecimalString[]>(),
    };
    row.amounts.set(historyRow.year, [...(row.amounts.get(historyRow.year) ?? []), historyRow.amount]);
    rows.set(key, row);
  }

  const sortedYears = [...years].sort();
  return {
    columns: [
      { id: "account", header: "الحساب" },
      { id: "type", header: "النوع", kind: "status" },
      { id: "center", header: "مركز التكلفة" },
      ...sortedYears.map((year) => ({
        id: `y_${year}`,
        header: year,
        kind: "money-exact" as const,
        numeric: true,
        decimal: true,
      })),
    ],
    rows: [...rows.entries()].map(([id, row]) => ({
      id,
      account: row.account,
      type: row.type,
      center: row.center,
      ...Object.fromEntries(
        sortedYears.flatMap((year) => {
          const amounts = row.amounts.get(year);
          return amounts
            ? [[`y_${year}`, sumDecimals(amounts).total]]
            : [];
        }),
      ),
    })),
  };
}

export function buildCostCenterYearTrend(
  historyRows: CostCenterHistoryRow[],
): CostCenterYearTrendRow[] {
  const byYear = new Map<string, { expense: DecimalString[]; revenue: DecimalString[] }>();
  for (const historyRow of historyRows) {
    const bucket = byYear.get(historyRow.year) ?? { expense: [], revenue: [] };
    bucket[historyRow.accountType].push(historyRow.amount);
    byYear.set(historyRow.year, bucket);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, value]) => {
      const expense = sumDecimals(value.expense).total;
      const revenue = sumDecimals(value.revenue).total;
      const net = sumDecimals([revenue, negateDecimal(expense)]).total;
      return {
        year,
        مصروفات: displayDecimal(expense, `expense trend ${year}`),
        إيرادات: displayDecimal(revenue, `revenue trend ${year}`),
        صافي: displayDecimal(net, `net trend ${year}`),
      };
    });
}

function displayDecimal(value: DecimalString, label: string): number {
  const number = decimalToSafeNumber(value);
  if (number == null) throw new Error(`cost center report: ${label} exceeds safe display range`);
  return number;
}

function negateDecimal(value: DecimalString): DecimalString {
  if (value === "0") return value;
  return value.startsWith("-") ? value.slice(1) : `-${value}`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
