// Payroll close — the PURE half of «إقفال الرواتب» (SPEC-0006 slice 3).
//
// Two responsibilities, both framework-free so they are unit-testable in the vitest node env and
// safe to ship in the client bundle alongside the close form:
//
//   1. STRICT PERIOD VALIDATION. `fn_close_payroll_run` freezes an immutable snapshot and, through
//      `guard_labor_log_payroll_freeze`, permanently freezes every labor_logs row inside the period.
//      A typo'd period is therefore not a retryable mistake — it is an irreversible one. The bounds
//      are validated as REAL calendar dates (2026-02-30 is rejected, not silently rolled to 03-02),
//      start ≤ end, at most PAYROLL_MAX_PERIOD_DAYS days, and never into the future.
//
//   2. FIELD-SAFE ARABIC ERROR MAPPING (non-negotiable #2). The close RPC raises messages that embed
//      raw identifiers — `'missing or invalid rate for (person:mode/unit): %'` interpolates person
//      UUIDs, `'no labor logs found for org % in period % .. %'` interpolates the org UUID. NONE of
//      that may reach a user. `payrollCloseFailure` classifies the error into a fixed category and
//      returns ONLY a constant from PAYROLL_CLOSE_MESSAGE_AR — it never returns, echoes, or
//      interpolates `error.message`, so no UUID, wage rate, or worker name can leak through it.
//      (lib/errors.ts' generic map is not enough here: the RPC raises FIVE distinct 22023 conditions
//      that need five different next-steps, so this module classifies within the SQLSTATE.)

/** The longest period a single close may cover — one leap year. */
export const PAYROLL_MAX_PERIOD_DAYS = 366;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;
const CAIRO_DATE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** A validated bound: the caller's own YYYY-MM-DD text, plus its UTC day number for arithmetic. */
interface CalendarDate {
  iso: string;
  dayNumber: number;
}

/**
 * Read a YYYY-MM-DD string, or null when it is not that exact shape OR not a real calendar date.
 * Round-tripping through Date.UTC catches every impossible day (2026-02-30, 2027-02-29, 2026-13-01)
 * AND the two-digit-year coercion Date.UTC would otherwise apply ("0050-01-01" becomes 1950, so the
 * round-trip rejects it).
 */
function readCalendarDate(value: unknown): CalendarDate | null {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const ms = Date.UTC(year, month - 1, day);
  if (Number.isNaN(ms)) return null;
  const parsed = new Date(ms);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return { iso: value, dayNumber: Math.floor(ms / MS_PER_DAY) };
}

/** True when `value` is a real YYYY-MM-DD calendar date. */
export function isCalendarDate(value: unknown): value is string {
  return readCalendarDate(value) !== null;
}

/** Current farm calendar day, independent of the browser/server UTC timezone. */
export function cairoTodayIso(now: Date = new Date()): string {
  if (Number.isNaN(now.getTime())) return "";
  const parts = new Map(
    CAIRO_DATE_PARTS.formatToParts(now).map((part) => [part.type, part.value]),
  );
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
}

export const PAYROLL_PERIOD_FORMAT_AR =
  "التاريخ غير صالح — أدخل تاريخًا ميلاديًا حقيقيًا بصيغة سنة-شهر-يوم.";
export const PAYROLL_PERIOD_ORDER_AR = "تاريخ البداية يجب ألا يكون بعد تاريخ النهاية.";
export const PAYROLL_PERIOD_TOO_LONG_AR =
  "المدة أطول من الحد المسموح (٣٦٦ يومًا). اختر فترة أقصر.";
export const PAYROLL_PERIOD_FUTURE_AR = "لا يمكن إقفال فترة تشمل تاريخًا في المستقبل.";

export type PayrollPeriodParse =
  | { ok: true; start: string; end: string; days: number }
  | { ok: false; error: string };

/**
 * Validate a requested close period. `today` is injected so the rule is deterministic under test;
 * both it and the bounds are compared as UTC calendar days, never as instants, so a server running
 * ahead of the farm's own clock cannot turn "today" into a future date by a few hours.
 */
export function parsePayrollPeriod(
  startRaw: unknown,
  endRaw: unknown,
  today: Date = new Date(),
): PayrollPeriodParse {
  const start = readCalendarDate(startRaw);
  const end = readCalendarDate(endRaw);
  if (!start || !end) return { ok: false, error: PAYROLL_PERIOD_FORMAT_AR };
  if (start.dayNumber > end.dayNumber) return { ok: false, error: PAYROLL_PERIOD_ORDER_AR };

  // Inclusive day count: a single-day period is 1 day, not 0.
  const days = end.dayNumber - start.dayNumber + 1;
  if (days > PAYROLL_MAX_PERIOD_DAYS) return { ok: false, error: PAYROLL_PERIOD_TOO_LONG_AR };

  const todayBound = readCalendarDate(cairoTodayIso(today));
  if (!todayBound) return { ok: false, error: PAYROLL_PERIOD_FORMAT_AR };
  if (end.dayNumber > todayBound.dayNumber) {
    return { ok: false, error: PAYROLL_PERIOD_FUTURE_AR };
  }

  return { ok: true, start: start.iso, end: end.iso, days };
}

/** The confirmation the close form must carry — an immutable freeze is never a one-click action. */
export const PAYROLL_CONFIRM_REQUIRED_AR =
  "أكّد أنك تفهم أن الإقفال نهائي ولا يمكن التراجع عنه قبل المتابعة.";

/** The categories the close RPC can fail in, each with ONE fixed, field-safe Arabic message. */
export type PayrollCloseErrorCategory =
  | "no_labor"
  | "missing_rate"
  | "unassigned_crew"
  | "overlap"
  | "validation"
  | "forbidden"
  | "general";

export const PAYROLL_CLOSE_MESSAGE_AR: Record<PayrollCloseErrorCategory, string> = {
  no_labor: "لا توجد سجلات عمل في هذه الفترة، فلا يوجد ما يُقفل.",
  missing_rate:
    "بعض العاملين في هذه الفترة بلا أجر محدَّد. أكمل بيانات الأجر — وتأكد من مطابقة فترة العقد الموسمي لفترة الإقفال — ثم أعد المحاولة.",
  unassigned_crew:
    "توجد سجلات عمل مسجَّلة باسم فريق دون ربطها بعامل. اربط كل سجل بعامل مسجَّل قبل الإقفال.",
  overlap: "هذه الفترة تتقاطع مع فترة سبق إقفالها. اختر فترة لا تتداخل معها.",
  validation: "بيانات الفترة غير صالحة. راجع تاريخي البداية والنهاية ثم أعد المحاولة.",
  forbidden: "ليس لديك صلاحية إقفال الرواتب — المالك أو المحاسب فقط.",
  general: "تعذّر إقفال الرواتب. حاول مرة أخرى.",
};

/** The minimal shape read off a Supabase/PostgREST error (PostgrestError-compatible). */
export interface PayrollDbError {
  code?: string | null;
  message?: string;
}

/**
 * The RPC's own 22023 conditions, told apart by a stable fragment of the raise text. The fragment is
 * used ONLY to pick a category — it is never rendered — so classification can improve without any
 * risk of the raw message reaching a user. An unrecognised 22023 falls back to `validation`.
 */
const RAISE_MARKERS: { marker: string; category: PayrollCloseErrorCategory }[] = [
  { marker: "no labor logs found", category: "no_labor" },
  { marker: "free-text crew labor logs", category: "unassigned_crew" },
  { marker: "missing or invalid rate", category: "missing_rate" },
];

export function classifyPayrollCloseError(
  error: PayrollDbError | null | undefined,
): PayrollCloseErrorCategory {
  const code = error?.code ?? "";
  if (code === "42501") return "forbidden";
  if (code === "23505") return "overlap";
  if (code === "22023") {
    const raw = typeof error?.message === "string" ? error.message.toLowerCase() : "";
    return RAISE_MARKERS.find((entry) => raw.includes(entry.marker))?.category ?? "validation";
  }
  // 23514 is the RPC's cross-org person re-verification: a real integrity failure the user cannot
  // act on and must not be told the shape of. Everything else is generic by construction.
  return "general";
}

export interface PayrollCloseFailure {
  category: PayrollCloseErrorCategory;
  /** Always a constant from PAYROLL_CLOSE_MESSAGE_AR — never derived from the DB message. */
  message: string;
}

export function payrollCloseFailure(
  error: PayrollDbError | null | undefined,
): PayrollCloseFailure {
  const category = classifyPayrollCloseError(error);
  return { category, message: PAYROLL_CLOSE_MESSAGE_AR[category] };
}
