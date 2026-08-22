import type { Json, MarketingRecordType } from "@/lib/database.types.ext";

/**
 * Pure, server-safe validation for MarketingRecordInput — no I/O, so it can run before the RPC
 * (fail closed) and be unit-tested directly. Required payload keys per record type mirror the
 * `required: true` field configs in `lib/marketing/fields.ts` — keep both in sync.
 */

const REQUIRED_PAYLOAD_KEYS: Partial<Record<MarketingRecordType, readonly string[]>> = {
  quality_batch: ["batchRef"],
  weekly_availability: ["week"],
  price_observation: ["commodity", "market"],
  message_template: ["body"],
  freight_reference: ["rate"],
  daily_sales_report: ["date"],
};

const PAYLOAD_LABELS: Record<string, string> = {
  batchRef: "مرجع الدفعة",
  week: "الأسبوع",
  commodity: "السلعة",
  market: "السوق",
  body: "نص القالب",
  rate: "تكلفة الشحن",
  date: "التاريخ",
};

export interface MarketingRecordValidationInput {
  title: string;
  payload: Json;
  amount?: number | null;
}

export interface MarketingRecordValidationResult {
  ok: boolean;
  error?: string;
}

function isPlainObject(value: Json): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateMarketingRecordInput(
  recordType: MarketingRecordType,
  input: MarketingRecordValidationInput,
): MarketingRecordValidationResult {
  if (typeof input.title !== "string" || input.title.trim() === "") {
    return { ok: false, error: "العنوان مطلوب." };
  }

  if (input.amount != null && !Number.isFinite(input.amount)) {
    return { ok: false, error: "القيمة يجب أن تكون رقمًا صحيحًا." };
  }

  if (!isPlainObject(input.payload)) {
    return { ok: false, error: "بيانات السجل غير صالحة." };
  }

  for (const [key, value] of Object.entries(input.payload)) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      return { ok: false, error: `القيمة الرقمية لحقل "${key}" غير صالحة.` };
    }
  }

  const requiredKeys = REQUIRED_PAYLOAD_KEYS[recordType] ?? [];
  for (const key of requiredKeys) {
    const value = input.payload[key];
    if (value == null || (typeof value === "string" && value.trim() === "")) {
      return { ok: false, error: `حقل ${PAYLOAD_LABELS[key] ?? key} مطلوب.` };
    }
  }

  return { ok: true };
}
