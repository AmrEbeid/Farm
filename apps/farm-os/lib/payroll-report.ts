// Payroll wage-mode/unit labels and the shared `isUuid` helper behind «إقفال الرواتب».
//
// READS RETIRED. Through R4a's pattern, this module used to select `payroll_runs`/`payroll_run_lines`
// directly via PostgREST (`loadPayrollRunHistory`, `loadPayrollRunDetail`). R4b retires both: every
// payroll read on the workspace and run 360 routes now goes through exactly one of
// `fn_payroll_workspace_snapshot` / `fn_payroll_run_snapshot` (migration 20260823150000,
// lib/payroll-snapshot-reads.ts) — one exact, bounded, reconciliation-checked snapshot per page view,
// never a direct table read. What remains here is presentation vocabulary only: no database access.
//
// NO CONTACT PII. The label maps below never touch `people` at all.

import { WAGE_MODE_AR, WAGE_UNIT_AR } from "@/lib/wage-modes";
import { isUuid } from "@/lib/reconciliation review";

export { isUuid };

/**
 * Wage modes (#388) and piece units, as they are stored. Both label maps come from
 * `lib/wage-modes.ts` — the same source the attendance form and the compensation editor read — so a
 * mode can never be labelled one way where it is ENTERED and another way on the frozen report that
 * prices it.
 */
export const PAYROLL_MODE_AR: Readonly<Record<string, string>> = WAGE_MODE_AR;

/** Piece-rate units — the CHECK-constrained set on both people_compensation and payroll_run_lines. */
export const PAYROLL_UNIT_AR: Readonly<Record<string, string>> = WAGE_UNIT_AR;

/** What the frozen `quantity` counts, per mode. A piece line names its own unit instead. */
const PAYROLL_QUANTITY_UNIT_AR: Record<string, string> = {
  hourly: "ساعة",
  daily: "يوم",
  seasonal: "فترة",
};

/** Shown when a stored mode/unit is not one this build knows — never guessed at. */
export const PAYROLL_UNKNOWN_LABEL_AR = "غير معروف";

export function payrollModeLabel(mode: string): string {
  return PAYROLL_MODE_AR[mode] ?? PAYROLL_UNKNOWN_LABEL_AR;
}

/** The unit the line's quantity is measured in: the piece unit, or the mode's own natural unit. */
export function payrollQuantityUnitLabel(mode: string, unit: string | null): string {
  if (mode !== "piece") return PAYROLL_QUANTITY_UNIT_AR[mode] ?? PAYROLL_UNKNOWN_LABEL_AR;
  if (!unit) return PAYROLL_UNKNOWN_LABEL_AR;
  return PAYROLL_UNIT_AR[unit] ?? PAYROLL_UNKNOWN_LABEL_AR;
}
