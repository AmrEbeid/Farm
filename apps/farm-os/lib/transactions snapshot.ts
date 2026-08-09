import { parseDecimal, type DecimalString } from "./decimal";

export const TRANSACTIONS_SNAPSHOT_VERSION = "farm-os.transactions.v1";
export type TransactionType = "expense" | "sale" | "collection" | "custody";
export type TransactionDirection = "in" | "out";

export interface TransactionSnapshotRow {
  id: string;
  type: TransactionType;
  event_date: string | null;
  category: string | null;
  description: string | null;
  crop: string | null;
  quantity: DecimalString | null;
  unit: string | null;
  pending_price: boolean;
  party_id: string | null;
  party_name: string | null;
  amount: DecimalString | null;
  direction: TransactionDirection;
  collected_by: string | null;
  movement_type: string | null;
}

export interface TransactionSnapshotCounts {
  expense: number;
  sale: number;
  collection: number;
  custody: number;
  pendingPrice: number;
}

export interface TransactionsSnapshot {
  rowLimit: number;
  counts: TransactionSnapshotCounts;
  rows: TransactionSnapshotRow[];
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`transactions snapshot: ${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`transactions snapshot: field "${key}" must be text`);
  }
  return value;
}

function nullableText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`transactions snapshot: field "${key}" must be text or null`);
  }
  return value;
}

function nullableDecimal(row: Record<string, unknown>, key: string): DecimalString | null {
  if (row[key] === null) return null;
  if (typeof row[key] !== "string") {
    throw new Error(`transactions snapshot: field "${key}" must be decimal text or null`);
  }
  const value = parseDecimal(row[key]);
  if (value === null) throw new Error(`transactions snapshot: field "${key}" is not decimal text`);
  return value;
}

function boundedInteger(row: Record<string, unknown>, key: string, min: number, max: number): number {
  const value = row[key];
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`transactions snapshot: field "${key}" is outside its safe range`);
  }
  return value as number;
}

function transactionType(row: Record<string, unknown>): TransactionType {
  const value = row.type;
  if (value === "expense" || value === "sale" || value === "collection" || value === "custody") return value;
  throw new Error("transactions snapshot: transaction type is invalid");
}

function direction(row: Record<string, unknown>): TransactionDirection {
  if (row.direction === "in" || row.direction === "out") return row.direction;
  throw new Error("transactions snapshot: transaction direction is invalid");
}

export function parseTransactionsSnapshot(value: unknown, expectedOrgId: string): TransactionsSnapshot {
  const payload = object(value, "payload");
  if (payload.version !== TRANSACTIONS_SNAPSHOT_VERSION) {
    throw new Error("transactions snapshot: version is invalid");
  }
  if (text(payload, "org_id") !== expectedOrgId) {
    throw new Error("transactions snapshot: organization does not match the active organization");
  }
  const rowLimit = boundedInteger(payload, "row_limit", 1, 400);
  const mismatchCount = boundedInteger(payload, "party_mismatch_count", 0, Number.MAX_SAFE_INTEGER);
  if (mismatchCount !== 0) throw new Error("transactions snapshot: party organization is invalid");

  const rawCounts = object(payload.counts, "counts");
  const counts: TransactionSnapshotCounts = {
    expense: boundedInteger(rawCounts, "expense", 0, Number.MAX_SAFE_INTEGER),
    sale: boundedInteger(rawCounts, "sale", 0, Number.MAX_SAFE_INTEGER),
    collection: boundedInteger(rawCounts, "collection", 0, Number.MAX_SAFE_INTEGER),
    custody: boundedInteger(rawCounts, "custody", 0, Number.MAX_SAFE_INTEGER),
    pendingPrice: boundedInteger(rawCounts, "pending_price", 0, Number.MAX_SAFE_INTEGER),
  };
  if (counts.pendingPrice > counts.sale) {
    throw new Error("transactions snapshot: pending-price count exceeds visible sales");
  }
  if (!Array.isArray(payload.rows)) throw new Error("transactions snapshot: rows must be an array");

  const rows = payload.rows.map((value, index): TransactionSnapshotRow => {
    const row = object(value, `row ${index}`);
    const type = transactionType(row);
    const item: TransactionSnapshotRow = {
      id: text(row, "id"),
      type,
      event_date: nullableText(row, "event_date"),
      category: nullableText(row, "category"),
      description: nullableText(row, "description"),
      crop: nullableText(row, "crop"),
      quantity: nullableDecimal(row, "quantity"),
      unit: nullableText(row, "unit"),
      pending_price: row.pending_price === true,
      party_id: nullableText(row, "party_id"),
      party_name: nullableText(row, "party_name"),
      amount: nullableDecimal(row, "amount"),
      direction: direction(row),
      collected_by: nullableText(row, "collected_by"),
      movement_type: nullableText(row, "movement_type"),
    };
    if (typeof row.pending_price !== "boolean") {
      throw new Error("transactions snapshot: pending-price flag must be boolean");
    }
    if ((item.party_id === null) !== (item.party_name === null)) {
      throw new Error("transactions snapshot: party id and name must be present together");
    }
    if (item.type === "sale" && (item.pending_price !== (item.amount === null))) {
      throw new Error("transactions snapshot: sale price state and amount disagree");
    }
    if (item.type === "sale" && item.crop === null) {
      throw new Error("transactions snapshot: sale crop is missing");
    }
    if (item.type !== "sale" && item.pending_price) {
      throw new Error("transactions snapshot: only a sale can have a pending price");
    }
    if (item.type !== "expense" && item.amount === null) {
      throw new Error("transactions snapshot: a money event amount is missing");
    }
    if (item.type !== "custody" && item.direction !== (item.type === "expense" ? "out" : "in")) {
      throw new Error("transactions snapshot: fixed transaction direction is invalid");
    }
    if (item.type === "custody" && item.movement_type === null) {
      throw new Error("transactions snapshot: custody movement type is missing");
    }
    return item;
  });

  const seen = new Set<string>();
  const rowCounts: Record<TransactionType, number> = { expense: 0, sale: 0, collection: 0, custody: 0 };
  for (const row of rows) {
    const key = `${row.type}:${row.id}`;
    if (seen.has(key)) throw new Error(`transactions snapshot: duplicate row ${key}`);
    seen.add(key);
    rowCounts[row.type] += 1;
  }
  for (const type of Object.keys(rowCounts) as TransactionType[]) {
    if (rowCounts[type] !== Math.min(counts[type], rowLimit)) {
      throw new Error(`transactions snapshot: ${type} row sample is incomplete`);
    }
  }

  return { rowLimit, counts, rows };
}
