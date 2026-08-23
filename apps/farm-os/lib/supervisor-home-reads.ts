// SPEC-0033 R3e — strict parser for the exact supervisor home snapshot
// (`fn_supervisor_home_snapshot`, migration 20260823120000).
//
// HONESTY CONTRACT (docs/CLAUDE.md #1 and #4). Everything under `recorded` is an exact count of rows
// RECORDED AS ASSIGNED TO THE CALLING PERSON in the active organisation — never a completeness claim
// about the farm, and never a claim about work assigned to anyone else. When the caller has no
// linked person row (or more than one), `recorded` and `drivers` are NULL rather than zero: a zero
// would read as "you are all clear" to a supervisor who is simply not linked yet.
//
// `executable` mirrors the shipped fn_execute_operation / fn_post_movement gates as documented in
// the migration. It decides only whether the fast record shortcut is offered. It is NOT a guarantee
// that the execution will post: stock sufficiency depends on the quantity the worker enters and on
// live bin state, so no stored row can settle it in advance. The server RPC stays the enforcement.
//
// Counts stay exact text (a JS number cannot represent every bigint), quantities stay decimal text,
// dates/version/organisation/as-of are validated strictly, every array is independently bounded by
// the snapshot's own detail limit — including the materials and crew nested inside a driver row —
// and the today buckets must reconcile exactly against their counts.

import { parseDecimal, type DecimalString } from "./decimal";
import type { DataAuthorityLevel } from "./data-authority";

export const SUPERVISOR_HOME_SNAPSHOT_VERSION = "farm-os.supervisor-home.v1";
export const SUPERVISOR_HOME_DETAIL_LIMIT = 6;

type Row = Record<string, unknown>;

/** An exact count as canonical decimal text. Never widened to a JS number. */
export type ExactCountString = string;

export type SupervisorLinkState = "linked" | "unlinked" | "ambiguous";
export type SupervisorUrgency = "overdue" | "today" | "unscheduled" | "upcoming";

/** The stored, exactly derivable reasons an assigned operation cannot be recorded right now. */
export const SUPERVISOR_BLOCKERS = ["signoff_missing", "target_unresolved", "unit_mismatch"] as const;
export type SupervisorBlocker = (typeof SUPERVISOR_BLOCKERS)[number];
const BLOCKER_SET = new Set<string>(SUPERVISOR_BLOCKERS);

const TARGET_STATES = new Set(["ok", "legacy", "unrecognized", "unresolved"]);
const TARGET_TYPES = new Set(["farm", "sector", "hawsha", "line", "palm"]);
const SCOPE_TYPES = new Set(["farm", "sector", "hawsha"]);

export interface SupervisorMaterial {
  id: string;
  itemId: string;
  itemName: string;
  qty: DecimalString | null;
  unit: string | null;
  /** The item's own tracked unit. Present so a unit conflict can be explained; never a cost. */
  itemUnit: string | null;
}

export interface SupervisorCrewMember {
  personId: string;
  name: string;
  isLead: boolean;
}

export interface SupervisorWorkRow {
  id: string;
  planId: string;
  planType: string | null;
  periodStart: string | null;
  subtype: string | null;
  status: string;
  plannedAt: string | null;
  endsOn: string | null;
  urgency: SupervisorUrgency;
  targetType: string | null;
  targetState: string;
  targetLabel: string | null;
  scopeType: string | null;
  scopeLabel: string | null;
  executable: boolean;
  blockers: SupervisorBlocker[];
  materialCount: ExactCountString;
  materials: SupervisorMaterial[];
  crewCount: ExactCountString;
  crew: SupervisorCrewMember[];
}

export interface SupervisorRecordedCounts {
  dueToday: ExactCountString;
  overdue: ExactCountString;
  readyNow: ExactCountString;
  blockedNow: ExactCountString;
  unscheduled: ExactCountString;
  upcoming: ExactCountString;
}

export interface SupervisorDrivers {
  readyNow: SupervisorWorkRow[];
  blockedNow: SupervisorWorkRow[];
  unscheduled: SupervisorWorkRow[];
  upcoming: SupervisorWorkRow[];
}

export interface SupervisorHomeSnapshot {
  orgId: string;
  asOf: string;
  detailLimit: number;
  authority: { operations: DataAuthorityLevel };
  link: { state: SupervisorLinkState; personId: string | null; personName: string | null };
  /** NULL — never zero — when the caller has no single linked person row. */
  recorded: SupervisorRecordedCounts | null;
  drivers: SupervisorDrivers | null;
}

function object(value: unknown, context: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`supervisor home snapshot: ${context} must be an object`);
  }
  return value as Row;
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`supervisor home snapshot: ${key} must be text`);
  }
  return value;
}

function nullableText(row: Row, key: string): string | null {
  return row[key] === null ? null : text(row, key);
}

function uuid(row: Row, key: string): string {
  const value = text(row, key);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`supervisor home snapshot: ${key} must be a UUID`);
  }
  return value;
}

function count(row: Row, key: string): ExactCountString {
  const value = text(row, key);
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`supervisor home snapshot: ${key} must be exact count text`);
  }
  return value;
}

function nullableDecimal(row: Row, key: string): DecimalString | null {
  if (row[key] === null) return null;
  const parsed = parseDecimal(row[key]);
  if (parsed === null) throw new Error(`supervisor home snapshot: ${key} must be decimal text`);
  return parsed;
}

function boolean(row: Row, key: string): boolean {
  if (typeof row[key] !== "boolean") {
    throw new Error(`supervisor home snapshot: ${key} must be boolean`);
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
    throw new Error(`supervisor home snapshot: ${key} must be a calendar date`);
  }
  return value;
}

function boundedRows(value: unknown, limit: number, context: string): Row[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw new Error(`supervisor home snapshot: ${context} must be a bounded array`);
  }
  return value.map((entry, index) => object(entry, `${context}[${index}]`));
}

function expectedBoundedLength(exactCount: ExactCountString, limit: number): number {
  const value = BigInt(exactCount);
  return value < BigInt(limit) ? Number(value) : limit;
}

function material(row: Row): SupervisorMaterial {
  return {
    id: uuid(row, "id"),
    itemId: uuid(row, "item_id"),
    itemName: text(row, "item_name"),
    qty: nullableDecimal(row, "qty"),
    unit: nullableText(row, "unit"),
    itemUnit: nullableText(row, "item_unit"),
  };
}

function crewMember(row: Row): SupervisorCrewMember {
  return {
    personId: uuid(row, "person_id"),
    name: text(row, "name"),
    isLead: boolean(row, "is_lead"),
  };
}

function blockers(row: Row): SupervisorBlocker[] {
  const raw = row.blockers;
  if (!Array.isArray(raw) || raw.length > SUPERVISOR_BLOCKERS.length) {
    throw new Error("supervisor home snapshot: blockers must be a bounded array");
  }
  const parsed = raw.map((entry) => {
    if (typeof entry !== "string" || !BLOCKER_SET.has(entry)) {
      throw new Error("supervisor home snapshot: unknown blocker code");
    }
    return entry as SupervisorBlocker;
  });
  if (new Set(parsed).size !== parsed.length) {
    throw new Error("supervisor home snapshot: blockers must be distinct");
  }
  return parsed;
}

function workRow(row: Row, limit: number, expectedUrgencies: ReadonlySet<SupervisorUrgency>): SupervisorWorkRow {
  const urgency = text(row, "urgency");
  if (!expectedUrgencies.has(urgency as SupervisorUrgency)) {
    throw new Error("supervisor home snapshot: driver row carries the wrong urgency for its bucket");
  }
  const targetState = text(row, "target_state");
  if (!TARGET_STATES.has(targetState)) {
    throw new Error("supervisor home snapshot: invalid target state");
  }
  const targetType = nullableText(row, "target_type");
  if (targetType !== null && !TARGET_TYPES.has(targetType) && targetState !== "unrecognized") {
    throw new Error("supervisor home snapshot: unrecognized target type is not labelled as such");
  }
  const scopeType = nullableText(row, "scope_type");
  if (scopeType !== null && !SCOPE_TYPES.has(scopeType)) {
    throw new Error("supervisor home snapshot: invalid plan scope type");
  }
  const executable = boolean(row, "executable");
  const rowBlockers = blockers(row);
  if (executable !== (rowBlockers.length === 0)) {
    throw new Error("supervisor home snapshot: executable disagrees with the recorded blockers");
  }
  const plannedAt = date(row, "planned_at", true);
  if ((urgency === "unscheduled") !== (plannedAt === null)) {
    throw new Error("supervisor home snapshot: unscheduled work must be exactly the undated work");
  }
  const materialCount = count(row, "material_count");
  const materials = boundedRows(row.materials, limit, "driver.materials").map(material);
  if (materials.length !== expectedBoundedLength(materialCount, limit)) {
    throw new Error("supervisor home snapshot: material rows do not match their bounded count");
  }
  const crewCount = count(row, "crew_count");
  const crew = boundedRows(row.crew, limit, "driver.crew").map(crewMember);
  if (crew.length !== expectedBoundedLength(crewCount, limit)) {
    throw new Error("supervisor home snapshot: crew rows do not match their bounded count");
  }
  return {
    id: uuid(row, "id"),
    planId: uuid(row, "plan_id"),
    planType: nullableText(row, "plan_type"),
    periodStart: date(row, "period_start", true),
    subtype: nullableText(row, "subtype"),
    status: text(row, "status"),
    plannedAt,
    endsOn: date(row, "ends_on", true),
    urgency: urgency as SupervisorUrgency,
    targetType,
    targetState,
    targetLabel: nullableText(row, "target_label"),
    scopeType,
    scopeLabel: nullableText(row, "scope_label"),
    executable,
    blockers: rowBlockers,
    materialCount,
    materials,
    crewCount,
    crew,
  };
}

function authority(value: unknown): SupervisorHomeSnapshot["authority"] {
  const raw = object(value, "authority");
  const allowed = new Set<DataAuthorityLevel>(["verified", "partial", "unverified", "blocked"]);
  const status = raw.operations ?? "unverified";
  if (typeof status !== "string" || !allowed.has(status as DataAuthorityLevel)) {
    throw new Error("supervisor home snapshot: invalid authority status for operations");
  }
  return { operations: status as DataAuthorityLevel };
}

const TODAY_URGENCIES: ReadonlySet<SupervisorUrgency> = new Set<SupervisorUrgency>(["overdue", "today"]);
const UNSCHEDULED_URGENCIES: ReadonlySet<SupervisorUrgency> = new Set<SupervisorUrgency>(["unscheduled"]);
const UPCOMING_URGENCIES: ReadonlySet<SupervisorUrgency> = new Set<SupervisorUrgency>(["upcoming"]);

export function parseSupervisorHomeSnapshot(
  value: unknown,
  expectedOrgId: string,
  expectedAsOf: string,
): SupervisorHomeSnapshot {
  const root = object(value, "root");
  if (text(root, "version") !== SUPERVISOR_HOME_SNAPSHOT_VERSION) {
    throw new Error("supervisor home snapshot: version mismatch");
  }
  if (text(root, "org_id") !== expectedOrgId) {
    throw new Error("supervisor home snapshot: organization mismatch");
  }
  if (date(root, "as_of") !== expectedAsOf) {
    throw new Error("supervisor home snapshot: as-of mismatch");
  }
  if (
    !Number.isInteger(root.detail_limit)
    || (root.detail_limit as number) < 1
    || (root.detail_limit as number) > 20
  ) {
    throw new Error("supervisor home snapshot: detail limit is invalid");
  }
  const detailLimit = root.detail_limit as number;

  const linkRow = object(root.link, "link");
  const state = text(linkRow, "state");
  if (state !== "linked" && state !== "unlinked" && state !== "ambiguous") {
    throw new Error("supervisor home snapshot: invalid person link state");
  }
  const link = {
    state: state as SupervisorLinkState,
    personId: linkRow.person_id === null ? null : uuid(linkRow, "person_id"),
    personName: nullableText(linkRow, "person_name"),
  };
  const parsedAuthority = authority(root.authority);

  if (link.state !== "linked") {
    // Fail-open on numbers is the wrong failure mode here: an unlinked supervisor must see an
    // explicit "not linked" state, never a set of zeros that reads as an all-clear.
    if (link.personId !== null || root.recorded !== null || root.drivers !== null) {
      throw new Error("supervisor home snapshot: an unresolved person link must carry no counts");
    }
    return { orgId: expectedOrgId, asOf: expectedAsOf, detailLimit, authority: parsedAuthority, link, recorded: null, drivers: null };
  }
  if (link.personId === null || link.personName === null) {
    throw new Error("supervisor home snapshot: a linked person must be identified");
  }

  const recordedRow = object(root.recorded, "recorded");
  const driversRow = object(root.drivers, "drivers");
  const recorded: SupervisorRecordedCounts = {
    dueToday: count(recordedRow, "due_today"),
    overdue: count(recordedRow, "overdue"),
    readyNow: count(recordedRow, "ready_now"),
    blockedNow: count(recordedRow, "blocked_now"),
    unscheduled: count(recordedRow, "unscheduled"),
    upcoming: count(recordedRow, "upcoming"),
  };
  // Strict reconciliation: today's work splits exactly into what can be recorded now and what is
  // blocked. A drift here means the snapshot double-counted or dropped an assigned operation.
  if (
    BigInt(recorded.readyNow) + BigInt(recorded.blockedNow)
    !== BigInt(recorded.dueToday) + BigInt(recorded.overdue)
  ) {
    throw new Error("supervisor home snapshot: ready and blocked work do not reconcile with today's work");
  }

  const readyNow = boundedRows(driversRow.ready_now, detailLimit, "drivers.ready_now")
    .map((row) => workRow(row, detailLimit, TODAY_URGENCIES));
  const blockedNow = boundedRows(driversRow.blocked_now, detailLimit, "drivers.blocked_now")
    .map((row) => workRow(row, detailLimit, TODAY_URGENCIES));
  const unscheduled = boundedRows(driversRow.unscheduled, detailLimit, "drivers.unscheduled")
    .map((row) => workRow(row, detailLimit, UNSCHEDULED_URGENCIES));
  const upcoming = boundedRows(driversRow.upcoming, detailLimit, "drivers.upcoming")
    .map((row) => workRow(row, detailLimit, UPCOMING_URGENCIES));

  if (readyNow.some((row) => !row.executable)) {
    throw new Error("supervisor home snapshot: a blocked operation was offered as ready to record");
  }
  if (blockedNow.some((row) => row.executable)) {
    throw new Error("supervisor home snapshot: an unblocked operation was listed as blocked");
  }
  if (readyNow.length !== expectedBoundedLength(recorded.readyNow, detailLimit)) {
    throw new Error("supervisor home snapshot: ready rows do not match their bounded count");
  }
  if (blockedNow.length !== expectedBoundedLength(recorded.blockedNow, detailLimit)) {
    throw new Error("supervisor home snapshot: blocked rows do not match their bounded count");
  }
  if (unscheduled.length !== expectedBoundedLength(recorded.unscheduled, detailLimit)) {
    throw new Error("supervisor home snapshot: unscheduled rows do not match their bounded count");
  }
  if (upcoming.length !== expectedBoundedLength(recorded.upcoming, detailLimit)) {
    throw new Error("supervisor home snapshot: upcoming rows do not match their bounded count");
  }
  const visibleToday = [...readyNow, ...blockedNow];
  const visibleOverdue = BigInt(visibleToday.filter((row) => row.urgency === "overdue").length);
  const recordedOverdue = BigInt(recorded.overdue);
  const minimumVisibleOverdue = recordedOverdue < BigInt(detailLimit)
    ? recordedOverdue
    : BigInt(detailLimit);
  if (visibleOverdue < minimumVisibleOverdue || visibleOverdue > recordedOverdue) {
    throw new Error("supervisor home snapshot: visible overdue drivers contradict the recorded overdue count");
  }
  for (const rows of [readyNow, blockedNow]) {
    const firstToday = rows.findIndex((row) => row.urgency === "today");
    if (firstToday >= 0 && rows.slice(firstToday + 1).some((row) => row.urgency === "overdue")) {
      throw new Error("supervisor home snapshot: overdue drivers must be ordered before today's work");
    }
  }

  return {
    orgId: expectedOrgId,
    asOf: expectedAsOf,
    detailLimit,
    authority: parsedAuthority,
    link,
    recorded,
    drivers: { readyNow, blockedNow, unscheduled, upcoming },
  };
}
