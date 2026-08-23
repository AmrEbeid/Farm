import {
  compareDecimals,
  parseDecimal,
  subtractDecimals,
  sumDecimals,
  type DecimalString,
} from "./decimal";

export const CHART_OF_ACCOUNTS_SNAPSHOT_VERSION = "farm-os.chart-of-accounts.v1";

export type ChartAccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type ChartAccountKind = "operating" | "drawing" | "capex";
export type ChartNormalBalance = "debit" | "credit";

export interface ChartOfAccountsNode {
  id: string;
  code: string;
  nameAr: string;
  accountType: ChartAccountType;
  normalBalance: ChartNormalBalance;
  parentId: string | null;
  kind: ChartAccountKind | null;
  isSystem: boolean;
  sortOrder: number | null;
  active: boolean;
  childCount: string;
  activeChildCount: string;
  postingCount: string;
  debit: DecimalString;
  credit: DecimalString;
  balance: DecimalString;
}

export interface ChartOfAccountsSnapshot {
  canWrite: boolean;
  totals: {
    accountCount: string;
    activeCount: string;
    archivedCount: string;
    postingLeafCount: string;
    operatingBalance: DecimalString;
    drawingBalance: DecimalString;
    capexBalance: DecimalString;
  };
  accounts: ChartOfAccountsNode[];
}

type Row = Record<string, unknown>;

function object(value: unknown, context: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`chart of accounts snapshot: ${context} must be an object`);
  }
  return value as Row;
}

function exactKeys(row: Row, keys: readonly string[], context: string): void {
  const expected = new Set(keys);
  const extra = Object.keys(row).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !(key in row));
  if (extra.length || missing.length) {
    throw new Error(`chart of accounts snapshot: ${context} shape is invalid`);
  }
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`chart of accounts snapshot: ${key} must be non-empty text`);
  }
  return value;
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`chart of accounts snapshot: ${key} must be text or null`);
  }
  return value;
}

function boolean(row: Row, key: string): boolean {
  if (typeof row[key] !== "boolean") {
    throw new Error(`chart of accounts snapshot: ${key} must be boolean`);
  }
  return row[key] as boolean;
}

function nullableInteger(row: Row, key: string): number | null {
  const value = row[key];
  if (value === null) return null;
  if (!Number.isSafeInteger(value)) {
    throw new Error(`chart of accounts snapshot: ${key} must be a safe integer or null`);
  }
  return value as number;
}

function exactCount(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`chart of accounts snapshot: ${key} must be exact count text`);
  }
  return value;
}

function money(row: Row, key: string): DecimalString {
  if (typeof row[key] !== "string") {
    throw new Error(`chart of accounts snapshot: ${key} must be decimal text`);
  }
  const value = parseDecimal(row[key]);
  if (value === null) throw new Error(`chart of accounts snapshot: ${key} is unreadable`);
  return value;
}

function oneOf<T extends string>(row: Row, key: string, values: readonly T[]): T {
  const value = text(row, key);
  if (!(values as readonly string[]).includes(value)) {
    throw new Error(`chart of accounts snapshot: ${key} is invalid`);
  }
  return value as T;
}

const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;
const NORMAL_BALANCES = ["debit", "credit"] as const;
const ACCOUNT_KINDS = ["operating", "drawing", "capex"] as const;

function countAsNumber(value: string, context: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`chart of accounts snapshot: ${context} exceeds the safe UI bound`);
  }
  return parsed;
}

export function parseChartOfAccountsSnapshot(
  value: unknown,
  expectedOrgId: string,
): ChartOfAccountsSnapshot {
  const root = object(value, "payload");
  exactKeys(root, ["version", "org_id", "can_write", "totals", "accounts"], "payload");
  if (root.version !== CHART_OF_ACCOUNTS_SNAPSHOT_VERSION) {
    throw new Error("chart of accounts snapshot: version is invalid");
  }
  if (text(root, "org_id") !== expectedOrgId) {
    throw new Error("chart of accounts snapshot: organization does not match the active organization");
  }
  const canWrite = boolean(root, "can_write");
  const rawTotals = object(root.totals, "totals");
  exactKeys(rawTotals, [
    "account_count", "active_count", "archived_count", "posting_leaf_count",
    "operating_balance", "drawing_balance", "capex_balance",
  ], "totals");
  const totals = {
    accountCount: exactCount(rawTotals, "account_count"),
    activeCount: exactCount(rawTotals, "active_count"),
    archivedCount: exactCount(rawTotals, "archived_count"),
    postingLeafCount: exactCount(rawTotals, "posting_leaf_count"),
    operatingBalance: money(rawTotals, "operating_balance"),
    drawingBalance: money(rawTotals, "drawing_balance"),
    capexBalance: money(rawTotals, "capex_balance"),
  };
  if (!Array.isArray(root.accounts)) {
    throw new Error("chart of accounts snapshot: accounts must be an array");
  }
  const accounts = root.accounts.map((value, index): ChartOfAccountsNode => {
    const row = object(value, `account ${index}`);
    exactKeys(row, [
      "id", "parent_id", "code", "name_ar", "account_type", "normal_balance", "kind",
      "active", "is_system", "sort_order", "child_count", "active_child_count", "posting_count",
      "debit", "credit", "balance",
    ], `account ${index}`);
    const normalBalance = oneOf(row, "normal_balance", NORMAL_BALANCES);
    const debit = money(row, "debit");
    const credit = money(row, "credit");
    const balance = money(row, "balance");
    const expectedBalance = normalBalance === "credit"
      ? subtractDecimals(credit, debit)
      : subtractDecimals(debit, credit);
    if (compareDecimals(balance, expectedBalance) !== 0) {
      throw new Error(`chart of accounts snapshot: account ${index} balance does not reconcile`);
    }
    const rawKind = nullableText(row, "kind");
    if (rawKind !== null && !(ACCOUNT_KINDS as readonly string[]).includes(rawKind)) {
      throw new Error(`chart of accounts snapshot: account ${index} kind is invalid`);
    }
    return {
      id: text(row, "id"),
      parentId: nullableText(row, "parent_id"),
      code: text(row, "code"),
      nameAr: text(row, "name_ar"),
      accountType: oneOf(row, "account_type", ACCOUNT_TYPES),
      normalBalance,
      kind: rawKind as ChartAccountKind | null,
      active: boolean(row, "active"),
      isSystem: boolean(row, "is_system"),
      sortOrder: nullableInteger(row, "sort_order"),
      childCount: exactCount(row, "child_count"),
      activeChildCount: exactCount(row, "active_child_count"),
      postingCount: exactCount(row, "posting_count"),
      debit,
      credit,
      balance,
    };
  });

  const byId = new Map<string, ChartOfAccountsNode>();
  for (const account of accounts) {
    if (byId.has(account.id)) throw new Error("chart of accounts snapshot: duplicate account id");
    byId.set(account.id, account);
  }
  for (const account of accounts) {
    if (account.parentId !== null && !byId.has(account.parentId)) {
      throw new Error("chart of accounts snapshot: account parent is missing");
    }
    const children = accounts.filter((candidate) => candidate.parentId === account.id);
    const activeChildren = children.filter((candidate) => candidate.active);
    if (countAsNumber(account.childCount, "child count") !== children.length
      || countAsNumber(account.activeChildCount, "active child count") !== activeChildren.length) {
      throw new Error("chart of accounts snapshot: account child counts do not reconcile");
    }
  }
  for (const account of accounts) {
    const visited = new Set([account.id]);
    let current = account;
    let depth = 1;
    while (current.parentId !== null) {
      if (visited.has(current.parentId)) {
        throw new Error("chart of accounts snapshot: account hierarchy contains a cycle");
      }
      const parent = byId.get(current.parentId);
      if (!parent) {
        throw new Error("chart of accounts snapshot: account parent is missing");
      }
      visited.add(parent.id);
      depth += 1;
      if (depth > 4) {
        throw new Error("chart of accounts snapshot: account hierarchy exceeds four levels");
      }
      current = parent;
    }
  }
  const activeCount = accounts.filter((account) => account.active).length;
  const archivedCount = accounts.length - activeCount;
  const postingLeafCount = accounts.filter((account) =>
    account.active && account.kind !== null && account.activeChildCount === "0").length;
  if (countAsNumber(totals.accountCount, "account total") !== accounts.length
    || countAsNumber(totals.activeCount, "active total") !== activeCount
    || countAsNumber(totals.archivedCount, "archived total") !== archivedCount
    || countAsNumber(totals.postingLeafCount, "posting leaf total") !== postingLeafCount) {
    throw new Error("chart of accounts snapshot: totals do not reconcile");
  }
  const rootBalance = (kind: ChartAccountKind) => sumDecimals(accounts
    .filter((account) => account.parentId === null && account.kind === kind)
    .map((account) => account.balance)).total;
  if (compareDecimals(rootBalance("operating"), totals.operatingBalance) !== 0
    || compareDecimals(rootBalance("drawing"), totals.drawingBalance) !== 0
    || compareDecimals(rootBalance("capex"), totals.capexBalance) !== 0) {
    throw new Error("chart of accounts snapshot: root balances do not reconcile");
  }

  return { canWrite, totals, accounts };
}
