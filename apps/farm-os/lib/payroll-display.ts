// R4b — the shared Arabic rendering vocabulary for the payroll workspace and the run 360.
//
// One module so the two surfaces can never describe the same run differently. The exact count/decimal
// renderers are pure and new here (mirrors lib/inventory-display.ts); the wage-mode/unit labels are
// re-exported from lib/payroll-report.ts unchanged, so a mode is never labelled one way where it is
// ENTERED (the attendance form, the compensation editor) and another way on a frozen run's report.

import { formatDecimalArabic, type DecimalString } from "./decimal";
import type { ExactCountString } from "./payroll-snapshot-reads";

export { payrollModeLabel, payrollQuantityUnitLabel } from "./payroll-report";

const ARABIC_INTEGER = new Intl.NumberFormat("ar-EG");

/** Render an exact count. Read as a BigInt so a bigint beyond 2^53 still prints every digit. */
export function exactCount(value: ExactCountString): string {
  return ARABIC_INTEGER.format(BigInt(value));
}

export function plainCount(value: number): string {
  return ARABIC_INTEGER.format(value);
}

/** Render a recorded decimal at its own scale — never padded, never rounded away. */
export function decimalText(value: DecimalString): string {
  const scale = value.includes(".") ? value.split(".")[1].length : 0;
  return formatDecimalArabic(value, scale);
}

/** An exact money figure, two decimals — a signed wage figure, never a rounded estimate. */
export function moneyText(value: DecimalString): string {
  return `${formatDecimalArabic(value, 2)} ج.م`;
}
