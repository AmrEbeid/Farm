/**
 * PAYROLL READINESS — three VALIDATION-ONLY import descriptors (SPEC-0006 · docs/PILOT-READINESS.md).
 *
 * WHAT THESE ARE. A rehearsal, not an import. Before a pilot farm's payroll can be trusted, the owner
 * and the accountant have to find out whether their roster, their rates and their labor records are
 * even SHAPED like something the close can price — a missing piece unit or a seasonal contract that
 * does not match its close period fails `fn_close_payroll_run` for the WHOLE period, and finding that
 * out at close time is the expensive way to find out. These three templates let them find out on a
 * spreadsheet, weeks earlier, against exactly the rules the real surfaces enforce.
 *
 * WHAT THESE ARE NOT. They are not a payroll import. `validationOnly: true` means the type system
 * itself refuses them an `rpc`, a `toRpcArgs`, a `table`, a `matchKey` and an `archiveType`; the
 * route refuses a `commit` POST for them before it parses the upload at all (the descriptor and mode
 * are query parameters so that refusal precedes `req.formData()`); and `planCommit` throws if one
 * ever reaches it. A clean dry-run produces a REPORT and nothing else. Authoritative payroll import
 * stays closed until the Stage-M privacy review and the independent access review clear it.
 *
 * NO CONTACT PII, BY CONSTRUCTION. `people` carries `phone` and `email`. Neither appears as a column
 * here, in either direction: these descriptors declare no `table`, so the template is never prefilled
 * from the database, and no column asks for a phone or an email. The only thing that touches real
 * data at all is the person REFERENCE lookup (`people.name` → id), which is read-only, RLS-scoped to
 * the caller's active org, and never echoed back in the dry-run response.
 *
 * DUPLICATE NAMES FAIL CLOSED. A person is referenced by display name, which is not unique. The
 * framework's existing ref resolver drops any code that matches more than one row, so an ambiguous
 * name becomes a row ERROR — it is never resolved to "whichever one came back first". Resolving a
 * wage or a work record onto the wrong worker is precisely the failure this rehearsal exists to
 * prevent, so it must not be the failure the rehearsal itself commits.
 *
 * THE RULES ARE BORROWED, NOT RESTATED. Every mode-dependent rule below comes from
 * `parseCompensationShape` (lib/compensation.ts) and `parseLaborShape` (lib/labor-entry.ts) — the
 * same functions «أجور الفريق» and «تسجيل الحضور» run, returning the same Arabic sentences. A
 * template that accepted a shape the real form rejects would be worse than no template at all.
 *
 * EXAMPLES ARE OBVIOUSLY SYNTHETIC. Every example value is a visibly fake Arabic placeholder
 * («عامل تجريبي ١»), never a member of the farm's staff and never a real rate. They live on the
 * instructions sheet only (`buildTemplateSpec`), so they are never parsed as data.
 */
import {
  COMPENSATION_MODES,
  COMPENSATION_UNITS,
  parseCompensationShape,
} from "@/lib/compensation";
import { LABOR_MODES, LABOR_UNITS, parseLaborShape } from "@/lib/labor-entry";
import { EMP_TYPE_AR } from "@/lib/labels";
import type { CrossFieldError, ImportColumn, ValidationOnlyImportDescriptor } from "../types";

/** owner/accountant only — the same pair that gates `people_compensation` and the payroll close. */
const PAYROLL_READINESS_ROLES = ["owner", "accountant"] as const;

/**
 * `role` on a descriptor normally names the RPC gate it mirrors. These have no RPC, so it names the
 * PERMISSION that gates the data they are a rehearsal for — the same `payroll.read` behind
 * `people_compensation` and `payroll_runs`.
 */
const PAYROLL_READINESS_PERMISSION = "payroll.read";

/** Defensive typo bounds on free text. Not a policy about names — just a bound. */
export const READINESS_NAME_MAX = 120;
const READINESS_POSITION_MAX = 120;

const NAME_TOO_LONG_AR = "اسم العامل أطول من المسموح.";
const POSITION_TOO_LONG_AR = "المسمّى الوظيفي أطول من المسموح.";

/** Employment types the team directory already knows (lib/labels.ts) — one spelling, not a new set. */
const READINESS_EMPLOYMENT_TYPES = Object.keys(EMP_TYPE_AR);

/** Synthetic placeholders. Visibly fake by construction — «تجريبي» is in every one of them. */
const EXAMPLE_PERSON_AR = "عامل تجريبي ١";
const EXAMPLE_POSITION_AR = "وظيفة تجريبية";
const EXAMPLE_NOTE_AR = "ملاحظة تجريبية";

/** A bounded-length check for one already-coerced text column. */
function tooLong(
  row: Record<string, unknown>,
  column: string,
  max: number,
  reason: string,
): CrossFieldError[] {
  const value = row[column];
  return typeof value === "string" && value.length > max ? [{ column, reason }] : [];
}

/** The person reference column, identical on the two descriptors that carry it. */
const personRefColumn: ImportColumn = {
  key: "personName",
  labelAr: "اسم العامل",
  type: "string",
  required: true,
  example: EXAMPLE_PERSON_AR,
  // Active people only, resolved by display name inside the caller's active org. A name matching
  // two active people resolves to NEITHER — the resolver drops ambiguous codes.
  ref: { table: "people", codeColumn: "name", activeColumn: "active", activeValue: true },
};

// ── 1. STAFF READINESS ────────────────────────────────────────────────────────────────────────────
// The roster itself: is every worker who will appear in a payroll period actually registered, with a
// position and an employment type, and marked active? No reference lookup, no contact columns.
export const payrollReadinessStaffDescriptor: ValidationOnlyImportDescriptor = {
  key: "payroll-readiness-staff",
  titleAr: "جاهزية الرواتب: كشف الفريق (تحقق فقط)",
  validationOnly: true,
  role: PAYROLL_READINESS_PERMISSION,
  allowedRoles: [...PAYROLL_READINESS_ROLES],
  columns: [
    {
      key: "name",
      labelAr: "اسم العامل",
      type: "string",
      required: true,
      example: EXAMPLE_PERSON_AR,
    },
    {
      key: "position",
      labelAr: "المسمّى الوظيفي",
      type: "string",
      required: true,
      example: EXAMPLE_POSITION_AR,
    },
    {
      key: "employmentType",
      labelAr: "نوع التوظيف",
      type: "enum",
      required: true,
      enumValues: READINESS_EMPLOYMENT_TYPES,
      example: "permanent",
    },
    { key: "active", labelAr: "نشط (true/false)", type: "bool", required: true, example: "true" },
  ],
  crossFieldCheck: (row) => [
    ...tooLong(row, "name", READINESS_NAME_MAX, NAME_TOO_LONG_AR),
    ...tooLong(row, "position", READINESS_POSITION_MAX, POSITION_TOO_LONG_AR),
  ],
};

// ── 2. COMPENSATION READINESS ─────────────────────────────────────────────────────────────────────
// The rates the close prices against, checked with `parseCompensationShape` — the wage editor's own
// validator. A piece rate must name its unit; every other mode must not. A seasonal rate must carry
// two real contract dates in order and within one leap year; every other mode must carry none.
export const payrollReadinessCompensationDescriptor: ValidationOnlyImportDescriptor = {
  key: "payroll-readiness-compensation",
  titleAr: "جاهزية الرواتب: الأجور (تحقق فقط)",
  validationOnly: true,
  role: PAYROLL_READINESS_PERMISSION,
  allowedRoles: [...PAYROLL_READINESS_ROLES],
  columns: [
    personRefColumn,
    {
      key: "mode",
      labelAr: "طريقة الأجر",
      type: "enum",
      required: true,
      enumValues: [...COMPENSATION_MODES],
      example: "daily",
    },
    { key: "rate", labelAr: "قيمة الأجر", type: "decimal", required: true, example: "150" },
    {
      key: "unit",
      labelAr: "وحدة الأجر بالقطعة",
      type: "enum",
      required: false,
      enumValues: [...COMPENSATION_UNITS],
      example: "box",
    },
    {
      key: "contractPeriodStart",
      labelAr: "بداية العقد الموسمي",
      type: "date",
      required: false,
      format: "YYYY-MM-DD",
      example: "2026-01-01",
    },
    {
      key: "contractPeriodEnd",
      labelAr: "نهاية العقد الموسمي",
      type: "date",
      required: false,
      format: "YYYY-MM-DD",
      example: "2026-03-31",
    },
  ],
  crossFieldCheck: (row) => {
    const bounds = tooLong(row, "personName", READINESS_NAME_MAX, NAME_TOO_LONG_AR);
    const shape = parseCompensationShape(row);
    return shape.ok ? bounds : [...bounds, { column: shape.field, reason: shape.error }];
  },
};

// ── 3. LABOR READINESS ────────────────────────────────────────────────────────────────────────────
// The attendance the close aggregates, checked with `parseLaborShape` — the attendance form's own
// validator. Hours stay required and positive (≤24) for EVERY mode, because they are attendance
// evidence rather than a pricing input; quantity + unit belong to piece rows only; and a work date
// is a real calendar day that is never in the future on the CAIRO clock, not the server's.
export const payrollReadinessLaborDescriptor: ValidationOnlyImportDescriptor = {
  key: "payroll-readiness-labor",
  titleAr: "جاهزية الرواتب: سجل العمل (تحقق فقط)",
  validationOnly: true,
  role: PAYROLL_READINESS_PERMISSION,
  allowedRoles: [...PAYROLL_READINESS_ROLES],
  columns: [
    personRefColumn,
    {
      key: "workDate",
      labelAr: "تاريخ العمل",
      type: "date",
      required: true,
      format: "YYYY-MM-DD",
      example: "2026-01-15",
    },
    {
      key: "mode",
      labelAr: "طريقة الأجر",
      type: "enum",
      required: true,
      enumValues: [...LABOR_MODES],
      example: "daily",
    },
    { key: "hours", labelAr: "عدد الساعات", type: "decimal", required: true, example: "8" },
    { key: "quantity", labelAr: "الكمية (للقطعة فقط)", type: "decimal", required: false, example: "40" },
    {
      key: "unit",
      labelAr: "الوحدة (للقطعة فقط)",
      type: "enum",
      required: false,
      enumValues: [...LABOR_UNITS],
      example: "box",
    },
    { key: "note", labelAr: "ملاحظة", type: "string", required: false, example: EXAMPLE_NOTE_AR },
  ],
  // The note is NOT bounded here: `parseLaborShape` already bounds it (LABOR_NOTE_MAX), and adding a
  // second bound would report the same problem twice with two different sentences.
  crossFieldCheck: (row, now) => {
    const bounds = tooLong(row, "personName", READINESS_NAME_MAX, NAME_TOO_LONG_AR);
    const shape = parseLaborShape(row, now);
    return shape.ok ? bounds : [...bounds, { column: shape.field, reason: shape.error }];
  },
};

/** The three, in the order the readiness page presents them: who → what they earn → what they did. */
export const PAYROLL_READINESS_DESCRIPTORS: ValidationOnlyImportDescriptor[] = [
  payrollReadinessStaffDescriptor,
  payrollReadinessCompensationDescriptor,
  payrollReadinessLaborDescriptor,
];
