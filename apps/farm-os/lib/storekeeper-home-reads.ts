// SPEC-0033 R3f — strict parser for the exact storekeeper home snapshot
// (`fn_storekeeper_home_snapshot`, migration 20260823130000).
//
// HONESTY CONTRACT (docs/CLAUDE.md #1). Everything under `recorded` is an exact count of rows
// RECORDED in the active organisation — never a completeness claim about the physical store, and
// never a claim that stock on the shelf matches the book.
//
// THERE IS NO COMPLETED-STOCK-TAKE NUMBER, ON PURPOSE. `fn_record_stock_take` writes no provenance
// row and posts nothing at all when the physical count matches the book, so no stored row means "a
// stock-take happened". `recentShrink` rows are RECORDED MOVEMENTS (adjustment / loss / expiry) and
// must never be labelled stock-takes; the stock-take itself exists in this product only as an
// available legal action.
//
// `receivable` mirrors the one stored fn_post_receipt rejection documented in the migration: a line
// with no quantity makes the WHOLE request unpostable. A line unit that differs from the item's unit
// is deliberately NOT a blocker — since migration 20260701210000 fn_post_receipt passes NULL as the
// movement unit so fn_post_movement defaults to the item's own unit, and inventing a gate the
// database does not have would be as dishonest as hiding one. `itemUnit` is carried instead, because
// that is the unit the receipt will actually be recorded in.
//
// `receivable` decides only whether the fast receive shortcut is offered. It is NOT a guarantee that
// the receipt will post: the received quantity is typed at receive time and a concurrent claim can
// still win, so no stored row can settle it in advance. The server RPC stays the enforcement.
//
// Counts stay exact text (a JS number cannot represent every bigint), quantities stay decimal text,
// dates/version/organisation/as-of are validated strictly, every array is independently bounded by
// the snapshot's own detail limit — including the lines nested inside a receipt row — and the
// receipt buckets must reconcile exactly against their counts, twice: by receivability and by
// urgency.

import { compareDecimals, parseDecimal, subtractDecimals, type DecimalString } from "./decimal";
import type { DataAuthorityLevel } from "./data-authority";

export const STOREKEEPER_HOME_SNAPSHOT_VERSION = "farm-os.storekeeper-home.v1";
export const STOREKEEPER_HOME_DETAIL_LIMIT = 6;

type Row = Record<string, unknown>;

/** An exact count as canonical decimal text. Never widened to a JS number. */
export type ExactCountString = string;

export type StorekeeperUrgency = "overdue" | "today" | "upcoming" | "undated";

/** The stored, exactly derivable reasons fn_post_receipt would refuse the whole request. */
export const STOREKEEPER_BLOCKERS = ["unquantified_line"] as const;
export type StorekeeperBlocker = (typeof STOREKEEPER_BLOCKERS)[number];
const BLOCKER_SET = new Set<string>(STOREKEEPER_BLOCKERS);

/** The leakage-sensitive movement types, exactly as lib/movements-console.ts groups them. */
export const STOREKEEPER_SHRINK_TYPES = ["adjustment", "loss", "expiry"] as const;
export type StorekeeperShrinkType = (typeof STOREKEEPER_SHRINK_TYPES)[number];
const SHRINK_TYPE_SET = new Set<string>(STOREKEEPER_SHRINK_TYPES);

/** The only two purchase-request statuses fn_post_receipt will claim. */
const RECEIVABLE_STATUSES = new Set(["approved", "partially_received"]);
const URGENCIES = new Set<string>(["overdue", "today", "upcoming", "undated"]);

export interface StorekeeperReceiptLine {
  itemId: string;
  itemName: string;
  /** The unit recorded on the order line. May differ from the unit the receipt posts in. */
  unit: string | null;
  /** The item's own tracked unit — the unit fn_post_receipt actually records. Never a cost. */
  itemUnit: string | null;
  ordered: DecimalString;
  received: DecimalString;
  remaining: DecimalString;
}

export interface StorekeeperReceipt {
  id: string;
  code: string;
  status: string;
  neededBy: string | null;
  urgency: StorekeeperUrgency;
  receivable: boolean;
  blockers: StorekeeperBlocker[];
  openLineCount: ExactCountString;
  lines: StorekeeperReceiptLine[];
}

export interface StorekeeperStockItem {
  itemId: string;
  name: string;
  unit: string | null;
  /** Sum of every bin. NULL only in the unknown bucket, where no bin row exists at all. */
  available: DecimalString | null;
  /** The positive recorded threshold this reading was compared against. */
  threshold: DecimalString | null;
  binCount: ExactCountString | null;
}

export interface StorekeeperMovement {
  id: string;
  itemId: string;
  itemName: string;
  qty: DecimalString;
  unit: string | null;
  occurredOn: string;
}

export interface StorekeeperIssue extends StorekeeperMovement {
  location: string | null;
}

export interface StorekeeperShrinkMovement extends StorekeeperMovement {
  /** A recorded movement type. NEVER a stock-take: no stored row records that a count happened. */
  type: StorekeeperShrinkType;
}

export interface StorekeeperRecordedCounts {
  openReceipts: ExactCountString;
  receivableNow: ExactCountString;
  blockedReceipts: ExactCountString;
  overdueReceipts: ExactCountString;
  dueTodayReceipts: ExactCountString;
  upcomingReceipts: ExactCountString;
  undatedReceipts: ExactCountString;
  openReceiptLines: ExactCountString;
  issuedToday: ExactCountString;
  belowReorder: ExactCountString;
  unknownStock: ExactCountString;
  recentShrink: ExactCountString;
}

export interface StorekeeperDrivers {
  receivable: StorekeeperReceipt[];
  blocked: StorekeeperReceipt[];
  belowReorder: StorekeeperStockItem[];
  unknownStock: StorekeeperStockItem[];
  issuedToday: StorekeeperIssue[];
  recentShrink: StorekeeperShrinkMovement[];
}

export interface StorekeeperHomeSnapshot {
  orgId: string;
  asOf: string;
  detailLimit: number;
  /** The closed window, in days ending on `asOf`, that `recentShrink` covers exactly. */
  evidenceWindowDays: number;
  authority: { inventory: DataAuthorityLevel };
  recorded: StorekeeperRecordedCounts;
  drivers: StorekeeperDrivers;
}

function object(value: unknown, context: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`storekeeper home snapshot: ${context} must be an object`);
  }
  return value as Row;
}

function rejectExtraKeys(row: Row, allowed: readonly string[], context: string): void {
  const allowedKeys = new Set(allowed);
  const extra = Object.keys(row).filter((key) => !allowedKeys.has(key));
  if (extra.length > 0) {
    throw new Error(`storekeeper home snapshot: ${context} has unexpected keys: ${extra.sort().join(", ")}`);
  }
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`storekeeper home snapshot: ${key} must be text`);
  }
  return value;
}

function nullableText(row: Row, key: string): string | null {
  return row[key] === null ? null : text(row, key);
}

function uuid(row: Row, key: string): string {
  const value = text(row, key);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`storekeeper home snapshot: ${key} must be a UUID`);
  }
  return value;
}

function count(row: Row, key: string): ExactCountString {
  const value = text(row, key);
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`storekeeper home snapshot: ${key} must be exact count text`);
  }
  return value;
}

function decimal(row: Row, key: string): DecimalString {
  const parsed = parseDecimal(row[key]);
  if (parsed === null) throw new Error(`storekeeper home snapshot: ${key} must be decimal text`);
  return parsed;
}

function boolean(row: Row, key: string): boolean {
  if (typeof row[key] !== "boolean") {
    throw new Error(`storekeeper home snapshot: ${key} must be boolean`);
  }
  return row[key] as boolean;
}

function date(row: Row, key: string, nullable = false): string | null {
  const value = nullable ? nullableText(row, key) : text(row, key);
  if (value === null) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`storekeeper home snapshot: ${key} must be a calendar date`);
  }
  return value;
}

/** Whole days from `from` to `to`, both calendar dates already validated. */
function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

function boundedRows(value: unknown, limit: number, context: string): Row[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw new Error(`storekeeper home snapshot: ${context} must be a bounded array`);
  }
  return value.map((entry, index) => object(entry, `${context}[${index}]`));
}

function expectedBoundedLength(exactCount: ExactCountString, limit: number): number {
  const value = BigInt(exactCount);
  return value < BigInt(limit) ? Number(value) : limit;
}

function blockers(row: Row): StorekeeperBlocker[] {
  const raw = row.blockers;
  if (!Array.isArray(raw) || raw.length > STOREKEEPER_BLOCKERS.length) {
    throw new Error("storekeeper home snapshot: blockers must be a bounded array");
  }
  const parsed = raw.map((entry) => {
    if (typeof entry !== "string" || !BLOCKER_SET.has(entry)) {
      throw new Error("storekeeper home snapshot: unknown blocker code");
    }
    return entry as StorekeeperBlocker;
  });
  if (new Set(parsed).size !== parsed.length) {
    throw new Error("storekeeper home snapshot: blockers must be distinct");
  }
  return parsed;
}

function receiptLine(row: Row): StorekeeperReceiptLine {
  rejectExtraKeys(
    row,
    ["item_id", "item_name", "unit", "item_unit", "ordered", "received", "remaining"],
    "receipt line",
  );
  const ordered = decimal(row, "ordered");
  const received = decimal(row, "received");
  const remaining = decimal(row, "remaining");
  // A line is only shown while it still owes stock, and the three quantities must be consistent —
  // a drift here means the received-to-date balance and the remaining-on-order disagree. Compared in
  // exact decimal space, never through a JS double.
  if (compareDecimals(remaining, "0") <= 0) {
    throw new Error("storekeeper home snapshot: a shown receipt line must still owe stock");
  }
  if (subtractDecimals(ordered, received) !== remaining) {
    throw new Error("storekeeper home snapshot: receipt line quantities do not reconcile");
  }
  return {
    itemId: uuid(row, "item_id"),
    itemName: text(row, "item_name"),
    unit: nullableText(row, "unit"),
    itemUnit: nullableText(row, "item_unit"),
    ordered,
    received,
    remaining,
  };
}

function receipt(row: Row, limit: number, expectedReceivable: boolean, asOf: string): StorekeeperReceipt {
  rejectExtraKeys(
    row,
    ["id", "code", "status", "needed_by", "urgency", "receivable", "blockers", "open_line_count", "lines"],
    "receipt",
  );
  const status = text(row, "status");
  if (!RECEIVABLE_STATUSES.has(status)) {
    throw new Error("storekeeper home snapshot: a receipt carries a status fn_post_receipt cannot claim");
  }
  const urgency = text(row, "urgency");
  if (!URGENCIES.has(urgency)) {
    throw new Error("storekeeper home snapshot: invalid receipt urgency");
  }
  const neededBy = date(row, "needed_by", true);
  const expectedUrgency: StorekeeperUrgency = neededBy === null
    ? "undated"
    : neededBy < asOf
      ? "overdue"
      : neededBy === asOf
        ? "today"
        : "upcoming";
  if (urgency !== expectedUrgency) {
    throw new Error("storekeeper home snapshot: receipt urgency contradicts its needed-by date");
  }
  const receivable = boolean(row, "receivable");
  if (receivable !== expectedReceivable) {
    throw new Error("storekeeper home snapshot: a receipt row sits in the wrong receivability bucket");
  }
  const rowBlockers = blockers(row);
  if (receivable !== (rowBlockers.length === 0)) {
    throw new Error("storekeeper home snapshot: receivable disagrees with the recorded blockers");
  }
  const openLineCount = count(row, "open_line_count");
  if (openLineCount === "0") {
    throw new Error("storekeeper home snapshot: a shown receipt must have at least one open line");
  }
  const lines = boundedRows(row.lines, limit, "receipt.lines").map(receiptLine);
  if (lines.length !== expectedBoundedLength(openLineCount, limit)) {
    throw new Error("storekeeper home snapshot: receipt lines do not match their bounded count");
  }
  return {
    id: uuid(row, "id"),
    code: text(row, "code"),
    status,
    neededBy,
    urgency: urgency as StorekeeperUrgency,
    receivable,
    blockers: rowBlockers,
    openLineCount,
    lines,
  };
}

function belowReorderItem(row: Row): StorekeeperStockItem {
  rejectExtraKeys(row, ["item_id", "name", "unit", "available", "threshold", "bin_count"], "below-reorder item");
  const available = decimal(row, "available");
  const threshold = decimal(row, "threshold");
  if (compareDecimals(threshold, "0") <= 0) {
    throw new Error("storekeeper home snapshot: a reorder reading needs a positive recorded threshold");
  }
  if (compareDecimals(available, threshold) >= 0) {
    throw new Error("storekeeper home snapshot: an item at or above its threshold is not below reorder");
  }
  const binCount = count(row, "bin_count");
  if (binCount === "0") {
    throw new Error("storekeeper home snapshot: an item with no bin is unknown, never a reorder reading");
  }
  return {
    itemId: uuid(row, "item_id"),
    name: text(row, "name"),
    unit: nullableText(row, "unit"),
    available,
    threshold,
    binCount,
  };
}

function unknownStockItem(row: Row): StorekeeperStockItem {
  // Unknown means unknown: no balance, no threshold reading, and explicitly not zero.
  if ("available" in row || "threshold" in row) {
    throw new Error("storekeeper home snapshot: an unknown-stock item must carry no balance at all");
  }
  rejectExtraKeys(row, ["item_id", "name", "unit"], "unknown-stock item");
  return {
    itemId: uuid(row, "item_id"),
    name: text(row, "name"),
    unit: nullableText(row, "unit"),
    available: null,
    threshold: null,
    binCount: null,
  };
}

function movement(row: Row, asOf: string): StorekeeperMovement {
  const qty = decimal(row, "qty");
  if (compareDecimals(qty, "0") <= 0) {
    throw new Error("storekeeper home snapshot: a recorded movement quantity must be positive");
  }
  const occurredOn = date(row, "occurred_on") as string;
  if (occurredOn > asOf) {
    throw new Error("storekeeper home snapshot: a movement cannot be recorded after the business date");
  }
  return {
    id: uuid(row, "id"),
    itemId: uuid(row, "item_id"),
    itemName: text(row, "item_name"),
    qty,
    unit: nullableText(row, "unit"),
    occurredOn,
  };
}

function issue(row: Row, asOf: string): StorekeeperIssue {
  rejectExtraKeys(row, ["id", "item_id", "item_name", "qty", "unit", "location", "occurred_on"], "issue");
  const base = movement(row, asOf);
  if (base.occurredOn !== asOf) {
    throw new Error("storekeeper home snapshot: today's issues must all be recorded on the business date");
  }
  return { ...base, location: nullableText(row, "location") };
}

function shrinkMovement(row: Row, asOf: string, windowDays: number): StorekeeperShrinkMovement {
  rejectExtraKeys(row, ["id", "item_id", "item_name", "type", "qty", "unit", "occurred_on"], "movement evidence");
  const base = movement(row, asOf);
  const type = text(row, "type");
  if (!SHRINK_TYPE_SET.has(type)) {
    throw new Error("storekeeper home snapshot: unknown recorded movement type");
  }
  const age = daysBetween(base.occurredOn, asOf);
  if (age < 0 || age > windowDays - 1) {
    throw new Error("storekeeper home snapshot: movement evidence falls outside its stated window");
  }
  return { ...base, type: type as StorekeeperShrinkType };
}

function authority(value: unknown): StorekeeperHomeSnapshot["authority"] {
  const raw = object(value, "authority");
  rejectExtraKeys(raw, ["inventory"], "authority");
  const allowed = new Set<DataAuthorityLevel>(["verified", "partial", "unverified", "blocked"]);
  const status = raw.inventory ?? "unverified";
  if (typeof status !== "string" || !allowed.has(status as DataAuthorityLevel)) {
    throw new Error("storekeeper home snapshot: invalid authority status for inventory");
  }
  return { inventory: status as DataAuthorityLevel };
}

/** Rows are ordered overdue → today → upcoming → undated; a later row may never outrank an earlier one. */
const URGENCY_RANK: Record<StorekeeperUrgency, number> = {
  overdue: 0, today: 1, upcoming: 2, undated: 3,
};

function assertUrgencyOrder(rows: StorekeeperReceipt[], bucket: string): void {
  for (let index = 1; index < rows.length; index += 1) {
    if (URGENCY_RANK[rows[index].urgency] < URGENCY_RANK[rows[index - 1].urgency]) {
      throw new Error(`storekeeper home snapshot: ${bucket} receipts are not ordered by urgency`);
    }
  }
}

function assertDistinctIds(ids: string[], context: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new Error(`storekeeper home snapshot: ${context} must not repeat a row`);
  }
}

/**
 * The counts must agree with each other before any driver row is read. Open receipts split exactly
 * into what can be received now and what is blocked, AND exactly into the four urgency buckets; a
 * drift in either means the snapshot double-counted or dropped an open purchase request.
 */
function assertRecordedCoherence(recorded: StorekeeperRecordedCounts): void {
  if (
    BigInt(recorded.receivableNow) + BigInt(recorded.blockedReceipts)
    !== BigInt(recorded.openReceipts)
  ) {
    throw new Error("storekeeper home snapshot: receivable and blocked receipts do not reconcile with the open total");
  }
  if (
    BigInt(recorded.overdueReceipts) + BigInt(recorded.dueTodayReceipts)
    + BigInt(recorded.upcomingReceipts) + BigInt(recorded.undatedReceipts)
    !== BigInt(recorded.openReceipts)
  ) {
    throw new Error("storekeeper home snapshot: receipt urgency buckets do not reconcile with the open total");
  }
  // An open request has at least one open line by construction, so lines can never be scarcer than
  // requests. Without this, an empty line set could read as "nothing left to receive".
  if (BigInt(recorded.openReceiptLines) < BigInt(recorded.openReceipts)) {
    throw new Error("storekeeper home snapshot: open receipt lines cannot be fewer than open receipts");
  }
}

/** Every driver list must match its own exact count, repeat no row, and hide no overdue receipt. */
function assertDriverCoherence(
  drivers: StorekeeperDrivers,
  recorded: StorekeeperRecordedCounts,
  detailLimit: number,
): void {
  const bounded: [string, { length: number }, ExactCountString][] = [
    ["receivable", drivers.receivable, recorded.receivableNow],
    ["blocked", drivers.blocked, recorded.blockedReceipts],
    ["below_reorder", drivers.belowReorder, recorded.belowReorder],
    ["unknown_stock", drivers.unknownStock, recorded.unknownStock],
    ["issued_today", drivers.issuedToday, recorded.issuedToday],
    ["recent_shrink", drivers.recentShrink, recorded.recentShrink],
  ];
  for (const [name, rows, exact] of bounded) {
    if (rows.length !== expectedBoundedLength(exact, detailLimit)) {
      throw new Error(`storekeeper home snapshot: ${name} rows do not match their bounded count`);
    }
  }

  assertUrgencyOrder(drivers.receivable, "receivable");
  assertUrgencyOrder(drivers.blocked, "blocked");
  assertDistinctIds([...drivers.receivable, ...drivers.blocked].map((row) => row.id), "receipts");
  assertDistinctIds(drivers.belowReorder.map((row) => row.itemId), "below_reorder");
  assertDistinctIds(drivers.unknownStock.map((row) => row.itemId), "unknown_stock");
  assertDistinctIds(drivers.issuedToday.map((row) => row.id), "issued_today");
  assertDistinctIds(drivers.recentShrink.map((row) => row.id), "recent_shrink");
  // The same item cannot be both a threshold reading and unknown: the buckets are defined by
  // whether any bin row exists at all.
  assertDistinctIds(
    [...drivers.belowReorder, ...drivers.unknownStock].map((row) => row.itemId),
    "stock buckets",
  );

  // Both buckets are ordered overdue-first and each is bounded by the same detail limit, so each
  // bucket shows min(its own overdue rows, detailLimit) of them — and the two together therefore
  // show at least min(recorded overdue, detailLimit). Below that floor an overdue request was
  // silently pushed out of sight; above the recorded total, one was invented.
  const visibleOverdue = BigInt(
    [...drivers.receivable, ...drivers.blocked].filter((row) => row.urgency === "overdue").length,
  );
  const recordedOverdue = BigInt(recorded.overdueReceipts);
  const minimumVisibleOverdue = recordedOverdue < BigInt(detailLimit) ? recordedOverdue : BigInt(detailLimit);
  if (visibleOverdue < minimumVisibleOverdue || visibleOverdue > recordedOverdue) {
    throw new Error("storekeeper home snapshot: visible overdue receipts contradict the recorded overdue count");
  }
}

export function parseStorekeeperHomeSnapshot(
  value: unknown,
  expectedOrgId: string,
  expectedAsOf: string,
): StorekeeperHomeSnapshot {
  const root = object(value, "root");
  rejectExtraKeys(
    root,
    ["version", "org_id", "as_of", "detail_limit", "evidence_window_days", "authority", "recorded", "drivers"],
    "root",
  );
  if (text(root, "version") !== STOREKEEPER_HOME_SNAPSHOT_VERSION) {
    throw new Error("storekeeper home snapshot: version mismatch");
  }
  if (text(root, "org_id") !== expectedOrgId) {
    throw new Error("storekeeper home snapshot: organization mismatch");
  }
  if (date(root, "as_of") !== expectedAsOf) {
    throw new Error("storekeeper home snapshot: as-of mismatch");
  }
  if (
    !Number.isInteger(root.detail_limit)
    || (root.detail_limit as number) < 1
    || (root.detail_limit as number) > 20
  ) {
    throw new Error("storekeeper home snapshot: detail limit is invalid");
  }
  const detailLimit = root.detail_limit as number;
  if (
    !Number.isInteger(root.evidence_window_days)
    || (root.evidence_window_days as number) < 1
    || (root.evidence_window_days as number) > 90
  ) {
    throw new Error("storekeeper home snapshot: evidence window is invalid");
  }
  const evidenceWindowDays = root.evidence_window_days as number;
  const parsedAuthority = authority(root.authority);

  const recordedRow = object(root.recorded, "recorded");
  const driversRow = object(root.drivers, "drivers");
  rejectExtraKeys(
    recordedRow,
    [
      "open_receipts", "receivable_now", "blocked_receipts", "overdue_receipts",
      "due_today_receipts", "upcoming_receipts", "undated_receipts", "open_receipt_lines",
      "issued_today", "below_reorder", "unknown_stock", "recent_shrink",
    ],
    "recorded",
  );
  rejectExtraKeys(
    driversRow,
    ["receivable", "blocked", "below_reorder", "unknown_stock", "issued_today", "recent_shrink"],
    "drivers",
  );
  const recorded: StorekeeperRecordedCounts = {
    openReceipts: count(recordedRow, "open_receipts"),
    receivableNow: count(recordedRow, "receivable_now"),
    blockedReceipts: count(recordedRow, "blocked_receipts"),
    overdueReceipts: count(recordedRow, "overdue_receipts"),
    dueTodayReceipts: count(recordedRow, "due_today_receipts"),
    upcomingReceipts: count(recordedRow, "upcoming_receipts"),
    undatedReceipts: count(recordedRow, "undated_receipts"),
    openReceiptLines: count(recordedRow, "open_receipt_lines"),
    issuedToday: count(recordedRow, "issued_today"),
    belowReorder: count(recordedRow, "below_reorder"),
    unknownStock: count(recordedRow, "unknown_stock"),
    recentShrink: count(recordedRow, "recent_shrink"),
  };
  assertRecordedCoherence(recorded);

  const receivable = boundedRows(driversRow.receivable, detailLimit, "drivers.receivable")
    .map((row) => receipt(row, detailLimit, true, expectedAsOf));
  const blocked = boundedRows(driversRow.blocked, detailLimit, "drivers.blocked")
    .map((row) => receipt(row, detailLimit, false, expectedAsOf));
  const belowReorder = boundedRows(driversRow.below_reorder, detailLimit, "drivers.below_reorder")
    .map(belowReorderItem);
  const unknownStock = boundedRows(driversRow.unknown_stock, detailLimit, "drivers.unknown_stock")
    .map(unknownStockItem);
  const issuedToday = boundedRows(driversRow.issued_today, detailLimit, "drivers.issued_today")
    .map((row) => issue(row, expectedAsOf));
  const recentShrink = boundedRows(driversRow.recent_shrink, detailLimit, "drivers.recent_shrink")
    .map((row) => shrinkMovement(row, expectedAsOf, evidenceWindowDays));

  const drivers: StorekeeperDrivers = {
    receivable, blocked, belowReorder, unknownStock, issuedToday, recentShrink,
  };
  assertDriverCoherence(drivers, recorded, detailLimit);

  return {
    orgId: expectedOrgId,
    asOf: expectedAsOf,
    detailLimit,
    evidenceWindowDays,
    authority: parsedAuthority,
    recorded,
    drivers,
  };
}
