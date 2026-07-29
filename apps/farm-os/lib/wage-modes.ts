// Wage modes and piece units — the ONE place the app names the sets the database already constrains.
//
// Migration 20260729090000_payroll_run_persistence.sql puts the SAME two CHECK-constrained sets on
// four columns: `people_compensation.mode`/`.unit` and `labor_logs.mode`/`.unit` (plus
// `payroll_run_lines`). Before this module, the attendance form, the compensation editor and the
// frozen payroll report each would have carried their own copy of those literals and their own
// Arabic labels — and a mode spelled one way on a form and another way on a report is exactly the
// kind of drift that ends with an unpriceable labor row discovered at close time.
//
// Pure and framework-free: it ships in the client bundle behind both forms and is imported by the
// server-side report reader, so there is exactly one spelling and one label per mode/unit.

/** Wage modes (#388). Mirrors `people_compensation_mode_check` / `labor_logs_mode_check`. */
export const WAGE_MODES = ["hourly", "daily", "piece", "seasonal"] as const;
export type WageMode = (typeof WAGE_MODES)[number];

/** Piece units (#388 pt.4). Mirrors `people_compensation_unit_check` / `labor_logs_unit_check`. */
export const WAGE_UNITS = ["tree", "box", "crate", "kg", "bucket", "bin", "row"] as const;
export type WageUnit = (typeof WAGE_UNITS)[number];

export const WAGE_MODE_AR: Record<WageMode, string> = {
  hourly: "بالساعة",
  daily: "باليوم",
  piece: "بالقطعة",
  seasonal: "موسمي",
};

export const WAGE_UNIT_AR: Record<WageUnit, string> = {
  tree: "نخلة",
  box: "صندوق",
  crate: "قفص",
  kg: "كيلوجرام",
  bucket: "جردل",
  bin: "صندوق كبير",
  row: "خط",
};

/**
 * A one-line explanation of what each mode's rate is multiplied by at close time — the thing a user
 * actually has to get right, and the thing the DB will not tell them. Derived from
 * `fn_close_payroll_run`'s own aggregation (section 10 of the migration), never re-computed here.
 */
export const WAGE_MODE_BASIS_AR: Record<WageMode, string> = {
  hourly: "الأجر لكل ساعة — يُضرب في مجموع الساعات المسجّلة في الفترة.",
  daily: "الأجر لكل يوم — يُضرب في عدد أيام العمل المختلفة المسجّلة في الفترة، لا في عدد السجلات.",
  piece: "الأجر لكل وحدة — يُضرب في مجموع الكميات المسجّلة بنفس الوحدة.",
  seasonal:
    "مبلغ ثابت للعقد كله — لا يُحتسب إلا إذا طابقت فترة الإقفال تاريخَي العقد بالضبط، وإلا عُومل كأنه بلا أجر.",
};

export function isWageMode(value: unknown): value is WageMode {
  return typeof value === "string" && (WAGE_MODES as readonly string[]).includes(value);
}

export function isWageUnit(value: unknown): value is WageUnit {
  return typeof value === "string" && (WAGE_UNITS as readonly string[]).includes(value);
}

/** The mode's Arabic label, or null when a stored value is not one this build knows. */
export function wageModeLabel(mode: unknown): string | null {
  return isWageMode(mode) ? WAGE_MODE_AR[mode] : null;
}

/** The unit's Arabic label, or null when a stored value is not one this build knows. */
export function wageUnitLabel(unit: unknown): string | null {
  return isWageUnit(unit) ? WAGE_UNIT_AR[unit] : null;
}
