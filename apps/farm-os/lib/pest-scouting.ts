/**
 * RPW-1: pure derived-status logic for the Red Palm Weevil (سوسة النخيل الحمراء) trap register.
 *
 * Real-world cadence this encodes (see docs/RESEARCH — no fabrication, only thresholds on REAL
 * recorded dates): a pheromone lure lasts ~90 days before it needs replacing, and traps are checked
 * weekly in the field — this flags "overdue" with ~10 days of slack over the ideal 7-day cadence
 * rather than nagging the day after a week passes.
 *
 * Deliberately a plain function over already-fetched rows, NOT a SQL view — no view exists yet
 * anywhere in this codebase, and a view over RLS-scoped tables needs `security_invoker` (PG15+) to
 * not silently bypass RLS as the view owner; a pure, unit-testable app-layer function is the
 * simpler, safer choice for a first slice (task brief: "prefer a plain query over a materialized
 * view").
 */

import { daysSince } from "@/lib/dates";

const LURE_LIFE_DAYS = 90;
const CHECK_OVERDUE_DAYS = 10;

export interface TrapStatusInput {
  /** The trap's installed_at date (fallback baseline when a lure/catch date is missing). */
  installedAt: string;
  lureChangedAt: string | null;
  /** max(checked_at) across this trap's catch log, or null if never checked. */
  lastCheckedAt: string | null;
  status: "active" | "removed";
}

export interface TrapStatus {
  daysSinceLureChange: number | null;
  needsLureChange: boolean;
  daysSinceLastCheck: number | null;
  overdueCheck: boolean;
}

/**
 * Derive "needs lure change" / "overdue check" flags for one trap. A REMOVED trap is never
 * flagged (it's no longer in service — flagging it would be noise, not a real signal). A trap
 * that has never had its lure changed, or never been checked, falls back to `installedAt` as the
 * baseline — the trap has been in the field unattended since that real date, which is itself a
 * genuine (not fabricated) signal.
 */
export function trapStatus(input: TrapStatusInput, now: Date = new Date()): TrapStatus {
  const active = input.status === "active";
  const daysSinceLureChange = daysSince(input.lureChangedAt ?? input.installedAt, now);
  const daysSinceLastCheck = daysSince(input.lastCheckedAt ?? input.installedAt, now);

  return {
    daysSinceLureChange,
    needsLureChange: active && daysSinceLureChange != null && daysSinceLureChange > LURE_LIFE_DAYS,
    daysSinceLastCheck,
    overdueCheck: active && daysSinceLastCheck != null && daysSinceLastCheck > CHECK_OVERDUE_DAYS,
  };
}
