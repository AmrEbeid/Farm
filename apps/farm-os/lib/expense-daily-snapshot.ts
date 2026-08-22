import { parseDecimal, type DecimalString } from "./decimal";
import {
  parseExpenseRegisterSummary,
  type ExpenseFilter,
  type ExpenseRegisterSummary,
} from "./expense-register-summary";

type ExpenseRow = {
  id: string;
  date: string | null;
  category: string | null;
  description: string | null;
  total: DecimalString | null;
  kind: string;
  supplierId: string | null;
  paymentStatus: string | null;
  accountId: string | null;
  costCenterId: string | null;
};

type SupplierRow = { id: string; name: string };

export type ExpenseAccountRow = {
  id: string;
  code: string;
  name_ar: string;
  account_type: string;
  kind: string | null;
  parent_id: string | null;
  active: boolean;
};

export type ExpenseDailySnapshot = {
  orgId: string;
  filter: ExpenseFilter;
  monthStart: string;
  monthEnd: string;
  rowLimit: number;
  matchingCount: number;
  summary: ExpenseRegisterSummary;
  expenseRows: ExpenseRow[];
  supplierRows: SupplierRow[];
  accountRows: ExpenseAccountRow[];
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`expense daily snapshot: ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`expense daily snapshot: ${label} must be a non-empty string`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value == null ? null : string(value, label);
}

function count(value: unknown, label: string): number {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`expense daily snapshot: ${label} must be a non-negative safe integer`);
  }
  return parsed;
}

function date(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
    throw new Error(`expense daily snapshot: ${label} must be an ISO date`);
  }
  return parsed;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`expense daily snapshot: ${label} must be an array`);
  return value;
}

function unique(rows: { id: string }[], label: string): void {
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`expense daily snapshot: duplicate ${label} id ${row.id}`);
    ids.add(row.id);
  }
}

export function parseExpenseDailySnapshot(value: unknown): ExpenseDailySnapshot {
  const row = object(value, "payload");
  if (row.version !== "farm-os.expense-daily.v1") {
    throw new Error("expense daily snapshot: unsupported version");
  }
  const filter = string(row.filter, "filter") as ExpenseFilter;
  if (!['all','month','operating','drawing','undated','unrouted','unclassified','uncentered'].includes(filter)) {
    throw new Error("expense daily snapshot: invalid filter");
  }
  const expenseRows = array(row.expenses, "expenses").map((item, index) => {
    const expense = object(item, `expenses[${index}]`);
    const rawTotal = expense.total;
    const total = rawTotal == null ? null : typeof rawTotal === "string" ? parseDecimal(rawTotal) : null;
    if (rawTotal != null && (total == null || total.startsWith("-"))) {
      throw new Error(`expense daily snapshot: expenses[${index}].total must be non-negative decimal text`);
    }
    return {
      id: string(expense.id, `expenses[${index}].id`),
      date: expense.date == null ? null : date(expense.date, `expenses[${index}].date`),
      category: nullableString(expense.category, `expenses[${index}].category`),
      description: nullableString(expense.description, `expenses[${index}].description`),
      total,
      kind: string(expense.kind, `expenses[${index}].kind`),
      supplierId: nullableString(expense.supplier_id, `expenses[${index}].supplier_id`),
      paymentStatus: nullableString(expense.payment_status, `expenses[${index}].payment_status`),
      accountId: nullableString(expense.account_id, `expenses[${index}].account_id`),
      costCenterId: nullableString(expense.cost_center_id, `expenses[${index}].cost_center_id`),
    };
  });
  const supplierRows = array(row.suppliers, "suppliers").map((item, index) => {
    const supplier = object(item, `suppliers[${index}]`);
    return { id: string(supplier.id, `suppliers[${index}].id`), name: string(supplier.name, `suppliers[${index}].name`) };
  });
  const accountRows = array(row.accounts, "accounts").map((item, index) => {
    const account = object(item, `accounts[${index}]`);
    if (typeof account.active !== "boolean") {
      throw new Error(`expense daily snapshot: accounts[${index}].active must be boolean`);
    }
    return {
      id: string(account.id, `accounts[${index}].id`),
      code: string(account.code, `accounts[${index}].code`),
      name_ar: string(account.name_ar, `accounts[${index}].name_ar`),
      account_type: string(account.account_type, `accounts[${index}].account_type`),
      kind: nullableString(account.kind, `accounts[${index}].kind`),
      parent_id: nullableString(account.parent_id, `accounts[${index}].parent_id`),
      active: account.active,
    };
  });
  unique(expenseRows, "expense");
  unique(supplierRows, "supplier");
  unique(accountRows, "account");

  const rowLimit = count(row.row_limit, "row_limit");
  const matchingCount = count(row.matching_count, "matching_count");
  if (rowLimit < 1 || expenseRows.length !== Math.min(rowLimit, matchingCount)) {
    throw new Error("expense daily snapshot: bounded row counts are inconsistent");
  }

  const summary = parseExpenseRegisterSummary(row.summary);
  const expectedMatchingCount: Partial<Record<ExpenseFilter, number>> = {
    all: summary.expenseCount,
    month: summary.monthCount,
    operating: summary.operatingCount,
    drawing: summary.drawingCount ?? undefined,
    unrouted: summary.unroutedCount,
    unclassified: summary.unclassifiedCount,
    uncentered: summary.uncenteredCount,
  };
  if (
    expectedMatchingCount[filter] !== undefined &&
    expectedMatchingCount[filter] !== matchingCount
  ) {
    throw new Error("expense daily snapshot: matching count disagrees with the exact summary");
  }

  return {
    orgId: string(row.org_id, "org_id"),
    filter,
    monthStart: date(row.month_start, "month_start"),
    monthEnd: date(row.month_end, "month_end"),
    rowLimit,
    matchingCount,
    summary,
    expenseRows,
    supplierRows,
    accountRows,
  };
}
