import {
  parseDecimal,
  subtractDecimals,
  sumDecimals,
  type DecimalString,
} from "@/lib/decimal";

export const INCOME_STATEMENT_SNAPSHOT_VERSION = "farm-os.income-statement.v1";

export interface IncomeStatementLine {
  code: string;
  nameAr: string;
  amount: DecimalString;
  kind: string | null;
}

export interface IncomeStatement {
  orgId: string;
  periodStart: string;
  periodEnd: string;
  revenue: IncomeStatementLine[];
  expenses: IncomeStatementLine[];
  revenueTotal: DecimalString;
  expensesTotal: DecimalString;
  operatingExpenses: DecimalString;
  netIncome: DecimalString;
}

export function parseIncomeStatement(
  value: unknown,
  expectedOrgId: string,
  expectedStart: string,
  expectedEnd: string,
): IncomeStatement {
  const payload = object(value, "payload");
  if (payload.version !== INCOME_STATEMENT_SNAPSHOT_VERSION) fail("version is invalid");
  const orgId = text(payload.org_id, "org_id");
  if (orgId !== expectedOrgId) fail("organization does not match the active organization");
  const periodStart = date(payload.period_start, "period_start");
  const periodEnd = date(payload.period_end, "period_end");
  if (periodStart !== expectedStart || periodEnd !== expectedEnd) fail("period does not match the request");

  const revenue = lines(payload.revenue, "revenue", false);
  const expenses = lines(payload.expenses, "expenses", true);
  if (revenue.length !== count(payload.revenue_count, "revenue_count")) fail("revenue count does not match");
  if (expenses.length !== count(payload.expense_count, "expense_count")) fail("expense count does not match");
  uniqueCodes([...revenue, ...expenses]);
  const revenueTotal = decimal(payload.revenue_total, "revenue_total");
  const expensesTotal = decimal(payload.expenses_total, "expenses_total");
  const operatingExpenses = decimal(payload.operating_expenses, "operating_expenses");
  const netIncome = decimal(payload.net_income, "net_income");

  reconcileLines(revenue, revenueTotal, "revenue");
  reconcileLines(expenses, expensesTotal, "expenses");
  const operatingTotal = sumDecimals(
    expenses.filter((row) => row.kind === "operating").map((row) => row.amount),
  ).total;
  if (operatingTotal !== operatingExpenses) fail("operating expense lines do not reconcile");
  if (subtractDecimals(revenueTotal, expensesTotal) !== netIncome) fail("net income does not reconcile");

  return {
    orgId,
    periodStart,
    periodEnd,
    revenue,
    expenses,
    revenueTotal,
    expensesTotal,
    operatingExpenses,
    netIncome,
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be text`);
  return value;
}

function date(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) fail(`${label} must be an ISO date`);
  return result;
}

function nullableText(value: unknown, label: string): string | null {
  if (value === null) return null;
  return text(value, label);
}

function decimal(value: unknown, label: string): DecimalString {
  if (typeof value !== "string") fail(`${label} must be decimal text`);
  const result = parseDecimal(value);
  if (result === null) fail(`${label} is not valid decimal text`);
  return result;
}

function count(value: unknown, label: string): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) fail(`${label} must be integer text`);
  const result = Number(value);
  if (!Number.isSafeInteger(result)) fail(`${label} is outside the safe range`);
  return result;
}

function lines(value: unknown, label: string, includeKind: boolean): IncomeStatementLine[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value.map((entry, index) => {
    const row = object(entry, `${label}[${index}]`);
    const kind = nullableText(row.kind ?? null, `${label}[${index}].kind`);
    if (!includeKind && kind !== null) fail(`${label}[${index}] must not carry an account kind`);
    return {
      code: text(row.code, `${label}[${index}].code`),
      nameAr: text(row.name_ar, `${label}[${index}].name_ar`),
      amount: decimal(row.amount, `${label}[${index}].amount`),
      kind,
    };
  });
}

function uniqueCodes(rows: IncomeStatementLine[]): void {
  const codes = new Set<string>();
  for (const row of rows) {
    if (codes.has(row.code)) fail(`duplicate account code ${row.code}`);
    codes.add(row.code);
  }
}

function reconcileLines(rows: IncomeStatementLine[], total: DecimalString, label: string): void {
  if (sumDecimals(rows.map((row) => row.amount)).total !== total) {
    fail(`${label} lines do not reconcile to their total`);
  }
}

function fail(message: string): never {
  throw new Error(`income statement snapshot: ${message}`);
}
