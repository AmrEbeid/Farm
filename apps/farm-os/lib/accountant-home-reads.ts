import { parseDecimal, type DecimalString } from "./decimal";
import type { DataAuthorityLevel } from "./data-authority";

export const ACCOUNTANT_HOME_SNAPSHOT_VERSION = "farm-os.accountant-home.v1";
export const ACCOUNTANT_HOME_DETAIL_LIMIT = 8;

type Row = Record<string, unknown>;
export type ExactCountString = string;

export interface AccountantHomeSnapshot {
  orgId: string;
  asOf: string;
  cutover: string;
  monthStart: string;
  monthEnd: string;
  previousMonthStart: string;
  previousMonthEnd: string;
  detailLimit: number;
  authority: DataAuthorityLevel;
  moneyAvailable: boolean;
  state: {
    period: { openCount: ExactCountString; lockedCount: ExactCountString; asOfLocked: boolean };
    custody: {
      accountCount: ExactCountString;
      totalTargetFloat: DecimalString | null;
      totalClosingBalance: DecimalString | null;
    };
  };
  queues: {
    closeBlockers: {
      pendingPriceCount: ExactCountString;
      undatedExpenseCount: ExactCountString;
      undatedExpenseKnownTotal: DecimalString | null;
      undatedExpenseUnknownCount: ExactCountString;
      unroutedCount: ExactCountString;
      unroutedKnownTotal: DecimalString | null;
      unroutedUnknownCount: ExactCountString;
      unclassifiedCount: ExactCountString;
      unclassifiedKnownTotal: DecimalString | null;
      unclassifiedUnknownCount: ExactCountString;
      unallocatedCount: ExactCountString;
      unallocatedKnownTotal: DecimalString | null;
      unallocatedUnknownCount: ExactCountString;
    };
    pendingPricing: { count: ExactCountString };
    receivables: {
      agedCount: ExactCountString;
      agedTotal: DecimalString | null;
      openCount: ExactCountString;
      openTotal: DecimalString | null;
    };
    reconciliation: {
      batchCount: ExactCountString;
      stagedBatchCount: ExactCountString;
      ownerWaitingCount: ExactCountString;
      failedBatchCount: ExactCountString;
    };
    paymentObligations: {
      accountantActionableCount: ExactCountString;
      ownerBlockedCount: ExactCountString;
      operatingUnpaidCount: ExactCountString;
      operatingUnpaidTotal: DecimalString | null;
      operatingUnpaidUnknownCount: ExactCountString;
      capexUnpaidCount: ExactCountString;
      capexUnpaidTotal: DecimalString | null;
      capexUnpaidUnknownCount: ExactCountString;
      drawingExcludedCount: ExactCountString;
    };
  };
  attention: {
    closeBlockerCount: ExactCountString;
    ledgerGapCount: ExactCountString;
    pendingPricingCount: ExactCountString;
    agedReceivablesCount: ExactCountString;
    reconciliationActionableCount: ExactCountString;
    paymentObligationsActionableCount: ExactCountString;
    paymentObligationsOwnerBlockedCount: ExactCountString;
  };
  comparison: {
    comparable: boolean;
    currentMonthPostedCount: ExactCountString | null;
    previousMonthPostedCount: ExactCountString | null;
    reason: string | null;
  };
  drivers: {
    pendingPricing: Array<{
      id: string; saleDate: string | null; crop: string; qty: DecimalString | null;
      unit: string; buyerName: string; deliveryNoteNo: string | null;
    }>;
    receivables: Array<{
      id: string; saleDate: string | null; crop: string; buyerName: string;
      total: DecimalString | null; collected: DecimalString | null; remaining: DecimalString | null;
    }>;
    reconciliation: Array<{
      id: string; status: "staged"; unreviewedCount: ExactCountString;
    }>;
    paymentObligations: Array<{
      id: string; requestNo: string; status: PaymentStatus; periodStart: string | null;
      periodEnd: string | null; approvedNetRequest: DecimalString | null; ownerBlocked: boolean;
    }>;
    custodyAccounts: Array<{
      id: string; holderLabel: string; targetFloat: DecimalString | null;
      closingBalance: DecimalString | null;
    }>;
  };
}

type PaymentStatus = "draft" | "submitted" | "approved_operational" | "approved_final" | "paid";

function object(value: unknown, context: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`accountant home snapshot: ${context} must be an object`);
  }
  return value as Row;
}

function text(row: Row, key: string, allowEmpty = false): string {
  const value = row[key];
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    throw new Error(`accountant home snapshot: ${key} must be text`);
  }
  return value;
}

function nullableText(row: Row, key: string): string | null {
  return row[key] === null ? null : text(row, key);
}

function count(row: Row, key: string): ExactCountString {
  const value = text(row, key);
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`accountant home snapshot: ${key} must be exact count text`);
  }
  return value;
}

function decimal(row: Row, key: string): DecimalString {
  if (typeof row[key] !== "string") {
    throw new Error(`accountant home snapshot: ${key} must be decimal text`);
  }
  const parsed = parseDecimal(row[key]);
  if (parsed === null) throw new Error(`accountant home snapshot: ${key} must be decimal text`);
  return parsed;
}

function nullableDecimal(row: Row, key: string): DecimalString | null {
  return row[key] === null ? null : decimal(row, key);
}

function boolean(row: Row, key: string): boolean {
  if (typeof row[key] !== "boolean") {
    throw new Error(`accountant home snapshot: ${key} must be boolean`);
  }
  return row[key];
}

function date(row: Row, key: string, nullable = false): string | null {
  const value = nullable ? nullableText(row, key) : text(row, key);
  if (value === null) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`accountant home snapshot: ${key} must be a calendar date`);
  }
  return value;
}

function uuid(row: Row, key: string): string {
  const value = text(row, key);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`accountant home snapshot: ${key} must be a UUID`);
  }
  return value;
}

function boundedRows(value: unknown, limit: number, context: string): Row[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw new Error(`accountant home snapshot: ${context} must be a bounded array`);
  }
  return value.map((entry, index) => object(entry, `${context}[${index}]`));
}

function nextMonth(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  parsed.setUTCMonth(parsed.getUTCMonth() + 1);
  return parsed.toISOString().slice(0, 10);
}

function gatedMoney(row: Row, key: string, available: boolean, optional = false): DecimalString | null {
  const value = nullableDecimal(row, key);
  if (!available && value !== null) {
    throw new Error(`accountant home snapshot: ${key} must be null while money is unavailable`);
  }
  if (available && !optional && value === null) {
    throw new Error(`accountant home snapshot: ${key} is required while money is available`);
  }
  return value;
}

export function parseAccountantHomeSnapshot(
  value: unknown,
  expectedOrgId: string,
  expectedAsOf: string,
  expectedCutover: string,
): AccountantHomeSnapshot {
  const root = object(value, "root");
  if (text(root, "version") !== ACCOUNTANT_HOME_SNAPSHOT_VERSION) throw new Error("accountant home snapshot: version mismatch");
  if (uuid(root, "org_id") !== expectedOrgId) throw new Error("accountant home snapshot: organization mismatch");
  const asOf = date(root, "as_of") as string;
  const cutover = date(root, "cutover") as string;
  if (asOf !== expectedAsOf) throw new Error("accountant home snapshot: as-of mismatch");
  if (cutover !== expectedCutover) throw new Error("accountant home snapshot: cutover mismatch");
  if (!Number.isInteger(root.detail_limit) || (root.detail_limit as number) < 1 || (root.detail_limit as number) > 20) {
    throw new Error("accountant home snapshot: detail limit is invalid");
  }
  const detailLimit = root.detail_limit as number;
  const monthStart = date(root, "month_start") as string;
  const monthEnd = date(root, "month_end") as string;
  const previousMonthStart = date(root, "previous_month_start") as string;
  const previousMonthEnd = date(root, "previous_month_end") as string;
  if (!monthStart.endsWith("-01") || nextMonth(monthStart) !== monthEnd ||
      nextMonth(previousMonthStart) !== monthStart || previousMonthEnd !== monthStart ||
      asOf < monthStart || asOf >= monthEnd) {
    throw new Error("accountant home snapshot: month boundaries are inconsistent");
  }

  const authorityRaw = text(root, "authority");
  if (!["verified", "partial", "unverified", "blocked"].includes(authorityRaw)) {
    throw new Error("accountant home snapshot: invalid authority status");
  }
  const authority = authorityRaw as DataAuthorityLevel;
  const moneyAvailable = boolean(root, "money_available");
  if (moneyAvailable !== (authority === "verified")) {
    throw new Error("accountant home snapshot: money availability contradicts authority");
  }

  const state = object(root.state, "state");
  const period = object(state.period, "state.period");
  const custody = object(state.custody, "state.custody");
  const queues = object(root.queues, "queues");
  const blockers = object(queues.close_blockers, "queues.close_blockers");
  const pendingPricing = object(queues.pending_pricing, "queues.pending_pricing");
  const receivables = object(queues.receivables, "queues.receivables");
  const reconciliation = object(queues.reconciliation, "queues.reconciliation");
  const obligations = object(queues.payment_obligations, "queues.payment_obligations");
  const attention = object(root.attention, "attention");
  const comparison = object(root.comparison, "comparison");
  const comparable = boolean(comparison, "comparable");
  if (comparable !== moneyAvailable) throw new Error("accountant home snapshot: comparison availability is inconsistent");
  const currentPosted = comparison.current_month_posted_count === null ? null : count(comparison, "current_month_posted_count");
  const previousPosted = comparison.previous_month_posted_count === null ? null : count(comparison, "previous_month_posted_count");
  const reason = nullableText(comparison, "reason");
  if (comparable ? (currentPosted === null || previousPosted === null || reason !== null) :
      (currentPosted !== null || previousPosted !== null || reason === null)) {
    throw new Error("accountant home snapshot: comparison null contract is invalid");
  }

  const drivers = object(root.drivers, "drivers");
  const paymentStatuses = new Set<PaymentStatus>(["draft", "submitted", "approved_operational", "approved_final", "paid"]);

  return {
    orgId: expectedOrgId, asOf, cutover, monthStart, monthEnd, previousMonthStart, previousMonthEnd,
    detailLimit, authority, moneyAvailable,
    state: {
      period: { openCount: count(period, "open_count"), lockedCount: count(period, "locked_count"), asOfLocked: boolean(period, "as_of_locked") },
      custody: {
        accountCount: count(custody, "account_count"),
        totalTargetFloat: gatedMoney(custody, "total_target_float", moneyAvailable),
        totalClosingBalance: gatedMoney(custody, "total_closing_balance", moneyAvailable),
      },
    },
    queues: {
      closeBlockers: {
        pendingPriceCount: count(blockers, "pending_price_count"),
        undatedExpenseCount: count(blockers, "undated_expense_count"),
        undatedExpenseKnownTotal: gatedMoney(blockers, "undated_expense_known_total", moneyAvailable),
        undatedExpenseUnknownCount: count(blockers, "undated_expense_unknown_count"),
        unroutedCount: count(blockers, "unrouted_count"),
        unroutedKnownTotal: gatedMoney(blockers, "unrouted_known_total", moneyAvailable),
        unroutedUnknownCount: count(blockers, "unrouted_unknown_count"),
        unclassifiedCount: count(blockers, "unclassified_count"),
        unclassifiedKnownTotal: gatedMoney(blockers, "unclassified_known_total", moneyAvailable),
        unclassifiedUnknownCount: count(blockers, "unclassified_unknown_count"),
        unallocatedCount: count(blockers, "unallocated_count"),
        unallocatedKnownTotal: gatedMoney(blockers, "unallocated_known_total", moneyAvailable),
        unallocatedUnknownCount: count(blockers, "unallocated_unknown_count"),
      },
      pendingPricing: { count: count(pendingPricing, "count") },
      receivables: {
        agedCount: count(receivables, "aged_count"),
        agedTotal: gatedMoney(receivables, "aged_total", moneyAvailable),
        openCount: count(receivables, "open_count"),
        openTotal: gatedMoney(receivables, "open_total", moneyAvailable),
      },
      reconciliation: {
        batchCount: count(reconciliation, "batch_count"),
        stagedBatchCount: count(reconciliation, "staged_batch_count"),
        ownerWaitingCount: count(reconciliation, "owner_waiting_count"),
        failedBatchCount: count(reconciliation, "failed_batch_count"),
      },
      paymentObligations: {
        accountantActionableCount: count(obligations, "accountant_actionable_count"),
        ownerBlockedCount: count(obligations, "owner_blocked_count"),
        operatingUnpaidCount: count(obligations, "operating_unpaid_count"),
        operatingUnpaidTotal: gatedMoney(obligations, "operating_unpaid_total", moneyAvailable),
        operatingUnpaidUnknownCount: count(obligations, "operating_unpaid_unknown_count"),
        capexUnpaidCount: count(obligations, "capex_unpaid_count"),
        capexUnpaidTotal: gatedMoney(obligations, "capex_unpaid_total", moneyAvailable),
        capexUnpaidUnknownCount: count(obligations, "capex_unpaid_unknown_count"),
        drawingExcludedCount: count(obligations, "drawing_excluded_count"),
      },
    },
    attention: {
      closeBlockerCount: count(attention, "close_blocker_count"),
      ledgerGapCount: count(attention, "ledger_gap_count"),
      pendingPricingCount: count(attention, "pending_pricing_count"),
      agedReceivablesCount: count(attention, "aged_receivables_count"),
      reconciliationActionableCount: count(attention, "reconciliation_actionable_count"),
      paymentObligationsActionableCount: count(attention, "payment_obligations_actionable_count"),
      paymentObligationsOwnerBlockedCount: count(attention, "payment_obligations_owner_blocked_count"),
    },
    comparison: { comparable, currentMonthPostedCount: currentPosted, previousMonthPostedCount: previousPosted, reason },
    drivers: {
      pendingPricing: boundedRows(drivers.pending_pricing, detailLimit, "drivers.pending_pricing").map((row) => ({
        id: uuid(row, "id"), saleDate: date(row, "sale_date", true), crop: text(row, "crop"),
        qty: nullableDecimal(row, "qty"), unit: text(row, "unit", true), buyerName: text(row, "buyer_name"),
        deliveryNoteNo: nullableText(row, "delivery_note_no"),
      })),
      receivables: boundedRows(drivers.receivables, detailLimit, "drivers.receivables").map((row) => ({
        id: uuid(row, "id"), saleDate: date(row, "sale_date", true), crop: text(row, "crop"), buyerName: text(row, "buyer_name"),
        total: gatedMoney(row, "total", moneyAvailable), collected: gatedMoney(row, "collected", moneyAvailable),
        remaining: gatedMoney(row, "remaining", moneyAvailable),
      })),
      reconciliation: boundedRows(drivers.reconciliation, detailLimit, "drivers.reconciliation").map((row) => {
        if (text(row, "status") !== "staged") throw new Error("accountant home snapshot: invalid reconciliation status");
        return { id: uuid(row, "id"), status: "staged" as const, unreviewedCount: count(row, "unreviewed_count") };
      }),
      paymentObligations: boundedRows(drivers.payment_obligations, detailLimit, "drivers.payment_obligations").map((row) => {
        const status = text(row, "status") as PaymentStatus;
        if (!paymentStatuses.has(status)) throw new Error("accountant home snapshot: invalid payment status");
        const periodStart = date(row, "period_start", true);
        const periodEnd = date(row, "period_end", true);
        if ((periodStart === null) !== (periodEnd === null) || (periodStart && periodEnd && periodStart > periodEnd)) {
          throw new Error("accountant home snapshot: invalid payment period");
        }
        const ownerBlocked = boolean(row, "owner_blocked");
        if (ownerBlocked !== (status === "approved_operational")) {
          throw new Error("accountant home snapshot: owner-blocked state contradicts payment status");
        }
        return {
          id: uuid(row, "id"), requestNo: text(row, "request_no"), status, periodStart, periodEnd,
          approvedNetRequest: gatedMoney(row, "approved_net_request", moneyAvailable, true), ownerBlocked,
        };
      }),
      custodyAccounts: boundedRows(drivers.custody_accounts, detailLimit, "drivers.custody_accounts").map((row) => ({
        id: uuid(row, "id"), holderLabel: text(row, "holder_label"),
        targetFloat: gatedMoney(row, "target_float", moneyAvailable),
        closingBalance: gatedMoney(row, "closing_balance", moneyAvailable),
      })),
    },
  };
}
