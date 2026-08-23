// SPEC-0033 R4a — strict parsers for the exact inventory LIST and ITEM 360 snapshots
// (`fn_inventory_list_snapshot` and `fn_inventory_item_snapshot`, migration 20260823140000).
//
// ROLE SEPARATION IS A SHAPE, NOT A STYLE RULE.
// The database builds two genuinely different payloads: `operational` (storekeeper) has no money,
// counterparty, purchase free-text or purchase-request-id key at all, and `finance` (every other
// member role) keeps exactly the capability those roles have today. Both directions are enforced
// here rather than trusted:
//   * every object rejects unexpected keys at every nesting level, so a future SQL edit that leaks
//     `est_cost` into the operational payload fails the parse instead of reaching a browser;
//   * the operational payload is additionally walked key-by-key against a forbidden-name set, so a
//     leak inside an object this parser does not otherwise read still cannot pass;
//   * the finance payload must actually CARRY its money keys, so a silent regression that stops
//     sending cost to an owner is caught too — a missing figure and a zero figure are different
//     facts and neither may be invented by the reader.
// The result types are a discriminated union on `scope`, so the operational branch has no
// `unitCost`/`valuation` property for a component to render even by accident.
//
// HONESTY CONTRACT (docs/CLAUDE.md #1).
//   * `state === "unknown"` means no bin row exists at all. Its balances are `null`, never 0, and the
//     parser refuses a row that claims both.
//   * `state === "no_threshold"` means there is no positive recorded threshold to read against — the
//     item is neither below reorder nor confirmed ok.
//   * A null `unitCost` is unknown cost. Valuation excludes those items and publishes the size of the
//     gap, and the parser refuses a valuation on an item with no cost or no recorded balance.
//   * Counts stay exact text (a JS number cannot represent every bigint) and quantities stay decimal
//     text (a binary double cannot represent every `numeric`). Every comparison below happens in
//     exact decimal space.
//
// NONE OF THIS IS THE COVERAGE ENGINE. `below_reorder` is a point-in-time reading of the recorded
// threshold against the sum of every bin. It is never called coverage, and the forward-looking
// verdict stays on the per-item coverage page.

import {
  compareDecimals,
  multiplyDecimals,
  parseDecimal,
  subtractDecimals,
  sumDecimals,
  type DecimalString,
} from "./decimal";
import type { DataAuthorityLevel } from "./data-authority";
import type { Role } from "./auth";

export const INVENTORY_LIST_SNAPSHOT_VERSION = "farm-os.inventory-list.v1";
export const INVENTORY_ITEM_SNAPSHOT_VERSION = "farm-os.inventory-item.v1";

/** One page of the list. Kept small because the phone is the design target. */
export const INVENTORY_LIST_PAGE_SIZE = 20;
export const INVENTORY_ITEM_MOVEMENT_LIMIT = 10;
export const INVENTORY_ITEM_PURCHASE_LIMIT = 10;

/**
 * The RPC's OWN argument bounds, restated here so a payload that breaks them is refused rather than
 * rendered. They are duplicated knowledge across two languages on purpose — the database is the
 * enforcement and these are the reader's independent check — so they must be kept in step with
 * migration 20260823140000 (`p_limit` 1-50, `p_offset` 0-1000000, `v_max_bins` 200).
 */
const RPC_MAX_PAGE_LIMIT = 50;
const RPC_MAX_PAGE_OFFSET = 1_000_000;
const RPC_MAX_SAMPLE_LIMIT = 50;
/** Every physical location of an item is returned in full; beyond this the RPC fails loudly. */
const RPC_MAX_LOCATIONS = 200;

type Row = Record<string, unknown>;

/** An exact count as canonical non-negative integer text. Never widened to a JS number. */
export type ExactCountString = string;

/**
 * An exact RECORDED whole number that is not a count, so it may legitimately be negative.
 * `lead_time_days` is the only one: the column carries no non-negativity constraint, and refusing a
 * recorded negative would blank a real item page rather than report what the database actually
 * holds. It is rendered as-is, so corrupt data stays visible instead of being silently normalised.
 */
export type ExactIntegerString = string;

export type InventoryScope = "operational" | "finance";

/**
 * The one place a role becomes a payload scope. The page uses it to ask for the right thing and the
 * parser uses it to check it got the right thing, so the browser and the database can never disagree
 * about which of the two contracts is in play. It mirrors the RPC's own branch exactly: the
 * storekeeper gets the money-free operational payload, every other member role keeps the finance
 * capability the enforced `/inventory*` policy already gives it.
 */
export function inventoryScopeForRole(role: Role): InventoryScope {
  return role === "storekeeper" ? "operational" : "finance";
}

/** Mutually exclusive and jointly exhaustive, so the filter chips always reconcile to the total. */
export const INVENTORY_STOCK_STATES = ["below_reorder", "unknown", "no_threshold", "ok"] as const;
export type InventoryStockState = (typeof INVENTORY_STOCK_STATES)[number];
const STATE_SET = new Set<string>(INVENTORY_STOCK_STATES);

/** Rows are ordered exceptions-first; a later row may never outrank an earlier one. */
const STATE_RANK: Record<InventoryStockState, number> = {
  below_reorder: 0,
  unknown: 1,
  no_threshold: 2,
  ok: 3,
};

export const INVENTORY_LIST_FILTERS = ["all", "below_reorder", "unknown", "uncosted"] as const;
export type InventoryListFilter = (typeof INVENTORY_LIST_FILTERS)[number];

/** «بلا تكلفة» is a finance question, so it is not offered to — or accepted from — the store scope. */
const OPERATIONAL_FILTERS: readonly InventoryListFilter[] = ["all", "below_reorder", "unknown"];

export function inventoryFiltersForScope(scope: InventoryScope): readonly InventoryListFilter[] {
  return scope === "finance" ? INVENTORY_LIST_FILTERS : OPERATIONAL_FILTERS;
}

export function isInventoryListFilter(value: unknown): value is InventoryListFilter {
  return typeof value === "string" && (INVENTORY_LIST_FILTERS as readonly string[]).includes(value);
}

/** Parse a URL filter for a scope. An illegal or unknown value falls back to «all», never throws. */
export function parseInventoryListFilter(
  raw: string | undefined,
  scope: InventoryScope,
): InventoryListFilter {
  return isInventoryListFilter(raw) && inventoryFiltersForScope(scope).includes(raw) ? raw : "all";
}

export type ThresholdSource = "reorder_point" | "min_stock";
const THRESHOLD_SOURCES = new Set<string>(["reorder_point", "min_stock"]);

/** Every recorded movement type. `transfer` is constraint-disabled for new writes but may be historic. */
export const INVENTORY_MOVEMENT_TYPES = [
  "receipt", "issue", "return", "adjustment", "transfer", "loss", "expiry", "reserve", "release",
] as const;
export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];
const MOVEMENT_TYPE_SET = new Set<string>(INVENTORY_MOVEMENT_TYPES);

export const PURCHASE_REQUEST_STATUSES = [
  "draft", "submitted", "approved", "rejected", "received", "partially_received",
] as const;
const PR_STATUS_SET = new Set<string>(PURCHASE_REQUEST_STATUSES);

/**
 * Key names that must NEVER appear anywhere inside an operational payload. Matched EXACTLY, not by
 * substring, so an innocent key ("reserved", "available") can never trip it and a real leak cannot
 * hide behind a prefix.
 */
const FORBIDDEN_OPERATIONAL_KEYS = new Set([
  "unit_cost", "est_cost", "cost", "unitCost", "estCost",
  "valuation", "uncosted", "value", "price", "amount", "rate", "total_value",
  "supplier", "supplier_id", "supplier_name", "preferred_supplier_id",
  "reason", "notes", "requested_by", "approved_by", "approved_at",
  "person", "person_id", "people", "phone", "email",
  "pr_id", "purchase_request_id",
]);

// ── primitive readers ─────────────────────────────────────────────────────────────────────────

function object(value: unknown, context: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`inventory snapshot: ${context} must be an object`);
  }
  return value as Row;
}

function rejectExtraKeys(row: Row, allowed: readonly string[], context: string): void {
  const allowedKeys = new Set(allowed);
  const extra = Object.keys(row).filter((key) => !allowedKeys.has(key));
  if (extra.length > 0) {
    throw new Error(`inventory snapshot: ${context} has unexpected keys: ${extra.sort().join(", ")}`);
  }
}

function requireKeys(row: Row, required: readonly string[], context: string): void {
  const missing = required.filter((key) => !(key in row));
  if (missing.length > 0) {
    throw new Error(`inventory snapshot: ${context} is missing keys: ${missing.sort().join(", ")}`);
  }
}

/** Walk the raw payload and refuse any forbidden key, however deeply it is nested. */
function assertNoFinanceKeys(value: unknown, path = "root"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoFinanceKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Row)) {
    if (FORBIDDEN_OPERATIONAL_KEYS.has(key)) {
      throw new Error(`inventory snapshot: the operational payload carries "${key}" at ${path}`);
    }
    assertNoFinanceKeys(child, `${path}.${key}`);
  }
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`inventory snapshot: ${key} must be text`);
  }
  return value;
}

function nullableText(row: Row, key: string): string | null {
  return row[key] === null ? null : text(row, key);
}

function uuid(row: Row, key: string): string {
  const value = text(row, key);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`inventory snapshot: ${key} must be a UUID`);
  }
  return value;
}

function count(row: Row, key: string): ExactCountString {
  const value = text(row, key);
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`inventory snapshot: ${key} must be exact count text`);
  }
  return value;
}

function integerText(row: Row, key: string): ExactIntegerString {
  const value = text(row, key);
  if (!/^(0|-?[1-9]\d*)$/.test(value)) {
    throw new Error(`inventory snapshot: ${key} must be exact whole-number text`);
  }
  return value;
}

function decimal(row: Row, key: string): DecimalString {
  if (typeof row[key] !== "string") {
    throw new Error(`inventory snapshot: ${key} must be decimal text`);
  }
  const parsed = parseDecimal(row[key]);
  if (parsed === null) throw new Error(`inventory snapshot: ${key} must be decimal text`);
  return parsed;
}

function nullableDecimal(row: Row, key: string): DecimalString | null {
  return row[key] === null ? null : decimal(row, key);
}

function boundedInteger(row: Row, key: string, min: number, max: number): number {
  const value = row[key];
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`inventory snapshot: ${key} is out of range`);
  }
  return value as number;
}

function calendarDate(row: Row, key: string, nullable = false): string | null {
  const value = nullable ? nullableText(row, key) : text(row, key);
  if (value === null) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`inventory snapshot: ${key} must be a calendar date`);
  }
  return value;
}

function boundedRows(value: unknown, limit: number, context: string): Row[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw new Error(`inventory snapshot: ${context} must be a bounded array`);
  }
  return value.map((entry, index) => object(entry, `${context}[${index}]`));
}

/** How many rows a bounded sample of an exact total must contain. */
function expectedSampleLength(exact: ExactCountString, limit: number): number {
  const value = BigInt(exact);
  return value < BigInt(limit) ? Number(value) : limit;
}

/** How many rows a limit/offset page of an exact total must contain. */
function expectedPageLength(exact: ExactCountString, limit: number, offset: number): number {
  const remaining = BigInt(exact) - BigInt(offset);
  if (remaining <= BigInt(0)) return 0;
  return remaining < BigInt(limit) ? Number(remaining) : limit;
}

function authority(value: unknown): { inventory: DataAuthorityLevel } {
  const raw = object(value, "authority");
  rejectExtraKeys(raw, ["inventory"], "authority");
  const allowed = new Set<DataAuthorityLevel>(["verified", "partial", "unverified", "blocked"]);
  const status = raw.inventory ?? "unverified";
  if (typeof status !== "string" || !allowed.has(status as DataAuthorityLevel)) {
    throw new Error("inventory snapshot: invalid authority status for inventory");
  }
  return { inventory: status as DataAuthorityLevel };
}

function scopeOf(row: Row): InventoryScope {
  const value = text(row, "scope");
  if (value !== "operational" && value !== "finance") {
    throw new Error("inventory snapshot: unknown role scope");
  }
  return value;
}

function assertDistinct(ids: string[], context: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new Error(`inventory snapshot: ${context} must not repeat a row`);
  }
}

// ── the shared stock reading ──────────────────────────────────────────────────────────────────

interface StockReading {
  state: InventoryStockState;
  binCount: ExactCountString;
  onHand: DecimalString | null;
  reserved: DecimalString | null;
  available: DecimalString | null;
  threshold: DecimalString | null;
  thresholdSource: ThresholdSource | null;
}

/**
 * The one place the four states are validated against the numbers behind them, so the list row and
 * the item 360 header can never disagree about what an item's stock means.
 */
function stockReading(row: Row, context: string): StockReading {
  const rawState = text(row, "state");
  if (!STATE_SET.has(rawState)) {
    throw new Error(`inventory snapshot: ${context} has an unknown stock state`);
  }
  const state = rawState as InventoryStockState;
  const binCount = count(row, "bin_count");
  const onHand = nullableDecimal(row, "on_hand");
  const reserved = nullableDecimal(row, "reserved");
  const available = nullableDecimal(row, "available");
  const threshold = nullableDecimal(row, "threshold");
  const rawSource = row.threshold_source;
  if (rawSource !== null && (typeof rawSource !== "string" || !THRESHOLD_SOURCES.has(rawSource))) {
    throw new Error(`inventory snapshot: ${context} has an unknown threshold source`);
  }
  const thresholdSource = (rawSource as ThresholdSource | null) ?? null;
  if ((threshold === null) !== (thresholdSource === null)) {
    throw new Error(`inventory snapshot: ${context} threshold and its source disagree`);
  }

  const hasBin = binCount !== "0";
  // Unknown means unknown. A balance of any kind on an item with no bin row would be an invention,
  // and a missing balance on an item that HAS bins would silently hide real stock.
  if (hasBin !== (onHand !== null) || hasBin !== (reserved !== null) || hasBin !== (available !== null)) {
    throw new Error(`inventory snapshot: ${context} balance presence contradicts its bin count`);
  }
  if (!hasBin && state !== "unknown") {
    throw new Error(`inventory snapshot: ${context} has no recorded balance, so it can only be unknown`);
  }
  if (hasBin && state === "unknown") {
    throw new Error(`inventory snapshot: ${context} has recorded bins and cannot be unknown`);
  }
  if (onHand !== null && reserved !== null && available !== null
      && subtractDecimals(onHand, reserved) !== available) {
    throw new Error(`inventory snapshot: ${context} available does not reconcile with on hand and reserved`);
  }

  const positiveThreshold = threshold !== null && compareDecimals(threshold, "0") > 0;
  if (hasBin) {
    if (state === "no_threshold" && positiveThreshold) {
      throw new Error(`inventory snapshot: ${context} has a positive recorded threshold to read against`);
    }
    if (state !== "no_threshold" && !positiveThreshold) {
      throw new Error(`inventory snapshot: ${context} has no positive recorded threshold`);
    }
    if (state === "below_reorder" && compareDecimals(available as DecimalString, threshold as DecimalString) >= 0) {
      throw new Error(`inventory snapshot: ${context} is at or above its threshold and is not below reorder`);
    }
    if (state === "ok" && compareDecimals(available as DecimalString, threshold as DecimalString) < 0) {
      throw new Error(`inventory snapshot: ${context} is under its threshold and cannot read as ok`);
    }
  }

  return { state, binCount, onHand, reserved, available, threshold, thresholdSource };
}

/** Valuation exists only where BOTH a recorded balance and a recorded unit cost exist. */
function checkedValuation(
  onHand: DecimalString | null,
  unitCost: DecimalString | null,
  valuation: DecimalString | null,
  context: string,
): DecimalString | null {
  if (onHand === null || unitCost === null) {
    if (valuation !== null) {
      throw new Error(`inventory snapshot: ${context} is valued without a recorded balance and cost`);
    }
    return null;
  }
  if (valuation === null) {
    throw new Error(`inventory snapshot: ${context} has a balance and a cost but no valuation`);
  }
  if (multiplyDecimals(onHand, unitCost) !== valuation) {
    throw new Error(`inventory snapshot: ${context} valuation does not reconcile with balance × cost`);
  }
  return valuation;
}

// ── list snapshot ─────────────────────────────────────────────────────────────────────────────

export interface InventoryListRow extends StockReading {
  itemId: string;
  name: string;
  category: string | null;
  unit: string | null;
}

export interface InventoryListFinanceRow extends InventoryListRow {
  /** Unknown cost is `null`, never 0. */
  unitCost: DecimalString | null;
  /** `null` whenever the item cannot honestly be valued. */
  valuation: DecimalString | null;
}

export interface InventoryListCounts {
  /** Every item in the organisation, before search and before filter. */
  totalItems: ExactCountString;
  /** Items matching the search. The denominator of the state counts below. */
  queryTotal: ExactCountString;
  /** Items matching search AND filter. The denominator of the page. */
  matching: ExactCountString;
  belowReorder: ExactCountString;
  unknownStock: ExactCountString;
  noThreshold: ExactCountString;
  okStock: ExactCountString;
}

export interface InventoryListFinanceCounts extends InventoryListCounts {
  uncosted: ExactCountString;
}

export interface InventoryValuation {
  /** The exact total of the items that could be valued — never the whole store unless the gap is 0. */
  knownTotal: DecimalString;
  valuedItems: ExactCountString;
  /** Has stock, no recorded cost. Excluded from the total; this is the size of the gap. */
  unknownCostItems: ExactCountString;
  /** Has no recorded balance at all, so it cannot be valued whatever its cost. */
  unknownStockItems: ExactCountString;
}

interface InventoryListShared {
  orgId: string;
  query: string | null;
  filter: InventoryListFilter;
  limit: number;
  offset: number;
  authority: { inventory: DataAuthorityLevel };
}

export interface InventoryListOperationalSnapshot extends InventoryListShared {
  scope: "operational";
  counts: InventoryListCounts;
  rows: InventoryListRow[];
}

export interface InventoryListFinanceSnapshot extends InventoryListShared {
  scope: "finance";
  counts: InventoryListFinanceCounts;
  valuation: InventoryValuation;
  rows: InventoryListFinanceRow[];
}

export type InventoryListSnapshot =
  | InventoryListOperationalSnapshot
  | InventoryListFinanceSnapshot;

export interface InventoryListSnapshotExpectation {
  orgId: string;
  scope: InventoryScope;
  query: string | null;
  filter: InventoryListFilter;
  limit: number;
  offset: number;
}

const LIST_ROW_SHARED_KEYS = [
  "item_id", "name", "category", "unit", "state", "bin_count",
  "on_hand", "reserved", "available", "threshold", "threshold_source",
] as const;

function listRow(row: Row, scope: InventoryScope): InventoryListRow | InventoryListFinanceRow {
  rejectExtraKeys(
    row,
    scope === "finance" ? [...LIST_ROW_SHARED_KEYS, "unit_cost", "valuation"] : LIST_ROW_SHARED_KEYS,
    "list row",
  );
  const reading = stockReading(row, "list row");
  const base: InventoryListRow = {
    ...reading,
    itemId: uuid(row, "item_id"),
    name: text(row, "name"),
    category: nullableText(row, "category"),
    unit: nullableText(row, "unit"),
  };
  if (scope !== "finance") return base;
  requireKeys(row, ["unit_cost", "valuation"], "finance list row");
  const unitCost = nullableDecimal(row, "unit_cost");
  return {
    ...base,
    unitCost,
    valuation: checkedValuation(reading.onHand, unitCost, nullableDecimal(row, "valuation"), "list row"),
  };
}

/**
 * The counts must agree with each other before a single row is read. The four states partition the
 * searched set exactly; a drift means an item was double-counted or dropped, which on a reorder
 * screen is a purchase decision made on a wrong number.
 */
function assertListCounts(counts: InventoryListCounts, filter: InventoryListFilter, uncosted: ExactCountString | null): void {
  const stateSum = BigInt(counts.belowReorder) + BigInt(counts.unknownStock)
    + BigInt(counts.noThreshold) + BigInt(counts.okStock);
  if (stateSum !== BigInt(counts.queryTotal)) {
    throw new Error("inventory snapshot: the stock states do not partition the searched items exactly");
  }
  if (BigInt(counts.queryTotal) > BigInt(counts.totalItems)) {
    throw new Error("inventory snapshot: the search matched more items than the organization has");
  }
  if (BigInt(counts.matching) > BigInt(counts.queryTotal)) {
    throw new Error("inventory snapshot: the filter matched more items than the search did");
  }
  if (uncosted !== null && BigInt(uncosted) > BigInt(counts.queryTotal)) {
    throw new Error("inventory snapshot: more items lack a cost than the search matched");
  }
  // The page denominator must be exactly the count of the chip the caller selected, or the pager and
  // the chip would tell the user two different sizes for the same set.
  const expected: ExactCountString | null =
    filter === "all" ? counts.queryTotal
      : filter === "below_reorder" ? counts.belowReorder
        : filter === "unknown" ? counts.unknownStock
          : uncosted;
  if (expected !== null && counts.matching !== expected) {
    throw new Error("inventory snapshot: the page total contradicts its own filter count");
  }
}

export function parseInventoryListSnapshot(
  value: unknown,
  expected: InventoryListSnapshotExpectation,
): InventoryListSnapshot {
  const root = object(value, "root");
  const scope = scopeOf(root);
  if (scope !== expected.scope) {
    throw new Error("inventory snapshot: list role scope mismatch");
  }
  if (scope === "operational") assertNoFinanceKeys(root);

  rejectExtraKeys(
    root,
    scope === "finance"
      ? ["version", "org_id", "scope", "query", "filter", "limit", "offset", "authority", "counts", "rows", "valuation"]
      : ["version", "org_id", "scope", "query", "filter", "limit", "offset", "authority", "counts", "rows"],
    "root",
  );
  if (text(root, "version") !== INVENTORY_LIST_SNAPSHOT_VERSION) {
    throw new Error("inventory snapshot: list version mismatch");
  }
  if (text(root, "org_id") !== expected.orgId) {
    throw new Error("inventory snapshot: organization mismatch");
  }
  const rawFilter = text(root, "filter");
  if (!isInventoryListFilter(rawFilter) || !inventoryFiltersForScope(scope).includes(rawFilter)) {
    throw new Error("inventory snapshot: the filter is not valid for this role scope");
  }
  const filter = rawFilter;
  const query = root.query === null ? null : text(root, "query");
  const limit = boundedInteger(root, "limit", 1, RPC_MAX_PAGE_LIMIT);
  const offset = boundedInteger(root, "offset", 0, RPC_MAX_PAGE_OFFSET);
  if (
    query !== expected.query
    || filter !== expected.filter
    || limit !== expected.limit
    || offset !== expected.offset
  ) {
    throw new Error("inventory snapshot: list request arguments mismatch");
  }
  const parsedAuthority = authority(root.authority);

  const countsRow = object(root.counts, "counts");
  const sharedCountKeys = [
    "total_items", "query_total", "matching", "below_reorder", "unknown_stock", "no_threshold", "ok_stock",
  ] as const;
  rejectExtraKeys(
    countsRow,
    scope === "finance" ? [...sharedCountKeys, "uncosted"] : sharedCountKeys,
    "counts",
  );
  const counts: InventoryListCounts = {
    totalItems: count(countsRow, "total_items"),
    queryTotal: count(countsRow, "query_total"),
    matching: count(countsRow, "matching"),
    belowReorder: count(countsRow, "below_reorder"),
    unknownStock: count(countsRow, "unknown_stock"),
    noThreshold: count(countsRow, "no_threshold"),
    okStock: count(countsRow, "ok_stock"),
  };
  const uncosted = scope === "finance" ? count(countsRow, "uncosted") : null;
  assertListCounts(counts, filter, uncosted);

  const rows = boundedRows(root.rows, limit, "rows").map((row) => listRow(row, scope));
  if (rows.length !== expectedPageLength(counts.matching, limit, offset)) {
    throw new Error("inventory snapshot: the page does not match its exact total, limit and offset");
  }
  assertDistinct(rows.map((row) => row.itemId), "list rows");
  for (let index = 1; index < rows.length; index += 1) {
    if (STATE_RANK[rows[index].state] < STATE_RANK[rows[index - 1].state]) {
      throw new Error("inventory snapshot: list rows are not ordered exceptions first");
    }
  }
  // A filtered page may only contain rows of that state, or the chip is lying about what it shows.
  if (filter === "below_reorder" || filter === "unknown") {
    const wanted: InventoryStockState = filter === "unknown" ? "unknown" : "below_reorder";
    if (rows.some((row) => row.state !== wanted)) {
      throw new Error("inventory snapshot: a filtered page contains a row outside its own filter");
    }
  }

  const shared: InventoryListShared = {
    orgId: expected.orgId, query, filter, limit, offset, authority: parsedAuthority,
  };
  if (scope !== "finance") {
    return { ...shared, scope: "operational", counts, rows };
  }
  const valuationRow = object(root.valuation, "valuation");
  rejectExtraKeys(
    valuationRow,
    ["known_total", "valued_items", "unknown_cost_items", "unknown_stock_items"],
    "valuation",
  );
  const valuation: InventoryValuation = {
    knownTotal: decimal(valuationRow, "known_total"),
    valuedItems: count(valuationRow, "valued_items"),
    unknownCostItems: count(valuationRow, "unknown_cost_items"),
    unknownStockItems: count(valuationRow, "unknown_stock_items"),
  };
  if (
    BigInt(valuation.valuedItems) + BigInt(valuation.unknownCostItems)
      + BigInt(valuation.unknownStockItems)
    !== BigInt(counts.queryTotal)
  ) {
    throw new Error("inventory snapshot: valued and unvaluable items do not reconcile with the searched total");
  }
  if (uncosted === null) throw new Error("inventory snapshot: the finance scope must publish its uncosted count");
  return {
    ...shared,
    scope: "finance",
    counts: { ...counts, uncosted },
    valuation,
    rows: rows as InventoryListFinanceRow[],
  };
}

// ── item 360 snapshot ─────────────────────────────────────────────────────────────────────────

export interface InventoryItemIdentity {
  name: string;
  category: string | null;
  unit: string | null;
  packSize: DecimalString | null;
  criticality: string | null;
  expiryTracked: boolean;
}

export interface InventoryItemPolicy {
  minStock: DecimalString | null;
  maxStock: DecimalString | null;
  safetyStock: DecimalString | null;
  reorderPoint: DecimalString | null;
  reorderQty: DecimalString | null;
  /** Recorded whole days. May be negative: the column carries no non-negativity constraint. */
  leadTimeDays: ExactIntegerString | null;
  threshold: DecimalString | null;
  thresholdSource: ThresholdSource | null;
}

export interface InventoryItemLocation {
  location: string;
  onHand: DecimalString;
  reserved: DecimalString;
  available: DecimalString;
  ordered: DecimalString;
  projected: DecimalString;
}

export interface InventoryItemStock extends StockReading {
  ordered: DecimalString | null;
  projected: DecimalString | null;
}

export interface InventoryItemMovement {
  id: string;
  type: InventoryMovementType;
  qty: DecimalString;
  unit: string | null;
  location: string;
  occurredOn: string;
  batchNo: string | null;
  expiryDate: string | null;
}

export interface InventoryItemFinanceMovement extends InventoryItemMovement {
  unitCost: DecimalString | null;
}

export interface InventoryItemPurchase {
  id: string;
  code: string;
  status: string;
  neededBy: string | null;
  /** `null` is an unquantified line — the recorded order says nothing about how much. */
  ordered: DecimalString | null;
  received: DecimalString;
  remaining: DecimalString | null;
  unit: string | null;
  /** The item's tracked unit — the unit a receipt is actually recorded in. */
  itemUnit: string | null;
}

export interface InventoryItemFinancePurchase extends InventoryItemPurchase {
  prId: string;
  estCost: DecimalString | null;
  reason: string | null;
}

export interface InventoryItemSupplier {
  name: string;
  /** Recorded whole days. May be negative, for the same reason as the item policy above. */
  leadTimeDays: ExactIntegerString | null;
}

interface InventoryItemShared {
  orgId: string;
  itemId: string;
  movementLimit: number;
  purchaseLimit: number;
  authority: { inventory: DataAuthorityLevel };
  item: InventoryItemIdentity;
  policy: InventoryItemPolicy;
  stock: InventoryItemStock;
  locations: InventoryItemLocation[];
  movementTotal: ExactCountString;
  purchaseTotal: ExactCountString;
  openPurchaseTotal: ExactCountString;
}

export interface InventoryItemOperationalSnapshot extends InventoryItemShared {
  scope: "operational";
  movements: InventoryItemMovement[];
  purchases: InventoryItemPurchase[];
}

export interface InventoryItemFinanceSnapshot extends InventoryItemShared {
  scope: "finance";
  movements: InventoryItemFinanceMovement[];
  purchases: InventoryItemFinancePurchase[];
  unitCost: DecimalString | null;
  valuation: DecimalString | null;
  supplier: InventoryItemSupplier | null;
}

export type InventoryItemSnapshot =
  | InventoryItemOperationalSnapshot
  | InventoryItemFinanceSnapshot;

export interface InventoryItemSnapshotExpectation {
  orgId: string;
  itemId: string;
  scope: InventoryScope;
  movementLimit: number;
  purchaseLimit: number;
}

function itemIdentity(value: unknown): InventoryItemIdentity {
  const row = object(value, "item");
  rejectExtraKeys(row, ["name", "category", "unit", "pack_size", "criticality", "expiry_tracked"], "item");
  if (typeof row.expiry_tracked !== "boolean") {
    throw new Error("inventory snapshot: expiry_tracked must be boolean");
  }
  return {
    name: text(row, "name"),
    category: nullableText(row, "category"),
    unit: nullableText(row, "unit"),
    packSize: nullableDecimal(row, "pack_size"),
    criticality: nullableText(row, "criticality"),
    expiryTracked: row.expiry_tracked,
  };
}

function itemPolicy(value: unknown): InventoryItemPolicy {
  const row = object(value, "policy");
  rejectExtraKeys(
    row,
    ["min_stock", "max_stock", "safety_stock", "reorder_point", "reorder_qty", "lead_time_days",
      "threshold", "threshold_source"],
    "policy",
  );
  const reorderPoint = nullableDecimal(row, "reorder_point");
  const minStock = nullableDecimal(row, "min_stock");
  const threshold = nullableDecimal(row, "threshold");
  const rawSource = row.threshold_source;
  if (rawSource !== null && (typeof rawSource !== "string" || !THRESHOLD_SOURCES.has(rawSource))) {
    throw new Error("inventory snapshot: policy has an unknown threshold source");
  }
  const thresholdSource = (rawSource as ThresholdSource | null) ?? null;
  // The published threshold must be the recorded value it claims to come from, so the 360 header and
  // the reorder policy card can never state two different thresholds.
  const expected = reorderPoint !== null ? reorderPoint : minStock;
  const expectedSource: ThresholdSource | null =
    reorderPoint !== null ? "reorder_point" : minStock !== null ? "min_stock" : null;
  if (threshold !== expected || thresholdSource !== expectedSource) {
    throw new Error("inventory snapshot: the published threshold is not the recorded policy value");
  }
  return {
    minStock,
    maxStock: nullableDecimal(row, "max_stock"),
    safetyStock: nullableDecimal(row, "safety_stock"),
    reorderPoint,
    reorderQty: nullableDecimal(row, "reorder_qty"),
    leadTimeDays: row.lead_time_days === null ? null : integerText(row, "lead_time_days"),
    threshold,
    thresholdSource,
  };
}

function itemLocation(row: Row): InventoryItemLocation {
  rejectExtraKeys(row, ["location", "on_hand", "reserved", "available", "ordered", "projected"], "location");
  const onHand = decimal(row, "on_hand");
  const reserved = decimal(row, "reserved");
  const available = decimal(row, "available");
  if (subtractDecimals(onHand, reserved) !== available) {
    throw new Error("inventory snapshot: a location's available does not reconcile with its balances");
  }
  return {
    location: text(row, "location"),
    onHand,
    reserved,
    available,
    ordered: decimal(row, "ordered"),
    projected: decimal(row, "projected"),
  };
}

const MOVEMENT_SHARED_KEYS = [
  "id", "type", "qty", "unit", "location", "occurred_on", "batch_no", "expiry_date",
] as const;

function itemMovement(row: Row, scope: InventoryScope): InventoryItemMovement | InventoryItemFinanceMovement {
  rejectExtraKeys(
    row,
    scope === "finance" ? [...MOVEMENT_SHARED_KEYS, "unit_cost"] : MOVEMENT_SHARED_KEYS,
    "movement",
  );
  const type = text(row, "type");
  if (!MOVEMENT_TYPE_SET.has(type)) {
    throw new Error("inventory snapshot: unknown recorded movement type");
  }
  // The quantity is NOT required to be positive here. Every shipped write path posts a positive
  // quantity, but the table carries no CHECK, so refusing a historic negative would blank a real
  // page rather than report what the ledger actually holds.
  const base: InventoryItemMovement = {
    id: uuid(row, "id"),
    type: type as InventoryMovementType,
    qty: decimal(row, "qty"),
    unit: nullableText(row, "unit"),
    location: text(row, "location"),
    occurredOn: calendarDate(row, "occurred_on") as string,
    batchNo: nullableText(row, "batch_no"),
    expiryDate: calendarDate(row, "expiry_date", true),
  };
  if (scope !== "finance") return base;
  requireKeys(row, ["unit_cost"], "finance movement");
  return { ...base, unitCost: nullableDecimal(row, "unit_cost") };
}

const PURCHASE_SHARED_KEYS = [
  "id", "code", "status", "needed_by", "ordered", "received", "remaining", "unit", "item_unit",
] as const;

function itemPurchase(row: Row, scope: InventoryScope): InventoryItemPurchase | InventoryItemFinancePurchase {
  rejectExtraKeys(
    row,
    scope === "finance" ? [...PURCHASE_SHARED_KEYS, "pr_id", "est_cost", "reason"] : PURCHASE_SHARED_KEYS,
    "purchase line",
  );
  const status = text(row, "status");
  if (!PR_STATUS_SET.has(status)) {
    throw new Error("inventory snapshot: unknown purchase request status");
  }
  const ordered = nullableDecimal(row, "ordered");
  const received = decimal(row, "received");
  const remaining = nullableDecimal(row, "remaining");
  // An unquantified line records no ordered quantity, so it has no remaining balance either. Showing
  // 0 there would read as "nothing left to receive" when the truth is "nobody said how much".
  if ((ordered === null) !== (remaining === null)) {
    throw new Error("inventory snapshot: an unquantified purchase line cannot have a remaining balance");
  }
  if (ordered !== null && remaining !== null && subtractDecimals(ordered, received) !== remaining) {
    throw new Error("inventory snapshot: purchase line quantities do not reconcile");
  }
  const base: InventoryItemPurchase = {
    id: uuid(row, "id"),
    code: text(row, "code"),
    status,
    neededBy: calendarDate(row, "needed_by", true),
    ordered,
    received,
    remaining,
    unit: nullableText(row, "unit"),
    itemUnit: nullableText(row, "item_unit"),
  };
  if (scope !== "finance") return base;
  requireKeys(row, ["pr_id", "est_cost", "reason"], "finance purchase line");
  return {
    ...base,
    prId: uuid(row, "pr_id"),
    estCost: nullableDecimal(row, "est_cost"),
    reason: nullableText(row, "reason"),
  };
}

function itemSupplier(value: unknown): InventoryItemSupplier | null {
  if (value === null) return null;
  const row = object(value, "supplier");
  rejectExtraKeys(row, ["name", "lead_time_days"], "supplier");
  return {
    name: text(row, "name"),
    leadTimeDays: row.lead_time_days === null ? null : integerText(row, "lead_time_days"),
  };
}

export function parseInventoryItemSnapshot(
  value: unknown,
  expected: InventoryItemSnapshotExpectation,
): InventoryItemSnapshot {
  const root = object(value, "root");
  const scope = scopeOf(root);
  if (scope !== expected.scope) {
    throw new Error("inventory snapshot: item role scope mismatch");
  }
  if (scope === "operational") assertNoFinanceKeys(root);

  const sharedRootKeys = [
    "version", "org_id", "item_id", "scope", "movement_limit", "purchase_limit",
    "authority", "item", "policy", "stock", "locations", "movements", "purchases",
  ] as const;
  rejectExtraKeys(
    root,
    scope === "finance" ? [...sharedRootKeys, "unit_cost", "valuation", "supplier"] : sharedRootKeys,
    "root",
  );
  if (text(root, "version") !== INVENTORY_ITEM_SNAPSHOT_VERSION) {
    throw new Error("inventory snapshot: item version mismatch");
  }
  if (text(root, "org_id") !== expected.orgId) {
    throw new Error("inventory snapshot: organization mismatch");
  }
  if (text(root, "item_id") !== expected.itemId) {
    throw new Error("inventory snapshot: item mismatch");
  }
  const movementLimit = boundedInteger(root, "movement_limit", 1, RPC_MAX_SAMPLE_LIMIT);
  const purchaseLimit = boundedInteger(root, "purchase_limit", 1, RPC_MAX_SAMPLE_LIMIT);
  if (movementLimit !== expected.movementLimit || purchaseLimit !== expected.purchaseLimit) {
    throw new Error("inventory snapshot: item request arguments mismatch");
  }
  const parsedAuthority = authority(root.authority);
  const identity = itemIdentity(root.item);
  const policy = itemPolicy(root.policy);

  const stockRow = object(root.stock, "stock");
  rejectExtraKeys(
    stockRow,
    ["bin_count", "state", "on_hand", "reserved", "available", "ordered", "projected"],
    "stock",
  );
  // The 360 aggregate is read against the SAME policy the card shows, so the header state and the
  // reorder policy can never contradict each other.
  const reading = stockReading(
    { ...stockRow, threshold: policy.threshold, threshold_source: policy.thresholdSource },
    "stock",
  );
  const hasBin = reading.binCount !== "0";
  const orderedTotal = nullableDecimal(stockRow, "ordered");
  const projectedTotal = nullableDecimal(stockRow, "projected");
  if (hasBin !== (orderedTotal !== null) || hasBin !== (projectedTotal !== null)) {
    throw new Error("inventory snapshot: stock ordered/projected presence contradicts the bin count");
  }
  const stock: InventoryItemStock = { ...reading, ordered: orderedTotal, projected: projectedTotal };

  const locations = boundedRows(root.locations, RPC_MAX_LOCATIONS, "locations").map(itemLocation);
  if (BigInt(locations.length) !== BigInt(reading.binCount)) {
    throw new Error("inventory snapshot: the published locations do not account for every bin");
  }
  assertDistinct(locations.map((row) => row.location), "locations");
  // The aggregate must be the sum of the locations behind it — that equality is the whole point of
  // this contract, because the surface it replaces reported only the first bin.
  if (locations.length > 0) {
    const onHandSum = sumDecimals(locations.map((row) => row.onHand));
    const reservedSum = sumDecimals(locations.map((row) => row.reserved));
    if (onHandSum.total !== stock.onHand || reservedSum.total !== stock.reserved) {
      throw new Error("inventory snapshot: the stock aggregate does not sum every published location");
    }
  }

  const movementsRow = object(root.movements, "movements");
  rejectExtraKeys(movementsRow, ["total", "rows"], "movements");
  const movementTotal = count(movementsRow, "total");
  const movements = boundedRows(movementsRow.rows, movementLimit, "movements.rows")
    .map((row) => itemMovement(row, scope));
  if (movements.length !== expectedSampleLength(movementTotal, movementLimit)) {
    throw new Error("inventory snapshot: the movement sample does not match its exact total");
  }
  assertDistinct(movements.map((row) => row.id), "movements");
  for (let index = 1; index < movements.length; index += 1) {
    if (movements[index].occurredOn > movements[index - 1].occurredOn) {
      throw new Error("inventory snapshot: movements are not ordered most recent first");
    }
  }

  const purchasesRow = object(root.purchases, "purchases");
  rejectExtraKeys(purchasesRow, ["total", "open_total", "rows"], "purchases");
  const purchaseTotal = count(purchasesRow, "total");
  const openPurchaseTotal = count(purchasesRow, "open_total");
  if (BigInt(openPurchaseTotal) > BigInt(purchaseTotal)) {
    throw new Error("inventory snapshot: more purchase lines are open than exist");
  }
  const purchases = boundedRows(purchasesRow.rows, purchaseLimit, "purchases.rows")
    .map((row) => itemPurchase(row, scope));
  if (purchases.length !== expectedSampleLength(purchaseTotal, purchaseLimit)) {
    throw new Error("inventory snapshot: the purchase sample does not match its exact total");
  }
  assertDistinct(purchases.map((row) => row.id), "purchase lines");

  const shared: InventoryItemShared = {
    orgId: expected.orgId,
    itemId: expected.itemId,
    movementLimit,
    purchaseLimit,
    authority: parsedAuthority,
    item: identity,
    policy,
    stock,
    locations,
    movementTotal,
    purchaseTotal,
    openPurchaseTotal,
  };

  if (scope !== "finance") {
    return {
      ...shared,
      scope: "operational",
      movements: movements as InventoryItemMovement[],
      purchases: purchases as InventoryItemPurchase[],
    };
  }
  requireKeys(root, ["unit_cost", "valuation", "supplier"], "finance root");
  const unitCost = nullableDecimal(root, "unit_cost");
  return {
    ...shared,
    scope: "finance",
    movements: movements as InventoryItemFinanceMovement[],
    purchases: purchases as InventoryItemFinancePurchase[],
    unitCost,
    valuation: checkedValuation(stock.onHand, unitCost, nullableDecimal(root, "valuation"), "item"),
    supplier: itemSupplier(root.supplier),
  };
}
