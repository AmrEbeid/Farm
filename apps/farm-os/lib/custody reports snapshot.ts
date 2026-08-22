import {
  compareDecimals,
  maxDecimal,
  parseDecimal,
  subtractDecimals,
  sumDecimals,
  type DecimalString,
} from "./decimal";

export const CUSTODY_REPORTS_SNAPSHOT_VERSION = "farm-os.custody-reports.v1";

export interface CustodyReportsSummary {
  holderCount: number;
  movementCount: number;
  cashCount: number;
  cashMissingMovementCount: number;
  cashUnknownTotalCount: number;
  obligationCount: number;
  obligationUnknownTotalCount: number;
  obligationUnknownDateCount: number;
  over30Count: number;
  over30UnknownTotalCount: number;
  fundingCount: number;
  openingTotal: DecimalString;
  periodIn: DecimalString;
  periodOut: DecimalString;
  closingTotal: DecimalString;
  cashTotal: DecimalString;
  obligationTotal: DecimalString;
  over30Total: DecimalString;
  fundingTotal: DecimalString;
}

export interface CustodyReportHolder {
  id: string;
  holderLabel: string;
  targetFloat: DecimalString;
  active: boolean;
  openingBalance: DecimalString;
  amountIn: DecimalString;
  amountOut: DecimalString;
  closingBalance: DecimalString;
  movementCount: number;
}

export interface CustodyReportMovement {
  id: string;
  custodyAccountId: string;
  holderLabel: string;
  occurredAt: string;
  movementType: string;
  amountIn: DecimalString;
  amountOut: DecimalString;
  net: DecimalString;
  expenseId: string | null;
  paymentRequestId: string | null;
  transferGroupId: string | null;
  note: string | null;
}

export interface CustodyCashExpense {
  id: string;
  expenseDate: string | null;
  category: string | null;
  description: string | null;
  total: DecimalString | null;
  kind: "operating" | "drawing" | "capex";
  paidBy: string | null;
  movementId: string | null;
  paidAt: string | null;
  holderLabel: string | null;
  paymentRequestId: string | null;
  missingMovement: boolean;
}

export interface CustodyObligation {
  id: string;
  expenseDate: string | null;
  category: string | null;
  description: string | null;
  total: DecimalString | null;
  kind: "operating" | "drawing" | "capex";
  ageDays: number | null;
  agingBucket: "unknown" | "0-29" | "30-59" | "60+";
  paymentRequestId: string | null;
  requestNo: number | null;
  requestStatus: string | null;
}

export interface CustodyFunding {
  id: string;
  paymentRequestId: string;
  requestNo: number;
  requestStatus: string;
  requestPeriodStart: string | null;
  requestPeriodEnd: string | null;
  holderLabel: string;
  occurredAt: string;
  amount: DecimalString;
  note: string | null;
  approvedNetRequest: DecimalString | null;
  grossRequest: DecimalString;
  ownerFundingReceived: DecimalString;
  remainingToFund: DecimalString;
}

export interface CustodyReportsSnapshot {
  periodStart: string;
  periodEnd: string;
  asOf: string;
  rowLimit: number;
  summary: CustodyReportsSummary;
  holders: CustodyReportHolder[];
  movements: CustodyReportMovement[];
  cashExpenses: CustodyCashExpense[];
  obligations: CustodyObligation[];
  fundings: CustodyFunding[];
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`custody reports snapshot: ${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`custody reports snapshot: field "${key}" must be text`);
  }
  return value;
}

function nullableText(row: Record<string, unknown>, key: string): string | null {
  if (row[key] === null) return null;
  return text(row, key);
}

function integer(row: Record<string, unknown>, key: string, max = Number.MAX_SAFE_INTEGER): number {
  const value = row[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) {
    throw new Error(`custody reports snapshot: field "${key}" is outside its safe range`);
  }
  return value as number;
}

function nullableInteger(row: Record<string, unknown>, key: string): number | null {
  return row[key] === null ? null : integer(row, key);
}

function positiveInteger(row: Record<string, unknown>, key: string): number {
  const value = integer(row, key);
  if (value < 1) throw new Error(`custody reports snapshot: field "${key}" must be positive`);
  return value;
}

function nullablePositiveInteger(row: Record<string, unknown>, key: string): number | null {
  return row[key] === null ? null : positiveInteger(row, key);
}

function boolean(row: Record<string, unknown>, key: string): boolean {
  if (typeof row[key] !== "boolean") {
    throw new Error(`custody reports snapshot: field "${key}" must be boolean`);
  }
  return row[key];
}

function decimal(
  row: Record<string, unknown>,
  key: string,
  {
    nullable = false,
    nonNegative = false,
    positive = false,
  }: { nullable?: boolean; nonNegative?: boolean; positive?: boolean } = {},
): DecimalString | null {
  if (row[key] === null && nullable) return null;
  if (typeof row[key] !== "string") {
    throw new Error(`custody reports snapshot: field "${key}" must be exact decimal text${nullable ? " or null" : ""}`);
  }
  const parsed = parseDecimal(row[key]);
  if (
    parsed === null ||
    (nonNegative && compareDecimals(parsed, "0") < 0) ||
    (positive && compareDecimals(parsed, "0") <= 0)
  ) {
    throw new Error(`custody reports snapshot: field "${key}" is not a valid decimal`);
  }
  return parsed;
}

function calendarDate(row: Record<string, unknown>, key: string, nullable = false): string | null {
  if (row[key] === null && nullable) return null;
  const value = text(row, key);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`custody reports snapshot: field "${key}" must be a calendar date`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`custody reports snapshot: field "${key}" must be a calendar date`);
  }
  return value;
}

function array(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`custody reports snapshot: ${context} must be an array`);
  return value;
}

function kind(row: Record<string, unknown>): CustodyCashExpense["kind"] {
  if (row.kind === "operating" || row.kind === "drawing" || row.kind === "capex") return row.kind;
  throw new Error("custody reports snapshot: expense kind is invalid");
}

function unique(id: string, seen: Set<string>, context: string): void {
  if (seen.has(id)) throw new Error(`custody reports snapshot: duplicate ${context} ${id}`);
  seen.add(id);
}

function exactSum(values: Array<DecimalString | null>): DecimalString {
  const summary = sumDecimals(values.filter((value): value is DecimalString => value !== null));
  if (summary.hasUnknown) throw new Error("custody reports snapshot: exact sum failed");
  return summary.total;
}

function expectEqual(left: DecimalString, right: DecimalString, context: string): void {
  if (compareDecimals(left, right) !== 0) {
    throw new Error(`custody reports snapshot: ${context} is inconsistent`);
  }
}

function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

export function parseCustodyReportsSnapshot(
  value: unknown,
  expectedOrgId: string,
  expectedStart: string,
  expectedEnd: string,
  expectedAsOf: string,
): CustodyReportsSnapshot {
  const payload = object(value, "payload");
  if (payload.version !== CUSTODY_REPORTS_SNAPSHOT_VERSION) {
    throw new Error("custody reports snapshot: version is invalid");
  }
  if (text(payload, "org_id") !== expectedOrgId) {
    throw new Error("custody reports snapshot: organization does not match the active organization");
  }
  const periodStart = calendarDate(payload, "period_start")!;
  const periodEnd = calendarDate(payload, "period_end")!;
  const asOf = calendarDate(payload, "as_of")!;
  if (periodStart !== expectedStart || periodEnd !== expectedEnd || asOf !== expectedAsOf || periodStart > periodEnd) {
    throw new Error("custody reports snapshot: requested dates do not match");
  }
  const rowLimit = integer(payload, "row_limit", 400);
  if (rowLimit < 1) throw new Error("custody reports snapshot: row limit must be positive");
  if (integer(payload, "relationship_mismatch_count") !== 0) {
    throw new Error("custody reports snapshot: relationship organization is invalid");
  }

  const rawSummary = object(payload.summary, "summary");
  const summary: CustodyReportsSummary = {
    holderCount: integer(rawSummary, "holder_count"),
    movementCount: integer(rawSummary, "movement_count"),
    cashCount: integer(rawSummary, "cash_count"),
    cashMissingMovementCount: integer(rawSummary, "cash_missing_movement_count"),
    cashUnknownTotalCount: integer(rawSummary, "cash_unknown_total_count"),
    obligationCount: integer(rawSummary, "obligation_count"),
    obligationUnknownTotalCount: integer(rawSummary, "obligation_unknown_total_count"),
    obligationUnknownDateCount: integer(rawSummary, "obligation_unknown_date_count"),
    over30Count: integer(rawSummary, "over_30_count"),
    over30UnknownTotalCount: integer(rawSummary, "over_30_unknown_total_count"),
    fundingCount: integer(rawSummary, "funding_count"),
    openingTotal: decimal(rawSummary, "opening_total")!,
    periodIn: decimal(rawSummary, "period_in", { nonNegative: true })!,
    periodOut: decimal(rawSummary, "period_out", { nonNegative: true })!,
    closingTotal: decimal(rawSummary, "closing_total")!,
    cashTotal: decimal(rawSummary, "cash_total", { nonNegative: true })!,
    obligationTotal: decimal(rawSummary, "obligation_total", { nonNegative: true })!,
    over30Total: decimal(rawSummary, "over_30_total", { nonNegative: true })!,
    fundingTotal: decimal(rawSummary, "funding_total", { nonNegative: true })!,
  };
  if (
    summary.cashMissingMovementCount > summary.cashCount ||
    summary.cashUnknownTotalCount > summary.cashCount ||
    summary.obligationUnknownTotalCount > summary.obligationCount ||
    summary.obligationUnknownDateCount > summary.obligationCount ||
    summary.over30Count > summary.obligationCount ||
    summary.over30UnknownTotalCount > summary.over30Count ||
    compareDecimals(summary.over30Total, summary.obligationTotal) > 0
  ) {
    throw new Error("custody reports snapshot: summary counts are inconsistent");
  }
  expectEqual(
    subtractDecimals(exactSum([summary.openingTotal, summary.periodIn]), summary.periodOut),
    summary.closingTotal,
    "summary custody movement",
  );

  const holderIds = new Set<string>();
  const holders = array(payload.holders, "holders").map((raw, index): CustodyReportHolder => {
    const row = object(raw, `holder ${index}`);
    const item: CustodyReportHolder = {
      id: text(row, "id"),
      holderLabel: text(row, "holder_label"),
      targetFloat: decimal(row, "target_float", { nonNegative: true })!,
      active: boolean(row, "active"),
      openingBalance: decimal(row, "opening_balance")!,
      amountIn: decimal(row, "amount_in", { nonNegative: true })!,
      amountOut: decimal(row, "amount_out", { nonNegative: true })!,
      closingBalance: decimal(row, "closing_balance")!,
      movementCount: integer(row, "movement_count"),
    };
    unique(item.id, holderIds, "holder");
    expectEqual(
      subtractDecimals(exactSum([item.openingBalance, item.amountIn]), item.amountOut),
      item.closingBalance,
      "holder custody movement",
    );
    return item;
  });
  if (holders.length !== Math.min(summary.holderCount, rowLimit)) {
    throw new Error("custody reports snapshot: holder sample is incomplete");
  }
  if (summary.holderCount <= rowLimit) {
    if (holders.reduce((sum, row) => sum + row.movementCount, 0) !== summary.movementCount) {
      throw new Error("custody reports snapshot: holder counts are inconsistent");
    }
    expectEqual(exactSum(holders.map((row) => row.openingBalance)), summary.openingTotal, "holder opening total");
    expectEqual(exactSum(holders.map((row) => row.amountIn)), summary.periodIn, "holder incoming total");
    expectEqual(exactSum(holders.map((row) => row.amountOut)), summary.periodOut, "holder outgoing total");
    expectEqual(exactSum(holders.map((row) => row.closingBalance)), summary.closingTotal, "holder closing total");
  }

  const movementIds = new Set<string>();
  const movements = array(payload.movements, "movements").map((raw, index): CustodyReportMovement => {
    const row = object(raw, `movement ${index}`);
    const item: CustodyReportMovement = {
      id: text(row, "id"),
      custodyAccountId: text(row, "custody_account_id"),
      holderLabel: text(row, "holder_label"),
      occurredAt: calendarDate(row, "occurred_at")!,
      movementType: text(row, "movement_type"),
      amountIn: decimal(row, "amount_in", { nonNegative: true })!,
      amountOut: decimal(row, "amount_out", { nonNegative: true })!,
      net: decimal(row, "net")!,
      expenseId: nullableText(row, "expense_id"),
      paymentRequestId: nullableText(row, "payment_request_id"),
      transferGroupId: nullableText(row, "transfer_group_id"),
      note: nullableText(row, "note"),
    };
    unique(item.id, movementIds, "movement");
    if (item.occurredAt < periodStart || item.occurredAt > periodEnd) {
      throw new Error("custody reports snapshot: movement is outside the requested period");
    }
    expectEqual(subtractDecimals(item.amountIn, item.amountOut), item.net, "movement net");
    if ((compareDecimals(item.amountIn, "0") > 0) === (compareDecimals(item.amountOut, "0") > 0)) {
      throw new Error("custody reports snapshot: movement direction is invalid");
    }
    return item;
  });
  if (movements.length !== Math.min(summary.movementCount, rowLimit)) {
    throw new Error("custody reports snapshot: movement sample is incomplete");
  }

  const cashIds = new Set<string>();
  const cashExpenses = array(payload.cash_expenses, "cash expenses").map((raw, index): CustodyCashExpense => {
    const row = object(raw, `cash expense ${index}`);
    const item: CustodyCashExpense = {
      id: text(row, "id"),
      expenseDate: calendarDate(row, "expense_date", true),
      category: nullableText(row, "category"),
      description: nullableText(row, "description"),
      total: decimal(row, "total", { nullable: true, nonNegative: true }),
      kind: kind(row),
      paidBy: nullableText(row, "paid_by"),
      movementId: nullableText(row, "movement_id"),
      paidAt: calendarDate(row, "paid_at", true),
      holderLabel: nullableText(row, "holder_label"),
      paymentRequestId: nullableText(row, "payment_request_id"),
      missingMovement: boolean(row, "missing_movement"),
    };
    unique(item.id, cashIds, "cash expense");
    const reportDate = item.paidAt ?? item.expenseDate;
    if (reportDate === null || reportDate < periodStart || reportDate > periodEnd) {
      throw new Error("custody reports snapshot: cash expense is outside the requested period");
    }
    if (item.missingMovement !== (item.movementId === null) || (item.movementId === null) !== (item.holderLabel === null)) {
      throw new Error("custody reports snapshot: cash movement state is inconsistent");
    }
    return item;
  });
  if (cashExpenses.length !== Math.min(summary.cashCount, rowLimit)) {
    throw new Error("custody reports snapshot: cash expense sample is incomplete");
  }
  if (summary.cashCount <= rowLimit) {
    if (
      cashExpenses.filter((row) => row.missingMovement).length !== summary.cashMissingMovementCount ||
      cashExpenses.filter((row) => row.total === null).length !== summary.cashUnknownTotalCount
    ) {
      throw new Error("custody reports snapshot: cash unknown-total count is inconsistent");
    }
    expectEqual(exactSum(cashExpenses.map((row) => row.total)), summary.cashTotal, "cash expense total");
  }

  const obligationIds = new Set<string>();
  const obligations = array(payload.obligations, "obligations").map((raw, index): CustodyObligation => {
    const row = object(raw, `obligation ${index}`);
    const item: CustodyObligation = {
      id: text(row, "id"),
      expenseDate: calendarDate(row, "expense_date", true),
      category: nullableText(row, "category"),
      description: nullableText(row, "description"),
      total: decimal(row, "total", { nullable: true, nonNegative: true }),
      kind: kind(row),
      ageDays: nullableInteger(row, "age_days"),
      agingBucket: row.aging_bucket as CustodyObligation["agingBucket"],
      paymentRequestId: nullableText(row, "payment_request_id"),
      requestNo: nullablePositiveInteger(row, "request_no"),
      requestStatus: nullableText(row, "request_status"),
    };
    unique(item.id, obligationIds, "obligation");
    if (!(["unknown", "0-29", "30-59", "60+"] as unknown[]).includes(item.agingBucket)) {
      throw new Error("custody reports snapshot: aging bucket is invalid");
    }
    if (item.expenseDate === null) {
      if (item.ageDays !== null || item.agingBucket !== "unknown") {
        throw new Error("custody reports snapshot: unknown obligation date is inconsistent");
      }
    } else {
      if (item.expenseDate > asOf || item.ageDays !== daysBetween(item.expenseDate, asOf)) {
        throw new Error("custody reports snapshot: obligation age is inconsistent");
      }
      const expectedBucket = item.ageDays >= 60 ? "60+" : item.ageDays >= 30 ? "30-59" : "0-29";
      if (item.agingBucket !== expectedBucket) {
        throw new Error("custody reports snapshot: obligation aging bucket is inconsistent");
      }
    }
    if (
      (item.paymentRequestId === null && (item.requestNo !== null || item.requestStatus !== null)) ||
      (item.paymentRequestId !== null && (item.requestNo === null || item.requestStatus === null))
    ) {
      throw new Error("custody reports snapshot: obligation request state is inconsistent");
    }
    return item;
  });
  if (obligations.length !== Math.min(summary.obligationCount, rowLimit)) {
    throw new Error("custody reports snapshot: obligation sample is incomplete");
  }
  if (summary.obligationCount <= rowLimit) {
    if (
      obligations.filter((row) => row.total === null).length !== summary.obligationUnknownTotalCount ||
      obligations.filter((row) => row.expenseDate === null).length !== summary.obligationUnknownDateCount ||
      obligations.filter((row) => row.ageDays !== null && row.ageDays >= 30).length !== summary.over30Count ||
      obligations.filter((row) => row.ageDays !== null && row.ageDays >= 30 && row.total === null).length !== summary.over30UnknownTotalCount
    ) {
      throw new Error("custody reports snapshot: obligation counts are inconsistent");
    }
    expectEqual(exactSum(obligations.map((row) => row.total)), summary.obligationTotal, "obligation total");
    expectEqual(
      exactSum(obligations.filter((row) => row.ageDays !== null && row.ageDays >= 30).map((row) => row.total)),
      summary.over30Total,
      "over-30 obligation total",
    );
  }

  const fundingIds = new Set<string>();
  const fundings = array(payload.fundings, "fundings").map((raw, index): CustodyFunding => {
    const row = object(raw, `funding ${index}`);
    const item: CustodyFunding = {
      id: text(row, "id"),
      paymentRequestId: text(row, "payment_request_id"),
      requestNo: positiveInteger(row, "request_no"),
      requestStatus: text(row, "request_status"),
      requestPeriodStart: calendarDate(row, "request_period_start", true),
      requestPeriodEnd: calendarDate(row, "request_period_end", true),
      holderLabel: text(row, "holder_label"),
      occurredAt: calendarDate(row, "occurred_at")!,
      amount: decimal(row, "amount", { positive: true })!,
      note: nullableText(row, "note"),
      approvedNetRequest: decimal(row, "approved_net_request", { nullable: true, nonNegative: true }),
      grossRequest: decimal(row, "gross_request", { nonNegative: true })!,
      ownerFundingReceived: decimal(row, "owner_funding_received", { nonNegative: true })!,
      remainingToFund: decimal(row, "remaining_to_fund", { nonNegative: true })!,
    };
    unique(item.id, fundingIds, "funding");
    if (item.occurredAt < periodStart || item.occurredAt > periodEnd) {
      throw new Error("custody reports snapshot: funding is outside the requested period");
    }
    if (item.requestPeriodStart !== null && item.requestPeriodEnd !== null && item.requestPeriodStart > item.requestPeriodEnd) {
      throw new Error("custody reports snapshot: funding request period is invalid");
    }
    const basis = item.approvedNetRequest ?? item.grossRequest;
    expectEqual(maxDecimal(subtractDecimals(basis, item.ownerFundingReceived), "0"), item.remainingToFund, "funding remaining amount");
    return item;
  });
  if (fundings.length !== Math.min(summary.fundingCount, rowLimit)) {
    throw new Error("custody reports snapshot: funding sample is incomplete");
  }
  if (summary.fundingCount <= rowLimit) {
    expectEqual(exactSum(fundings.map((row) => row.amount)), summary.fundingTotal, "funding total");
  }

  return { periodStart, periodEnd, asOf, rowLimit, summary, holders, movements, cashExpenses, obligations, fundings };
}
