// SPEC-0033 R3d — strict parser for the exact agronomist home snapshot
// (`fn_agronomist_home_snapshot`, migration 20260823110000).
//
// HONESTY CONTRACT (docs/CLAUDE.md #1 and #4). Everything under `recorded` is an exact count of rows
// RECORDED for the active organisation — never a completeness claim about the farm. Agronomy values
// stay editable templates pending a NAMED sign-off, and `apcRegistrationRef` is only the reference
// that was recorded: its presence is NOT evidence that an Egyptian registration is current or valid.
//
// Counts stay exact text (a JS number cannot represent every bigint), quantities stay decimal text,
// dates/version/organisation/as-of are validated strictly, and every array is independently bounded
// by the snapshot's own detail limit — including the materials nested inside a sign-off row.

import { parseDecimal, type DecimalString } from "./decimal";
import type { DataAuthorityLevel } from "./data-authority";

export const AGRONOMIST_HOME_SNAPSHOT_VERSION = "farm-os.agronomist-home.v1";
export const AGRONOMIST_HOME_DETAIL_LIMIT = 8;

type Row = Record<string, unknown>;

/** An exact count as canonical decimal text. Never widened to a JS number. */
export type ExactCountString = string;

export type DueUrgency = "today" | "overdue";
const TARGET_ZONES = new Set(["bunch", "crown", "trunk", "offshoot", "whole_palm"]);

export interface AgronomyOperationDriver {
  id: string;
  planId: string;
  planType: string | null;
  periodStart: string | null;
  subtype: string | null;
  status: string;
  plannedAt: string | null;
  endsOn: string | null;
}

export interface AgronomyMaterial {
  id: string;
  itemId: string;
  itemName: string;
  qty: DecimalString | null;
  unit: string | null;
  targetPest: string | null;
  /** The recorded reference only. Presence is never proof of a valid, current registration. */
  apcRegistrationRef: string | null;
  reiHours: DecimalString | null;
  phiDays: DecimalString | null;
  targetZone: string | null;
  applicatorPersonId: string | null;
  applicatorName: string | null;
}

export interface AgronomyTrapFollowup {
  id: string;
  code: string;
  label: string;
  installedAt: string;
  lureChangedAt: string | null;
  lastCheckedAt: string | null;
  daysSinceCheck: number;
  daysSinceLureChange: number;
  overdueCheck: boolean;
  needsLureChange: boolean;
}

export interface AgronomistHomeSnapshot {
  orgId: string;
  asOf: string;
  detailLimit: number;
  authority: { operations: DataAuthorityLevel };
  recorded: {
    pendingSignoffs: ExactCountString;
    dueToday: ExactCountString;
    overdue: ExactCountString;
    trapFollowups: ExactCountString;
  };
  drivers: {
    pendingSignoffs: Array<
      AgronomyOperationDriver & { materialCount: ExactCountString; materials: AgronomyMaterial[] }
    >;
    dueOperations: Array<AgronomyOperationDriver & { urgency: DueUrgency }>;
    trapFollowups: AgronomyTrapFollowup[];
    blockedChecks: Array<{
      id: string;
      planId: string;
      planType: string | null;
      periodStart: string | null;
      kind: string;
    }>;
  };
}

function object(value: unknown, context: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`agronomist home snapshot: ${context} must be an object`);
  }
  return value as Row;
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`agronomist home snapshot: ${key} must be text`);
  }
  return value;
}

function nullableText(row: Row, key: string): string | null {
  return row[key] === null ? null : text(row, key);
}

function uuid(row: Row, key: string): string {
  const value = text(row, key);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`agronomist home snapshot: ${key} must be a UUID`);
  }
  return value;
}

function nullableUuid(row: Row, key: string): string | null {
  return row[key] === null ? null : uuid(row, key);
}

function count(row: Row, key: string): ExactCountString {
  const value = text(row, key);
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`agronomist home snapshot: ${key} must be exact count text`);
  }
  return value;
}

/** Day distances may be negative when a check or lure change was recorded ahead of today. */
function dayCount(row: Row, key: string): number {
  const value = text(row, key);
  if (!/^-?(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`agronomist home snapshot: ${key} must be exact day-count text`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`agronomist home snapshot: ${key} exceeds the display range`);
  }
  return parsed;
}

function nullableDecimal(row: Row, key: string): DecimalString | null {
  if (row[key] === null) return null;
  const parsed = parseDecimal(row[key]);
  if (parsed === null) throw new Error(`agronomist home snapshot: ${key} must be decimal text`);
  return parsed;
}

function boolean(row: Row, key: string): boolean {
  if (typeof row[key] !== "boolean") {
    throw new Error(`agronomist home snapshot: ${key} must be boolean`);
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
    throw new Error(`agronomist home snapshot: ${key} must be a calendar date`);
  }
  return value;
}

function boundedRows(value: unknown, limit: number, context: string): Row[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw new Error(`agronomist home snapshot: ${context} must be a bounded array`);
  }
  return value.map((entry, index) => object(entry, `${context}[${index}]`));
}

function expectedBoundedLength(exactCount: ExactCountString, limit: number): number {
  const value = BigInt(exactCount);
  return value < BigInt(limit) ? Number(value) : limit;
}

function operation(row: Row): AgronomyOperationDriver {
  return {
    id: uuid(row, "id"),
    planId: uuid(row, "plan_id"),
    planType: nullableText(row, "plan_type"),
    periodStart: date(row, "period_start", true),
    subtype: nullableText(row, "subtype"),
    status: text(row, "status"),
    plannedAt: date(row, "planned_at", true),
    endsOn: date(row, "ends_on", true),
  };
}

function material(row: Row): AgronomyMaterial {
  const targetZone = nullableText(row, "target_zone");
  if (targetZone !== null && !TARGET_ZONES.has(targetZone)) {
    throw new Error("agronomist home snapshot: invalid spray target zone");
  }
  return {
    id: uuid(row, "id"),
    itemId: uuid(row, "item_id"),
    itemName: text(row, "item_name"),
    qty: nullableDecimal(row, "qty"),
    unit: nullableText(row, "unit"),
    targetPest: nullableText(row, "target_pest"),
    apcRegistrationRef: nullableText(row, "apc_registration_ref"),
    reiHours: nullableDecimal(row, "rei_hours"),
    phiDays: nullableDecimal(row, "phi_days"),
    targetZone,
    applicatorPersonId: nullableUuid(row, "applicator_person_id"),
    applicatorName: nullableText(row, "applicator_name"),
  };
}

function authority(value: unknown): AgronomistHomeSnapshot["authority"] {
  const raw = object(value, "authority");
  const allowed = new Set<DataAuthorityLevel>(["verified", "partial", "unverified", "blocked"]);
  const status = raw.operations ?? "unverified";
  if (typeof status !== "string" || !allowed.has(status as DataAuthorityLevel)) {
    throw new Error("agronomist home snapshot: invalid authority status for operations");
  }
  return { operations: status as DataAuthorityLevel };
}

export function parseAgronomistHomeSnapshot(
  value: unknown,
  expectedOrgId: string,
  expectedAsOf: string,
): AgronomistHomeSnapshot {
  const root = object(value, "root");
  if (text(root, "version") !== AGRONOMIST_HOME_SNAPSHOT_VERSION) {
    throw new Error("agronomist home snapshot: version mismatch");
  }
  if (text(root, "org_id") !== expectedOrgId) {
    throw new Error("agronomist home snapshot: organization mismatch");
  }
  if (date(root, "as_of") !== expectedAsOf) {
    throw new Error("agronomist home snapshot: as-of mismatch");
  }
  if (
    !Number.isInteger(root.detail_limit)
    || (root.detail_limit as number) < 1
    || (root.detail_limit as number) > 20
  ) {
    throw new Error("agronomist home snapshot: detail limit is invalid");
  }
  const detailLimit = root.detail_limit as number;
  const recorded = object(root.recorded, "recorded");
  const drivers = object(root.drivers, "drivers");
  const recordedCounts = {
    pendingSignoffs: count(recorded, "pending_signoffs"),
    dueToday: count(recorded, "due_today"),
    overdue: count(recorded, "overdue"),
    trapFollowups: count(recorded, "trap_followups"),
  };
  const pendingSignoffs = boundedRows(
    drivers.pending_signoffs,
    detailLimit,
    "drivers.pending_signoffs",
  ).map((row) => {
    const materialCount = count(row, "material_count");
    const materials = boundedRows(
      row.materials,
      detailLimit,
      "drivers.pending_signoffs[].materials",
    ).map(material);
    if (materials.length !== expectedBoundedLength(materialCount, detailLimit)) {
      throw new Error("agronomist home snapshot: material rows do not match their bounded count");
    }
    return { ...operation(row), materialCount, materials };
  });
  const dueOperations = boundedRows(
    drivers.due_operations,
    detailLimit,
    "drivers.due_operations",
  ).map((row) => {
    const urgency = text(row, "urgency");
    if (urgency !== "today" && urgency !== "overdue") {
      throw new Error("agronomist home snapshot: invalid due-operation urgency");
    }
    return { ...operation(row), urgency: urgency as DueUrgency };
  });
  const trapFollowups = boundedRows(
    drivers.trap_followups,
    detailLimit,
    "drivers.trap_followups",
  ).map((row) => {
    const trap = {
      id: uuid(row, "id"),
      code: text(row, "code"),
      label: text(row, "label"),
      installedAt: date(row, "installed_at") as string,
      lureChangedAt: date(row, "lure_changed_at", true),
      lastCheckedAt: date(row, "last_checked_at", true),
      daysSinceCheck: dayCount(row, "days_since_check"),
      daysSinceLureChange: dayCount(row, "days_since_lure_change"),
      overdueCheck: boolean(row, "overdue_check"),
      needsLureChange: boolean(row, "needs_lure_change"),
    };
    if (!trap.overdueCheck && !trap.needsLureChange) {
      throw new Error("agronomist home snapshot: trap follow-up row has no follow-up flag");
    }
    return trap;
  });
  const todayRows = dueOperations.filter((row) => row.urgency === "today").length;
  const overdueRows = dueOperations.length - todayRows;
  if (pendingSignoffs.length !== expectedBoundedLength(recordedCounts.pendingSignoffs, detailLimit)) {
    throw new Error("agronomist home snapshot: pending rows do not match their bounded count");
  }
  const expectedOverdueRows = expectedBoundedLength(recordedCounts.overdue, detailLimit);
  const remainingDueSlots = detailLimit - expectedOverdueRows;
  const expectedTodayRows = expectedBoundedLength(recordedCounts.dueToday, remainingDueSlots);
  if (overdueRows !== expectedOverdueRows || todayRows !== expectedTodayRows) {
    throw new Error("agronomist home snapshot: due rows do not match overdue-first bounded counts");
  }
  if (trapFollowups.length !== expectedBoundedLength(recordedCounts.trapFollowups, detailLimit)) {
    throw new Error("agronomist home snapshot: trap rows do not match their bounded count");
  }

  return {
    orgId: expectedOrgId,
    asOf: expectedAsOf,
    detailLimit,
    authority: authority(root.authority),
    recorded: recordedCounts,
    drivers: {
      pendingSignoffs,
      dueOperations,
      trapFollowups,
      blockedChecks: boundedRows(drivers.blocked_checks, detailLimit, "drivers.blocked_checks").map((row) => ({
        id: uuid(row, "id"),
        planId: uuid(row, "plan_id"),
        planType: nullableText(row, "plan_type"),
        periodStart: date(row, "period_start", true),
        kind: text(row, "kind"),
      })),
    },
  };
}
