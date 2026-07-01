/** Arabic (ar-EG) date formatting. Never fabricates: pass real values only. */

const FMT = new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" });

export function fmtDate(value: string | Date | null | undefined): string {
  if (value == null || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return FMT.format(date);
}

/**
 * Whole days between a real recorded date and `now` (default: the current moment). Never
 * fabricates: a missing/invalid `value` returns `null` (render "—"), not 0 — a trap with no
 * lure-change date yet is not "changed 0 days ago". Used by lib/pest-scouting.ts.
 */
export function daysSince(value: string | Date | null | undefined, now: Date = new Date()): number | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((now.getTime() - date.getTime()) / msPerDay);
}
