import type { SalesRevenueByCenter } from "./finance-insights";
import { decimalToSafeNumber, parseDecimal, sumDecimals, type DecimalString } from "./decimal";

export const COST_CENTER_REVENUE_SUMMARY_VERSION = "farm-os.cost-center-revenue-summary.v1";

type RevenueRow = {
  costCenterId: string | null;
  revenue: DecimalString;
  saleCount: number;
};

export type CostCenterRevenueSummary = {
  orgId: string;
  saleCount: number;
  totalRevenue: DecimalString;
  rows: RevenueRow[];
  salesRevenue: SalesRevenueByCenter;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid cost-center revenue summary ${label}`);
  }
  return value as Record<string, unknown>;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Error(`Invalid cost-center revenue summary ${label}`);
  }
  return value;
}

function count(value: unknown, label: string): number {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid cost-center revenue summary ${label}`);
  }
  return parsed;
}

function money(value: unknown, label: string): DecimalString {
  const parsed = typeof value === "string" ? parseDecimal(value) : null;
  if (parsed === null || parsed.startsWith("-")) {
    throw new Error(`Invalid cost-center revenue summary ${label}`);
  }
  return parsed;
}

function displayMoney(value: DecimalString, label: string): number {
  const parsed = decimalToSafeNumber(value);
  if (parsed === null) {
    throw new Error(`Cost-center revenue summary ${label} exceeds safe display range`);
  }
  return parsed;
}

export function parseCostCenterRevenueSummary(value: unknown, expectedOrgId: string): CostCenterRevenueSummary {
  const root = record(value, "payload");
  if (root.version !== COST_CENTER_REVENUE_SUMMARY_VERSION) {
    throw new Error("Invalid cost-center revenue summary version");
  }
  const orgId = uuid(root.org_id, "organization");
  if (orgId !== expectedOrgId) throw new Error("Cost-center revenue summary organization mismatch");
  if (!Array.isArray(root.rows)) throw new Error("Invalid cost-center revenue summary rows");

  const seen = new Set<string>();
  const rows = root.rows.map((raw, index): RevenueRow => {
    const row = record(raw, `row ${index}`);
    const costCenterId = row.cost_center_id === null ? null : uuid(row.cost_center_id, `row ${index} cost center`);
    const key = costCenterId ?? "<unallocated>";
    if (seen.has(key)) throw new Error("Duplicate cost center in revenue summary");
    seen.add(key);
    return {
      costCenterId,
      revenue: money(row.revenue, `row ${index} revenue`),
      saleCount: count(row.sale_count, `row ${index} count`),
    };
  });

  const saleCount = count(root.sale_count, "sale count");
  const totalRevenue = money(root.total_revenue, "total revenue");
  const rowCount = rows.reduce((sum, row) => sum + row.saleCount, 0);
  const rowRevenue = sumDecimals(rows.map((row) => row.revenue));
  if (rowCount !== saleCount) throw new Error("Cost-center revenue summary count does not foot");
  if (rowRevenue.hasUnknown || rowRevenue.total !== totalRevenue) {
    throw new Error("Cost-center revenue summary money does not foot");
  }

  const byCenter: Record<string, number> = {};
  for (const row of rows) {
    if (row.costCenterId) byCenter[row.costCenterId] = displayMoney(row.revenue, `center ${row.costCenterId}`);
  }

  return {
    orgId,
    saleCount,
    totalRevenue,
    rows,
    salesRevenue: { byCenter, total: displayMoney(totalRevenue, "total") },
  };
}
