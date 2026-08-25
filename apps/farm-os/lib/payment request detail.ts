import {
  compareDecimals,
  formatDecimalArabic,
  parseDecimal,
  sumDecimals,
  type DecimalString,
} from "@/lib/decimal";

const TOTAL_KEYS = [
  "operating_unpaid",
  "capex_unpaid",
  "drawing_unpaid",
  "post_paid_unpaid",
  "target_float",
  "current_custody",
  "custody_top_up",
  "gross_request",
  "approved_post_paid_total",
  "approved_custody_top_up",
  "approved_net_request",
  "owner_funding_received",
  "request_cash_out",
  "remaining_to_fund",
  "net_request",
] as const;

export type PaymentRequestTotals = Record<(typeof TOTAL_KEYS)[number], DecimalString>;

export function paymentRequestAmount(value: unknown, label = "payment request amount"): DecimalString {
  if (typeof value !== "string") {
    throw new Error(`${label} was not transported as exact text`);
  }
  const amount = parseDecimal(value);
  if (amount == null) throw new Error(`${label} is unreadable`);
  return amount;
}

export function paymentRequestTotals(value: unknown): PaymentRequestTotals {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("payment request totals are unreadable");
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    TOTAL_KEYS.map((key) => [key, paymentRequestAmount(record[key], `payment request total ${key}`)]),
  ) as PaymentRequestTotals;
}

export function addPaymentRequestAmounts(left: DecimalString, right: DecimalString): DecimalString {
  return sumDecimals([left, right]).total;
}

export function isPositivePaymentRequestAmount(value: unknown): boolean {
  const amount = parseDecimal(value);
  return amount != null && compareDecimals(amount, "0") > 0;
}

export type PaymentRequestSettlementState = {
  canReceiveFunding: boolean;
  canConfirmPayment: boolean;
  canClose: boolean;
};

export function paymentRequestSettlementState(
  status: string,
  remainingToFund: DecimalString,
  pendingLineCount: number,
): PaymentRequestSettlementState {
  if (!Number.isSafeInteger(pendingLineCount) || pendingLineCount < 0) {
    throw new Error("payment request pending line count must be a non-negative safe integer");
  }
  const remaining = isPositivePaymentRequestAmount(remainingToFund);
  return {
    canReceiveFunding: status === "approved_final" || (status === "paid" && remaining),
    canConfirmPayment: status === "paid" && !remaining,
    canClose: status === "paid" && !remaining && pendingLineCount === 0,
  };
}

export function normalizePositivePaymentRequestAmount(value: unknown): DecimalString | null {
  const amount = parseDecimal(value);
  return amount != null && compareDecimals(amount, "0") > 0 ? amount : null;
}

export function paymentRequestAmountEgp(amount: DecimalString): string {
  const fractionDigits = amount.includes(".") ? amount.length - amount.indexOf(".") - 1 : 0;
  return `${formatDecimalArabic(amount, Math.max(2, fractionDigits))} ج.م`;
}

export const PAYMENT_REQUEST_DETAIL_SNAPSHOT_VERSION = "farm-os.payment-request-detail.v1";

const REQUEST_STATUSES = [
  "draft",
  "submitted",
  "approved_operational",
  "approved_final",
  "paid",
  "closed",
] as const;
const EXPENSE_PAYMENT_STATUSES = [
  "paid_from_custody",
  "post_paid_unpaid",
  "paid_by_owner",
  "historical_treasury",
  "historical_reversed",
  "cancelled",
] as const;
const EXPENSE_KINDS = ["operating", "drawing", "capex"] as const;
const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;

type RequestStatus = (typeof REQUEST_STATUSES)[number];
type ExpensePaymentStatus = (typeof EXPENSE_PAYMENT_STATUSES)[number];
type ExpenseKind = (typeof EXPENSE_KINDS)[number];
type AccountType = (typeof ACCOUNT_TYPES)[number];

export type PaymentRequestDetailRequest = {
  id: string;
  request_no: number;
  status: RequestStatus;
  period_start: string | null;
  period_end: string | null;
  custody_account_id: string | null;
  custody_account_label: string | null;
  note: string | null;
  created_at: string;
  prepared_by: string | null;
  submitted_at: string | null;
  approved_op_by: string | null;
  approved_op_at: string | null;
  approved_final_by: string | null;
  approved_final_at: string | null;
};

export type PaymentRequestDetailExpense = {
  id: string;
  date: string | null;
  description: string | null;
  category: string | null;
  total: DecimalString;
  payment_status: ExpensePaymentStatus;
  kind: ExpenseKind;
  account_id: string | null;
};

export type PaymentRequestDetailLine = {
  id: string;
  expense_id: string;
  paid_at: string | null;
  paid_by: string | null;
  paid_from_custody_account_id: string | null;
  custody_movement_id: string | null;
  journal_entry_id: string | null;
  expense: PaymentRequestDetailExpense;
};

export type PaymentRequestDetailFunding = {
  id: string;
  occurred_at: string;
  amount: DecimalString;
  custody_account_id: string;
  custody_movement_id: string;
  journal_entry_id: string;
  note: string | null;
};

export type PaymentRequestDetailCustodyAccount = {
  id: string;
  holder_label: string;
  active: boolean;
};

export type PaymentRequestDetailAccount = {
  id: string;
  code: string;
  name_ar: string;
  account_type: AccountType;
  kind: ExpenseKind | null;
  parent_id: string | null;
  active: boolean;
};

export type PaymentRequestDetailActor = { user_id: string; name: string };

export type PaymentRequestDetailSnapshot = {
  orgId: string;
  requestId: string;
  request: PaymentRequestDetailRequest | null;
  totals: PaymentRequestTotals | null;
  organizationName: string | null;
  lines: PaymentRequestDetailLine[];
  fundings: PaymentRequestDetailFunding[];
  custodyAccounts: PaymentRequestDetailCustodyAccount[];
  accounts: PaymentRequestDetailAccount[];
  actors: PaymentRequestDetailActor[];
  availableExpenses: PaymentRequestDetailExpense[];
  availableExpenseCount: number;
  unclassifiedAvailableCount: number;
  availableExpensesTruncated: boolean;
};

function snapshotObject(value: unknown, label: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`payment request detail snapshot: ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function snapshotArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`payment request detail snapshot: ${label} must be an array`);
  }
  return value;
}

function snapshotString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`payment request detail snapshot: ${label} must be a non-empty string`);
  }
  return value;
}

function snapshotNullableString(value: unknown, label: string): string | null {
  return value == null ? null : snapshotString(value, label);
}

function snapshotNullableText(value: unknown, label: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new Error(`payment request detail snapshot: ${label} must be text`);
  }
  return value;
}

function snapshotEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  const parsed = snapshotString(value, label);
  if (!(allowed as readonly string[]).includes(parsed)) {
    throw new Error(`payment request detail snapshot: ${label} is unsupported`);
  }
  return parsed as T[number];
}

function snapshotNullableEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] | null {
  return value == null ? null : snapshotEnum(value, allowed, label);
}

function snapshotUuid(value: unknown, label: string): string {
  const parsed = snapshotString(value, label);
  // PostgreSQL's uuid type accepts the full canonical 8-4-4-4-12 hex shape,
  // including the farm's historical organization namespace with a zero version
  // nibble. Identity is still checked exactly below; rejecting valid database
  // UUID transport here made every payment-request detail page fail at render.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed)) {
    throw new Error(`payment request detail snapshot: ${label} must be a UUID`);
  }
  return parsed;
}

function snapshotNullableUuid(value: unknown, label: string): string | null {
  return value == null ? null : snapshotUuid(value, label);
}

function snapshotDate(value: unknown, label: string): string {
  const parsed = snapshotString(value, label);
  const instant = new Date(`${parsed}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed) || Number.isNaN(instant.getTime()) || instant.toISOString().slice(0, 10) !== parsed) {
    throw new Error(`payment request detail snapshot: ${label} must be an ISO date`);
  }
  return parsed;
}

function snapshotNullableDate(value: unknown, label: string): string | null {
  return value == null ? null : snapshotDate(value, label);
}

function snapshotTimestamp(value: unknown, label: string): string {
  const parsed = snapshotString(value, label);
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2})(?::?(\d{2}))?)$/.exec(parsed);
  if (!match) {
    throw new Error(`payment request detail snapshot: ${label} must be a timestamp`);
  }
  const [, year, month, day, hour, minute, second, offsetSign, offsetHour = "00", offsetMinute = "00"] = match;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const validCalendar =
    calendar.getUTCFullYear() === Number(year) &&
    calendar.getUTCMonth() === Number(month) - 1 &&
    calendar.getUTCDate() === Number(day);
  const validTime = Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
  const validOffset =
    !offsetSign ||
    (Number(offsetHour) <= 14 &&
      Number(offsetMinute) <= 59 &&
      (Number(offsetHour) < 14 || offsetMinute === "00"));
  if (!validCalendar || !validTime || !validOffset || Number.isNaN(Date.parse(parsed))) {
    throw new Error(`payment request detail snapshot: ${label} must be a timestamp`);
  }
  return parsed;
}

function snapshotNullableTimestamp(value: unknown, label: string): string | null {
  return value == null ? null : snapshotTimestamp(value, label);
}

function snapshotBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`payment request detail snapshot: ${label} must be boolean`);
  }
  return value;
}

function snapshotCount(value: unknown, label: string): number {
  const parsed = snapshotString(value, label);
  if (!/^\d+$/.test(parsed)) {
    throw new Error(`payment request detail snapshot: ${label} must be integer text`);
  }
  const count = Number(parsed);
  if (!Number.isSafeInteger(count)) {
    throw new Error(`payment request detail snapshot: ${label} exceeds safe display range`);
  }
  return count;
}

function snapshotInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`payment request detail snapshot: ${label} must be a non-negative safe integer`);
  }
  return value;
}

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`payment request detail snapshot: duplicate ${label}`);
  }
}

function parseDetailExpense(value: unknown, label: string): PaymentRequestDetailExpense {
  const row = snapshotObject(value, label);
  return {
    id: snapshotUuid(row.id, `${label}.id`),
    date: snapshotNullableDate(row.date, `${label}.date`),
    description: snapshotNullableText(row.description, `${label}.description`),
    category: snapshotNullableText(row.category, `${label}.category`),
    total: paymentRequestAmount(row.total, `${label}.total`),
    payment_status: snapshotEnum(row.payment_status, EXPENSE_PAYMENT_STATUSES, `${label}.payment_status`),
    kind: snapshotEnum(row.kind, EXPENSE_KINDS, `${label}.kind`),
    account_id: snapshotNullableUuid(row.account_id, `${label}.account_id`),
  };
}

export function parsePaymentRequestDetailSnapshot(
  value: unknown,
  expectedOrgId: string,
  expectedRequestId: string,
): PaymentRequestDetailSnapshot {
  const root = snapshotObject(value, "root");
  if (root.version !== PAYMENT_REQUEST_DETAIL_SNAPSHOT_VERSION) {
    throw new Error("payment request detail snapshot: unsupported version");
  }
  const orgId = snapshotUuid(root.org_id, "org_id");
  const requestId = snapshotUuid(root.request_id, "request_id");
  if (orgId !== expectedOrgId || requestId !== expectedRequestId) {
    throw new Error("payment request detail snapshot: identity mismatch");
  }

  const rawLines = snapshotArray(root.lines, "lines");
  const rawFundings = snapshotArray(root.fundings, "fundings");
  const rawCustodyAccounts = snapshotArray(root.custody_accounts, "custody_accounts");
  const rawAccounts = snapshotArray(root.accounts, "accounts");
  const rawActors = snapshotArray(root.actors, "actors");
  const rawAvailable = snapshotArray(root.available_expenses, "available_expenses");
  const availableExpenseCount = snapshotCount(root.available_expense_count, "available_expense_count");
  const unclassifiedAvailableCount = snapshotCount(root.unclassified_available_count, "unclassified_available_count");
  const availableExpensesTruncated = snapshotBoolean(root.available_expenses_truncated, "available_expenses_truncated");

  if (root.request == null) {
    if (
      root.totals != null || root.organization_name != null || rawLines.length || rawFundings.length ||
      rawCustodyAccounts.length || rawAccounts.length || rawActors.length || rawAvailable.length ||
      availableExpenseCount !== 0 || unclassifiedAvailableCount !== 0 || availableExpensesTruncated
    ) {
      throw new Error("payment request detail snapshot: missing request payload is inconsistent");
    }
    return {
      orgId, requestId, request: null, totals: null, organizationName: null,
      lines: [], fundings: [], custodyAccounts: [], accounts: [], actors: [], availableExpenses: [],
      availableExpenseCount: 0, unclassifiedAvailableCount: 0, availableExpensesTruncated: false,
    };
  }

  const requestRow = snapshotObject(root.request, "request");
  const request: PaymentRequestDetailRequest = {
    id: snapshotUuid(requestRow.id, "request.id"),
    request_no: snapshotInteger(requestRow.request_no, "request.request_no"),
    status: snapshotEnum(requestRow.status, REQUEST_STATUSES, "request.status"),
    period_start: snapshotNullableDate(requestRow.period_start, "request.period_start"),
    period_end: snapshotNullableDate(requestRow.period_end, "request.period_end"),
    custody_account_id: snapshotNullableUuid(requestRow.custody_account_id, "request.custody_account_id"),
    custody_account_label: snapshotNullableString(requestRow.custody_account_label, "request.custody_account_label"),
    note: snapshotNullableText(requestRow.note, "request.note"),
    created_at: snapshotTimestamp(requestRow.created_at, "request.created_at"),
    prepared_by: snapshotNullableUuid(requestRow.prepared_by, "request.prepared_by"),
    submitted_at: snapshotNullableTimestamp(requestRow.submitted_at, "request.submitted_at"),
    approved_op_by: snapshotNullableUuid(requestRow.approved_op_by, "request.approved_op_by"),
    approved_op_at: snapshotNullableTimestamp(requestRow.approved_op_at, "request.approved_op_at"),
    approved_final_by: snapshotNullableUuid(requestRow.approved_final_by, "request.approved_final_by"),
    approved_final_at: snapshotNullableTimestamp(requestRow.approved_final_at, "request.approved_final_at"),
  };
  if (request.id !== requestId) {
    throw new Error("payment request detail snapshot: invalid request identity or number");
  }
  if ((request.custody_account_id == null) !== (request.custody_account_label == null)) {
    throw new Error("payment request detail snapshot: request custody label mismatch");
  }

  const custodyAccounts = rawCustodyAccounts.map((value, index) => {
    const row = snapshotObject(value, `custody_accounts[${index}]`);
    return {
      id: snapshotUuid(row.id, `custody_accounts[${index}].id`),
      holder_label: snapshotString(row.holder_label, `custody_accounts[${index}].holder_label`),
      active: snapshotBoolean(row.active, `custody_accounts[${index}].active`),
    };
  });
  unique(custodyAccounts.map((row) => row.id), "custody account id");
  const custodyById = new Map(custodyAccounts.map((row) => [row.id, row]));
  if (request.custody_account_id && custodyById.get(request.custody_account_id)?.holder_label !== request.custody_account_label) {
    throw new Error("payment request detail snapshot: request custody account is inconsistent");
  }

  const accounts = rawAccounts.map((value, index) => {
    const row = snapshotObject(value, `accounts[${index}]`);
    return {
      id: snapshotUuid(row.id, `accounts[${index}].id`),
      code: snapshotString(row.code, `accounts[${index}].code`),
      name_ar: snapshotString(row.name_ar, `accounts[${index}].name_ar`),
      account_type: snapshotEnum(row.account_type, ACCOUNT_TYPES, `accounts[${index}].account_type`),
      kind: snapshotNullableEnum(row.kind, EXPENSE_KINDS, `accounts[${index}].kind`),
      parent_id: snapshotNullableUuid(row.parent_id, `accounts[${index}].parent_id`),
      active: snapshotBoolean(row.active, `accounts[${index}].active`),
    };
  });
  unique(accounts.map((row) => row.id), "account id");
  const accountIds = new Set(accounts.map((row) => row.id));

  const lines = rawLines.map((value, index) => {
    const row = snapshotObject(value, `lines[${index}]`);
    const expense = parseDetailExpense(row.expense, `lines[${index}].expense`);
    const line: PaymentRequestDetailLine = {
      id: snapshotUuid(row.id, `lines[${index}].id`),
      expense_id: snapshotUuid(row.expense_id, `lines[${index}].expense_id`),
      paid_at: snapshotNullableTimestamp(row.paid_at, `lines[${index}].paid_at`),
      paid_by: snapshotNullableText(row.paid_by, `lines[${index}].paid_by`),
      paid_from_custody_account_id: snapshotNullableUuid(row.paid_from_custody_account_id, `lines[${index}].paid_from_custody_account_id`),
      custody_movement_id: snapshotNullableUuid(row.custody_movement_id, `lines[${index}].custody_movement_id`),
      journal_entry_id: snapshotNullableUuid(row.journal_entry_id, `lines[${index}].journal_entry_id`),
      expense,
    };
    if (line.expense_id !== expense.id) throw new Error("payment request detail snapshot: line expense mismatch");
    if (expense.account_id && !accountIds.has(expense.account_id)) throw new Error("payment request detail snapshot: line account missing");
    if (line.paid_from_custody_account_id && !custodyById.has(line.paid_from_custody_account_id)) {
      throw new Error("payment request detail snapshot: line custody account missing");
    }
    const hasPaymentProof = [
      line.paid_from_custody_account_id,
      line.custody_movement_id,
      line.journal_entry_id,
    ].every((field) => field !== null);
    const hasAnyPaymentProof = [
      line.paid_from_custody_account_id,
      line.custody_movement_id,
      line.journal_entry_id,
    ].some((field) => field !== null);
    if (
      (line.paid_at === null && (hasAnyPaymentProof || expense.payment_status !== "post_paid_unpaid"))
      || (line.paid_at !== null && (!hasPaymentProof || expense.payment_status !== "paid_from_custody"))
    ) {
      throw new Error("payment request detail snapshot: inconsistent line payment state");
    }
    return line;
  });
  unique(lines.map((row) => row.id), "line id");
  unique(lines.map((row) => row.expense_id), "line expense id");

  const fundings = rawFundings.map((value, index) => {
    const row = snapshotObject(value, `fundings[${index}]`);
    const funding: PaymentRequestDetailFunding = {
      id: snapshotUuid(row.id, `fundings[${index}].id`),
      occurred_at: snapshotDate(row.occurred_at, `fundings[${index}].occurred_at`),
      amount: paymentRequestAmount(row.amount, `fundings[${index}].amount`),
      custody_account_id: snapshotUuid(row.custody_account_id, `fundings[${index}].custody_account_id`),
      custody_movement_id: snapshotUuid(row.custody_movement_id, `fundings[${index}].custody_movement_id`),
      journal_entry_id: snapshotUuid(row.journal_entry_id, `fundings[${index}].journal_entry_id`),
      note: snapshotNullableText(row.note, `fundings[${index}].note`),
    };
    if (!custodyById.has(funding.custody_account_id)) throw new Error("payment request detail snapshot: funding custody account missing");
    return funding;
  });
  unique(fundings.map((row) => row.id), "funding id");

  const actors = rawActors.map((value, index) => {
    const row = snapshotObject(value, `actors[${index}]`);
    return {
      user_id: snapshotUuid(row.user_id, `actors[${index}].user_id`),
      name: snapshotString(row.name, `actors[${index}].name`),
    };
  });
  unique(actors.map((row) => row.user_id), "actor user id");

  const availableExpenses = rawAvailable.map((value, index) =>
    parseDetailExpense(value, `available_expenses[${index}]`),
  );
  unique(availableExpenses.map((row) => row.id), "available expense id");
  const linkedExpenseIds = new Set(lines.map((row) => row.expense_id));
  for (const expense of availableExpenses) {
    if (
      expense.account_id == null ||
      !accountIds.has(expense.account_id) ||
      linkedExpenseIds.has(expense.id) ||
      !["post_paid_unpaid", "paid_from_custody"].includes(expense.payment_status)
    ) {
      throw new Error("payment request detail snapshot: invalid available expense");
    }
  }
  if (
    availableExpenseCount < availableExpenses.length ||
    availableExpensesTruncated !== (availableExpenseCount > availableExpenses.length)
  ) {
    throw new Error("payment request detail snapshot: available expense completeness mismatch");
  }

  return {
    orgId,
    requestId,
    request,
    totals: paymentRequestTotals(root.totals),
    organizationName: snapshotString(root.organization_name, "organization_name"),
    lines,
    fundings,
    custodyAccounts,
    accounts,
    actors,
    availableExpenses,
    availableExpenseCount,
    unclassifiedAvailableCount,
    availableExpensesTruncated,
  };
}
