export type AccountingPeriodStatus = "locked" | "open";

export interface AccountingPeriod {
  id: string;
  orgId: string;
  periodStart: string;
  periodEnd: string;
  status: AccountingPeriodStatus;
  note: string | null;
  lockedAt: string;
  reopenedAt: string | null;
}

export interface AccountingPeriodRegister {
  periods: AccountingPeriod[];
  locked: AccountingPeriod[];
  open: AccountingPeriod[];
}

export function parseAccountingPeriods(value: unknown, expectedOrgId: string): AccountingPeriodRegister {
  if (!Array.isArray(value)) fail("register must be an array");
  const ids = new Set<string>();
  const periods = value.map((entry, index): AccountingPeriod => {
    const row = object(entry, index);
    const id = uuid(row.id, `row ${index} id`);
    if (ids.has(id)) fail(`duplicate period ${id}`);
    ids.add(id);
    const orgId = uuid(row.org_id, `row ${index} org_id`);
    if (orgId !== expectedOrgId) fail(`row ${index} belongs to another organization`);
    const periodStart = date(row.period_start, `row ${index} period_start`);
    const periodEnd = date(row.period_end, `row ${index} period_end`);
    if (periodEnd < periodStart) fail(`row ${index} ends before it starts`);
    const status = periodStatus(row.status, `row ${index} status`);
    const lockedAt = timestamp(row.locked_at, `row ${index} locked_at`);
    const reopenedAt = nullableTimestamp(row.reopened_at, `row ${index} reopened_at`);
    if (status === "locked" && reopenedAt !== null) fail(`locked row ${index} carries a reopen timestamp`);
    if (status === "open" && reopenedAt === null) fail(`open row ${index} has no reopen timestamp`);
    return {
      id,
      orgId,
      periodStart,
      periodEnd,
      status,
      note: nullableText(row.note, `row ${index} note`),
      lockedAt,
      reopenedAt,
    };
  }).sort((left, right) => right.periodStart.localeCompare(left.periodStart) || right.periodEnd.localeCompare(left.periodEnd));

  const locked = periods.filter((period) => period.status === "locked");
  for (let index = 0; index < locked.length; index += 1) {
    for (let compare = index + 1; compare < locked.length; compare += 1) {
      if (locked[index].periodStart <= locked[compare].periodEnd && locked[compare].periodStart <= locked[index].periodEnd) {
        fail("locked periods overlap");
      }
    }
  }
  return { periods, locked, open: periods.filter((period) => period.status === "open") };
}

function object(value: unknown, index: number): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`row ${index} must be an object`);
  return value as Record<string, unknown>;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    fail(`${label} must be a UUID`);
  }
  return value;
}

function date(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${label} must be an ISO date`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) fail(`${label} must be a timestamp`);
  return value;
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestamp(value, label);
}

function nullableText(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") fail(`${label} must be text or null`);
  return value;
}

function periodStatus(value: unknown, label: string): AccountingPeriodStatus {
  if (value !== "locked" && value !== "open") fail(`${label} is invalid`);
  return value;
}

function fail(message: string): never {
  throw new Error(`accounting period register: ${message}`);
}
