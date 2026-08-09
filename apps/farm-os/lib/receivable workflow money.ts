import {
  compareDecimals,
  formatDecimalArabic,
  multiplyDecimals,
  parseDecimal,
  roundDecimal,
  subtractDecimals,
  sumDecimals,
  type DecimalString,
} from "@/lib/decimal";

export interface PendingSalePricing {
  id: string;
  saleDate: string | null;
  crop: string;
  qty: DecimalString;
  unit: string;
  buyerName: string;
  deliveryNoteNo: number | null;
}

export interface OpenSaleReceivable {
  id: string;
  saleDate: string | null;
  crop: string;
  buyerName: string;
  total: DecimalString;
  collected: DecimalString;
  remaining: DecimalString;
}

function objectRows(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${label} response is not an array`);
  return value.map((row, index) => {
    if (row == null || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`${label} row ${index + 1} is invalid`);
    }
    return row as Record<string, unknown>;
  });
}

function text(row: Record<string, unknown>, key: string, label: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} ${key} is invalid`);
  }
  return value;
}

function nullableDate(row: Record<string, unknown>, key: string, label: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} ${key} is invalid`);
  }
  return value;
}

function exactDecimal(row: Record<string, unknown>, key: string, label: string): DecimalString {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`${label} ${key} is not exact text`);
  const decimal = parseDecimal(value);
  if (decimal == null) throw new Error(`${label} ${key} is invalid`);
  return decimal;
}

export function normalizePositiveReceivableAmount(value: unknown): DecimalString | null {
  if (typeof value !== "string") return null;
  const decimal = parseDecimal(value);
  return decimal != null && compareDecimals(decimal, "0") > 0 ? decimal : null;
}

export function parsePendingSalePricing(value: unknown): PendingSalePricing[] {
  return objectRows(value, "pending sale pricing").map((row, index) => {
    const label = `pending sale pricing row ${index + 1}`;
    const noteNo = row.delivery_note_no;
    if (noteNo !== null && (!Number.isSafeInteger(noteNo) || Number(noteNo) <= 0)) {
      throw new Error(`${label} delivery_note_no is invalid`);
    }
    return {
      id: text(row, "id", label),
      saleDate: nullableDate(row, "sale_date", label),
      crop: text(row, "crop", label),
      qty: exactDecimal(row, "qty", label),
      unit: typeof row.unit === "string" ? row.unit : "",
      buyerName: text(row, "buyer_name", label),
      deliveryNoteNo: noteNo as number | null,
    };
  });
}

export function parseOpenSaleReceivables(value: unknown): OpenSaleReceivable[] {
  return objectRows(value, "open receivables").map((row, index) => {
    const label = `open receivables row ${index + 1}`;
    const total = exactDecimal(row, "total", label);
    const collected = exactDecimal(row, "collected", label);
    const remaining = exactDecimal(row, "remaining", label);
    if (compareDecimals(total, "0") < 0 || compareDecimals(collected, "0") < 0) {
      throw new Error(`${label} contains a negative balance`);
    }
    if (compareDecimals(remaining, "0") <= 0 || subtractDecimals(total, collected) !== remaining) {
      throw new Error(`${label} balance does not reconcile`);
    }
    return {
      id: text(row, "id", label),
      saleDate: nullableDate(row, "sale_date", label),
      crop: text(row, "crop", label),
      buyerName: text(row, "buyer_name", label),
      total,
      collected,
      remaining,
    };
  });
}

export function saleTotal(qty: DecimalString, unitPrice: DecimalString): DecimalString | null {
  try {
    const total = roundDecimal(multiplyDecimals(qty, unitPrice), 2);
    return compareDecimals(total, "0") > 0 ? total : null;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export function addReceivableAmounts(values: DecimalString[]): DecimalString {
  return sumDecimals(values).total;
}

export function remainingReceivable(total: DecimalString, collected: DecimalString): DecimalString {
  return subtractDecimals(total, collected);
}

export function receivableAmountEgp(amount: DecimalString): string {
  const fractionDigits = amount.includes(".") ? amount.length - amount.indexOf(".") - 1 : 0;
  return `${formatDecimalArabic(amount, Math.max(2, fractionDigits))} ج.م`;
}

export function receivableQuantity(value: DecimalString): string {
  const fractionDigits = value.includes(".") ? value.length - value.indexOf(".") - 1 : 0;
  return formatDecimalArabic(value, fractionDigits);
}
