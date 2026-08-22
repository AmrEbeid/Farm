import { parseDecimal, type DecimalString } from "./decimal";
import type { DataAuthorityLevel } from "./data-authority";

export const MANAGER_HOME_SNAPSHOT_VERSION = "farm-os.manager-home.v1";
export const MANAGER_HOME_DETAIL_LIMIT = 8;

type Row = Record<string, unknown>;
type Urgency = "overdue" | "today" | "unscheduled";

export interface ManagerOperationDriver {
  id: string;
  planId: string;
  planType: string | null;
  periodStart: string | null;
  subtype: string | null;
  status: string;
  plannedAt: string | null;
  endsOn: string | null;
}

export interface ManagerHomeSnapshot {
  orgId: string;
  asOf: string;
  detailLimit: number;
  authority: { operations: DataAuthorityLevel; inventory: DataAuthorityLevel };
  attention: {
    overdueOperations: number;
    blockedPlanChecks: number;
    unassignedOperations: number;
    unscheduledOperations: number;
    pendingAgronomySignoffs: number;
    unknownStockItems: number;
    belowReorderThreshold: number;
  };
  state: {
    operations: { openCount: number; todayCount: number; overdueCount: number; unassignedCount: number; unscheduledCount: number };
    inventory: { belowThresholdCount: number; outOfStockCount: number; unknownStockCount: number };
    blockedPlanChecks: number;
    pendingAgronomySignoffs: number;
  };
  drivers: {
    priorityOperations: Array<ManagerOperationDriver & { assigned: boolean; urgency: Urgency }>;
    unassignedOperations: ManagerOperationDriver[];
    pendingSignoffs: ManagerOperationDriver[];
    blockedChecks: Array<{ id: string; planId: string; planType: string | null; periodStart: string | null; kind: string }>;
    stockBelowThreshold: Array<{ id: string; name: string; unit: string | null; available: DecimalString; threshold: DecimalString }>;
  };
}

function object(value: unknown, context: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`manager home snapshot: ${context} must be an object`);
  }
  return value as Row;
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`manager home snapshot: ${key} must be text`);
  return value;
}

function nullableText(row: Row, key: string): string | null {
  return row[key] === null ? null : text(row, key);
}

function count(row: Row, key: string): number {
  const value = text(row, key);
  if (!/^\d+$/.test(value)) throw new Error(`manager home snapshot: ${key} must be exact count text`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`manager home snapshot: ${key} exceeds the display range`);
  return parsed;
}

function date(row: Row, key: string, nullable = false): string | null {
  const value = nullable ? nullableText(row, key) : text(row, key);
  if (value === null) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`manager home snapshot: ${key} must be a calendar date`);
  }
  return value;
}

function boundedRows(value: unknown, limit: number, context: string): Row[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`manager home snapshot: ${context} must be a bounded array`);
  return value.map((entry, index) => object(entry, `${context}[${index}]`));
}

function operation(row: Row): ManagerOperationDriver {
  return {
    id: text(row, "id"),
    planId: text(row, "plan_id"),
    planType: nullableText(row, "plan_type"),
    periodStart: date(row, "period_start", true),
    subtype: nullableText(row, "subtype"),
    status: text(row, "status"),
    plannedAt: date(row, "planned_at", true),
    endsOn: date(row, "ends_on", true),
  };
}

function authority(value: unknown): ManagerHomeSnapshot["authority"] {
  const raw = object(value, "authority");
  const allowed = new Set<DataAuthorityLevel>(["verified", "partial", "unverified", "blocked"]);
  const level = (domain: "operations" | "inventory"): DataAuthorityLevel => {
    const status = raw[domain] ?? "unverified";
    if (typeof status !== "string" || !allowed.has(status as DataAuthorityLevel)) {
      throw new Error(`manager home snapshot: invalid authority status for ${domain}`);
    }
    return status as DataAuthorityLevel;
  };
  return { operations: level("operations"), inventory: level("inventory") };
}

export function parseManagerHomeSnapshot(value: unknown, expectedOrgId: string, expectedAsOf: string): ManagerHomeSnapshot {
  const root = object(value, "root");
  if (text(root, "version") !== MANAGER_HOME_SNAPSHOT_VERSION) throw new Error("manager home snapshot: version mismatch");
  if (text(root, "org_id") !== expectedOrgId) throw new Error("manager home snapshot: organization mismatch");
  if (date(root, "as_of") !== expectedAsOf) throw new Error("manager home snapshot: as-of mismatch");
  if (!Number.isInteger(root.detail_limit) || (root.detail_limit as number) < 1 || (root.detail_limit as number) > 20) {
    throw new Error("manager home snapshot: detail limit is invalid");
  }
  const detailLimit = root.detail_limit as number;
  const attention = object(root.attention, "attention");
  const state = object(root.state, "state");
  const operations = object(state.operations, "state.operations");
  const inventory = object(state.inventory, "state.inventory");
  const drivers = object(root.drivers, "drivers");

  return {
    orgId: expectedOrgId,
    asOf: expectedAsOf,
    detailLimit,
    authority: authority(root.authority),
    attention: {
      overdueOperations: count(attention, "overdue_operations"),
      blockedPlanChecks: count(attention, "blocked_plan_checks"),
      unassignedOperations: count(attention, "unassigned_operations"),
      unscheduledOperations: count(attention, "unscheduled_operations"),
      pendingAgronomySignoffs: count(attention, "pending_agronomy_signoffs"),
      unknownStockItems: count(attention, "unknown_stock_items"),
      belowReorderThreshold: count(attention, "below_reorder_threshold"),
    },
    state: {
      operations: {
        openCount: count(operations, "open_count"),
        todayCount: count(operations, "today_count"),
        overdueCount: count(operations, "overdue_count"),
        unassignedCount: count(operations, "unassigned_count"),
        unscheduledCount: count(operations, "unscheduled_count"),
      },
      inventory: {
        belowThresholdCount: count(inventory, "below_threshold_count"),
        outOfStockCount: count(inventory, "out_of_stock_count"),
        unknownStockCount: count(inventory, "unknown_stock_count"),
      },
      blockedPlanChecks: count(state, "blocked_plan_checks"),
      pendingAgronomySignoffs: count(state, "pending_agronomy_signoffs"),
    },
    drivers: {
      priorityOperations: boundedRows(drivers.priority_operations, detailLimit, "drivers.priority_operations").map((row) => {
        const urgency = text(row, "urgency");
        if (!(urgency === "overdue" || urgency === "today" || urgency === "unscheduled")) {
          throw new Error("manager home snapshot: invalid operation urgency");
        }
        if (typeof row.assigned !== "boolean") throw new Error("manager home snapshot: assigned must be boolean");
        return { ...operation(row), assigned: row.assigned, urgency };
      }),
      unassignedOperations: boundedRows(drivers.unassigned_operations, detailLimit, "drivers.unassigned_operations").map(operation),
      pendingSignoffs: boundedRows(drivers.pending_signoffs, detailLimit, "drivers.pending_signoffs").map(operation),
      blockedChecks: boundedRows(drivers.blocked_checks, detailLimit, "drivers.blocked_checks").map((row) => ({
        id: text(row, "id"), planId: text(row, "plan_id"), planType: nullableText(row, "plan_type"),
        periodStart: date(row, "period_start", true), kind: text(row, "kind"),
      })),
      stockBelowThreshold: boundedRows(drivers.stock_below_threshold, detailLimit, "drivers.stock_below_threshold").map((row) => {
        const available = parseDecimal(row.available);
        const threshold = parseDecimal(row.threshold);
        if (available === null || threshold === null) throw new Error("manager home snapshot: stock quantities must be decimal text");
        return { id: text(row, "id"), name: text(row, "name"), unit: nullableText(row, "unit"), available, threshold };
      }),
    },
  };
}
