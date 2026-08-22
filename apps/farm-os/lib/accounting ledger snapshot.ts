import { parseDecimal, type DecimalString } from "./decimal";

export const ACCOUNTING_LEDGER_SNAPSHOT_VERSION = "farm-os.accounting-ledger.v1";

export interface AccountingTrialBalanceRow {
  account_id: string;
  org_id: string;
  code: string;
  name_ar: string;
  account_type: string;
  normal_balance: string;
  parent_id: string | null;
  active: boolean;
  has_postings: boolean;
  debit: DecimalString;
  credit: DecimalString;
  net: DecimalString;
}

export interface AccountingRecentEntry {
  id: string;
  entry_date: string;
  source_type: string;
  source_id: string;
  description: string | null;
  status: string;
  posted_at: string;
  amount: DecimalString | null;
}

export interface AccountingRecentLine {
  id: string;
  journal_entry_id: string;
  account_id: string;
  account_code: string;
  account_name_ar: string;
  debit: DecimalString;
  credit: DecimalString;
  description: string | null;
  payment_request_id: string | null;
  expense_id: string | null;
}

export interface AccountingLedgerSnapshot {
  entryLimit: number;
  trialBalance: AccountingTrialBalanceRow[];
  recentEntries: AccountingRecentEntry[];
  recentLines: AccountingRecentLine[];
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`accounting ledger snapshot: ${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`accounting ledger snapshot: field "${key}" must be text`);
  }
  return value;
}

function nullableText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`accounting ledger snapshot: field "${key}" must be text or null`);
  }
  return value;
}

function exactMoney(row: Record<string, unknown>, key: string): DecimalString {
  if (typeof row[key] !== "string") {
    throw new Error(`accounting ledger snapshot: field "${key}" must be decimal text`);
  }
  const value = parseDecimal(row[key]);
  if (value === null) {
    throw new Error(`accounting ledger snapshot: field "${key}" is not decimal text`);
  }
  return value;
}

function nullableExactMoney(row: Record<string, unknown>, key: string): DecimalString | null {
  return row[key] === null ? null : exactMoney(row, key);
}

function boundedInteger(row: Record<string, unknown>, key: string, min: number, max: number): number {
  const value = row[key];
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`accounting ledger snapshot: field "${key}" is outside its safe range`);
  }
  return value as number;
}

function boolean(row: Record<string, unknown>, key: string): boolean {
  if (typeof row[key] !== "boolean") {
    throw new Error(`accounting ledger snapshot: field "${key}" must be boolean`);
  }
  return row[key];
}

function unique(rows: Array<{ id: string }>, label: string): void {
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`accounting ledger snapshot: duplicate ${label} ${row.id}`);
    ids.add(row.id);
  }
}

export function parseAccountingLedgerSnapshot(value: unknown, expectedOrgId: string): AccountingLedgerSnapshot {
  const payload = object(value, "payload");
  if (payload.version !== ACCOUNTING_LEDGER_SNAPSHOT_VERSION) {
    throw new Error("accounting ledger snapshot: version is invalid");
  }
  if (text(payload, "org_id") !== expectedOrgId) {
    throw new Error("accounting ledger snapshot: organization does not match the active organization");
  }
  const entryLimit = boundedInteger(payload, "entry_limit", 1, 100);
  const lineLimit = boundedInteger(payload, "line_limit", 1, 10_000);
  const lineCount = boundedInteger(payload, "line_count", 0, Number.MAX_SAFE_INTEGER);
  const accountMismatchCount = boundedInteger(
    payload,
    "account_mismatch_count",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  if (accountMismatchCount !== 0) {
    throw new Error("accounting ledger snapshot: journal line account organization is invalid");
  }
  if (!Array.isArray(payload.trial_balance) || !Array.isArray(payload.recent_entries) || !Array.isArray(payload.recent_lines)) {
    throw new Error("accounting ledger snapshot: row collections must be arrays");
  }

  const trialBalance = payload.trial_balance.map((value, index): AccountingTrialBalanceRow => {
    const row = object(value, `trial balance row ${index}`);
    return {
      account_id: text(row, "account_id"),
      org_id: text(row, "org_id"),
      code: text(row, "code"),
      name_ar: text(row, "name_ar"),
      account_type: text(row, "account_type"),
      normal_balance: text(row, "normal_balance"),
      parent_id: nullableText(row, "parent_id"),
      active: boolean(row, "active"),
      has_postings: boolean(row, "has_postings"),
      debit: exactMoney(row, "debit"),
      credit: exactMoney(row, "credit"),
      net: exactMoney(row, "net"),
    };
  });
  unique(trialBalance.map((row) => ({ id: row.account_id })), "account");

  const recentEntries = payload.recent_entries.map((value, index): AccountingRecentEntry => {
    const row = object(value, `recent entry ${index}`);
    return {
      id: text(row, "id"),
      entry_date: text(row, "entry_date"),
      source_type: text(row, "source_type"),
      source_id: text(row, "source_id"),
      description: nullableText(row, "description"),
      status: text(row, "status"),
      posted_at: text(row, "posted_at"),
      amount: nullableExactMoney(row, "amount"),
    };
  });
  if (recentEntries.length > entryLimit) {
    throw new Error("accounting ledger snapshot: recent entries exceed the requested limit");
  }
  unique(recentEntries, "entry");

  const recentLines = payload.recent_lines.map((value, index): AccountingRecentLine => {
    const row = object(value, `recent line ${index}`);
    return {
      id: text(row, "id"),
      journal_entry_id: text(row, "journal_entry_id"),
      account_id: text(row, "account_id"),
      account_code: text(row, "account_code"),
      account_name_ar: text(row, "account_name_ar"),
      debit: exactMoney(row, "debit"),
      credit: exactMoney(row, "credit"),
      description: nullableText(row, "description"),
      payment_request_id: nullableText(row, "payment_request_id"),
      expense_id: nullableText(row, "expense_id"),
    };
  });
  unique(recentLines, "line");
  if (recentLines.length !== lineCount || lineCount > lineLimit) {
    throw new Error("accounting ledger snapshot: recent line detail is incomplete");
  }
  const entryIds = new Set(recentEntries.map((entry) => entry.id));
  if (recentLines.some((line) => !entryIds.has(line.journal_entry_id))) {
    throw new Error("accounting ledger snapshot: line does not belong to a returned entry");
  }

  if (trialBalance.some((row) => row.org_id !== expectedOrgId)) {
    throw new Error("accounting ledger snapshot: trial balance contains another organization");
  }

  return { entryLimit, trialBalance, recentEntries, recentLines };
}
