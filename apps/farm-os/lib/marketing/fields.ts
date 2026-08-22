// SPEC-0032 — shared payload-field configs for MarketingRecordTable, one entry per record type.
// Kept out of the page files so the 5 view pages and any future page can reuse the exact same
// shape without drifting.
import type { MarketingRecordField } from "@/components/marketing/MarketingRecordTable";

export const QUALITY_BATCH_FIELDS: MarketingRecordField[] = [
  { key: "batchRef", label: "مرجع الدفعة", required: true },
  { key: "grade", label: "الدرجة" },
  { key: "moisturePct", label: "نسبة الرطوبة %", type: "number" },
];

export const WEEKLY_AVAILABILITY_FIELDS: MarketingRecordField[] = [
  { key: "week", label: "الأسبوع (تاريخ)", type: "date", required: true },
  { key: "variety", label: "الصنف" },
  { key: "tons", label: "الكمية المتاحة (طن)", type: "number" },
];

export const PRICE_OBSERVATION_FIELDS: MarketingRecordField[] = [
  { key: "commodity", label: "السلعة", required: true },
  { key: "market", label: "السوق", required: true },
  { key: "observedAt", label: "تاريخ الرصد", type: "date" },
  { key: "low", label: "أقل سعر", type: "number" },
  { key: "high", label: "أعلى سعر", type: "number" },
  { key: "note", label: "ملاحظة", type: "textarea" },
];

export const COMPETITOR_FIELDS: MarketingRecordField[] = [
  { key: "region", label: "المنطقة" },
  { key: "strengths", label: "نقاط القوة", type: "textarea" },
  { key: "weaknesses", label: "نقاط الضعف", type: "textarea" },
];

export const LEAD_FIELDS: MarketingRecordField[] = [
  { key: "country", label: "الدولة" },
  { key: "channel", label: "القناة" },
  { key: "buyer", label: "المشتري" },
  { key: "place", label: "وسيلة التواصل" },
  { key: "qty", label: "الكمية" },
  { key: "spec", label: "الاحتياج", type: "textarea" },
  { key: "date", label: "تاريخ الإضافة", type: "date" },
];

export const LEAD_STATUS_OPTIONS = [
  { value: "new", label: "جديد" },
  { value: "contacted", label: "تم التواصل" },
  { value: "qualified", label: "مؤهّل" },
  { value: "won", label: "تم الفوز به" },
  { value: "lost", label: "فُقد" },
];

export const EXW_BID_FIELDS: MarketingRecordField[] = [
  { key: "validUntil", label: "صالح حتى", type: "date" },
  { key: "incoterm", label: "شرط التسليم" },
];

export const BROKER_STATE_FIELDS: MarketingRecordField[] = [
  { key: "region", label: "المنطقة" },
  { key: "commissionPct", label: "نسبة العمولة %", type: "number" },
];

export const BROKER_STATUS_OPTIONS = [
  { value: "active", label: "نشط" },
  { value: "inactive", label: "غير نشط" },
];

export const TASK_FIELDS: MarketingRecordField[] = [{ key: "dueDate", label: "تاريخ الاستحقاق", type: "date" }];

export const TASK_STATUS_OPTIONS = [
  { value: "todo", label: "لم يبدأ" },
  { value: "doing", label: "جارٍ" },
  { value: "done", label: "منتهٍ" },
];

export const PLATFORM_STATE_FIELDS: MarketingRecordField[] = [
  { key: "listingUrl", label: "رابط العرض" },
  { key: "cat", label: "نوع المنصة" },
  { key: "priority", label: "الأولوية" },
  { key: "use", label: "الاستخدام", type: "textarea" },
];

export const PLATFORM_STATUS_OPTIONS = [
  { value: "draft", label: "مسودّة" },
  { value: "live", label: "منشور" },
  { value: "paused", label: "متوقف" },
];

export const CERTIFICATE_FIELDS: MarketingRecordField[] = [
  { key: "issuer", label: "جهة الإصدار" },
  { key: "expiresAt", label: "تاريخ الانتهاء", type: "date" },
  { key: "fixedDate", label: "التاريخ الثابت", type: "date" },
  { key: "note", label: "ملاحظة", type: "textarea" },
];

export const CERTIFICATE_STATUS_OPTIONS = [
  { value: "valid", label: "سارٍ" },
  { value: "expired", label: "منتهٍ" },
];

export const CHANNEL_TARGET_FIELDS: MarketingRecordField[] = [
  { key: "channel", label: "القناة" },
  { key: "period", label: "الفترة" },
];

export const MESSAGE_TEMPLATE_FIELDS: MarketingRecordField[] = [
  { key: "channel", label: "القناة" },
  { key: "body", label: "نص القالب", type: "textarea", required: true },
];

export const FREIGHT_REFERENCE_FIELDS: MarketingRecordField[] = [
  { key: "rate", label: "تكلفة الشحن (دولار/كجم)", type: "number", required: true },
  { key: "market", label: "مرجع السوق", type: "textarea" },
  { key: "checkedAt", label: "تاريخ آخر مراجعة", type: "date" },
];

export const MARKET_REFERENCE_FIELDS: MarketingRecordField[] = [
  { key: "kind", label: "نوع المرجع" },
  { key: "note", label: "ملاحظة", type: "textarea" },
];

export const FARM_MARKETING_FACT_FIELDS: MarketingRecordField[] = [
  { key: "farmAreaFeddan", label: "المساحة (فدان)", type: "number" },
  { key: "sectors", label: "القطاعات", type: "number" },
  { key: "gapGGN", label: "رقم GLOBALG.A.P" },
  { key: "gacc", label: "رقم GACC" },
  { key: "capq2025Tons", label: "طاقة اعتماد ٢٠٢٥ (طن)", type: "number" },
  { key: "latestSizeMm", label: "آخر مقاس (مم)", type: "number" },
  { key: "latestSizeDate", label: "تاريخ القياس", type: "date" },
  { key: "salesTerm", label: "شرط البيع" },
];

export const DAILY_SALES_REPORT_FIELDS: MarketingRecordField[] = [
  { key: "date", label: "التاريخ", type: "date", required: true },
  { key: "contacts", label: "جهات تم التواصل معها", type: "number" },
  { key: "replies", label: "الردود", type: "number" },
  { key: "qualified", label: "فرص مؤهلة", type: "number" },
  { key: "offers", label: "عروض أُرسلت", type: "number" },
  { key: "notes", label: "قرار اليوم وملاحظاته", type: "textarea" },
];

export const REPEAT_CUSTOMER_FIELDS: MarketingRecordField[] = [
  { key: "market", label: "السوق" },
  { key: "lastOrderAt", label: "تاريخ آخر طلب", type: "date" },
  { key: "orderCount", label: "عدد الطلبات", type: "number" },
  { key: "notes", label: "ملاحظات", type: "textarea" },
];
