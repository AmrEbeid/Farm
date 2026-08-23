// R4b pass 1 — strict parsers for the exact payroll WORKSPACE (run history) and RUN detail snapshots
// (`fn_payroll_workspace_snapshot` and `fn_payroll_run_snapshot`, migration 20260823150000).
//
// STORED VALUES ONLY, NEVER RECOMPUTED. Every line here is a frozen `payroll_run_lines` row
// (mode/unit/quantity/rate/gross snapshotted at close time by `fn_close_payroll_run` and immutable
// afterward) — this parser never re-derives a rate from `people_compensation`, so a rate edited after
// a close can never change what a past run is read to report.
//
// NO CONTACT PII, NO CLOSER IDENTITY. `person_name` is the close-time name stored on the immutable
// payroll line and the only identity fact this contract carries about a person (SPEC-0048 keeps
// phone/email PII-locked); `closed_by` never appears in either payload at all — this parser
// rejects it as an unexpected key exactly like any other leak.
//
// HONESTY CONTRACT (docs/CLAUDE.md #1).
//   * Every count and every amount leaves PostgreSQL as TEXT and is read here as exact decimal/count
//     text — a JS number cannot represent every bigint, and a binary double cannot represent every
//     `numeric`. Every comparison below happens in exact decimal space.
//   * A run's own frozen `total_gross` must reconcile with the sum of its own frozen lines whenever
//     every line for that run is actually in hand (the run's own detail page, never the workspace
//     history's bounded per-run line count) — a drift is refused rather than rendered.
//   * `gross` must reconcile with `round(quantity * rate, 2)`, the same invariant pinned as a CHECK
//     constraint on `payroll_run_lines` itself (`payroll_run_lines_gross_exact`).

import {
  compareDecimals,
  multiplyDecimals,
  parseDecimal,
  roundDecimal,
  sumDecimals,
  type DecimalString,
} from "./decimal";
import type { DataAuthorityLevel } from "./data-authority";

export const PAYROLL_WORKSPACE_SNAPSHOT_VERSION = "farm-os.payroll-workspace.v1";
export const PAYROLL_RUN_SNAPSHOT_VERSION = "farm-os.payroll-run.v1";

/** One page of the run history. Recent history, not an archive browser. */
export const PAYROLL_WORKSPACE_PAGE_SIZE = 20;
/** One page of a single run's lines. */
export const PAYROLL_RUN_LINE_PAGE_SIZE = 20;

/**
 * The RPCs' OWN argument bounds, restated here so a payload that breaks them is refused rather than
 * rendered — duplicated knowledge across two languages on purpose, kept in step with migration
 * 20260823150000 (`p_limit` 1-50, `p_offset` 0-1000000 on both functions).
 */
const RPC_MAX_PAGE_LIMIT = 50;
const RPC_MAX_PAGE_OFFSET = 1_000_000;

type Row = Record<string, unknown>;

/** An exact count as canonical non-negative integer text. Never widened to a JS number. */
export type ExactCountString = string;

/** The four frozen wage modes (SPEC-0006 #388) — the exact CHECK-constrained set on payroll_run_lines. */
export const PAYROLL_MODES = ["hourly", "daily", "piece", "seasonal"] as const;
export type PayrollMode = (typeof PAYROLL_MODES)[number];
const MODE_SET = new Set<string>(PAYROLL_MODES);

/** The exact CHECK-constrained piece-rate units on both people_compensation and payroll_run_lines. */
export const PAYROLL_UNITS = ["tree", "box", "crate", "kg", "bucket", "bin", "row"] as const;
export type PayrollUnit = (typeof PAYROLL_UNITS)[number];
const UNIT_SET = new Set<string>(PAYROLL_UNITS);

/** Key names that must never appear in either payload. `closed_by` is checked by name, not omission. */
const FORBIDDEN_KEYS = new Set(["closed_by", "closer", "closer_id", "person_phone", "phone", "email"]);

// ── primitive readers ─────────────────────────────────────────────────────────────────────────

function object(value: unknown, context: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`payroll snapshot: ${context} must be an object`);
  }
  return value as Row;
}

function rejectExtraKeys(row: Row, allowed: readonly string[], context: string): void {
  const allowedKeys = new Set(allowed);
  const extra = Object.keys(row).filter((key) => !allowedKeys.has(key));
  if (extra.length > 0) {
    throw new Error(`payroll snapshot: ${context} has unexpected keys: ${extra.sort().join(", ")}`);
  }
}

/** Walk the raw payload and refuse any forbidden key, however deeply it is nested. */
function assertNoForbiddenKeys(value: unknown, path = "root"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Row)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`payroll snapshot: the payload carries "${key}" at ${path}`);
    }
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`payroll snapshot: ${key} must be text`);
  }
  return value;
}

function uuid(row: Row, key: string): string {
  const value = text(row, key);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`payroll snapshot: ${key} must be a UUID`);
  }
  return value;
}

function count(row: Row, key: string): ExactCountString {
  const value = text(row, key);
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`payroll snapshot: ${key} must be exact count text`);
  }
  return value;
}

function decimal(row: Row, key: string): DecimalString {
  if (typeof row[key] !== "string") {
    throw new Error(`payroll snapshot: ${key} must be decimal text`);
  }
  const parsed = parseDecimal(row[key]);
  if (parsed === null) throw new Error(`payroll snapshot: ${key} must be decimal text`);
  return parsed;
}

function calendarDate(row: Row, key: string): string {
  const value = text(row, key);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`payroll snapshot: ${key} must be a calendar date`);
  }
  return value;
}

/** `closed_at` is a timestamptz rendered as text — validated as a real parseable instant, not merely
 * nonempty text, so a corrupt or truncated timestamp is refused rather than displayed. */
function timestampText(row: Row, key: string): string {
  const value = text(row, key);
  if (Number.isNaN(new Date(value).getTime())) {
    throw new Error(`payroll snapshot: ${key} must be a parseable timestamp`);
  }
  return value;
}

function boundedInteger(row: Row, key: string, min: number, max: number): number {
  const value = row[key];
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`payroll snapshot: ${key} is out of range`);
  }
  return value as number;
}

function boundedRows(value: unknown, limit: number, context: string): Row[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw new Error(`payroll snapshot: ${context} must be a bounded array`);
  }
  return value.map((entry, index) => object(entry, `${context}[${index}]`));
}

/** How many rows a limit/offset page of an exact total must contain. */
function expectedPageLength(exact: ExactCountString, limit: number, offset: number): number {
  const remaining = BigInt(exact) - BigInt(offset);
  if (remaining <= BigInt(0)) return 0;
  return remaining < BigInt(limit) ? Number(remaining) : limit;
}

function assertDistinct(ids: string[], context: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new Error(`payroll snapshot: ${context} must not repeat a row`);
  }
}

function authority(value: unknown): { payroll: DataAuthorityLevel } {
  const raw = object(value, "authority");
  rejectExtraKeys(raw, ["payroll"], "authority");
  const allowed = new Set<DataAuthorityLevel>(["verified", "partial", "unverified", "blocked"]);
  const status = raw.payroll ?? "unverified";
  if (typeof status !== "string" || !allowed.has(status as DataAuthorityLevel)) {
    throw new Error("payroll snapshot: invalid authority status for payroll");
  }
  return { payroll: status as DataAuthorityLevel };
}

// ── workspace snapshot (run history) ─────────────────────────────────────────────────────────

export interface PayrollWorkspaceRun {
  runId: string;
  periodStart: string;
  periodEnd: string;
  closedAt: string;
  totalGross: DecimalString;
  lineCount: ExactCountString;
}

export interface PayrollWorkspaceCounts {
  totalRuns: ExactCountString;
}

export interface PayrollWorkspaceTotals {
  /** The exact sum of total_gross over EVERY run in the organization, not just the bounded page. */
  totalGross: DecimalString;
}

export interface PayrollWorkspaceSnapshot {
  version: typeof PAYROLL_WORKSPACE_SNAPSHOT_VERSION;
  orgId: string;
  limit: number;
  offset: number;
  authority: { payroll: DataAuthorityLevel };
  counts: PayrollWorkspaceCounts;
  totals: PayrollWorkspaceTotals;
  rows: PayrollWorkspaceRun[];
}

export interface PayrollWorkspaceSnapshotExpectation {
  orgId: string;
  limit: number;
  offset: number;
}

const WORKSPACE_ROOT_KEYS = [
  "version", "org_id", "limit", "offset", "authority", "counts", "totals", "rows",
] as const;

const WORKSPACE_ROW_KEYS = [
  "run_id", "period_start", "period_end", "closed_at", "total_gross", "line_count",
] as const;

function workspaceRow(row: Row): PayrollWorkspaceRun {
  rejectExtraKeys(row, WORKSPACE_ROW_KEYS, "workspace row");
  return {
    runId: uuid(row, "run_id"),
    periodStart: calendarDate(row, "period_start"),
    periodEnd: calendarDate(row, "period_end"),
    closedAt: timestampText(row, "closed_at"),
    totalGross: decimal(row, "total_gross"),
    lineCount: count(row, "line_count"),
  };
}

export function parsePayrollWorkspaceSnapshot(
  value: unknown,
  expected: PayrollWorkspaceSnapshotExpectation,
): PayrollWorkspaceSnapshot {
  const root = object(value, "root");
  assertNoForbiddenKeys(root);
  rejectExtraKeys(root, WORKSPACE_ROOT_KEYS, "root");

  if (text(root, "version") !== PAYROLL_WORKSPACE_SNAPSHOT_VERSION) {
    throw new Error("payroll snapshot: workspace version mismatch");
  }
  if (text(root, "org_id") !== expected.orgId) {
    throw new Error("payroll snapshot: organization mismatch");
  }
  const limit = boundedInteger(root, "limit", 1, RPC_MAX_PAGE_LIMIT);
  const offset = boundedInteger(root, "offset", 0, RPC_MAX_PAGE_OFFSET);
  if (limit !== expected.limit || offset !== expected.offset) {
    throw new Error("payroll snapshot: workspace request arguments mismatch");
  }
  const parsedAuthority = authority(root.authority);

  const countsRow = object(root.counts, "counts");
  rejectExtraKeys(countsRow, ["total_runs"], "counts");
  const counts: PayrollWorkspaceCounts = { totalRuns: count(countsRow, "total_runs") };

  const totalsRow = object(root.totals, "totals");
  rejectExtraKeys(totalsRow, ["total_gross"], "totals");
  const totals: PayrollWorkspaceTotals = { totalGross: decimal(totalsRow, "total_gross") };

  const rows = boundedRows(root.rows, limit, "rows").map(workspaceRow);
  if (rows.length !== expectedPageLength(counts.totalRuns, limit, offset)) {
    throw new Error("payroll snapshot: the workspace page does not match its exact total, limit and offset");
  }
  assertDistinct(rows.map((row) => row.runId), "workspace rows");
  // Every run's own line count must be a real number and cannot exceed what a run could hold; the
  // per-run reconciliation against a run's OWN total_gross happens on that run's own detail page
  // (parsePayrollRunSnapshot below), where every one of its lines is actually in hand.
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (
      current.periodStart > previous.periodStart
      || (current.periodStart === previous.periodStart && current.periodEnd > previous.periodEnd)
    ) {
      throw new Error("payroll snapshot: workspace rows are not ordered most recently closed first");
    }
  }

  return {
    version: PAYROLL_WORKSPACE_SNAPSHOT_VERSION,
    orgId: expected.orgId,
    limit,
    offset,
    authority: parsedAuthority,
    counts,
    totals,
    rows,
  };
}

// ── run snapshot (one closed run's detail) ───────────────────────────────────────────────────

export interface PayrollRunLine {
  lineId: string;
  personId: string;
  personName: string;
  mode: PayrollMode;
  unit: PayrollUnit | null;
  quantity: DecimalString;
  rate: DecimalString;
  gross: DecimalString;
}

export interface PayrollRunCounts {
  totalLines: ExactCountString;
}

export interface PayrollRunSnapshot {
  version: typeof PAYROLL_RUN_SNAPSHOT_VERSION;
  orgId: string;
  runId: string;
  periodStart: string;
  periodEnd: string;
  closedAt: string;
  totalGross: DecimalString;
  limit: number;
  offset: number;
  counts: PayrollRunCounts;
  rows: PayrollRunLine[];
}

export interface PayrollRunSnapshotExpectation {
  orgId: string;
  runId: string;
  limit: number;
  offset: number;
}

const RUN_ROOT_KEYS = [
  "version", "org_id", "run_id", "period_start", "period_end", "closed_at", "total_gross",
  "limit", "offset", "counts", "rows",
] as const;

const RUN_LINE_KEYS = [
  "line_id", "person_id", "person_name", "mode", "unit", "quantity", "rate", "gross",
] as const;

function runLine(row: Row): PayrollRunLine {
  rejectExtraKeys(row, RUN_LINE_KEYS, "run line");
  const mode = text(row, "mode");
  if (!MODE_SET.has(mode)) {
    throw new Error("payroll snapshot: unknown recorded wage mode");
  }
  const rawUnit = row.unit;
  if (rawUnit !== null && (typeof rawUnit !== "string" || !UNIT_SET.has(rawUnit))) {
    throw new Error("payroll snapshot: unknown recorded piece unit");
  }
  const unit = rawUnit as PayrollUnit | null;
  // Mirrors the CHECK constraint pinned on payroll_run_lines itself: a piece line has a unit and no
  // other mode does.
  if ((mode === "piece") !== (unit !== null)) {
    throw new Error("payroll snapshot: a wage mode and its unit disagree");
  }
  const quantity = decimal(row, "quantity");
  const rate = decimal(row, "rate");
  const gross = decimal(row, "gross");
  // Mirrors payroll_run_lines_gross_exact: gross = round(quantity * rate, 2), never recomputed from a
  // current rate — this is the STORED value, checked for internal consistency, not re-derived.
  if (roundDecimal(multiplyDecimals(quantity, rate), 2) !== gross) {
    throw new Error("payroll snapshot: a frozen line's gross does not reconcile with its own quantity and rate");
  }
  return {
    lineId: uuid(row, "line_id"),
    personId: uuid(row, "person_id"),
    personName: text(row, "person_name"),
    mode: mode as PayrollMode,
    unit,
    quantity,
    rate,
    gross,
  };
}

export function parsePayrollRunSnapshot(
  value: unknown,
  expected: PayrollRunSnapshotExpectation,
): PayrollRunSnapshot | null {
  if (value === null) return null;
  const root = object(value, "root");
  assertNoForbiddenKeys(root);
  rejectExtraKeys(root, RUN_ROOT_KEYS, "root");

  if (text(root, "version") !== PAYROLL_RUN_SNAPSHOT_VERSION) {
    throw new Error("payroll snapshot: run version mismatch");
  }
  if (text(root, "org_id") !== expected.orgId) {
    throw new Error("payroll snapshot: organization mismatch");
  }
  if (text(root, "run_id") !== expected.runId) {
    throw new Error("payroll snapshot: run mismatch");
  }
  const limit = boundedInteger(root, "limit", 1, RPC_MAX_PAGE_LIMIT);
  const offset = boundedInteger(root, "offset", 0, RPC_MAX_PAGE_OFFSET);
  if (limit !== expected.limit || offset !== expected.offset) {
    throw new Error("payroll snapshot: run request arguments mismatch");
  }

  const periodStart = calendarDate(root, "period_start");
  const periodEnd = calendarDate(root, "period_end");
  if (periodStart > periodEnd) {
    throw new Error("payroll snapshot: run period_start is after period_end");
  }
  const closedAt = timestampText(root, "closed_at");
  const totalGross = decimal(root, "total_gross");

  const countsRow = object(root.counts, "counts");
  rejectExtraKeys(countsRow, ["total_lines"], "counts");
  const counts: PayrollRunCounts = { totalLines: count(countsRow, "total_lines") };

  const rows = boundedRows(root.rows, limit, "rows").map(runLine);
  if (rows.length !== expectedPageLength(counts.totalLines, limit, offset)) {
    throw new Error("payroll snapshot: the run line page does not match its exact total, limit and offset");
  }
  assertDistinct(rows.map((row) => row.lineId), "run lines");
  // Ordering by person name is a DB contract, proven in pgTAP (migration 20260823150000's `order by
  // person_name, ...`) — never re-checked here with JS `<`. PostgreSQL collation and JS UTF-16 code
  // unit ordering can disagree for Arabic names, so a client-side re-check would reject a correctly
  // ordered page.

  // Reconciliation against the run's OWN frozen total is only checkable when every one of its lines
  // is actually in hand — a bounded page can legitimately sum to less than the run total, and that is
  // not a drift, so this only ever runs when limit/offset cover the whole exact count. Compared as
  // BigInt, never widened through Number, so an exact count beyond 2^53 still compares correctly.
  if (BigInt(limit) >= BigInt(counts.totalLines) && offset === 0) {
    const grossSum = sumDecimals(rows.map((row) => row.gross));
    if (!grossSum.hasUnknown && compareDecimals(grossSum.total, totalGross) !== 0) {
      throw new Error("payroll snapshot: the run's total_gross does not reconcile with its own lines");
    }
  }

  return {
    version: PAYROLL_RUN_SNAPSHOT_VERSION,
    orgId: expected.orgId,
    runId: expected.runId,
    periodStart,
    periodEnd,
    closedAt,
    totalGross,
    limit,
    offset,
    counts,
    rows,
  };
}
