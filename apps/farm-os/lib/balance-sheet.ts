import {
  compareDecimals,
  parseDecimal,
  subtractDecimals,
  sumDecimals,
  type DecimalString,
} from "@/lib/decimal";

export const BALANCE_SHEET_SNAPSHOT_VERSION = "farm-os.balance-sheet.v1";

export interface BalanceSheetLine {
  code: string;
  nameAr: string;
  balance: DecimalString;
  kind: string | null;
}

export interface BalanceSheet {
  orgId: string;
  asOf: string;
  assets: BalanceSheetLine[];
  liabilities: BalanceSheetLine[];
  equity: BalanceSheetLine[];
  assetsTotal: DecimalString;
  liabilitiesTotal: DecimalString;
  equityTotal: DecimalString;
  drawingsTotal: DecimalString;
  revenueTotal: DecimalString;
  expenseTotal: DecimalString;
  netIncome: DecimalString;
  totalEquityInclIncome: DecimalString;
  liabilitiesPlusEquity: DecimalString;
  balanced: boolean;
}

export function parseBalanceSheet(value: unknown, expectedOrgId: string, expectedAsOf: string): BalanceSheet {
  const payload = object(value, "payload");
  if (payload.version !== BALANCE_SHEET_SNAPSHOT_VERSION) fail("version is invalid");
  const orgId = text(payload.org_id, "org_id");
  if (orgId !== expectedOrgId) fail("organization does not match the active organization");
  const asOf = date(payload.as_of, "as_of");
  if (asOf !== expectedAsOf) fail("as-of date does not match the request");

  const assets = lines(payload.assets, "assets", false);
  const liabilities = lines(payload.liabilities, "liabilities", false);
  const equity = lines(payload.equity, "equity", true);
  if (assets.length !== count(payload.asset_count, "asset_count")) fail("asset count does not match");
  if (liabilities.length !== count(payload.liability_count, "liability_count")) {
    fail("liability count does not match");
  }
  if (equity.length !== count(payload.equity_count, "equity_count")) fail("equity count does not match");
  uniqueCodes([...assets, ...liabilities, ...equity]);

  const assetsTotal = decimal(payload.assets_total, "assets_total");
  const liabilitiesTotal = decimal(payload.liabilities_total, "liabilities_total");
  const equityTotal = decimal(payload.equity_total, "equity_total");
  const drawingsTotal = decimal(payload.drawings_total, "drawings_total");
  const revenueTotal = decimal(payload.revenue_total, "revenue_total");
  const expenseTotal = decimal(payload.expense_total, "expense_total");
  const netIncome = decimal(payload.net_income, "net_income");
  const totalEquityInclIncome = decimal(payload.total_equity_incl_income, "total_equity_incl_income");
  const liabilitiesPlusEquity = decimal(payload.liabilities_plus_equity, "liabilities_plus_equity");
  const balanced = bool(payload.balanced, "balanced");

  reconcileLines(assets, assetsTotal, "assets");
  reconcileLines(liabilities, liabilitiesTotal, "liabilities");
  reconcileLines(equity, equityTotal, "equity");
  const drawingBalance = sumDecimals(
    equity.filter((row) => row.kind === "drawing").map((row) => row.balance),
  ).total;
  if (subtractDecimals("0", drawingBalance) !== drawingsTotal) {
    fail("drawings total does not reconcile");
  }
  if (subtractDecimals(revenueTotal, expenseTotal) !== netIncome) fail("net income does not reconcile");
  if (sumDecimals([equityTotal, netIncome]).total !== totalEquityInclIncome) {
    fail("equity including income does not reconcile");
  }
  if (sumDecimals([liabilitiesTotal, totalEquityInclIncome]).total !== liabilitiesPlusEquity) {
    fail("liabilities plus equity does not reconcile");
  }
  if ((compareDecimals(assetsTotal, liabilitiesPlusEquity) === 0) !== balanced) {
    fail("balanced flag does not match the accounting identity");
  }

  return {
    orgId,
    asOf,
    assets,
    liabilities,
    equity,
    assetsTotal,
    liabilitiesTotal,
    equityTotal,
    drawingsTotal,
    revenueTotal,
    expenseTotal,
    netIncome,
    totalEquityInclIncome,
    liabilitiesPlusEquity,
    balanced,
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

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} must be boolean`);
  return value;
}

function count(value: unknown, label: string): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) fail(`${label} must be integer text`);
  const result = Number(value);
  if (!Number.isSafeInteger(result)) fail(`${label} is outside the safe range`);
  return result;
}

function lines(value: unknown, label: string, includeKind: boolean): BalanceSheetLine[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value.map((entry, index) => {
    const row = object(entry, `${label}[${index}]`);
    const kind = nullableText(row.kind ?? null, `${label}[${index}].kind`);
    if (!includeKind && kind !== null) fail(`${label}[${index}] must not carry an account kind`);
    return {
      code: text(row.code, `${label}[${index}].code`),
      nameAr: text(row.name_ar, `${label}[${index}].name_ar`),
      balance: decimal(row.balance, `${label}[${index}].balance`),
      kind,
    };
  });
}

function uniqueCodes(rows: BalanceSheetLine[]): void {
  const codes = new Set<string>();
  for (const row of rows) {
    if (codes.has(row.code)) fail(`duplicate account code ${row.code}`);
    codes.add(row.code);
  }
}

function reconcileLines(rows: BalanceSheetLine[], total: DecimalString, label: string): void {
  if (sumDecimals(rows.map((row) => row.balance)).total !== total) {
    fail(`${label} lines do not reconcile to their total`);
  }
}

function fail(message: string): never {
  throw new Error(`balance sheet snapshot: ${message}`);
}
