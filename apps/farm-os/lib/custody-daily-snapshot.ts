import { parseDecimal, type DecimalString } from "./decimal";
import {
  parseExpenseRegisterSummary,
  type ExpenseRegisterSummary,
} from "./expense-register-summary";

export const CUSTODY_DAILY_SNAPSHOT_VERSION = "farm-os.custody-daily.v1";

export type CustodyRequestFilter = "all" | "awaiting" | "settled";

export interface CustodyDailyAccount {
  id: string;
  holderLabel: string;
  holderUserId: string | null;
  targetFloat: DecimalString;
  active: boolean;
  balance: DecimalString;
}

export interface CustodyDailyMovement {
  id: string;
  occurredAt: string;
  movementType: string;
  amountIn: DecimalString;
  amountOut: DecimalString;
  custodyAccountId: string;
  holderLabel: string;
  reversalOf: string | null;
  reversedBy: string | null;
}

export interface CustodyDailyRequest {
  id: string;
  requestNo: number;
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
}

export interface CustodyDailySnapshot {
  orgId: string;
  requestFilter: CustodyRequestFilter;
  movementLimit: number;
  requestLimit: number;
  accountRows: CustodyDailyAccount[];
  movementRows: CustodyDailyMovement[];
  movementCount: number;
  requestRows: CustodyDailyRequest[];
  allRequestCount: number;
  awaitingRequestCount: number;
  settledRequestCount: number;
  selectedRequestCount: number;
  expenseSummary: ExpenseRegisterSummary;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`custody daily snapshot: ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`custody daily snapshot: field "${key}" must be text`);
  }
  return value;
}

function optionalText(row: Record<string, unknown>, key: string): string | null {
  if (row[key] === null) return null;
  return text(row, key);
}

function count(row: Record<string, unknown>, key: string): number {
  const raw = row[key];
  const value = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`custody daily snapshot: field "${key}" must be a non-negative safe integer`);
  }
  return value;
}

function money(row: Record<string, unknown>, key: string): DecimalString {
  if (typeof row[key] !== "string") {
    throw new Error(`custody daily snapshot: field "${key}" must be decimal text`);
  }
  const value = parseDecimal(row[key]);
  if (value === null || value.startsWith("-")) {
    throw new Error(`custody daily snapshot: field "${key}" must be non-negative decimal text`);
  }
  return value;
}

function signedMoney(row: Record<string, unknown>, key: string): DecimalString {
  if (typeof row[key] !== "string") {
    throw new Error(`custody daily snapshot: field "${key}" must be decimal text`);
  }
  const value = parseDecimal(row[key]);
  if (value === null) {
    throw new Error(`custody daily snapshot: field "${key}" must be decimal text`);
  }
  return value;
}

function date(row: Record<string, unknown>, key: string): string {
  const value = text(row, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`custody daily snapshot: field "${key}" must be an ISO date`);
  }
  return value;
}

function optionalDate(row: Record<string, unknown>, key: string): string | null {
  return row[key] === null ? null : date(row, key);
}

function timestamp(row: Record<string, unknown>, key: string): string {
  const value = text(row, key);
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`custody daily snapshot: field "${key}" must be a timestamp`);
  }
  return value;
}

function uniqueRows<T>(
  rows: unknown,
  label: string,
  parse: (row: Record<string, unknown>) => T & { id: string },
): T[] {
  if (!Array.isArray(rows)) throw new Error(`custody daily snapshot: ${label} must be an array`);
  const ids = new Set<string>();
  return rows.map((value) => {
    const parsed = parse(object(value, `${label} row`));
    if (ids.has(parsed.id)) throw new Error(`custody daily snapshot: duplicate ${label} id ${parsed.id}`);
    ids.add(parsed.id);
    return parsed;
  });
}

export function parseCustodyDailySnapshot(value: unknown): CustodyDailySnapshot {
  const payload = object(value, "payload");
  if (payload.version !== CUSTODY_DAILY_SNAPSHOT_VERSION) {
    throw new Error("custody daily snapshot: version is invalid");
  }
  const requestFilter = payload.request_filter;
  if (requestFilter !== "all" && requestFilter !== "awaiting" && requestFilter !== "settled") {
    throw new Error("custody daily snapshot: request filter is invalid");
  }

  const accountRows = uniqueRows(payload.accounts, "account", (row) => {
    if (row.holder_user_id !== null && typeof row.holder_user_id !== "string") {
      throw new Error('custody daily snapshot: field "holder_user_id" must be text or null');
    }
    if (typeof row.active !== "boolean") {
      throw new Error('custody daily snapshot: field "active" must be boolean');
    }
    return {
      id: text(row, "id"),
      holderLabel: text(row, "holder_label"),
      holderUserId: row.holder_user_id as string | null,
      targetFloat: money(row, "target_float"),
      active: row.active,
      balance: signedMoney(row, "closing_balance"),
    };
  });
  const movementRows = uniqueRows(payload.movements, "movement", (row) => ({
    id: text(row, "id"),
    occurredAt: date(row, "occurred_at"),
    movementType: text(row, "movement_type"),
    amountIn: money(row, "amount_in"),
    amountOut: money(row, "amount_out"),
    custodyAccountId: text(row, "custody_account_id"),
    holderLabel: text(row, "holder_label"),
    reversalOf: optionalText(row, "reversal_of"),
    reversedBy: optionalText(row, "reversed_by"),
  }));
  const requestRows = uniqueRows(payload.requests, "request", (row) => ({
    id: text(row, "id"),
    requestNo: count(row, "request_no"),
    status: text(row, "status"),
    periodStart: optionalDate(row, "period_start"),
    periodEnd: optionalDate(row, "period_end"),
    createdAt: timestamp(row, "created_at"),
  }));

  const movementLimit = count(payload, "movement_limit");
  const requestLimit = count(payload, "request_limit");
  const movementCount = count(payload, "movement_count");
  const allRequestCount = count(payload, "all_request_count");
  const awaitingRequestCount = count(payload, "awaiting_request_count");
  const settledRequestCount = count(payload, "settled_request_count");
  const selectedRequestCount = count(payload, "selected_request_count");
  const expectedSelectedCount =
    requestFilter === "awaiting"
      ? awaitingRequestCount
      : requestFilter === "settled"
        ? settledRequestCount
        : allRequestCount;
  if (selectedRequestCount !== expectedSelectedCount) {
    throw new Error("custody daily snapshot: selected request count is inconsistent");
  }
  if (movementRows.length > movementLimit || movementRows.length > movementCount) {
    throw new Error("custody daily snapshot: movement bounds are inconsistent");
  }
  if (requestRows.length > requestLimit || requestRows.length > selectedRequestCount) {
    throw new Error("custody daily snapshot: request bounds are inconsistent");
  }

  return {
    orgId: text(payload, "org_id"),
    requestFilter,
    movementLimit,
    requestLimit,
    accountRows,
    movementRows,
    movementCount,
    requestRows,
    allRequestCount,
    awaitingRequestCount,
    settledRequestCount,
    selectedRequestCount,
    expenseSummary: parseExpenseRegisterSummary(payload.expense_summary),
  };
}
