// Attendance / labor-log entry — the PURE half (SPEC-0006 slice 4, data-entry side of the mixed-mode
// payroll close shipped in migration 20260729090000_payroll_run_persistence.sql).
//
// WHY THIS EXISTS. The close RPC prices four wage modes (hourly/daily/piece/seasonal) off
// `labor_logs.mode`/`quantity`/`unit`, but the attendance form only ever wrote hourly rows with no
// quantity at all — so a piece-rate farm could not record what it actually pays for. This module is
// the mode-aware validator both the form and the server action run, so the browser and the server
// agree on exactly one set of rules and exactly one set of Arabic messages.
//
// THE HOURS RULE, STATED ONCE. `labor_logs.hours` is NOT NULL for EVERY row regardless of mode
// (migration 20260729090000 §2). Hours are ATTENDANCE EVIDENCE — who was on the farm, and for how
// long — and they stay required and positive for daily, piece and seasonal rows too. What changes by
// mode is only how the close PRICES the day: daily counts distinct work_dates, piece sums quantity,
// seasonal pays the contract once. None of those read `hours`. So "hours are ignored for pricing" and
// "hours are still required" are both true at the same time, and the UI says so in one line.
//
// SHAPE, MIRRORING THE CHECK CONSTRAINTS EXACTLY (labor_logs_piece_shape):
//   mode = 'piece'  → quantity > 0 AND unit ∈ LABOR_UNITS
//   mode ≠ 'piece'  → quantity IS NULL AND unit IS NULL
// Validating it here as well as in Postgres means a wrong shape is an Arabic sentence, not a 23514.
//
// DATES. A real YYYY-MM-DD calendar day (2026-02-30 is rejected, not rolled forward) and never in the
// future, compared against the SHARED Cairo calendar helper the payroll close already uses — the farm
// clock, not the server's UTC one. YYYY-MM-DD sorts lexicographically in calendar order, so the
// future check is a plain string comparison between two already-validated dates.

import { cairoTodayIso, isCalendarDate } from "@/lib/payroll-close";
import { isUuid } from "@/lib/uuid";
import {
  WAGE_MODES,
  WAGE_UNITS,
  WAGE_MODE_AR,
  WAGE_UNIT_AR,
  isWageMode,
  isWageUnit,
  type WageMode,
  type WageUnit,
} from "@/lib/wage-modes";

// The mode/unit sets and their Arabic labels live in ONE module (`lib/wage-modes`), shared with the
// compensation editor and the frozen payroll report. They are re-exported under the LABOR_* names
// this surface reads naturally in, so there is a single spelling of every mode across entry, pricing
// and reporting — a mode named one way on the form and another way on the report is precisely how an
// unpriceable labor row gets discovered at close time instead of at entry time.
export {
  WAGE_MODES as LABOR_MODES,
  WAGE_UNITS as LABOR_UNITS,
  WAGE_MODE_AR as LABOR_MODE_AR,
  WAGE_UNIT_AR as LABOR_UNIT_AR,
  isWageMode as isLaborMode,
  isWageUnit as isLaborUnit,
};
export type LaborMode = WageMode;
export type LaborUnit = WageUnit;

/** One calendar day of attendance can never exceed 24 hours — a typo'd «80» is caught here. */
export const LABOR_HOURS_MAX = 24;
/** An upper bound on a single day's piece count: a defensive sanity limit, not an agronomic one. */
export const LABOR_QUANTITY_MAX = 100_000;
export const LABOR_TEAM_NAME_MAX = 120;
export const LABOR_NOTE_MAX = 300;

/** Shown when a stored mode/unit is not one this build knows — never guessed at. */
export const LABOR_UNKNOWN_LABEL_AR = "غير معروف";

export function laborModeLabel(mode: string): string {
  return isWageMode(mode) ? WAGE_MODE_AR[mode] : LABOR_UNKNOWN_LABEL_AR;
}

export function laborUnitLabel(unit: string | null): string {
  if (!unit) return "—";
  return isWageUnit(unit) ? WAGE_UNIT_AR[unit] : LABOR_UNKNOWN_LABEL_AR;
}

// ── The fixed Arabic messages. Every rejection returns one of these constants; none is ever built
//    from a database message, so no identifier, rate or worker name can leak through a validation
//    verdict (non-negotiable #2). ───────────────────────────────────────────────────────────────────
export const LABOR_WHO_REQUIRED_AR = "اختر عضو فريق أو أدخل اسم فريق.";
export const LABOR_WHO_BOTH_AR = "اختر إمّا عضو فريق أو اسم فريق، وليس الاثنين.";
export const LABOR_PERSON_INVALID_AR = "عضو الفريق المختار غير صالح — اختره من القائمة.";
export const LABOR_TEAM_TOO_LONG_AR = "اسم الفريق أطول من المسموح.";
export const LABOR_MODE_INVALID_AR = "اختر طريقة أجر مدعومة: بالساعة أو باليوم أو بالقطعة أو موسمي.";
export const LABOR_DATE_INVALID_AR =
  "التاريخ غير صالح — أدخل تاريخًا ميلاديًا حقيقيًا بصيغة سنة-شهر-يوم.";
export const LABOR_DATE_FUTURE_AR = "لا يمكن تسجيل حضور بتاريخ في المستقبل.";
export const LABOR_HOURS_AR =
  "عدد الساعات مطلوب لكل طرق الأجر: رقم أكبر من صفر ولا يتجاوز ٢٤ ساعة في اليوم.";
export const LABOR_QUANTITY_AR = "الكمية مطلوبة مع الأجر بالقطعة: رقم أكبر من صفر.";
export const LABOR_UNIT_REQUIRED_AR = "اختر وحدة قياس مدعومة للأجر بالقطعة.";
export const LABOR_PIECE_ONLY_AR =
  "الكمية والوحدة لا تُسجَّلان إلا مع الأجر بالقطعة؛ اترك الحقلين فارغين في باقي الطرق.";
export const LABOR_NOTE_TOO_LONG_AR = "الملاحظات أطول من المسموح.";

/** The one-line explanation the form shows so «الساعات» never reads as «الأجر». */
export const LABOR_HOURS_ALWAYS_AR =
  "الساعات مطلوبة في كل الحالات كإثبات حضور فعلي. الأجر باليوم أو بالقطعة أو الموسمي لا يُحسب من الساعات: اليومي يُحسب بعدد أيام الحضور، والقطعة بالكمية والوحدة، والموسمي بقيمة العقد مرة واحدة.";

/** The warning shown whenever a free-text team is recorded instead of a registered person. */
export const LABOR_UNASSIGNED_TEAM_WARNING_AR =
  "اسم الفريق الحر يُسجَّل تشغيليًا فقط ولا يمكن تسعيره: إقفال الرواتب يرفض أي فترة تحتوي سجلًا واحدًا غير مرتبط بعامل مسجَّل. اربط السجل بعامل قبل موعد الإقفال.";

/** A labor row, normalized to exactly the columns `labor_logs` stores. */
export interface NormalizedLaborLog {
  personId: string | null;
  teamName: string | null;
  workDate: string;
  hours: number;
  mode: LaborMode;
  quantity: number | null;
  unit: LaborUnit | null;
  note: string | null;
}

export type LaborLogParse =
  | { ok: true; value: NormalizedLaborLog }
  | { ok: false; error: string };

/** Accepts a number or the numeric TEXT an `<input type="number">` produces. Rejects everything else. */
function readNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function readText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** The work columns themselves — everything about a labor row except WHO did it. */
export interface LaborShape {
  workDate: string;
  hours: number;
  mode: LaborMode;
  quantity: number | null;
  unit: LaborUnit | null;
  note: string | null;
}

/** Which input field a shape rejection belongs to, so a caller can attach it to its own column. */
export type LaborShapeField = "workDate" | "hours" | "mode" | "quantity" | "unit" | "note";

export type LaborShapeParse =
  | { ok: true; value: LaborShape }
  | { ok: false; field: LaborShapeField; error: string };

/**
 * THE ONE COPY of the date/hours/mode/quantity/unit/note rules — extracted verbatim from
 * `parseLaborLogInput`, which now calls it, so the attendance form and the readiness import template
 * cannot drift apart. Everything person/team-related stays out: this half knows nothing about
 * identity.
 *
 * Order is load-bearing and unchanged: date → hours → mode → mode-dependent shape → note.
 * `today` is injected so the "no future date" rule is deterministic under test; both sides are Cairo
 * calendar days, so a server running a few hours ahead of the farm cannot turn today into tomorrow.
 */
export function parseLaborShape(
  candidate: Record<string, unknown>,
  today: Date = new Date(),
): LaborShapeParse {
  const workDate = candidate.workDate;
  if (!isCalendarDate(workDate)) {
    return { ok: false, field: "workDate", error: LABOR_DATE_INVALID_AR };
  }
  // Both operands are validated YYYY-MM-DD, which sorts lexicographically in calendar order.
  if (workDate > cairoTodayIso(today)) {
    return { ok: false, field: "workDate", error: LABOR_DATE_FUTURE_AR };
  }

  // Hours stay required and positive for EVERY mode — attendance evidence, not a pricing input.
  const hours = readNumber(candidate.hours);
  if (hours === null || hours <= 0 || hours > LABOR_HOURS_MAX) {
    return { ok: false, field: "hours", error: LABOR_HOURS_AR };
  }

  const mode = candidate.mode;
  if (!isWageMode(mode)) return { ok: false, field: "mode", error: LABOR_MODE_INVALID_AR };

  const rawQuantity = candidate.quantity;
  const rawUnit = candidate.unit;
  const quantityGiven = rawQuantity !== null && rawQuantity !== undefined && rawQuantity !== "";
  const unitGiven = rawUnit !== null && rawUnit !== undefined && rawUnit !== "";

  let quantity: number | null = null;
  let unit: LaborUnit | null = null;

  if (mode === "piece") {
    const parsedQuantity = readNumber(rawQuantity);
    if (parsedQuantity === null || parsedQuantity <= 0 || parsedQuantity > LABOR_QUANTITY_MAX) {
      return { ok: false, field: "quantity", error: LABOR_QUANTITY_AR };
    }
    if (!isWageUnit(rawUnit)) return { ok: false, field: "unit", error: LABOR_UNIT_REQUIRED_AR };
    quantity = parsedQuantity;
    unit = rawUnit;
  } else if (quantityGiven || unitGiven) {
    // Never silently drop them: a caller that sent a quantity for an hourly row misunderstood the
    // row it is writing, and the close would price it differently than they expect.
    return { ok: false, field: "quantity", error: LABOR_PIECE_ONLY_AR };
  }

  const note = readText(candidate.note);
  if (note && note.length > LABOR_NOTE_MAX) {
    return { ok: false, field: "note", error: LABOR_NOTE_TOO_LONG_AR };
  }

  return { ok: true, value: { workDate, hours, mode, quantity, unit, note } };
}

/**
 * Validate and normalize one attendance row. `today` is injected so the "no future date" rule is
 * deterministic under test; both sides are Cairo calendar days, so a server running a few hours
 * ahead of the farm cannot turn today into tomorrow.
 *
 * Order matters: WHO → date → hours → mode → mode-dependent shape. Each step returns a single fixed
 * Arabic message, so the caller never has to assemble one.
 */
export function parseLaborLogInput(input: unknown, today: Date = new Date()): LaborLogParse {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: LABOR_WHO_REQUIRED_AR };
  }
  const candidate = input as Record<string, unknown>;

  const personId = readText(candidate.personId);
  const teamName = readText(candidate.teamName);
  if (!personId && !teamName) return { ok: false, error: LABOR_WHO_REQUIRED_AR };
  if (personId && teamName) return { ok: false, error: LABOR_WHO_BOTH_AR };
  // Shape-only: a person id must at least BE an id. That it is one of the caller's OWN org's people
  // is re-established in Postgres (labor_logs' same-org person guard + RLS), never here.
  if (personId && !isUuid(personId)) return { ok: false, error: LABOR_PERSON_INVALID_AR };
  if (teamName && teamName.length > LABOR_TEAM_NAME_MAX) {
    return { ok: false, error: LABOR_TEAM_TOO_LONG_AR };
  }

  const shape = parseLaborShape(candidate, today);
  if (!shape.ok) return { ok: false, error: shape.error };

  return { ok: true, value: { personId, teamName, ...shape.value } };
}

// ── FIELD-SAFE ERROR MAPPING (non-negotiable #2). The write path can now fail in ways the previous
//    hourly-only form never met — most importantly `guard_labor_log_payroll_freeze`, which raises
//    55000 for a row inside an already-closed payroll period. lib/errors.ts maps 55000 to the
//    ACCOUNTING-period message ("افتح الفترة أو اختر تاريخًا خارجها"), which is the wrong instruction
//    here: a closed payroll run is immutable and cannot be reopened at all. So this surface classifies
//    within the SQLSTATE itself and returns only constants — the DB message is never read. ───────────
export type LaborWriteErrorCategory =
  | "forbidden"
  | "closed_period"
  | "shape"
  | "missing_person"
  | "general";

export const LABOR_WRITE_MESSAGE_AR: Record<LaborWriteErrorCategory, string> = {
  forbidden: "ليس لديك صلاحية تسجيل الحضور.",
  closed_period:
    "هذه الفترة أُقفلت في الرواتب نهائيًا، فلا يمكن تسجيل أو تعديل أي ساعات عمل داخلها. اختر تاريخًا خارج الفترة المقفلة.",
  shape: "بيانات طريقة الأجر غير متطابقة. راجع الكمية والوحدة ثم أعد المحاولة.",
  missing_person: "عضو الفريق المختار غير موجود في مؤسستك.",
  general: "تعذّر تسجيل الحضور. حاول مرة أخرى.",
};

/** The minimal shape read off a Supabase/PostgREST error (PostgrestError-compatible). */
export interface LaborDbError {
  code?: string | null;
  message?: string;
}

/**
 * Classify by SQLSTATE ALONE — the raise text is never inspected and never returned.
 * `guard_labor_log_payroll_freeze` raises 55000 from both of its branches (an already-priced row
 * being edited, and a new row back-dated into a closed period); one message covers both, because the
 * user's next step is identical either way.
 */
export function classifyLaborWriteError(
  error: LaborDbError | null | undefined,
): LaborWriteErrorCategory {
  switch (error?.code ?? "") {
    case "42501":
      return "forbidden";
    case "55000":
      return "closed_period";
    case "23514":
      return "shape";
    case "23503":
      return "missing_person";
    default:
      return "general";
  }
}

export interface LaborWriteFailure {
  category: LaborWriteErrorCategory;
  /** Always a constant from LABOR_WRITE_MESSAGE_AR — never derived from the DB message. */
  message: string;
}

export function laborWriteFailure(error: LaborDbError | null | undefined): LaborWriteFailure {
  const category = classifyLaborWriteError(error);
  return { category, message: LABOR_WRITE_MESSAGE_AR[category] };
}
