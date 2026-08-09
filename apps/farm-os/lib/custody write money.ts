import {
  compareDecimals,
  formatDecimalArabic,
  parseDecimal,
  type DecimalString,
} from "@/lib/decimal";

export function normalizeNonNegativeCustodyAmount(value: unknown): DecimalString | null {
  if (typeof value !== "string") return null;
  const amount = parseDecimal(value);
  return amount != null && compareDecimals(amount, "0") >= 0 ? amount : null;
}

export function normalizePositiveCustodyAmount(value: unknown): DecimalString | null {
  if (typeof value !== "string") return null;
  const amount = parseDecimal(value);
  return amount != null && compareDecimals(amount, "0") > 0 ? amount : null;
}

export function isPositiveCustodyAmount(value: unknown): boolean {
  return normalizePositiveCustodyAmount(value) != null;
}

export function custodyAmountEgp(amount: DecimalString): string {
  const fractionDigits = amount.includes(".") ? amount.length - amount.indexOf(".") - 1 : 0;
  return `${formatDecimalArabic(amount, Math.max(2, fractionDigits))} ج.م`;
}
