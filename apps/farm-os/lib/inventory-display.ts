// SPEC-0033 R4a — the shared Arabic rendering vocabulary for the inventory list and the item 360.
//
// One module so the two surfaces can never describe the same stock differently. Everything here is
// pure: exact count/decimal text in, Arabic-Indic display text out, no rounding into existence and
// no zero standing in for an unknown.

import type { PillStatus } from "@amrebeid/ui";
import { formatDecimalArabic, type DecimalString } from "./decimal";
import type {
  ExactCountString,
  ExactIntegerString,
  InventoryStockState,
  ThresholdSource,
} from "./inventory-snapshot-reads";

/** One Arabic-Indic integer formatter for both surfaces (docs/CLAUDE.md #2 — no Western digits). */
const ARABIC_INTEGER = new Intl.NumberFormat("ar-EG");

/** Render an exact count. Read as a BigInt so a bigint beyond 2^53 still prints every digit. */
export function exactCount(value: ExactCountString): string {
  return ARABIC_INTEGER.format(BigInt(value));
}

export function plainCount(value: number): string {
  return ARABIC_INTEGER.format(value);
}

/** Render an exact recorded whole number that may be negative (a recorded lead time). */
export function exactInteger(value: ExactIntegerString): string {
  return ARABIC_INTEGER.format(BigInt(value));
}

/** Render a recorded decimal at its own scale — never padded, never rounded away. */
export function decimalText(value: DecimalString): string {
  const scale = value.includes(".") ? value.split(".")[1].length : 0;
  return formatDecimalArabic(value, scale);
}

/** A quantity with its unit. `null` is unknown and renders as «غير معروف», never «٠». */
export function quantity(value: DecimalString | null, unit: string | null): string {
  if (value === null) return "غير معروف";
  return unit ? `${decimalText(value)} ${unit}` : decimalText(value);
}

/**
 * A recorded POLICY quantity. Absent means nobody recorded it — «غير مسجل», which is a different
 * fact from «غير معروف» (the balance exists somewhere but this snapshot has none) and from «٠».
 */
export function recordedQuantity(value: DecimalString | null, unit: string | null): string {
  return value === null ? "غير مسجل" : quantity(value, unit);
}

/** A recorded lead time in whole days, or an honest absence. Never «٠ يوم». */
export function daysLabel(value: ExactIntegerString | null): string {
  return value === null ? "غير مسجلة" : `${exactInteger(value)} يوم`;
}

/** An exact money figure at two decimals. `null` is unknown cost, never a zero. */
export function moneyText(value: DecimalString | null): string {
  return value === null ? "غير معروف" : `${formatDecimalArabic(value, 2)} ج.م`;
}

/**
 * The four stock states in plain store Arabic. Each label carries its own meaning, because a pill
 * colour alone is not information (and two states here share the neutral tone on purpose: an absence
 * is neither a warning nor an all-clear).
 */
export const STOCK_STATE_LABEL: Record<InventoryStockState, string> = {
  below_reorder: "تحت حد إعادة الطلب",
  unknown: "بلا رصيد مسجل",
  no_threshold: "بلا حد مسجل",
  ok: "فوق حد إعادة الطلب",
};

export const STOCK_STATE_PILL: Record<InventoryStockState, PillStatus> = {
  below_reorder: "warning",
  unknown: "draft",
  no_threshold: "draft",
  ok: "active",
};

/** The one sentence that explains what each state actually means for the person reading it. */
export const STOCK_STATE_NOTE: Record<InventoryStockState, string> = {
  below_reorder: "المتاح من كل المخازن أقل من الحد المسجل. هذه قراءة لحظية، وليست توقّع النقص القادم.",
  unknown: "لم يُسجَّل لهذا الصنف رصيد في أي مخزن. هذه ليست حالة «لا يوجد مخزون».",
  no_threshold: "لا يوجد حد إعادة طلب مسجل موجب، فلا شيء يُقاس عليه الرصيد.",
  ok: "المتاح من كل المخازن يساوي الحد المسجل أو يزيد عليه، في هذه اللحظة.",
};

export const THRESHOLD_SOURCE_LABEL: Record<ThresholdSource, string> = {
  reorder_point: "نقطة إعادة الطلب",
  min_stock: "الحد الأدنى",
};

/** «حد إعادة الطلب المسجل ١٠ كجم (نقطة إعادة الطلب)», or an honest absence. */
export function thresholdLabel(
  threshold: DecimalString | null,
  source: ThresholdSource | null,
  unit: string | null,
): string {
  if (threshold === null || source === null) return "لا يوجد حد مسجل";
  return `${THRESHOLD_SOURCE_LABEL[source]} المسجلة ${quantity(threshold, unit)}`;
}

/** «من ٣ مخازن» — the number of physical locations behind an aggregate, so it never reads as one bin. */
export function binCountLabel(binCount: ExactCountString): string {
  if (binCount === "0") return "بلا مخزن مسجل";
  return binCount === "1" ? "من مخزن واحد" : `من ${exactCount(binCount)} مخازن`;
}
