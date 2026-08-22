import {
  compareDecimals,
  parseDecimal,
  subtractDecimals,
  sumDecimals,
  type DecimalString,
} from "./decimal";
import {
  parseExpenseRegisterSummary,
  unpaidExpenseCount,
  type ExpenseRegisterSummary,
} from "./expense-register-summary";
import {
  parseCustodyDashboardSummary,
  type CustodyDashboardAccount,
} from "./custody-dashboard-summary";

export const FINANCE_DASHBOARD_SNAPSHOT_VERSION =
  "farm-os.finance-dashboard.v1";
export const FINANCE_DASHBOARD_ROW_LIMIT = 12;
export const FINANCE_DASHBOARD_JOURNAL_LIMIT = 8;

export type FinanceDashboardRole = "owner" | "accountant" | "farm_manager";
export type FinanceDashboardExpenseKind = "operating" | "drawing" | "capex";
export type FinanceDashboardAuthority =
  | "verified"
  | "partial"
  | "unverified"
  | "blocked";

export interface FinanceDashboardBudgetSummary {
  budgetCount: number;
  approved: DecimalString;
  committed: DecimalString;
  actual: DecimalString;
  spentOrCommitted: DecimalString;
  available: DecimalString;
}

export interface FinanceDashboardBudgetRow {
  id: string;
  name: string;
  category: string;
  approved: DecimalString;
  committed: DecimalString;
  actual: DecimalString;
  available: DecimalString;
}

export interface FinanceDashboardBudgetCategory {
  category: string;
  approved: DecimalString;
  committed: DecimalString;
  actual: DecimalString;
}

export interface FinanceDashboardExpenseRow {
  id: string;
  date: string | null;
  category: string | null;
  description: string | null;
  total: DecimalString | null;
  kind: FinanceDashboardExpenseKind;
  accountId: string | null;
  supplierName: string | null;
}

export interface FinanceDashboardPurchaseRequestRow {
  id: string;
  code: string;
  status: string;
  reason: string | null;
  neededBy: string | null;
}

export interface FinanceDashboardPaymentRequestRow {
  id: string;
  requestNo: number;
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  approvedNetRequest: DecimalString | null;
}

export interface FinanceDashboardJournalRow {
  id: string;
  entryDate: string;
  sourceType: string;
  description: string | null;
  status: string;
}

export interface FinanceDashboardPrivate {
  custody: CustodyDashboardAccount[];
  expenseSummary: ExpenseRegisterSummary;
  openPaymentCount: number;
  readyPaymentCount: number;
  unclassifiedExpenseCount: number;
  journalCount: number;
  paymentRequests: FinanceDashboardPaymentRequestRow[];
  unpaidExpenses: FinanceDashboardExpenseRow[];
  journalEntries: FinanceDashboardJournalRow[];
}

export interface FinanceDashboardSnapshot {
  role: FinanceDashboardRole;
  canSeeAccounting: boolean;
  asOf: string;
  monthStart: string;
  monthEnd: string;
  rowLimit: number;
  journalLimit: number;
  budgetAuthority: FinanceDashboardAuthority;
  budgetSummary: FinanceDashboardBudgetSummary;
  budgetCategories: FinanceDashboardBudgetCategory[];
  budgets: FinanceDashboardBudgetRow[];
  expenseSample: {
    rowCount: number;
    operatingTotal: DecimalString;
    operatingUnknownCount: number;
    drawingTotal: DecimalString | null;
    drawingUnknownCount: number | null;
  };
  expenses: FinanceDashboardExpenseRow[];
  purchaseRequestSample: {
    rowCount: number;
    submittedCount: number;
    nearDueCount: number;
  };
  purchaseRequests: FinanceDashboardPurchaseRequestRow[];
  private: FinanceDashboardPrivate | null;
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`finance dashboard snapshot: ${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`finance dashboard snapshot: field "${key}" must be text`);
  }
  return value;
}

function nullableText(
  row: Record<string, unknown>,
  key: string
): string | null {
  if (row[key] === null) return null;
  if (typeof row[key] !== "string") {
    throw new Error(
      `finance dashboard snapshot: field "${key}" must be text or null`
    );
  }
  return row[key];
}

function count(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(
      `finance dashboard snapshot: field "${key}" must be a non-negative safe integer`
    );
  }
  return value as number;
}

function decimal(
  row: Record<string, unknown>,
  key: string,
  nullable = false
): DecimalString | null {
  if (nullable && row[key] === null) return null;
  if (typeof row[key] !== "string") {
    throw new Error(
      `finance dashboard snapshot: field "${key}" must be decimal text${
        nullable ? " or null" : ""
      }`
    );
  }
  const value = parseDecimal(row[key]);
  if (value === null)
    throw new Error(
      `finance dashboard snapshot: field "${key}" is not decimal text`
    );
  return value;
}

function calendarDate(
  row: Record<string, unknown>,
  key: string,
  nullable = false
): string | null {
  if (nullable && row[key] === null) return null;
  const value = text(row, key);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(
      `finance dashboard snapshot: field "${key}" must be a calendar date`
    );
  }
  return value;
}

function role(row: Record<string, unknown>): FinanceDashboardRole {
  if (
    row.role === "owner" ||
    row.role === "accountant" ||
    row.role === "farm_manager"
  )
    return row.role;
  throw new Error("finance dashboard snapshot: role is invalid");
}

function authority(row: Record<string, unknown>): FinanceDashboardAuthority {
  if (
    row.budget_authority_status === "verified" ||
    row.budget_authority_status === "partial" ||
    row.budget_authority_status === "unverified" ||
    row.budget_authority_status === "blocked"
  ) {
    return row.budget_authority_status;
  }
  throw new Error("finance dashboard snapshot: budget authority is invalid");
}

function expenseKind(
  row: Record<string, unknown>
): FinanceDashboardExpenseKind {
  if (
    row.kind === "operating" ||
    row.kind === "drawing" ||
    row.kind === "capex"
  )
    return row.kind;
  throw new Error("finance dashboard snapshot: expense kind is invalid");
}

function array(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value))
    throw new Error(`finance dashboard snapshot: ${context} must be an array`);
  return value;
}

function uniqueIdRows<T>(
  values: unknown[],
  context: string,
  parse: (row: Record<string, unknown>) => T & { id: string }
): T[] {
  const ids = new Set<string>();
  return values.map((raw, index) => {
    const item = parse(object(raw, `${context} ${index}`));
    if (ids.has(item.id))
      throw new Error(
        `finance dashboard snapshot: duplicate ${context} id ${item.id}`
      );
    ids.add(item.id);
    return item;
  });
}

function parseExpenseRows(
  value: unknown,
  context: string
): FinanceDashboardExpenseRow[] {
  return uniqueIdRows(array(value, context), context, (row) => ({
    id: text(row, "id"),
    date: calendarDate(row, "date", true),
    category: nullableText(row, "category"),
    description: nullableText(row, "description"),
    total: decimal(row, "total", true),
    kind: expenseKind(row),
    accountId: context === "expense" ? nullableText(row, "account_id") : null,
    supplierName:
      context === "expense" ? nullableText(row, "supplier_name") : null,
  }));
}

export function financeDashboardCanReadPrivateAccounting(
  roleValue: string
): boolean {
  return roleValue === "owner" || roleValue === "accountant";
}

export function parseFinanceDashboardSnapshot(
  value: unknown,
  expectedOrgId: string,
  expectedRole: string,
  expectedMonthStart: string,
  expectedMonthEnd: string,
  expectedAsOf: string
): FinanceDashboardSnapshot {
  const payload = object(value, "payload");
  if (payload.version !== FINANCE_DASHBOARD_SNAPSHOT_VERSION) {
    throw new Error("finance dashboard snapshot: version is invalid");
  }
  if (text(payload, "org_id") !== expectedOrgId) {
    throw new Error(
      "finance dashboard snapshot: organization does not match the active organization"
    );
  }
  const parsedRole = role(payload);
  if (parsedRole !== expectedRole)
    throw new Error(
      "finance dashboard snapshot: role does not match the active membership"
    );
  if (typeof payload.can_see_accounting !== "boolean") {
    throw new Error(
      "finance dashboard snapshot: accounting visibility must be boolean"
    );
  }
  const expectedPrivate = financeDashboardCanReadPrivateAccounting(parsedRole);
  if (payload.can_see_accounting !== expectedPrivate) {
    throw new Error(
      "finance dashboard snapshot: role and accounting visibility disagree"
    );
  }
  const asOf = calendarDate(payload, "as_of")!;
  const monthStart = calendarDate(payload, "month_start")!;
  const monthEnd = calendarDate(payload, "month_end")!;
  if (
    asOf !== expectedAsOf ||
    monthStart !== expectedMonthStart ||
    monthEnd !== expectedMonthEnd ||
    monthStart >= monthEnd
  ) {
    throw new Error("finance dashboard snapshot: requested dates do not match");
  }
  const rowLimit = count(payload, "row_limit");
  const journalLimit = count(payload, "journal_limit");
  if (
    rowLimit !== FINANCE_DASHBOARD_ROW_LIMIT ||
    journalLimit !== FINANCE_DASHBOARD_JOURNAL_LIMIT
  ) {
    throw new Error(
      "finance dashboard snapshot: display limits do not match the application contract"
    );
  }
  const budgetAuthority = authority(payload);

  const rawBudgetSummary = object(payload.budget_summary, "budget summary");
  const approved = decimal(rawBudgetSummary, "approved")!;
  const committed = decimal(rawBudgetSummary, "committed")!;
  const actual = decimal(rawBudgetSummary, "actual")!;
  const spentOrCommitted = sumDecimals([committed, actual]).total;
  const budgetSummary: FinanceDashboardBudgetSummary = {
    budgetCount: count(rawBudgetSummary, "budget_count"),
    approved,
    committed,
    actual,
    spentOrCommitted,
    available: subtractDecimals(approved, spentOrCommitted),
  };

  const budgetCategories = array(
    payload.budget_categories,
    "budget categories"
  ).map((raw, index) => {
    const row = object(raw, `budget category ${index}`);
    return {
      category: text(row, "category"),
      approved: decimal(row, "approved")!,
      committed: decimal(row, "committed")!,
      actual: decimal(row, "actual")!,
    };
  });
  if (
    new Set(budgetCategories.map((item) => item.category)).size !==
    budgetCategories.length
  ) {
    throw new Error(
      "finance dashboard snapshot: budget categories must be unique"
    );
  }
  if (
    compareDecimals(
      sumDecimals(budgetCategories.map((item) => item.approved)).total,
      approved
    ) !== 0 ||
    compareDecimals(
      sumDecimals(budgetCategories.map((item) => item.committed)).total,
      committed
    ) !== 0 ||
    compareDecimals(
      sumDecimals(budgetCategories.map((item) => item.actual)).total,
      actual
    ) !== 0
  ) {
    throw new Error(
      "finance dashboard snapshot: budget category totals do not reconcile"
    );
  }

  const budgets = uniqueIdRows(
    array(payload.budgets, "budgets"),
    "budget",
    (row) => {
      const rowApproved = decimal(row, "approved")!;
      const rowCommitted = decimal(row, "committed")!;
      const rowActual = decimal(row, "actual")!;
      return {
        id: text(row, "id"),
        name: text(row, "name"),
        category: text(row, "category"),
        approved: rowApproved,
        committed: rowCommitted,
        actual: rowActual,
        available: subtractDecimals(
          rowApproved,
          sumDecimals([rowCommitted, rowActual]).total
        ),
      };
    }
  );
  if (budgets.length !== Math.min(budgetSummary.budgetCount, 8)) {
    throw new Error(
      "finance dashboard snapshot: budget pressure sample is incomplete"
    );
  }
  if (
    budgetAuthority !== "verified" &&
    (budgetSummary.budgetCount !== 0 ||
      compareDecimals(budgetSummary.approved, "0") !== 0 ||
      compareDecimals(budgetSummary.committed, "0") !== 0 ||
      compareDecimals(budgetSummary.actual, "0") !== 0 ||
      budgetCategories.length !== 0 ||
      budgets.length !== 0)
  ) {
    throw new Error(
      "finance dashboard snapshot: unverified budget data must be withheld"
    );
  }

  const expenses = parseExpenseRows(payload.expenses, "expense");
  const rawExpenseSample = object(
    payload.expense_sample_summary,
    "expense sample summary"
  );
  const expenseSample = {
    rowCount: count(rawExpenseSample, "row_count"),
    operatingTotal: decimal(rawExpenseSample, "operating_total")!,
    operatingUnknownCount: count(rawExpenseSample, "operating_unknown_count"),
    drawingTotal: decimal(rawExpenseSample, "drawing_total", true),
    drawingUnknownCount:
      rawExpenseSample.drawing_unknown_count === null
        ? null
        : count(rawExpenseSample, "drawing_unknown_count"),
  };
  if (
    count(rawExpenseSample, "supplier_mismatch_count") !== 0 ||
    expenseSample.rowCount !== expenses.length ||
    expenses.length > rowLimit
  ) {
    throw new Error(
      "finance dashboard snapshot: expense sample is inconsistent"
    );
  }
  const operating = expenses.filter((item) => item.kind === "operating");
  const drawings = expenses.filter((item) => item.kind === "drawing");
  if (
    compareDecimals(
      sumDecimals(
        operating.flatMap((item) => (item.total === null ? [] : [item.total]))
      ).total,
      expenseSample.operatingTotal
    ) !== 0 ||
    operating.filter((item) => item.total === null).length !==
      expenseSample.operatingUnknownCount
  ) {
    throw new Error(
      "finance dashboard snapshot: operating sample does not reconcile"
    );
  }
  if (expectedPrivate) {
    if (
      expenseSample.drawingTotal === null ||
      expenseSample.drawingUnknownCount === null ||
      compareDecimals(
        sumDecimals(
          drawings.flatMap((item) => (item.total === null ? [] : [item.total]))
        ).total,
        expenseSample.drawingTotal
      ) !== 0 ||
      drawings.filter((item) => item.total === null).length !==
        expenseSample.drawingUnknownCount
    ) {
      throw new Error(
        "finance dashboard snapshot: drawing sample does not reconcile"
      );
    }
  } else if (
    expenseSample.drawingTotal !== null ||
    expenseSample.drawingUnknownCount !== null ||
    drawings.length !== 0
  ) {
    throw new Error(
      "finance dashboard snapshot: drawing data leaked to a non-finance role"
    );
  }

  const purchaseRequests = uniqueIdRows(
    array(payload.purchase_requests, "purchase requests"),
    "purchase request",
    (row) => ({
      id: text(row, "id"),
      code: text(row, "code"),
      status: text(row, "status"),
      reason: nullableText(row, "reason"),
      neededBy: calendarDate(row, "needed_by", true),
    })
  );
  const rawPrSample = object(
    payload.purchase_request_sample_summary,
    "purchase request sample summary"
  );
  const purchaseRequestSample = {
    rowCount: count(rawPrSample, "row_count"),
    submittedCount: count(rawPrSample, "submitted_count"),
    nearDueCount: count(rawPrSample, "near_due_count"),
  };
  if (
    purchaseRequestSample.rowCount !== purchaseRequests.length ||
    purchaseRequests.length > rowLimit ||
    purchaseRequestSample.submittedCount > purchaseRequestSample.rowCount ||
    purchaseRequestSample.nearDueCount > purchaseRequestSample.rowCount
  ) {
    throw new Error(
      "finance dashboard snapshot: purchase request sample is inconsistent"
    );
  }

  let privateData: FinanceDashboardPrivate | null = null;
  if (expectedPrivate) {
    const rawPrivate = object(payload.private, "private dashboard");
    const paymentRequests = uniqueIdRows(
      array(rawPrivate.payment_requests, "payment requests"),
      "payment request",
      (row) => ({
        id: text(row, "id"),
        requestNo: count(row, "request_no"),
        status: text(row, "status"),
        periodStart: calendarDate(row, "period_start", true),
        periodEnd: calendarDate(row, "period_end", true),
        approvedNetRequest: decimal(row, "approved_net_request", true),
      })
    );
    const unpaidExpenses = parseExpenseRows(
      rawPrivate.unpaid_expenses,
      "unpaid expense"
    );
    const journalEntries = uniqueIdRows(
      array(rawPrivate.journal_entries, "journal entries"),
      "journal entry",
      (row) => ({
        id: text(row, "id"),
        entryDate: calendarDate(row, "entry_date")!,
        sourceType: text(row, "source_type"),
        description: nullableText(row, "description"),
        status: text(row, "status"),
      })
    );
    const expenseSummary = parseExpenseRegisterSummary(
      rawPrivate.expense_summary
    );
    const openPaymentCount = count(rawPrivate, "open_payment_count");
    const journalCount = count(rawPrivate, "journal_count");
    if (
      paymentRequests.length !== Math.min(openPaymentCount, rowLimit) ||
      unpaidExpenses.length !==
        Math.min(unpaidExpenseCount(expenseSummary), rowLimit) ||
      journalEntries.length !== Math.min(journalCount, journalLimit)
    ) {
      throw new Error(
        "finance dashboard snapshot: private detail sample is inconsistent"
      );
    }
    privateData = {
      custody: parseCustodyDashboardSummary(rawPrivate.custody),
      expenseSummary,
      openPaymentCount,
      readyPaymentCount: count(rawPrivate, "ready_payment_count"),
      unclassifiedExpenseCount: count(rawPrivate, "unclassified_expense_count"),
      journalCount,
      paymentRequests,
      unpaidExpenses,
      journalEntries,
    };
    if (privateData.readyPaymentCount > privateData.openPaymentCount) {
      throw new Error(
        "finance dashboard snapshot: ready payment count exceeds open payment count"
      );
    }
  } else if (payload.private !== null) {
    throw new Error(
      "finance dashboard snapshot: private payload leaked to a non-finance role"
    );
  }

  return {
    role: parsedRole,
    canSeeAccounting: expectedPrivate,
    asOf,
    monthStart,
    monthEnd,
    rowLimit,
    journalLimit,
    budgetAuthority,
    budgetSummary,
    budgetCategories,
    budgets,
    expenseSample,
    expenses,
    purchaseRequestSample,
    purchaseRequests,
    private: privateData,
  };
}
