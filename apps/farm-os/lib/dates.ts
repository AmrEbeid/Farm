/** Arabic (ar-EG) date formatting. Never fabricates: pass real values only. */

const FMT = new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" });
const DATE_TIME_FMT = new Intl.DateTimeFormat("ar-EG", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Cairo",
});
const CAIRO_DATE_FMT = new Intl.DateTimeFormat("en", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function fmtDate(value: string | Date | null | undefined): string {
  if (value == null || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return FMT.format(date);
}

/** Date and time in the farm's Cairo operating timezone. */
export function fmtDateTime(value: string | Date | null | undefined): string {
  if (value == null || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return DATE_TIME_FMT.format(date);
}

/** The farm's current calendar date, independent of the server's timezone. */
export function cairoDateString(value: Date = new Date()): string {
  const parts = Object.fromEntries(
    CAIRO_DATE_FMT.formatToParts(value).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Whole Cairo calendar days since a recorded farm date. */
export function daysSinceCairoDate(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (value == null || value === "") return null;
  const recordedDate =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value
      : (() => {
          const instant = value instanceof Date ? value : new Date(value);
          return Number.isNaN(instant.getTime()) ? null : cairoDateString(instant);
        })();
  if (recordedDate === null) return null;
  const recorded = new Date(`${recordedDate}T00:00:00.000Z`);
  if (Number.isNaN(recorded.getTime()) || recorded.toISOString().slice(0, 10) !== recordedDate) {
    return null;
  }
  const today = new Date(`${cairoDateString(now)}T00:00:00.000Z`);
  return Math.round((today.getTime() - recorded.getTime()) / (24 * 60 * 60 * 1000));
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
