import {
  parseDecimal,
  subtractDecimals,
  type DecimalString,
} from "./decimal";
import {
  parseCostCenterHistorySummary,
  type CostCenterHistoryRow,
} from "./cost-center-report";

const VERSION = "farm-os.cost-center-reports.v1";

export interface CostCenterSnapshotRow {
  orgId: string;
  costCenterId: string;
  parentId: string | null;
  code: string;
  nameAr: string;
  sectorId: string | null;
  enterprise: string | null;
  areaFeddan: DecimalString | null;
  active: boolean;
  isSystem: boolean;
  sortOrder: number | null;
  lineCount: number;
  expense: DecimalString;
  revenue: DecimalString;
  net: DecimalString;
  netPerFeddan: DecimalString | null;
}

export interface CostCenterSnapshotFlag {
  orgId: string;
  costCenterId: string;
  code: string;
  nameAr: string;
  flagCode: string;
  messageAr: string;
}

export interface CostCenterReportsSnapshot {
  orgId: string;
  historyIncluded: boolean;
  rollup: CostCenterSnapshotRow[];
  flags: CostCenterSnapshotFlag[];
  history: CostCenterHistoryRow[];
  unallocatedLineCount: number;
  expenseTotal: DecimalString;
  revenueTotal: DecimalString;
  profit: DecimalString;
}

export function parseCostCenterReportsSnapshot(
  value: unknown,
  expectedOrgId: string,
  expectedHistory: boolean,
): CostCenterReportsSnapshot {
  const payload = object(value, "snapshot");
  if (payload.version !== VERSION) fail("version is invalid");
  const orgId = text(payload.org_id, "org_id");
  if (orgId !== expectedOrgId) fail("organization does not match");
  if (payload.history_included !== expectedHistory) fail("history mode does not match");

  const rollupRaw = array(payload.rollup, "rollup");
  const flagsRaw = array(payload.flags, "flags");
  const historyRaw = array(payload.history, "history");
  const rollupCount = count(payload.rollup_count, "rollup_count");
  const flagCount = count(payload.flag_count, "flag_count");
  const historyCount = count(payload.history_count, "history_count");
  if (rollupRaw.length !== rollupCount) fail("rollup count does not match");
  if (flagsRaw.length !== flagCount) fail("flag count does not match");
  if (historyRaw.length !== historyCount) fail("history count does not match");
  if (!expectedHistory && historyRaw.length !== 0) fail("overview includes history rows");

  const rollup = rollupRaw.map((entry, index) => parseRollup(entry, index, orgId));
  const ids = new Set<string>();
  const codes = new Set<string>();
  const parentById = new Map<string, string | null>();
  for (const row of rollup) {
    if (ids.has(row.costCenterId)) fail("rollup contains duplicate center id");
    if (codes.has(row.code)) fail("rollup contains duplicate center code");
    ids.add(row.costCenterId);
    codes.add(row.code);
    parentById.set(row.costCenterId, row.parentId);
  }
  for (const row of rollup) {
    if (row.parentId && !ids.has(row.parentId)) fail("rollup parent is missing");
  }
  for (const row of rollup) {
    const visited = new Set<string>([row.costCenterId]);
    let parentId = row.parentId;
    while (parentId) {
      if (visited.has(parentId)) fail("rollup hierarchy contains a cycle");
      visited.add(parentId);
      parentId = parentById.get(parentId) ?? null;
    }
  }

  const flags = flagsRaw.map((entry, index) => parseFlag(entry, index, orgId));
  const flagKeys = new Set<string>();
  for (const flag of flags) {
    if (!ids.has(flag.costCenterId)) fail("flag center is missing from rollup");
    const key = `${flag.costCenterId}:${flag.flagCode}`;
    if (flagKeys.has(key)) fail("flags contain a duplicate");
    flagKeys.add(key);
  }

  const history = parseCostCenterHistorySummary({
    version: "farm-os.cost-center-history.v1",
    rows: historyRaw,
  });
  const expenseTotal = decimal(payload.expense_total, "expense_total");
  const revenueTotal = decimal(payload.revenue_total, "revenue_total");
  const profit = decimal(payload.profit, "profit");
  if (subtractDecimals(revenueTotal, expenseTotal) !== profit) {
    fail("profit does not reconcile");
  }

  return {
    orgId,
    historyIncluded: expectedHistory,
    rollup,
    flags,
    history,
    unallocatedLineCount: count(payload.unallocated_line_count, "unallocated_line_count"),
    expenseTotal,
    revenueTotal,
    profit,
  };
}

function parseRollup(value: unknown, index: number, orgId: string): CostCenterSnapshotRow {
  const row = object(value, `rollup row ${index}`);
  if (text(row.org_id, `rollup row ${index} org_id`) !== orgId) {
    fail(`rollup row ${index} belongs to another organization`);
  }
  const expense = decimal(row.expense, `rollup row ${index} expense`);
  const revenue = decimal(row.revenue, `rollup row ${index} revenue`);
  const net = decimal(row.net, `rollup row ${index} net`);
  if (subtractDecimals(revenue, expense) !== net) fail(`rollup row ${index} does not reconcile`);
  return {
    orgId,
    costCenterId: text(row.cost_center_id, `rollup row ${index} cost_center_id`),
    parentId: nullableText(row.parent_id, `rollup row ${index} parent_id`),
    code: text(row.code, `rollup row ${index} code`),
    nameAr: text(row.name_ar, `rollup row ${index} name_ar`),
    sectorId: nullableText(row.sector_id, `rollup row ${index} sector_id`),
    enterprise: nullableText(row.enterprise, `rollup row ${index} enterprise`),
    areaFeddan: nullableDecimal(row.area_feddan, `rollup row ${index} area_feddan`),
    active: bool(row.active, `rollup row ${index} active`),
    isSystem: bool(row.is_system, `rollup row ${index} is_system`),
    sortOrder: nullableInteger(row.sort_order, `rollup row ${index} sort_order`),
    lineCount: count(row.line_count, `rollup row ${index} line_count`),
    expense,
    revenue,
    net,
    netPerFeddan: nullableDecimal(row.net_per_feddan, `rollup row ${index} net_per_feddan`),
  };
}

function parseFlag(value: unknown, index: number, orgId: string): CostCenterSnapshotFlag {
  const row = object(value, `flag row ${index}`);
  if (text(row.org_id, `flag row ${index} org_id`) !== orgId) {
    fail(`flag row ${index} belongs to another organization`);
  }
  return {
    orgId,
    costCenterId: text(row.cost_center_id, `flag row ${index} cost_center_id`),
    code: text(row.code, `flag row ${index} code`),
    nameAr: text(row.name_ar, `flag row ${index} name_ar`),
    flagCode: text(row.flag_code, `flag row ${index} flag_code`),
    messageAr: text(row.message_ar, `flag row ${index} message_ar`),
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be text`);
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  if (value === null) return null;
  return text(value, label);
}

function nullableInteger(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) fail(`${label} must be an integer`);
  return value;
}

function decimal(value: unknown, label: string): DecimalString {
  if (typeof value !== "string") fail(`${label} must be decimal text`);
  const parsed = parseDecimal(value);
  if (parsed == null) fail(`${label} is invalid`);
  return parsed;
}

function nullableDecimal(value: unknown, label: string): DecimalString | null {
  return value === null ? null : decimal(value, label);
}

function count(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} must be boolean`);
  return value;
}

function fail(message: string): never {
  throw new Error(`cost center reports snapshot: ${message}`);
}
