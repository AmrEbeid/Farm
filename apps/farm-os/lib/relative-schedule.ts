/**
 * Relative operation scheduling (owner finding, 2026-07-01): real spray/operation instructions are
 * often expressed RELATIVE to another operation ("spray after tilting completes"), not as an absolute
 * date. plan_operations.planned_at STAYS AUTHORITATIVE — there is no DB trigger that rewrites it when a
 * dependency shifts (see migration 20260701350000 for why: side-effecting cascades are a known risk in
 * this repo's engine). Instead, the EFFECTIVE date is a pure, read-time computation from the real
 * dependency's real planned_at + the stored offset. Never fabricates: if the dependency's planned_at is
 * unknown, the effective date is unknown too (null), not guessed.
 */

export interface DependencyRef {
  /** The dependency operation's own planned_at (yyyy-mm-dd or ISO string), or null if unknown. */
  plannedAt: string | null;
  /** Human label for the dependency operation (e.g. its Arabic subtype label), for display. */
  label: string;
}

/**
 * Effective planned date for an operation that depends on another, in yyyy-mm-dd form.
 * Returns null when there is nothing to compute from (no dependency, or the dependency's own
 * planned_at is unknown) — callers should fall back to the operation's own planned_at in that case.
 */
export function computeEffectiveDate(
  dependencyPlannedAt: string | null | undefined,
  offsetDays: number | null | undefined,
): string | null {
  if (!dependencyPlannedAt) return null;
  const base = new Date(dependencyPlannedAt);
  if (Number.isNaN(base.getTime())) return null;
  const offset = offsetDays ?? 0;
  if (!Number.isFinite(offset)) return null;

  // Do the arithmetic in UTC calendar days to avoid DST/timezone drift shifting the date by one day.
  const utcMidnight = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate());
  const shifted = new Date(utcMidnight + offset * 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Arabic display string for a dependency relationship, e.g. "بعد ٣ أيام من: رش المكافحة" (offset > 0),
 * "قبل يومين من: رش المكافحة" (offset < 0), or "في نفس يوم: رش المكافحة" (offset === 0/null).
 * Uses Arabic-Indic digits via toLocaleString (mirrors lib/money's no-Western-digit-leak rule).
 */
export function formatDependencyLabel(dependencyLabel: string, offsetDays: number | null | undefined): string {
  const offset = offsetDays ?? 0;
  if (offset === 0) return `في نفس يوم: ${dependencyLabel}`;
  const n = Math.abs(offset);
  const days = n.toLocaleString("ar-EG");
  const dayWord = n === 1 ? "يوم" : n === 2 ? "يومين" : "أيام";
  return offset > 0
    ? `بعد ${days} ${dayWord} من: ${dependencyLabel}`
    : `قبل ${days} ${dayWord} من: ${dependencyLabel}`;
}
