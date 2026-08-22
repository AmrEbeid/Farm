import { parseDecimal, type DecimalString } from "./decimal";
import {
  DATA_AUTHORITY_DOMAINS,
  type DataAuthorityDomain,
  type DataAuthorityLevel,
} from "./data-authority";

export const OWNER_HOME_SNAPSHOT_VERSION = "farm-os.owner-home.v1";
export const OWNER_HOME_DETAIL_LIMIT = 8;

type Row = Record<string, unknown>;

export interface OwnerHomeSnapshot {
  orgId: string;
  asOf: string;
  detailLimit: number;
  authority: Record<DataAuthorityDomain, DataAuthorityLevel>;
  attention: {
    pendingPaymentApprovals: number;
    pendingAgronomySignoffs: number;
    pendingPriceSales: number;
    unpaidNonDrawingExpenses: number;
    pendingPurchaseApprovals: number;
    overduePurchaseRequests: number;
    reorderItems: number;
    blockedPlanChecks: number;
    palmsNeedingAttention: number;
    unassignedOperations: number;
  };
  state: {
    budget: { lineCount: number; approved: DecimalString; committed: DecimalString; actual: DecimalString; available: DecimalString };
    inventory: { itemCount: number; reorderCount: number; outOfStockCount: number };
    operations: { activeCount: number; doneCount: number; dueWeekCount: number; unassignedCount: number };
    palms: { palmCount: number; attentionCount: number; active: number; watch: number; sick: number; dead: number };
    farmRegistry: { hawshaCount: number; barhiCount: number };
    activePeople: number;
    expenseFollowUp: {
      nonDrawingCount: number;
      nonDrawingTotal: DecimalString;
      nonDrawingUnknownCount: number;
      ownerDrawingCount: number;
      ownerDrawingTotal: DecimalString;
      ownerDrawingUnknownCount: number;
    };
  };
  drivers: {
    purchaseRequests: Array<{ id: string; code: string; status: string; reason: string | null; neededBy: string | null }>;
    stockShortages: Array<{ id: string; name: string; unit: string | null; available: DecimalString; threshold: DecimalString }>;
    dueOperations: Array<{ id: string; planId: string; subtype: string | null; status: string; plannedAt: string | null; assigned: boolean }>;
    costCenters: Array<{ id: string; code: string; name: string; debit: DecimalString; credit: DecimalString; net: DecimalString }>;
  };
}

function object(value: unknown, context: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`owner home snapshot: ${context} must be an object`);
  }
  return value as Row;
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`owner home snapshot: ${key} must be text`);
  }
  return value;
}

function nullableText(row: Row, key: string): string | null {
  if (row[key] === null) return null;
  return text(row, key);
}

function count(row: Row, key: string): number {
  const value = text(row, key);
  if (!/^\d+$/.test(value)) throw new Error(`owner home snapshot: ${key} must be exact count text`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`owner home snapshot: ${key} exceeds the display range`);
  return parsed;
}

function decimal(row: Row, key: string): DecimalString {
  const value = parseDecimal(row[key]);
  if (value === null) throw new Error(`owner home snapshot: ${key} must be decimal text`);
  return value;
}

function date(row: Row, key: string, nullable = false): string | null {
  const value = nullable ? nullableText(row, key) : text(row, key);
  if (value === null) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`owner home snapshot: ${key} must be a calendar date`);
  }
  return value;
}

function boundedRows(value: unknown, limit: number, context: string): Row[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw new Error(`owner home snapshot: ${context} must be a bounded array`);
  }
  return value.map((entry, index) => object(entry, `${context}[${index}]`));
}

function authorityStatuses(value: unknown): Record<DataAuthorityDomain, DataAuthorityLevel> {
  const raw = object(value, "authority");
  const allowed = new Set<DataAuthorityLevel>(["verified", "partial", "unverified", "blocked"]);
  return Object.fromEntries(DATA_AUTHORITY_DOMAINS.map((domain) => {
    const status = raw[domain] ?? "unverified";
    if (typeof status !== "string" || !allowed.has(status as DataAuthorityLevel)) {
      throw new Error(`owner home snapshot: invalid authority status for ${domain}`);
    }
    return [domain, status as DataAuthorityLevel];
  })) as Record<DataAuthorityDomain, DataAuthorityLevel>;
}

export function parseOwnerHomeSnapshot(
  value: unknown,
  expectedOrgId: string,
  expectedAsOf: string,
): OwnerHomeSnapshot {
  const root = object(value, "root");
  if (text(root, "version") !== OWNER_HOME_SNAPSHOT_VERSION) throw new Error("owner home snapshot: version mismatch");
  if (text(root, "org_id") !== expectedOrgId) throw new Error("owner home snapshot: organization mismatch");
  if (date(root, "as_of") !== expectedAsOf) throw new Error("owner home snapshot: as-of mismatch");
  if (!Number.isInteger(root.detail_limit) || (root.detail_limit as number) < 1 || (root.detail_limit as number) > 20) {
    throw new Error("owner home snapshot: detail limit is invalid");
  }
  const detailLimit = root.detail_limit as number;
  const authority = authorityStatuses(root.authority);
  const attention = object(root.attention, "attention");
  const state = object(root.state, "state");
  const budget = object(state.budget, "state.budget");
  const inventory = object(state.inventory, "state.inventory");
  const operations = object(state.operations, "state.operations");
  const palms = object(state.palms, "state.palms");
  const farmRegistry = object(state.farm_registry, "state.farm_registry");
  const expense = object(state.expense_follow_up, "state.expense_follow_up");
  // Validate remaining state branches even when this first UI slice does not display them.
  object(state.offshoots, "state.offshoots");
  object(state.cost_centers, "state.cost_centers");
  count(state, "active_people");
  count(state, "purchase_request_count");
  const drivers = object(root.drivers, "drivers");
  boundedRows(drivers.budget_pressure, detailLimit, "drivers.budget_pressure");

  return {
    orgId: expectedOrgId,
    asOf: expectedAsOf,
    detailLimit,
    authority,
    attention: {
      pendingPaymentApprovals: count(attention, "pending_payment_approvals"),
      pendingAgronomySignoffs: count(attention, "pending_agronomy_signoffs"),
      pendingPriceSales: count(attention, "pending_price_sales"),
      unpaidNonDrawingExpenses: count(attention, "unpaid_non_drawing_expenses"),
      pendingPurchaseApprovals: count(attention, "pending_purchase_approvals"),
      overduePurchaseRequests: count(attention, "overdue_purchase_requests"),
      reorderItems: count(attention, "reorder_items"),
      blockedPlanChecks: count(attention, "blocked_plan_checks"),
      palmsNeedingAttention: count(attention, "palms_needing_attention"),
      unassignedOperations: count(attention, "unassigned_operations"),
    },
    state: {
      budget: {
        lineCount: count(budget, "line_count"),
        approved: decimal(budget, "approved"),
        committed: decimal(budget, "committed"),
        actual: decimal(budget, "actual"),
        available: decimal(budget, "available"),
      },
      inventory: {
        itemCount: count(inventory, "item_count"),
        reorderCount: count(inventory, "reorder_count"),
        outOfStockCount: count(inventory, "out_of_stock_count"),
      },
      operations: {
        activeCount: count(operations, "active_count"),
        doneCount: count(operations, "done_count"),
        dueWeekCount: count(operations, "due_week_count"),
        unassignedCount: count(operations, "unassigned_count"),
      },
      palms: {
        palmCount: count(palms, "palm_count"),
        attentionCount: count(palms, "attention_count"),
        active: count(palms, "active"),
        watch: count(palms, "watch"),
        sick: count(palms, "sick"),
        dead: count(palms, "dead"),
      },
      farmRegistry: {
        hawshaCount: count(farmRegistry, "hawsha_count"),
        barhiCount: count(farmRegistry, "barhi_count"),
      },
      activePeople: count(state, "active_people"),
      expenseFollowUp: {
        nonDrawingCount: count(expense, "non_drawing_count"),
        nonDrawingTotal: decimal(expense, "non_drawing_total"),
        nonDrawingUnknownCount: count(expense, "non_drawing_unknown_count"),
        ownerDrawingCount: count(expense, "owner_drawing_count"),
        ownerDrawingTotal: decimal(expense, "owner_drawing_total"),
        ownerDrawingUnknownCount: count(expense, "owner_drawing_unknown_count"),
      },
    },
    drivers: {
      purchaseRequests: boundedRows(drivers.purchase_requests, detailLimit, "drivers.purchase_requests").map((row) => ({
        id: text(row, "id"), code: text(row, "code"), status: text(row, "status"),
        reason: nullableText(row, "reason"), neededBy: date(row, "needed_by", true),
      })),
      stockShortages: boundedRows(drivers.stock_shortages, detailLimit, "drivers.stock_shortages").map((row) => ({
        id: text(row, "id"), name: text(row, "name"), unit: nullableText(row, "unit"),
        available: decimal(row, "available"), threshold: decimal(row, "threshold"),
      })),
      dueOperations: boundedRows(drivers.due_operations, detailLimit, "drivers.due_operations").map((row) => {
        if (typeof row.assigned !== "boolean") throw new Error("owner home snapshot: assigned must be boolean");
        return { id: text(row, "id"), planId: text(row, "plan_id"), subtype: nullableText(row, "subtype"), status: text(row, "status"), plannedAt: date(row, "planned_at", true), assigned: row.assigned };
      }),
      costCenters: boundedRows(drivers.cost_centers, detailLimit, "drivers.cost_centers").map((row) => ({
        id: text(row, "id"), code: text(row, "code"), name: text(row, "name"),
        debit: decimal(row, "debit"), credit: decimal(row, "credit"), net: decimal(row, "net"),
      })),
    },
  };
}
