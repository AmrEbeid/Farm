// Compensation setup — the PURE half of «أجور الفريق» (SPEC-0006 slice 4).
//
// WHAT IT VALIDATES. One `people_compensation` row: the wage MODE, the RATE, the piece UNIT and the
// seasonal contract bounds. Every rule below is the app-side mirror of a CHECK constraint or partial
// unique index that migration 20260729090000_payroll_run_persistence.sql already enforces in
// Postgres, so a wrong shape becomes an Arabic sentence instead of a raw 23514/23505:
//
//   people_compensation_mode_check              mode ∈ {hourly,daily,piece,seasonal}
//   people_compensation_unit_check              unit ∈ {tree,box,crate,kg,bucket,bin,row} or null
//   people_compensation_piece_shape             (mode='piece') = (unit is not null)
//   people_compensation_seasonal_shape          (mode='seasonal') = (both contract bounds set)
//   people_compensation_seasonal_period_valid   start <= end
//   people_compensation_person_mode_uq          one non-piece rate per (person, mode)
//   people_compensation_person_mode_unit_uq     one piece rate per (person, mode, unit)
//
// RATE. `people_compensation.rate` is nullable in the schema and `fn_close_payroll_run` treats a
// null/zero/negative rate exactly like a missing one — it FAILS the whole close rather than pricing
// it (non-negotiable #1: never fabricate). So this editor refuses to WRITE such a rate at all: a
// stored rate is always finite and strictly positive, and the failure is caught at data entry rather
// than months later at close time.
//
// SEASONAL. A seasonal rate is a fixed amount for ONE declared span, and the close resolves it only
// on an EXACT match between the close period and these bounds — never by overlap or containment. The
// bounds are therefore validated as real calendar dates with start ≤ end and a sane maximum span, and
// the UI says in words that the close period must equal them.

import {
  LABOR_MODES,
  LABOR_UNITS,
  LABOR_MODE_AR,
  LABOR_UNIT_AR,
  isLaborMode,
  isLaborUnit,
  type LaborMode,
  type LaborUnit,
} from "@/lib/labor-entry";
import { isCalendarDate } from "@/lib/payroll-close";
import { isUuid } from "@/lib/uuid";

export {
  LABOR_MODES as COMPENSATION_MODES,
  LABOR_UNITS as COMPENSATION_UNITS,
  LABOR_MODE_AR as COMPENSATION_MODE_AR,
  LABOR_UNIT_AR as COMPENSATION_UNIT_AR,
};
export type CompensationMode = LaborMode;
export type CompensationUnit = LaborUnit;

/** The largest rate this editor will store. A defensive typo bound, not a market judgement. */
export const COMPENSATION_RATE_MAX = 10_000_000;
/** The longest seasonal contract a single rate may declare — one leap year, matching the close bound. */
export const COMPENSATION_MAX_SEASON_DAYS = 366;

const MS_PER_DAY = 86_400_000;

export const COMPENSATION_PERSON_INVALID_AR = "اختر عاملًا مسجَّلًا من القائمة.";
export const COMPENSATION_ROW_INVALID_AR = "سطر الأجر المطلوب تعديله غير صالح.";
export const COMPENSATION_MODE_INVALID_AR =
  "اختر طريقة أجر مدعومة: بالساعة أو باليوم أو بالقطعة أو موسمي.";
export const COMPENSATION_RATE_INVALID_AR = "قيمة الأجر يجب أن تكون رقمًا أكبر من صفر.";
export const COMPENSATION_UNIT_REQUIRED_AR = "اختر وحدة قياس مدعومة للأجر بالقطعة.";
export const COMPENSATION_UNIT_FORBIDDEN_AR =
  "الوحدة لا تُستخدم إلا مع الأجر بالقطعة؛ اتركها فارغة في باقي الطرق.";
export const COMPENSATION_SEASON_REQUIRED_AR =
  "الأجر الموسمي يتطلب تاريخي بداية ونهاية حقيقيين للعقد.";
export const COMPENSATION_SEASON_FORBIDDEN_AR =
  "تاريخا العقد لا يُستخدمان إلا مع الأجر الموسمي؛ اتركهما فارغين في باقي الطرق.";
export const COMPENSATION_SEASON_ORDER_AR = "تاريخ بداية العقد يجب ألا يكون بعد تاريخ نهايته.";
export const COMPENSATION_SEASON_TOO_LONG_AR =
  "مدة العقد الموسمي أطول من الحد المسموح (٣٦٦ يومًا). اختر مدة أقصر.";

/** The fixed message for a duplicate-rate race — never the raw 23505 text. */
export const COMPENSATION_CONFLICT_AR =
  "يوجد بالفعل أجر محفوظ لهذا العامل بنفس الطريقة (ونفس الوحدة للأجر بالقطعة). عدّل السطر الموجود بدل إضافة سطر جديد.";

/** The rule the seasonal editor states in words, because the close will not infer it. */
export const COMPENSATION_SEASONAL_EXACT_AR =
  "الأجر الموسمي يُصرف مرة واحدة، وفقط عندما تكون فترة الإقفال مطابقة تمامًا لتاريخَي العقد المحفوظين هنا — لا يُحسب بالتداخل ولا بالاحتواء.";

/** The confidentiality statement: this surface exists so wages never reach the broader team pages. */
export const COMPENSATION_CONFIDENTIAL_AR =
  "الأجور تظهر للمالك والمحاسب فقط. لا تظهر في دليل الفريق ولا في ملف الشخص ولا لأي دور آخر.";

/** A compensation row, normalized to exactly the columns `people_compensation` stores. */
export interface NormalizedCompensation {
  /** Present only when editing an existing row; null when creating. */
  rowId: string | null;
  personId: string;
  mode: CompensationMode;
  rate: number;
  unit: CompensationUnit | null;
  contractPeriodStart: string | null;
  contractPeriodEnd: string | null;
}

export type CompensationParse =
  | { ok: true; value: NormalizedCompensation }
  | { ok: false; error: string };

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

/** Inclusive day count between two already-validated YYYY-MM-DD dates. */
function inclusiveDays(startIso: string, endIso: string): number {
  const start = Date.UTC(
    Number(startIso.slice(0, 4)),
    Number(startIso.slice(5, 7)) - 1,
    Number(startIso.slice(8, 10)),
  );
  const end = Date.UTC(
    Number(endIso.slice(0, 4)),
    Number(endIso.slice(5, 7)) - 1,
    Number(endIso.slice(8, 10)),
  );
  return Math.floor((end - start) / MS_PER_DAY) + 1;
}

/**
 * Validate and normalize one compensation row.
 *
 * `rowId`/`personId` are only shape-checked here (non-empty text). Their AUTHORITY — that the person
 * and the row really belong to the caller's own org — is re-established against the database by the
 * server action, because no pure function can know it. This split is deliberate: the pure half is
 * shared with the browser, and a browser must never be the thing that decides tenancy.
 */
export function parseCompensationInput(input: unknown): CompensationParse {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: COMPENSATION_PERSON_INVALID_AR };
  }
  const candidate = input as Record<string, unknown>;

  // `rowId` absent/blank = CREATE. Anything else must be a real uuid: an id that is not even
  // id-shaped would otherwise reach PostgREST and come back as a raw 22P02, and — worse — a
  // malformed id in an UPDATE filter is a filter that may not narrow the way the caller assumed.
  const rowIdRaw = candidate.rowId;
  const rowGiven = rowIdRaw !== null && rowIdRaw !== undefined && rowIdRaw !== "";
  const rowId = rowGiven ? readText(rowIdRaw) : null;
  if (rowGiven && !isUuid(rowId)) return { ok: false, error: COMPENSATION_ROW_INVALID_AR };

  const personId = readText(candidate.personId);
  if (!personId || !isUuid(personId)) return { ok: false, error: COMPENSATION_PERSON_INVALID_AR };

  const mode = candidate.mode;
  if (!isLaborMode(mode)) return { ok: false, error: COMPENSATION_MODE_INVALID_AR };

  const rate = readNumber(candidate.rate);
  if (rate === null || rate <= 0 || rate > COMPENSATION_RATE_MAX) {
    return { ok: false, error: COMPENSATION_RATE_INVALID_AR };
  }

  const rawUnit = candidate.unit;
  const unitGiven = rawUnit !== null && rawUnit !== undefined && rawUnit !== "";
  let unit: CompensationUnit | null = null;
  if (mode === "piece") {
    if (!isLaborUnit(rawUnit)) return { ok: false, error: COMPENSATION_UNIT_REQUIRED_AR };
    unit = rawUnit;
  } else if (unitGiven) {
    return { ok: false, error: COMPENSATION_UNIT_FORBIDDEN_AR };
  }

  const rawStart = candidate.contractPeriodStart;
  const rawEnd = candidate.contractPeriodEnd;
  const startGiven = rawStart !== null && rawStart !== undefined && rawStart !== "";
  const endGiven = rawEnd !== null && rawEnd !== undefined && rawEnd !== "";
  let contractPeriodStart: string | null = null;
  let contractPeriodEnd: string | null = null;

  if (mode === "seasonal") {
    if (!isCalendarDate(rawStart) || !isCalendarDate(rawEnd)) {
      return { ok: false, error: COMPENSATION_SEASON_REQUIRED_AR };
    }
    // Both are validated YYYY-MM-DD, which sorts lexicographically in calendar order.
    if (rawStart > rawEnd) return { ok: false, error: COMPENSATION_SEASON_ORDER_AR };
    if (inclusiveDays(rawStart, rawEnd) > COMPENSATION_MAX_SEASON_DAYS) {
      return { ok: false, error: COMPENSATION_SEASON_TOO_LONG_AR };
    }
    contractPeriodStart = rawStart;
    contractPeriodEnd = rawEnd;
  } else if (startGiven || endGiven) {
    return { ok: false, error: COMPENSATION_SEASON_FORBIDDEN_AR };
  }

  return {
    ok: true,
    value: { rowId, personId, mode, rate, unit, contractPeriodStart, contractPeriodEnd },
  };
}

/** How a stored rate reads in the list: «٢٥ ج.م / نخلة», «٢٠٠ ج.م / يوم» … */
const RATE_BASIS_AR: Record<CompensationMode, string> = {
  hourly: "ساعة",
  daily: "يوم",
  piece: "قطعة",
  seasonal: "العقد كاملًا",
};

export function compensationBasisLabel(mode: string, unit: string | null): string {
  if (mode === "piece") return unit ? (LABOR_UNIT_AR[unit as LaborUnit] ?? "غير معروف") : "غير معروف";
  return RATE_BASIS_AR[mode as CompensationMode] ?? "غير معروف";
}

// ── FIELD-SAFE ERROR MAPPING (non-negotiable #2). A wage editor is the LAST place a raw DB string may
//    surface: `people_compensation`'s constraint names embed the wage semantics, and a PostgREST error
//    body can echo the offending VALUES — i.e. someone's rate. Every failure is therefore classified by
//    SQLSTATE alone and answered with ONE constant from COMPENSATION_MESSAGE_AR. `error.message` is
//    never read, never returned and never logged onto the response. ──────────────────────────────────
export type CompensationErrorCategory =
  | "forbidden"
  | "duplicate"
  | "validation"
  | "missing_person"
  | "not_found"
  | "general";

export const COMPENSATION_MESSAGE_AR: Record<CompensationErrorCategory, string> = {
  forbidden: "ليس لديك صلاحية تعديل الأجور — المالك أو المحاسب فقط.",
  duplicate: COMPENSATION_CONFLICT_AR,
  validation: "بيانات الأجر غير صالحة. راجع الحقول ثم أعد المحاولة.",
  missing_person: "عضو الفريق المختار غير موجود في مؤسستك.",
  not_found: "لم يُعثر على سطر الأجر المطلوب تعديله في مؤسستك. حدّث الصفحة ثم أعد المحاولة.",
  general: "تعذّر حفظ الأجر. حاول مرة أخرى.",
};

/** The minimal shape read off a Supabase/PostgREST error (PostgrestError-compatible). */
export interface CompensationDbError {
  code?: string | null;
  message?: string;
}

/**
 * 23505 is the partial-unique-index race: two saves for the same (person, mode[, unit]) key, where the
 * loser is told to edit the existing row rather than being handed a Postgres index name. 23514 covers
 * every CHECK this module also validates app-side — reaching one means the app-side rule drifted from
 * the constraint, so it reads as "invalid data", not as an internal error the user can do nothing with.
 */
export function classifyCompensationError(
  error: CompensationDbError | null | undefined,
): CompensationErrorCategory {
  switch (error?.code ?? "") {
    case "42501":
      return "forbidden";
    case "23505":
      return "duplicate";
    case "23514":
    case "22023":
    case "23502":
    case "22P02":
      return "validation";
    case "23503":
      return "missing_person";
    default:
      return "general";
  }
}

export interface CompensationFailure {
  category: CompensationErrorCategory;
  /** Always a constant from COMPENSATION_MESSAGE_AR — never derived from the DB message. */
  message: string;
}

export function compensationFailure(
  error: CompensationDbError | null | undefined,
): CompensationFailure {
  const category = classifyCompensationError(error);
  return { category, message: COMPENSATION_MESSAGE_AR[category] };
}
