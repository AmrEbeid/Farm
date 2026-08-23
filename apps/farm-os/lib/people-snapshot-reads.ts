// SPEC-0033 R4c — strict parsers for the exact PEOPLE DIRECTORY and PERSON 360 snapshots
// (`fn_people_directory_snapshot` and `fn_person_snapshot`, migration 20260823160000).
//
// WHAT THESE REPLACE. Both surfaces used to read `people` unbounded through PostgREST, count open
// work as the literal status `planned`, ignore `plan_operations.responsible_person_id`, de-duplicate
// the two link kinds in JavaScript, and present `array.length` of a capped read as a total. Every
// one of those is now decided in PostgreSQL; this module's job is to refuse a payload that does not
// keep that contract, rather than to re-derive any of it.
//
// EVERY EXACT TOTAL IS SEPARATE FROM ITS ROWS, AND CHECKED AGAINST THEM.
// A bounded page or sample must contain EXACTLY the number of rows its own exact total, limit and
// offset imply. That single rule is what makes "this is one page of N" provable rather than
// asserted, and it is applied to the directory page and to all four person samples independently.
//
// WHAT MAY NEVER APPEAR. Contact PII (`phone`/`email`, PII-locked at the column-grant layer),
// `user_id` or any other auth identity, any wage/compensation/payroll figure, any creator/closer/
// audit identity, and `est_cost` or any other money key. Both payloads reject unexpected keys at
// every nesting level AND are walked key-by-key against a forbidden-name set, so a leak inside an
// object this parser does not otherwise read still cannot pass.
//
// HONESTY CONTRACT (docs/CLAUDE.md #1).
//   * OPEN is the NONTERMINAL operation set (`isExecutableOpStatus`'s negative set), never the
//     literal `planned`. Every row in the person 360's operation sample must actually be open, or
//     the sample is not the set its total describes.
//   * A missing manager is `null` on both surfaces, and the id and the name are null together — a
//     manager id with no name would be a dangling reference the database is supposed to refuse.
//   * Counts stay exact text and are compared in BigInt space; a JS number cannot represent every
//     bigint.
//
// ORDERING IS A DATABASE CONTRACT WHERE COLLATION IS INVOLVED. Arabic name order is proven in
// pgTAP and is NOT re-compared here with JavaScript `<`: PostgreSQL collation and JS UTF-16 code
// unit ordering can disagree, so a client re-check would reject a correctly ordered page. Only the
// order facts that are collation-free — the active-first rank, an ISO date, a timestamp — are
// re-checked below.

import type { DataAuthorityLevel } from "./data-authority";
import type { Role } from "./auth";

export const PEOPLE_DIRECTORY_SNAPSHOT_VERSION = "farm-os.people-directory.v1";
export const PERSON_SNAPSHOT_VERSION = "farm-os.person-360.v1";

/** One page of the directory. Kept small because the phone is the design target. */
export const PEOPLE_DIRECTORY_PAGE_SIZE = 20;

/** The person 360's four INDEPENDENT sample bounds — one per question the page asks. */
export const PERSON_OPERATION_SAMPLE = 10;
export const PERSON_PERFORMED_EVENT_SAMPLE = 8;
export const PERSON_ASSIGNED_EVENT_SAMPLE = 8;
export const PERSON_DIRECT_REPORT_SAMPLE = 10;

/**
 * The RPCs' OWN argument bounds, restated here so a payload that breaks them is refused rather than
 * rendered. Duplicated knowledge across two languages on purpose — the database is the enforcement
 * and these are the reader's independent check — so they must be kept in step with migration
 * 20260823160000 (`p_limit` 1-50, `p_offset` 0-1000000, every sample limit 1-50, 500 manager options).
 */
const RPC_MAX_PAGE_LIMIT = 50;
const RPC_MAX_PAGE_OFFSET = 1_000_000;
const RPC_MAX_SAMPLE_LIMIT = 50;
const RPC_MAX_MANAGER_OPTIONS = 500;

type Row = Record<string, unknown>;

/** An exact count as canonical non-negative integer text. Never widened to a JS number. */
export type ExactCountString = string;

/** The roles `/people` and `/people/[personId]` are gated to, re-checked inside PostgreSQL. */
export const PEOPLE_READ_ROLES: readonly Role[] = ["owner", "farm_manager", "agri_engineer", "accountant"];

/** The roles `authorize('people.write')` accepts (migration 20260701300000). */
export const PEOPLE_WRITE_ROLES: readonly Role[] = ["owner", "farm_manager"];

export function canWritePeople(role: Role): boolean {
  return PEOPLE_WRITE_ROLES.includes(role);
}

export const PEOPLE_DIRECTORY_FILTERS = ["all", "active", "assigned"] as const;
export type PeopleDirectoryFilter = (typeof PEOPLE_DIRECTORY_FILTERS)[number];

export function isPeopleDirectoryFilter(value: unknown): value is PeopleDirectoryFilter {
  return typeof value === "string" && (PEOPLE_DIRECTORY_FILTERS as readonly string[]).includes(value);
}

/** Parse a URL filter. An illegal or unknown value falls back to «all», never throws. */
export function parsePeopleDirectoryFilter(raw: string | undefined): PeopleDirectoryFilter {
  return isPeopleDirectoryFilter(raw) ? raw : "all";
}

/** The CHECK-constrained `plan_operations.status` set (migration 20260622000058). */
export const OPERATION_STATUSES = [
  "planned", "approved", "reserved", "ready", "in_progress", "done", "blocked", "abandoned", "skipped",
] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];
const OPERATION_STATUS_SET = new Set<string>(OPERATION_STATUSES);

/** The CHECK-constrained `farm_event.status` set (migration 20260622000004) — no `approved`. */
export const EVENT_STATUSES = [
  "planned", "reserved", "ready", "blocked", "in_progress", "done", "abandoned", "skipped",
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
const EVENT_STATUS_SET = new Set<string>(EVENT_STATUSES);

/**
 * TERMINAL, and therefore NOT open. The same negative set `fn_execute_operation` and
 * `isExecutableOpStatus` use, restated here so the reader can check the database kept its own rule.
 */
const TERMINAL_STATUSES = new Set<string>(["done", "blocked", "abandoned", "skipped"]);

export function isOpenRecordedStatus(status: string): boolean {
  return !TERMINAL_STATUSES.has(status);
}

/**
 * Key names that must NEVER appear anywhere in either payload. Matched EXACTLY, not by substring, so
 * an innocent key can never trip it and a real leak cannot hide behind a prefix.
 */
const FORBIDDEN_KEYS = new Set([
  // contact PII
  "phone", "email", "contact", "address",
  // auth / audit identity
  "user_id", "userId", "auth_id", "created_by", "createdBy", "closed_by", "actor_user_id",
  "approved_by", "requested_by", "signed_off_by", "signed_off_at", "verified_by",
  // wage, compensation, payroll and money
  "rate", "wage", "salary", "gross", "net", "compensation", "payroll", "pay",
  "est_cost", "estCost", "cost", "unit_cost", "amount", "price", "value", "total_gross", "valuation",
]);

// ── primitive readers ─────────────────────────────────────────────────────────────────────────

function object(value: unknown, context: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`people snapshot: ${context} must be an object`);
  }
  return value as Row;
}

function rejectExtraKeys(row: Row, allowed: readonly string[], context: string): void {
  const allowedKeys = new Set(allowed);
  const extra = Object.keys(row).filter((key) => !allowedKeys.has(key));
  if (extra.length > 0) {
    throw new Error(`people snapshot: ${context} has unexpected keys: ${extra.sort().join(", ")}`);
  }
}

function requireKeys(row: Row, required: readonly string[], context: string): void {
  const missing = required.filter((key) => !(key in row));
  if (missing.length > 0) {
    throw new Error(`people snapshot: ${context} is missing keys: ${missing.sort().join(", ")}`);
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
      throw new Error(`people snapshot: the payload carries "${key}" at ${path}`);
    }
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`people snapshot: ${key} must be text`);
  }
  return value;
}

function nullableText(row: Row, key: string): string | null {
  return row[key] === null ? null : text(row, key);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(row: Row, key: string): string {
  const value = text(row, key);
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`people snapshot: ${key} must be a UUID`);
  }
  return value;
}

function nullableUuid(row: Row, key: string): string | null {
  return row[key] === null ? null : uuid(row, key);
}

function count(row: Row, key: string): ExactCountString {
  const value = text(row, key);
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`people snapshot: ${key} must be exact count text`);
  }
  return value;
}

function boolean(row: Row, key: string): boolean {
  if (typeof row[key] !== "boolean") {
    throw new Error(`people snapshot: ${key} must be a boolean`);
  }
  return row[key] as boolean;
}

function boundedInteger(row: Row, key: string, min: number, max: number): number {
  const value = row[key];
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`people snapshot: ${key} is out of range`);
  }
  return value as number;
}

/** A recorded calendar date, or `null` for an operation nobody has scheduled yet. */
function nullableCalendarDate(row: Row, key: string): string | null {
  const value = nullableText(row, key);
  if (value === null) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`people snapshot: ${key} must be a calendar date`);
  }
  return value;
}

/** A timestamptz rendered as text — validated as a real parseable instant, not merely nonempty. */
function timestampText(row: Row, key: string): string {
  const value = text(row, key);
  if (Number.isNaN(new Date(value).getTime())) {
    throw new Error(`people snapshot: ${key} must be a parseable timestamp`);
  }
  return value;
}

function boundedRows(value: unknown, limit: number, context: string): Row[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw new Error(`people snapshot: ${context} must be a bounded array`);
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

function assertDistinct(ids: string[], context: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new Error(`people snapshot: ${context} must not repeat a row`);
  }
}

/** Active people lead every ordered list here; a later row may never outrank an earlier one. */
function assertActiveFirst(rows: { active: boolean }[], context: string): void {
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index].active && !rows[index - 1].active) {
      throw new Error(`people snapshot: ${context} is not ordered active first`);
    }
  }
}

function authority(value: unknown): { operations: DataAuthorityLevel } {
  const raw = object(value, "authority");
  rejectExtraKeys(raw, ["operations"], "authority");
  const allowed = new Set<DataAuthorityLevel>(["verified", "partial", "unverified", "blocked"]);
  const status = raw.operations ?? "unverified";
  if (typeof status !== "string" || !allowed.has(status as DataAuthorityLevel)) {
    throw new Error("people snapshot: invalid authority status for operations");
  }
  return { operations: status as DataAuthorityLevel };
}

/** A manager reference is a pair: both halves, or neither. A half is a dangling reference. */
function managerReference(row: Row, context: string): { managerId: string | null; managerName: string | null } {
  const managerId = nullableUuid(row, "manager_id");
  const managerName = nullableText(row, "manager_name");
  if ((managerId === null) !== (managerName === null)) {
    throw new Error(`people snapshot: ${context} has a manager id without a name, or the reverse`);
  }
  return { managerId, managerName };
}

// ── directory snapshot ────────────────────────────────────────────────────────────────────────

export interface PeopleDirectoryRow {
  personId: string;
  name: string;
  position: string | null;
  employmentType: string | null;
  active: boolean;
  managerId: string | null;
  managerName: string | null;
  /** Exact count of the person's OPEN (nonterminal) linked operations. Text, never a number. */
  openOperations: ExactCountString;
}

export interface PeopleDirectoryCounts {
  /** Every person in the organisation, before search and before filter. */
  totalPeople: ExactCountString;
  /** People matching the search. The denominator of the state counts below. */
  queryTotal: ExactCountString;
  /** People matching search AND filter. The denominator of the page. */
  matching: ExactCountString;
  active: ExactCountString;
  inactive: ExactCountString;
  /** People with at least one OPEN linked operation, through either link kind. */
  assigned: ExactCountString;
}

export interface PeopleManagerOption {
  personId: string;
  name: string;
}

export interface PeopleDirectorySnapshot {
  version: typeof PEOPLE_DIRECTORY_SNAPSHOT_VERSION;
  orgId: string;
  query: string | null;
  filter: PeopleDirectoryFilter;
  limit: number;
  offset: number;
  canWrite: boolean;
  authority: { operations: DataAuthorityLevel };
  counts: PeopleDirectoryCounts;
  rows: PeopleDirectoryRow[];
  /**
   * The FULL manager option list, published separately from the page. `null` means either the
   * caller cannot onboard or the full list exceeded its safe bound; `canWrite` distinguishes them.
   */
  managerOptions: PeopleManagerOption[] | null;
}

export interface PeopleDirectorySnapshotExpectation {
  orgId: string;
  query: string | null;
  filter: PeopleDirectoryFilter;
  limit: number;
  offset: number;
  canWrite: boolean;
}

const DIRECTORY_ROOT_KEYS = [
  "version", "org_id", "query", "filter", "limit", "offset", "can_write", "authority", "counts", "rows",
] as const;

const DIRECTORY_ROW_KEYS = [
  "person_id", "name", "position", "employment_type", "active",
  "manager_id", "manager_name", "open_operations",
] as const;

function directoryRow(row: Row): PeopleDirectoryRow {
  rejectExtraKeys(row, DIRECTORY_ROW_KEYS, "directory row");
  return {
    personId: uuid(row, "person_id"),
    name: text(row, "name"),
    position: nullableText(row, "position"),
    employmentType: nullableText(row, "employment_type"),
    active: boolean(row, "active"),
    ...managerReference(row, "directory row"),
    openOperations: count(row, "open_operations"),
  };
}

function managerOption(row: Row): PeopleManagerOption {
  rejectExtraKeys(row, ["person_id", "name"], "manager option");
  return { personId: uuid(row, "person_id"), name: text(row, "name") };
}

/**
 * The counts must agree with each other before a single row is read. Active and inactive partition
 * the searched set exactly; a drift means a person was double-counted or dropped, and on a roster
 * that is a colleague who does not exist or one who exists twice.
 */
function assertDirectoryCounts(counts: PeopleDirectoryCounts, filter: PeopleDirectoryFilter): void {
  if (BigInt(counts.active) + BigInt(counts.inactive) !== BigInt(counts.queryTotal)) {
    throw new Error("people snapshot: active and inactive do not partition the searched people exactly");
  }
  if (BigInt(counts.queryTotal) > BigInt(counts.totalPeople)) {
    throw new Error("people snapshot: the search matched more people than the organization has");
  }
  if (BigInt(counts.assigned) > BigInt(counts.queryTotal)) {
    throw new Error("people snapshot: more people are assigned than the search matched");
  }
  if (BigInt(counts.matching) > BigInt(counts.queryTotal)) {
    throw new Error("people snapshot: the filter matched more people than the search did");
  }
  // The page denominator must be exactly the count of the chip the caller selected, or the pager and
  // the chip would state two different sizes for the same set.
  const expected =
    filter === "active" ? counts.active : filter === "assigned" ? counts.assigned : counts.queryTotal;
  if (counts.matching !== expected) {
    throw new Error("people snapshot: the page total contradicts its own filter count");
  }
}

export function parsePeopleDirectorySnapshot(
  value: unknown,
  expected: PeopleDirectorySnapshotExpectation,
): PeopleDirectorySnapshot {
  const root = object(value, "root");
  assertNoForbiddenKeys(root);
  rejectExtraKeys(
    root,
    expected.canWrite ? [...DIRECTORY_ROOT_KEYS, "manager_options"] : DIRECTORY_ROOT_KEYS,
    "root",
  );

  if (text(root, "version") !== PEOPLE_DIRECTORY_SNAPSHOT_VERSION) {
    throw new Error("people snapshot: directory version mismatch");
  }
  if (text(root, "org_id") !== expected.orgId) {
    throw new Error("people snapshot: organization mismatch");
  }
  const rawFilter = text(root, "filter");
  if (!isPeopleDirectoryFilter(rawFilter)) {
    throw new Error("people snapshot: unknown directory filter");
  }
  const filter = rawFilter;
  const query = root.query === null ? null : text(root, "query");
  const limit = boundedInteger(root, "limit", 1, RPC_MAX_PAGE_LIMIT);
  const offset = boundedInteger(root, "offset", 0, RPC_MAX_PAGE_OFFSET);
  const canWrite = boolean(root, "can_write");
  if (
    query !== expected.query
    || filter !== expected.filter
    || limit !== expected.limit
    || offset !== expected.offset
  ) {
    throw new Error("people snapshot: directory request arguments mismatch");
  }
  // Both directions. A payload that grants write capability the caller does not have is a leak; one
  // that silently drops it from a caller who does have it is a regression that would blank the
  // onboarding form without anybody noticing.
  if (canWrite !== expected.canWrite) {
    throw new Error("people snapshot: directory write capability mismatch");
  }
  const parsedAuthority = authority(root.authority);

  const countsRow = object(root.counts, "counts");
  rejectExtraKeys(
    countsRow,
    ["total_people", "query_total", "matching", "active", "inactive", "assigned"],
    "counts",
  );
  const counts: PeopleDirectoryCounts = {
    totalPeople: count(countsRow, "total_people"),
    queryTotal: count(countsRow, "query_total"),
    matching: count(countsRow, "matching"),
    active: count(countsRow, "active"),
    inactive: count(countsRow, "inactive"),
    assigned: count(countsRow, "assigned"),
  };
  assertDirectoryCounts(counts, filter);

  const rows = boundedRows(root.rows, limit, "rows").map(directoryRow);
  if (rows.length !== expectedPageLength(counts.matching, limit, offset)) {
    throw new Error("people snapshot: the page does not match its exact total, limit and offset");
  }
  assertDistinct(rows.map((row) => row.personId), "directory rows");
  assertActiveFirst(rows, "the directory page");
  // A filtered page may only contain rows of that filter, or the chip is lying about what it shows.
  if (filter === "active" && rows.some((row) => !row.active)) {
    throw new Error("people snapshot: an active-only page contains an inactive person");
  }
  if (filter === "assigned" && rows.some((row) => row.openOperations === "0")) {
    throw new Error("people snapshot: an assigned-only page contains a person with no open operation");
  }

  let managerOptions: PeopleManagerOption[] | null = null;
  if (canWrite) {
    requireKeys(root, ["manager_options"], "root");
    if (root.manager_options !== null) {
      managerOptions = boundedRows(root.manager_options, RPC_MAX_MANAGER_OPTIONS, "manager options")
        .map(managerOption);
      assertDistinct(managerOptions.map((option) => option.personId), "manager options");
    }
  }

  return {
    version: PEOPLE_DIRECTORY_SNAPSHOT_VERSION,
    orgId: expected.orgId,
    query,
    filter,
    limit,
    offset,
    canWrite,
    authority: parsedAuthority,
    counts,
    rows,
    managerOptions,
  };
}

// ── person 360 snapshot ───────────────────────────────────────────────────────────────────────

export interface PersonIdentity {
  name: string;
  position: string | null;
  employmentType: string | null;
  active: boolean;
  managerId: string | null;
  managerName: string | null;
}

export interface PersonOperationRow {
  planOpId: string;
  planId: string;
  subtype: string | null;
  status: OperationStatus;
  plannedAt: string | null;
  endsOn: string | null;
  /** This person is a named assignee AND marked lead on the operation. */
  isLead: boolean;
  /** This person is the operation's legacy `responsible_person_id`. */
  isResponsible: boolean;
}

export interface PersonEventRow {
  eventId: string;
  type: string;
  subtype: string | null;
  status: EventStatus;
  occurredAt: string;
  notes: string | null;
}

export interface PersonDirectReportRow {
  personId: string;
  name: string;
  position: string | null;
  employmentType: string | null;
  active: boolean;
}

export interface PersonOperations {
  /** Every operation this person is linked to, ever. */
  total: ExactCountString;
  /** The nonterminal ones — the workload the sample below is drawn from. */
  openTotal: ExactCountString;
  rows: PersonOperationRow[];
}

export interface PersonEvents {
  total: ExactCountString;
  rows: PersonEventRow[];
}

export interface PersonAssignedEvents extends PersonEvents {
  openTotal: ExactCountString;
}

export interface PersonDirectReports {
  total: ExactCountString;
  activeTotal: ExactCountString;
  rows: PersonDirectReportRow[];
}

export interface PersonSnapshotLimits {
  operations: number;
  performedEvents: number;
  assignedEvents: number;
  directReports: number;
}

export interface PersonSnapshot {
  version: typeof PERSON_SNAPSHOT_VERSION;
  orgId: string;
  personId: string;
  limits: PersonSnapshotLimits;
  authority: { operations: DataAuthorityLevel };
  person: PersonIdentity;
  operations: PersonOperations;
  performedEvents: PersonEvents;
  assignedEvents: PersonAssignedEvents;
  directReports: PersonDirectReports;
}

export interface PersonSnapshotExpectation {
  orgId: string;
  personId: string;
  operationLimit: number;
  performedLimit: number;
  assignedLimit: number;
  reportLimit: number;
}

const PERSON_ROOT_KEYS = [
  "version", "org_id", "person_id", "limits", "authority", "person",
  "operations", "performed_events", "assigned_events", "direct_reports",
] as const;

const PERSON_IDENTITY_KEYS = [
  "name", "position", "employment_type", "active", "manager_id", "manager_name",
] as const;

const PERSON_OPERATION_KEYS = [
  "plan_op_id", "plan_id", "subtype", "status", "planned_at", "ends_on", "is_lead", "is_responsible",
] as const;

const PERSON_EVENT_KEYS = ["event_id", "type", "subtype", "status", "occurred_at", "notes"] as const;

const PERSON_REPORT_KEYS = ["person_id", "name", "position", "employment_type", "active"] as const;

function personOperationRow(row: Row): PersonOperationRow {
  rejectExtraKeys(row, PERSON_OPERATION_KEYS, "operation row");
  const status = text(row, "status");
  if (!OPERATION_STATUS_SET.has(status)) {
    throw new Error("people snapshot: unknown recorded operation status");
  }
  // The sample is drawn from the OPEN set, so a terminal row in it means the sample and the total it
  // is published beside describe two different sets.
  if (!isOpenRecordedStatus(status)) {
    throw new Error("people snapshot: a terminal operation appears in the open workload sample");
  }
  const isLead = boolean(row, "is_lead");
  const isResponsible = boolean(row, "is_responsible");
  // The row exists BECAUSE one of the two links exists. Neither means the de-duplicating union
  // produced a row nothing links to.
  if (!isLead && !isResponsible && row.is_lead === false && row.is_responsible === false) {
    // A plain (non-lead) assignee is the remaining legal case, and it is indistinguishable here from
    // "no link at all" — so it is checked in pgTAP against the assignee table, not invented here.
  }
  const plannedAt = nullableCalendarDate(row, "planned_at");
  const endsOn = nullableCalendarDate(row, "ends_on");
  if (plannedAt !== null && endsOn !== null && endsOn < plannedAt) {
    throw new Error("people snapshot: an operation ends before it starts");
  }
  return {
    planOpId: uuid(row, "plan_op_id"),
    planId: uuid(row, "plan_id"),
    subtype: nullableText(row, "subtype"),
    status: status as OperationStatus,
    plannedAt,
    endsOn,
    isLead,
    isResponsible,
  };
}

function personEventRow(row: Row): PersonEventRow {
  rejectExtraKeys(row, PERSON_EVENT_KEYS, "event row");
  const status = text(row, "status");
  if (!EVENT_STATUS_SET.has(status)) {
    throw new Error("people snapshot: unknown recorded event status");
  }
  return {
    eventId: uuid(row, "event_id"),
    type: text(row, "type"),
    subtype: nullableText(row, "subtype"),
    status: status as EventStatus,
    occurredAt: timestampText(row, "occurred_at"),
    notes: nullableText(row, "notes"),
  };
}

function personDirectReportRow(row: Row): PersonDirectReportRow {
  rejectExtraKeys(row, PERSON_REPORT_KEYS, "direct report row");
  return {
    personId: uuid(row, "person_id"),
    name: text(row, "name"),
    position: nullableText(row, "position"),
    employmentType: nullableText(row, "employment_type"),
    active: boolean(row, "active"),
  };
}

/** Newest recorded activity first. A timestamp comparison is collation-free, so it is re-checked. */
function assertNewestFirst(rows: PersonEventRow[], context: string): void {
  for (let index = 1; index < rows.length; index += 1) {
    if (new Date(rows[index].occurredAt).getTime() > new Date(rows[index - 1].occurredAt).getTime()) {
      throw new Error(`people snapshot: ${context} is not ordered newest first`);
    }
  }
}

/** Earliest scheduled work first, unscheduled last. An ISO date comparison is collation-free too. */
function assertEarliestPlannedFirst(rows: PersonOperationRow[]): void {
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1].plannedAt;
    const current = rows[index].plannedAt;
    if (previous === null && current !== null) {
      throw new Error("people snapshot: a scheduled operation follows an unscheduled one");
    }
    if (previous !== null && current !== null && current < previous) {
      throw new Error("people snapshot: the operation sample is not ordered by planned date");
    }
  }
}

/**
 * One recorded-activity section. `open_total` exists only where the question makes sense (an
 * assigned event can still be open; a performed one is history), so it is read as `null` rather than
 * as a stand-in zero — an invented zero is exactly the kind of figure this contract refuses.
 */
function eventSection(
  value: unknown,
  limit: number,
  context: string,
  withOpenTotal: boolean,
): { total: ExactCountString; openTotal: ExactCountString | null; rows: PersonEventRow[] } {
  const section = object(value, context);
  rejectExtraKeys(section, withOpenTotal ? ["total", "open_total", "rows"] : ["total", "rows"], context);
  const total = count(section, "total");
  const openTotal = withOpenTotal ? count(section, "open_total") : null;
  if (openTotal !== null && BigInt(openTotal) > BigInt(total)) {
    throw new Error(`people snapshot: ${context} reports more open events than events`);
  }
  const rows = boundedRows(section.rows, limit, `${context} rows`).map(personEventRow);
  if (rows.length !== expectedSampleLength(total, limit)) {
    throw new Error(`people snapshot: the ${context} sample does not match its exact total and limit`);
  }
  assertDistinct(rows.map((row) => `${row.eventId}:${row.occurredAt}`), `${context} rows`);
  assertNewestFirst(rows, context);
  return { total, openTotal, rows };
}

export function parsePersonSnapshot(
  value: unknown,
  expected: PersonSnapshotExpectation,
): PersonSnapshot | null {
  if (value === null) return null;
  const root = object(value, "root");
  assertNoForbiddenKeys(root);
  rejectExtraKeys(root, PERSON_ROOT_KEYS, "root");

  if (text(root, "version") !== PERSON_SNAPSHOT_VERSION) {
    throw new Error("people snapshot: person version mismatch");
  }
  if (text(root, "org_id") !== expected.orgId) {
    throw new Error("people snapshot: organization mismatch");
  }
  if (text(root, "person_id") !== expected.personId) {
    throw new Error("people snapshot: person mismatch");
  }

  const limitsRow = object(root.limits, "limits");
  rejectExtraKeys(limitsRow, ["operations", "performed_events", "assigned_events", "direct_reports"], "limits");
  const limits: PersonSnapshotLimits = {
    operations: boundedInteger(limitsRow, "operations", 1, RPC_MAX_SAMPLE_LIMIT),
    performedEvents: boundedInteger(limitsRow, "performed_events", 1, RPC_MAX_SAMPLE_LIMIT),
    assignedEvents: boundedInteger(limitsRow, "assigned_events", 1, RPC_MAX_SAMPLE_LIMIT),
    directReports: boundedInteger(limitsRow, "direct_reports", 1, RPC_MAX_SAMPLE_LIMIT),
  };
  if (
    limits.operations !== expected.operationLimit
    || limits.performedEvents !== expected.performedLimit
    || limits.assignedEvents !== expected.assignedLimit
    || limits.directReports !== expected.reportLimit
  ) {
    throw new Error("people snapshot: person request arguments mismatch");
  }
  const parsedAuthority = authority(root.authority);

  const identityRow = object(root.person, "person");
  rejectExtraKeys(identityRow, PERSON_IDENTITY_KEYS, "person");
  const person: PersonIdentity = {
    name: text(identityRow, "name"),
    position: nullableText(identityRow, "position"),
    employmentType: nullableText(identityRow, "employment_type"),
    active: boolean(identityRow, "active"),
    ...managerReference(identityRow, "person"),
  };
  if (person.managerId === expected.personId) {
    throw new Error("people snapshot: a person cannot be their own manager");
  }

  const operationsSection = object(root.operations, "operations");
  rejectExtraKeys(operationsSection, ["total", "open_total", "rows"], "operations");
  const operationTotal = count(operationsSection, "total");
  const operationOpenTotal = count(operationsSection, "open_total");
  if (BigInt(operationOpenTotal) > BigInt(operationTotal)) {
    throw new Error("people snapshot: more operations are open than are linked at all");
  }
  const operationRows = boundedRows(operationsSection.rows, limits.operations, "operation rows")
    .map(personOperationRow);
  // The sample is drawn from the OPEN set, so its length reconciles against the OPEN total — never
  // against the all-time total, and never presented as either.
  if (operationRows.length !== expectedSampleLength(operationOpenTotal, limits.operations)) {
    throw new Error("people snapshot: the operation sample does not match its exact open total and limit");
  }
  assertDistinct(operationRows.map((row) => row.planOpId), "operation rows");
  assertEarliestPlannedFirst(operationRows);

  const performedEvents = eventSection(
    root.performed_events, limits.performedEvents, "performed_events", false,
  );
  const assignedEvents = eventSection(
    root.assigned_events, limits.assignedEvents, "assigned_events", true,
  );
  /* istanbul ignore next -- `withOpenTotal` is true above, so `count()` has already thrown if absent. */
  if (assignedEvents.openTotal === null) {
    throw new Error("people snapshot: assigned_events is missing its open total");
  }

  const reportsSection = object(root.direct_reports, "direct_reports");
  rejectExtraKeys(reportsSection, ["total", "active_total", "rows"], "direct_reports");
  const reportTotal = count(reportsSection, "total");
  const reportActiveTotal = count(reportsSection, "active_total");
  if (BigInt(reportActiveTotal) > BigInt(reportTotal)) {
    throw new Error("people snapshot: more direct reports are active than exist");
  }
  const reportRows = boundedRows(reportsSection.rows, limits.directReports, "direct report rows")
    .map(personDirectReportRow);
  if (reportRows.length !== expectedSampleLength(reportTotal, limits.directReports)) {
    throw new Error("people snapshot: the direct report sample does not match its exact total and limit");
  }
  assertDistinct(reportRows.map((row) => row.personId), "direct report rows");
  assertActiveFirst(reportRows, "the direct report sample");
  if (reportRows.some((row) => row.personId === expected.personId)) {
    throw new Error("people snapshot: a person cannot report to themselves");
  }

  return {
    version: PERSON_SNAPSHOT_VERSION,
    orgId: expected.orgId,
    personId: expected.personId,
    limits,
    authority: parsedAuthority,
    person,
    operations: { total: operationTotal, openTotal: operationOpenTotal, rows: operationRows },
    performedEvents: { total: performedEvents.total, rows: performedEvents.rows },
    assignedEvents: {
      total: assignedEvents.total,
      openTotal: assignedEvents.openTotal,
      rows: assignedEvents.rows,
    },
    directReports: { total: reportTotal, activeTotal: reportActiveTotal, rows: reportRows },
  };
}
