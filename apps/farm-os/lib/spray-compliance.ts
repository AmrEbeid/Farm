/**
 * Spray/pesticide-application compliance — REI (re-entry interval) / PHI (pre-harvest interval)
 * DISPLAY-ONLY decision support (docs/CLAUDE.md non-negotiable #4).
 *
 * This is NOT an automated enforcement gate (matches this repo's "compliance ≠ auto-certify" posture,
 * docs/SPEC-0016-export-compliance-and-certification.md) — it computes two derived timestamps from a
 * REAL execution time and REAL rei_hours/phi_days, for a warning banner. Never fabricates: every
 * input is nullable, and an unset REI/PHI or unset execution time yields `null` (rendered "N/A" by the
 * caller), never a guessed value (non-negotiable #1).
 *
 * Automated enforcement (e.g. blocking a harvest operation while inside the PHI window) is explicitly
 * DEFERRED — a bigger, riskier behavior change belonging in its own reviewed PR/product decision.
 */

export interface SprayComplianceWindowInput {
  /** The operation's actual execution timestamp (farm_event.occurred_at), ISO string or null/undefined
   *  if the operation has not been executed yet. */
  occurredAt: string | null | undefined;
  /** Re-entry interval in hours (plan_material_requirements.rei_hours). */
  reiHours: number | null | undefined;
  /** Pre-harvest interval in days (plan_material_requirements.phi_days). */
  phiDays: number | null | undefined;
}

export interface SprayComplianceWindow {
  /** ISO timestamp after which re-entry is safe, or null if occurredAt/reiHours is unset. */
  safeReentryAt: string | null;
  /** ISO timestamp of the earliest safe harvest date, or null if occurredAt/phiDays is unset. */
  earliestSafeHarvestAt: string | null;
  /** True while "now" is still inside the REI window (re-entry not yet safe). Always false when
   *  safeReentryAt is null (nothing to warn about without a real execution time + REI). */
  withinReentryWindow: boolean;
  /** True while "now" is still inside the PHI window (harvest not yet safe). Always false when
   *  earliestSafeHarvestAt is null. */
  withinHarvestWindow: boolean;
}

/**
 * Compute the REI/PHI safety window from a REAL execution timestamp. `now` is injectable for testing;
 * defaults to the actual current time in application use.
 */
export function computeSprayComplianceWindow(
  input: SprayComplianceWindowInput,
  now: Date = new Date(),
): SprayComplianceWindow {
  const occurred = parseDate(input.occurredAt);

  const safeReentryAt =
    occurred && isFinitePositive(input.reiHours)
      ? new Date(occurred.getTime() + input.reiHours! * 60 * 60 * 1000)
      : null;
  const earliestSafeHarvestAt =
    occurred && isFinitePositive(input.phiDays)
      ? new Date(occurred.getTime() + input.phiDays! * 24 * 60 * 60 * 1000)
      : null;

  return {
    safeReentryAt: safeReentryAt?.toISOString() ?? null,
    earliestSafeHarvestAt: earliestSafeHarvestAt?.toISOString() ?? null,
    withinReentryWindow: safeReentryAt != null && now.getTime() < safeReentryAt.getTime(),
    withinHarvestWindow: earliestSafeHarvestAt != null && now.getTime() < earliestSafeHarvestAt.getTime(),
  };
}

/**
 * Reduce multiple materials' compliance windows to the single MOST RESTRICTIVE one. An operation can
 * apply 2+ products at once (fn_add_plan_operation_multi) with different REI/PHI values — you can't
 * re-enter or harvest until ALL of them have cleared, so the window that closes LAST (the latest
 * safeReentryAt / earliestSafeHarvestAt) is the one that governs, never the first material's window.
 *
 * A `null` window (or a null field within a window) means "no compliance data for this material" and
 * is EXCLUDED from the max — it must never be treated as "0 restriction", which would let a shorter
 * window from one material silently override a longer, more restrictive window from another
 * (non-negotiable #1: never manufacture a false "it's safe now" verdict).
 *
 * Returns null only when none of the inputs have any compliance data at all (nothing to show a banner
 * for). withinReentryWindow/withinHarvestWindow are recomputed against `now` from the chosen timestamps,
 * matching computeSprayComplianceWindow's own semantics.
 */
export function mostRestrictiveComplianceWindow(
  windows: (SprayComplianceWindow | null)[],
  now: Date = new Date(),
): SprayComplianceWindow | null {
  const latestReentry = maxTimestamp(windows.map((w) => w?.safeReentryAt ?? null));
  const latestHarvest = maxTimestamp(windows.map((w) => w?.earliestSafeHarvestAt ?? null));

  if (latestReentry == null && latestHarvest == null) return null;

  return {
    safeReentryAt: latestReentry,
    earliestSafeHarvestAt: latestHarvest,
    withinReentryWindow: latestReentry != null && now.getTime() < new Date(latestReentry).getTime(),
    withinHarvestWindow: latestHarvest != null && now.getTime() < new Date(latestHarvest).getTime(),
  };
}

// Picks the latest of a set of nullable ISO timestamps, ignoring nulls entirely (a missing value is
// "no data", not "earliest"/"0" — it must never win or lose the comparison).
function maxTimestamp(values: (string | null)[]): string | null {
  return values.reduce<string | null>((latest, v) => {
    if (v == null) return latest;
    if (latest == null) return v;
    return new Date(v).getTime() > new Date(latest).getTime() ? v : latest;
  }, null);
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// A negative or non-finite REI/PHI would silently produce a safeReentryAt/earliestSafeHarvestAt BEFORE
// occurredAt — i.e. claim the window already closed when it may not have. The DB CHECK constraints
// (migration 20260701320000) already reject negative rei_hours/phi_days, but this is a second,
// independent guard at the display layer (defense-in-depth against a row that predates the constraint
// or a future direct-write path) — never let bad data manufacture a false "it's safe now" verdict.
function isFinitePositive(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

export const TARGET_ZONE_AR: Record<string, string> = {
  bunch: "العذوق",
  crown: "القمة النامية",
  trunk: "الجذع",
  offshoot: "الفسائل",
  whole_palm: "النخلة كاملة",
};

export const TIME_OF_DAY_AR: Record<string, string> = {
  morning: "الصباح",
  midday: "الظهيرة",
  late_afternoon: "بعد العصر (بعد كسر الحرارة)",
  evening: "المساء",
};
