// SPEC-0032 — Marketing full-source fidelity manifest (the machine-checked oracle).
//
// This file is the SINGLE source of truth for "what the legacy 2026 marketing HTML contained and
// where each piece now lives in the Farm OS database". Everything else in the module (the 25-area
// workspace routes, the nav, the section renderers, the coverage ledger) is derived from it, so a
// source area, control, register, template or mutable state key cannot be dropped silently — the
// tests in `fidelity-manifest.test.ts` fail when a mapping goes missing.
//
// Hard rules held here:
// - No raw legacy HTML is shipped. Static source content is represented as reviewed structured data
//   (titles, purposes, register shapes) — never as markup and never as invented farm/financial data.
// - The 1,571-contact dataset is NEVER inlined here. Contacts load through the authenticated,
//   active-org-scoped `fn_marketing_contacts_page` RPC with server pagination.
// - The disputed approximate palm count is recorded as an explicit exclusion (CLAUDE.md #5).
// - The legacy Apps Script auto-send is mapped to a draft/queue/open-compose surface that never
//   transmits (`outbox` sections), not to any outbound integration.

import type { FullMarketingRecordType } from "./source-pack";
import { MARKETING_SOURCE_AREAS, type MarketingRoute } from "./source-areas";

export type MarketingContactCategory =
  | "exporter"
  | "buyer_lead"
  | "kuwait_distributor"
  | "platform"
  | "freight"
  | "other";

/* ------------------------------------------------------------------ *
 * 1. The 25 source tabs — exact IDs, order and labels.
 * ------------------------------------------------------------------ */

/** Source tab IDs in the exact order the legacy workspace rendered them. */
export const MARKETING_SOURCE_TAB_ORDER = MARKETING_SOURCE_AREAS.map((area) => area.sourceId);

export type MarketingSourceTabId = (typeof MARKETING_SOURCE_AREAS)[number]["sourceId"];

/* ------------------------------------------------------------------ *
 * 2. The 20 reusable copy templates.
 * ------------------------------------------------------------------ */

export interface MarketingTemplateSpec {
  /** The legacy `<textarea id="...">`; also the `payload.templateId` of the saved record. */
  id: string;
  label: string;
  language: "ar" | "en";
  channel: "email" | "whatsapp" | "linkedin" | "listing" | "profile";
  purpose: string;
  /** The source tab that owned this textarea. */
  area: MarketingSourceTabId;
}

export const MARKETING_TEMPLATES = [
  { id: "offshootAdAr", label: "إعلان فسائل - عربي", language: "ar", channel: "listing", purpose: "عرض بيع فسائل البرحي في الأسواق المحلية", area: "offshoots" },
  { id: "offshootAdEn", label: "إعلان فسائل - إنجليزي", language: "en", channel: "listing", purpose: "عرض بيع الفسائل للمشترين خارج مصر", area: "offshoots" },
  { id: "offshootWhats", label: "رسالة واتساب للفسائل", language: "ar", channel: "whatsapp", purpose: "رد سريع على استفسار فسائل عبر واتساب", area: "offshoots" },
  { id: "localAdAr", label: "إعلان البيع المحلي", language: "ar", channel: "listing", purpose: "عرض البيع المحلي للمستهلك وتجار الجملة", area: "local" },
  { id: "kuwaitMsgAr", label: "رسالة الكويت - عربي", language: "ar", channel: "whatsapp", purpose: "أول تواصل مع موزّع كويتي", area: "kuwait" },
  { id: "kuwaitMsgEn", label: "رسالة الكويت - إنجليزي", language: "en", channel: "email", purpose: "أول تواصل بالإنجليزية مع موزّع أو مستورد", area: "kuwait" },
  { id: "exwQuote", label: "عرض EXW", language: "ar", channel: "email", purpose: "عرض سعر تسليم أرض المزرعة", area: "exw" },
  { id: "linkedinAbout", label: "نبذة LinkedIn", language: "en", channel: "profile", purpose: "نبذة صفحة الشركة على LinkedIn", area: "linkedin" },
  { id: "liConnect", label: "طلب اتصال LinkedIn", language: "en", channel: "linkedin", purpose: "طلب إضافة مشترٍ محتمل", area: "linkedin" },
  { id: "liAfter", label: "رسالة بعد قبول LinkedIn", language: "en", channel: "linkedin", purpose: "أول رسالة بعد قبول طلب الاتصال", area: "linkedin" },
  { id: "liFollow", label: "متابعة LinkedIn", language: "en", channel: "linkedin", purpose: "تذكير متابعة بعد صمت المشتري", area: "linkedin" },
  { id: "liPost", label: "منشور LinkedIn", language: "en", channel: "linkedin", purpose: "منشور عام عن الموسم والتوافر", area: "linkedin" },
  { id: "farmPageDesc", label: "وصف صفحة المزرعة", language: "ar", channel: "profile", purpose: "وصف موحّد للمزرعة يُعاد استخدامه في كل منصة", area: "materials" },
  { id: "exporterLetterBody", label: "خطاب المصدرين", language: "ar", channel: "email", purpose: "الخطاب الكامل الموجّه لشركات التصدير", area: "exportletter" },
  { id: "exporterShortMsg", label: "رسالة قصيرة للمصدر", language: "ar", channel: "whatsapp", purpose: "نسخة مختصرة من خطاب المصدرين", area: "exportletter" },
  { id: "brokerMsg", label: "رسالة وسيط التصدير", language: "ar", channel: "whatsapp", purpose: "عرض تعاون على وسيط تصدير", area: "brokers" },
  { id: "mailTemplate", label: "قالب البريد", language: "ar", channel: "email", purpose: "قالب البريد المستخدم في الحملة اليومية", area: "gmail" },
  { id: "platformAdTitle", label: "عنوان إعلان المنصة", language: "ar", channel: "listing", purpose: "عنوان العرض على منصات B2B", area: "platforms" },
  { id: "platformAdText", label: "نص إعلان المنصة", language: "ar", channel: "listing", purpose: "نص العرض الكامل على منصات B2B", area: "platforms" },
  { id: "dsrWhatsappText", label: "ملخص التقرير اليومي لواتساب", language: "ar", channel: "whatsapp", purpose: "ملخص يومي يُرسل يدويًا للمالك", area: "dailyreport" },
] as const satisfies readonly MarketingTemplateSpec[];

/* ------------------------------------------------------------------ *
 * 3. The 31 mutable source state keys → typed database records.
 * ------------------------------------------------------------------ */

export type MarketingStatePersistence =
  | { kind: "record"; recordType: FullMarketingRecordType; payloadKind?: string; note: string }
  | { kind: "contact"; category: MarketingContactCategory; note: string }
  | { kind: "contact_field"; field: "selected" | "notes" | "metadata"; note: string }
  | { kind: "contact_activity"; activityKind: "call" | "email" | "meeting" | "note" | "followup"; note: string }
  | { kind: "mapped_elsewhere"; destination: string; reason: string }
  | { kind: "excluded"; reason: string };

export interface MarketingStateKeySpec {
  /** The legacy localStorage key read by the source `load(key, default)` calls. */
  key: string;
  /** Whether the source stored an array of rows or a keyed map. */
  shape: "array" | "map" | "scalar";
  /** The source tab that owned the register. */
  area: MarketingSourceTabId;
  persistence: MarketingStatePersistence;
}

/**
 * All 31 mutable registers the source could write. Every entry MUST resolve to a Farm OS
 * database target, an authoritative module elsewhere, or a documented exclusion — never "unmapped".
 */
export const MARKETING_STATE_KEYS = [
  { key: "ep_prices", shape: "array", area: "prices", persistence: { kind: "record", recordType: "price_observation", note: "كل رصد سعر يصبح سجل price_observation بتاريخ ومصدر وثقة" } },
  { key: "ebeid_social_price_sightings_v1", shape: "array", area: "socialprices", persistence: { kind: "record", recordType: "price_observation", payloadKind: "social_sighting", note: "رصد أسعار السوشيال يُخزَّن كـ price_observation مع payload.kind=social_sighting" } },
  { key: "ep_tasks", shape: "array", area: "campaign", persistence: { kind: "record", recordType: "task", payloadKind: "daily_campaign", note: "قائمة الحملة اليومية تصبح سجلات task في مجموعة daily_campaign" } },
  { key: "ep_platform_tasks", shape: "array", area: "platforms", persistence: { kind: "record", recordType: "task", payloadKind: "platform_readiness", note: "قائمة جاهزية المنصات تصبح سجلات task في مجموعة platform_readiness" } },
  { key: "ep_bids", shape: "array", area: "exw", persistence: { kind: "record", recordType: "exw_bid", note: "عروض EXW الواردة تُسجَّل كـ exw_bid (استخبارات سوق وليست إيرادًا محاسبيًا)" } },
  { key: "ep_exw", shape: "map", area: "exw", persistence: { kind: "record", recordType: "market_reference", payloadKind: "exw_settings", note: "إعدادات عرض EXW (المقاس، الحد الأدنى، شرط الدفع) كمرجع سوق قابل للتعديل" } },
  { key: "ep_sales_floor", shape: "map", area: "exw", persistence: { kind: "record", recordType: "market_reference", payloadKind: "sales_floor", note: "الحد الأدنى للسعر المقبول — مرجع تفاوضي وليس سعر بيع محاسبي" } },
  { key: "ep_broker_tracking", shape: "map", area: "brokers", persistence: { kind: "record", recordType: "broker_state", note: "حالة كل وسيط تصدير ونسبة عمولته" } },
  { key: "ep_certs", shape: "map", area: "quality", persistence: { kind: "record", recordType: "certificate", note: "حالة كل شهادة وتاريخ انتهائها؛ التعريفات الأربعة تُزرع بحالة unverified" } },
  { key: "ep_qc_log", shape: "array", area: "quality", persistence: { kind: "record", recordType: "quality_batch", note: "سجل مراقبة الجودة يصبح quality_batch لكل دفعة" } },
  { key: "ep_comps", shape: "array", area: "competitors", persistence: { kind: "record", recordType: "competitor", note: "ملاحظات المنافسين تصبح سجلات competitor" } },
  { key: "ep_crm", shape: "map", area: "crm", persistence: { kind: "contact", category: "exporter", note: "حالة شركات المتابعة محفوظة كخريطة مفهرسة وتُربط بجهات اتصال exporter" } },
  { key: "ep_crm_meta", shape: "map", area: "crm", persistence: { kind: "contact_field", field: "metadata", note: "بيانات المتابعة الإضافية (الأولوية، المحافظة، المنتجات) تُحفظ في marketing_contact.metadata" } },
  { key: "ep_hot_leads", shape: "array", area: "crm", persistence: { kind: "record", recordType: "hot_lead", note: "الفرص الساخنة تصبح سجلات hot_lead مرتبطة بجهة اتصال" } },
  { key: "ep_lileads", shape: "array", area: "linkedin", persistence: { kind: "record", recordType: "lead_linkedin", note: "فرص LinkedIn تصبح سجلات lead_linkedin" } },
  { key: "ep_li", shape: "map", area: "linkedin", persistence: { kind: "record", recordType: "platform_state", payloadKind: "linkedin_profile", note: "روابط وحالة صفحة LinkedIn/المزرعة تصبح platform_state" } },
  { key: "ep_local_leads", shape: "array", area: "local", persistence: { kind: "record", recordType: "lead_local", note: "فرص البيع المحلي تصبح سجلات lead_local" } },
  { key: "ep_repeat_customers", shape: "array", area: "local", persistence: { kind: "record", recordType: "repeat_customer", note: "العملاء المتكررون كسجل تسويقي — لا يكرر مبيعات المحاسبة" } },
  { key: "ep_offshoot_leads", shape: "array", area: "offshoots", persistence: { kind: "record", recordType: "lead_offshoot", note: "فرص بيع الفسائل تصبح سجلات lead_offshoot" } },
  { key: "ep_weekly_availability", shape: "array", area: "farm", persistence: { kind: "record", recordType: "weekly_availability", note: "التوافر الأسبوعي المعروض على المشتري — ليس مخزونًا authoritative" } },
  { key: "ep_platform_state", shape: "map", area: "platforms", persistence: { kind: "record", recordType: "platform_state", note: "حالة كل منصة B2B (مسودّة/منشور/متوقف) ورابط العرض" } },
  { key: "ep_finance", shape: "map", area: "reports", persistence: { kind: "record", recordType: "channel_target", note: "أهداف القنوات التسويقية فقط؛ الأرقام المحاسبية تبقى في وحدة المحاسبة" } },
  { key: "ep_kuwait_dist_status", shape: "map", area: "kuwait", persistence: { kind: "contact_field", field: "metadata", note: "حالة كل موزّع كويتي تُحفظ في metadata.status لجهة الاتصال" } },
  { key: "ep_kuwait_dist_notes", shape: "map", area: "kuwait", persistence: { kind: "contact_field", field: "notes", note: "ملاحظات الموزّع الكويتي تُحفظ في marketing_contact.notes" } },
  { key: "ep_csel", shape: "array", area: "contact", persistence: { kind: "contact_field", field: "selected", note: "الجهات المختارة لحملة اليوم تُحفظ في marketing_contact.selected" } },
  { key: "ep_cstat", shape: "map", area: "contact", persistence: { kind: "contact_field", field: "metadata", note: "حالة التواصل لكل جهة في الدليل تُحفظ في metadata.status" } },
  { key: "ep_csent", shape: "array", area: "gmail", persistence: { kind: "contact_activity", activityKind: "email", note: "قائمة الجهات التي فُتحت لها مسودّة تصبح نشاطًا مضافًا فقط بعد الفتح اليدوي — لا إرسال آلي" } },
  { key: "ep_gmail", shape: "map", area: "gmail", persistence: { kind: "record", recordType: "market_reference", payloadKind: "compose_settings", note: "إعدادات صياغة الرسالة (الموضوع، القالب المستخدم) — بديل آمن لسكربت الإرسال القديم" } },
  { key: "ep_daily_sales_reports", shape: "array", area: "dailyreport", persistence: { kind: "record", recordType: "daily_sales_report", note: "التقرير اليومي يصبح daily_sales_report قابلًا للتحرير والطباعة" } },
  { key: "ep_owner_whatsapp", shape: "scalar", area: "contact", persistence: { kind: "mapped_elsewhere", destination: "/website", reason: "رقم واتساب المالك إعداد موقع عام وليس جهة اتصال CRM" } },
  { key: "ep_harvest_log", shape: "array", area: "farm", persistence: { kind: "mapped_elsewhere", destination: "/harvest", reason: "الحصاد سجل تشغيلي authoritative ولا يُكرَّر داخل التسويق" } },
] as const satisfies readonly MarketingStateKeySpec[];

/** Source content deliberately NOT imported, with the reason. */
export const MARKETING_SOURCE_EXCLUSIONS = [
  {
    source: "FARM_FACTS.palmsApprox",
    reason: "عدد النخيل متنازع عليه (CLAUDE.md بند ٥) — لا يُستورد ولا يُعرض حتى اعتماد سجل وحدات مصحّح",
  },
  {
    source: "CONTACTS[].raw_html",
    reason: "لا يُنشر أي HTML خام من الملف المصدر؛ المحتوى الثابت يُمثَّل كبيانات مراجَعة فقط",
  },
] as const;

/* ------------------------------------------------------------------ *
 * 4. The nine static source datasets.
 * ------------------------------------------------------------------ */

export interface MarketingDatasetSpec {
  name: string;
  rows: number;
  area: MarketingSourceTabId;
  destination:
    | { kind: "contact"; category: MarketingContactCategory }
    | { kind: "record"; recordType: FullMarketingRecordType }
    | { kind: "excluded"; reason: string };
  note: string;
}

export const MARKETING_SOURCE_DATASETS = [
  { name: "FARM_FACTS", rows: 1, area: "farm", destination: { kind: "record", recordType: "market_reference" }, note: "حقائق المزرعة المعتمدة فقط؛ palmsApprox مستبعد" },
  { name: "EXPORTERS", rows: 75, area: "crm", destination: { kind: "contact", category: "exporter" }, note: "قائمة المصدّرين المنسّقة، مدمجة بلا تكرار مع الدليل" },
  { name: "CONTACTS", rows: 1513, area: "contact", destination: { kind: "contact", category: "buyer_lead" }, note: "دليل بوابة التصدير — يُحمَّل عبر ترقيم صفحات من الخادم فقط" },
  { name: "KUWAIT_DISTRIBUTORS", rows: 14, area: "kuwait", destination: { kind: "contact", category: "kuwait_distributor" }, note: "سجل موزّعي الكويت مع الحالة والملاحظة والمتابعة" },
  { name: "B2B_PLATFORMS", rows: 28, area: "platforms", destination: { kind: "record", recordType: "platform_state" }, note: "سجل منصات B2B وحالة الجاهزية لكل منصة" },
  { name: "CERT_DEFS", rows: 4, area: "quality", destination: { kind: "record", recordType: "certificate" }, note: "تعريفات الشهادات تُزرع بحالة unverified بلا ادّعاء سريان" },
  { name: "FIN_CHANNELS", rows: 5, area: "reports", destination: { kind: "record", recordType: "channel_target" }, note: "قنوات التمويل/الإيراد كأهداف تسويقية فقط" },
  { name: "FREIGHT_RATES", rows: 12, area: "shipping", destination: { kind: "record", recordType: "freight_reference" }, note: "مراجع شحن مع تاريخ مراجعة — تُستخدم للتقدير لا للتسعير النهائي" },
  { name: "PRICE_TYPES", rows: 7, area: "prices", destination: { kind: "record", recordType: "market_reference" }, note: "أنواع الأسعار المستخدمة في وسم كل رصد" },
] as const satisfies readonly MarketingDatasetSpec[];

/* ------------------------------------------------------------------ *
 * 5. Area blueprints — every section, control and affordance per tab.
 * ------------------------------------------------------------------ */

export type MarketingSectionKind =
  | "kpi"
  | "records"
  | "contacts"
  | "templates"
  | "checklist"
  | "calculator"
  | "outbox"
  | "reference"
  | "guide"
  | "import";

export type MarketingCalculatorId = "exw-net" | "landed-cost" | "campaign-funnel" | "availability-mix";

export interface MarketingSectionBlueprint {
  /** Anchor id inside the area page. Unique across the whole manifest. */
  id: string;
  title: string;
  description: string;
  kind: MarketingSectionKind;
  /** Editable record register rendered by MarketingRecordTable. */
  recordType?: FullMarketingRecordType;
  /** Only rows whose `payload.kind`/`payload.group` matches are shown here. */
  payloadKind?: string;
  contactCategory?: MarketingContactCategory;
  templateIds?: readonly string[];
  calculatorId?: MarketingCalculatorId;
  /** Legacy state keys this section is responsible for. */
  stateKeys: readonly string[];
  /** Static source datasets surfaced by this section. */
  datasets?: readonly string[];
  /** Reviewed structured content — never raw source markup. */
  points?: readonly string[];
  affordances: readonly ("copy" | "print" | "export" | "filter" | "paginate")[];
}

export interface MarketingAreaBlueprint {
  sourceId: MarketingSourceTabId;
  label: string;
  /** Legacy tab order, 1-based. */
  order: number;
  /** The compact route this area is also reachable from (kept for backward links). */
  compactRoute: MarketingRoute;
  summary: string;
  sections: readonly MarketingSectionBlueprint[];
}

const AREA_ROUTE = new Map(MARKETING_SOURCE_AREAS.map((area) => [area.sourceId, area.route] as const));
const AREA_LABEL = new Map(MARKETING_SOURCE_AREAS.map((area) => [area.sourceId, area.label] as const));

function area(
  sourceId: MarketingSourceTabId,
  summary: string,
  sections: readonly MarketingSectionBlueprint[],
): MarketingAreaBlueprint {
  const compactRoute = AREA_ROUTE.get(sourceId);
  const label = AREA_LABEL.get(sourceId);
  if (!compactRoute || !label) throw new Error(`Unknown Marketing source area: ${sourceId}`);
  return {
    sourceId,
    label,
    order: MARKETING_SOURCE_TAB_ORDER.indexOf(sourceId) + 1,
    compactRoute,
    summary,
    sections,
  };
}

function templatesOf(areaId: MarketingSourceTabId): readonly string[] {
  return MARKETING_TEMPLATES.filter((template) => template.area === areaId).map((template) => template.id);
}

export const MARKETING_AREA_BLUEPRINTS: readonly MarketingAreaBlueprint[] = [
  area("dashboard", "المؤشرات التي تفتح بها اليوم: ما هو متأخر، وما هي الخطوة التالية.", [
    {
      id: "kpis", title: "مؤشرات التسويق", kind: "kpi",
      description: "جهات نشطة، فرص، إشارات سوق، ومتابعات مستحقة — محسوبة من قاعدة البيانات لحظيًا.",
      stateKeys: [], affordances: ["print"],
    },
    {
      id: "story", title: "قصة اليوم", kind: "guide",
      description: "ترتيب العمل من المنتج إلى السوق إلى العميل ثم المتابعة.",
      points: [
        "ابدأ بجاهزية المنتج: الجودة والتوافر الأسبوعي.",
        "راجع إشارات السوق: الأسعار، الشحن، المنافسون.",
        "اختر جهات اليوم من الدليل، ثم افتح المسودّات يدويًا.",
        "أقفل اليوم بتقرير يومي يسجّل ما حدث فعلًا.",
      ],
      stateKeys: [], affordances: ["print"],
    },
  ]),

  area("farm", "بطاقة تعريف المزرعة التي تُعاد كتابتها في كل عرض، والتوافر الأسبوعي المعلن للمشتري.", [
    {
      id: "farm-facts", title: "حقائق المزرعة المعتمدة", kind: "reference",
      description: "المساحة والقطاعات وأرقام الاعتمادات المستخدمة في العروض. تُحرَّر هنا مرة وتُستخدم في كل قالب.",
      recordType: "market_reference", payloadKind: "farm_fact",
      datasets: ["FARM_FACTS"], stateKeys: [], affordances: ["copy", "print", "export", "filter"],
    },
    {
      id: "weekly-availability", title: "التوافر الأسبوعي", kind: "records",
      description: "الكمية المعروضة للمشتري كل أسبوع. رقم تسويقي معلن، وليس رصيد مخزون معتمدًا.",
      recordType: "weekly_availability",
      stateKeys: ["ep_weekly_availability"], affordances: ["export", "filter", "print"],
    },
    {
      id: "availability-mix", title: "حاسبة مزيج التوافر", kind: "calculator",
      description: "احسب الكمية القابلة للتعاقد بعد نسبة الفاقد ونصيب السوق المحلي.",
      calculatorId: "availability-mix", stateKeys: [], affordances: ["copy"],
    },
    {
      id: "harvest-link", title: "سجل الحصاد", kind: "guide",
      description: "الحصاد سجل تشغيلي authoritative في وحدة الحصاد ولا يُكرَّر هنا.",
      points: ["افتح /harvest لتسجيل الحصاد الفعلي.", "التسويق يقرأ التوافر المعلن فقط، لا أرقام الحصاد."],
      stateKeys: ["ep_harvest_log"], affordances: [],
    },
  ]),

  area("offshoots", "خط بيع فسائل البرحي: الفرص، القوالب، وحالة كل مشترٍ.", [
    {
      id: "offshoot-leads", title: "فرص الفسائل", kind: "records",
      description: "كل مشترٍ محتمل للفسائل مع الكمية والعرض والمرحلة.",
      recordType: "lead_offshoot",
      stateKeys: ["ep_offshoot_leads"], affordances: ["export", "filter", "print"],
    },
    {
      id: "offshoot-templates", title: "قوالب إعلان الفسائل", kind: "templates",
      description: "النصوص الجاهزة للإعلان العربي والإنجليزي ورسالة الواتساب.",
      templateIds: templatesOf("offshoots"), stateKeys: [], affordances: ["copy", "print", "export"],
    },
  ]),

  area("prices", "رصد الأسعار اليومي بأنواعه السبعة، ومقارنة النطاقات.", [
    {
      id: "price-types", title: "أنواع الأسعار", kind: "reference",
      description: "التصنيفات السبعة التي يُوسم بها كل رصد سعر.",
      recordType: "market_reference", payloadKind: "price_type",
      datasets: ["PRICE_TYPES"], stateKeys: [], affordances: ["export", "filter"],
    },
    {
      id: "price-log", title: "سجل الأسعار", kind: "records",
      description: "كل رصد سعر بتاريخه ونطاقه ومصدره. استخبارات سوق — ليست إيرادًا محاسبيًا.",
      recordType: "price_observation",
      stateKeys: ["ep_prices"], affordances: ["export", "filter", "print"],
    },
  ]),

  area("markets", "الأسواق المستهدفة ومتطلبات الدخول لكل سوق.", [
    {
      id: "market-references", title: "مراجع الأسواق", kind: "reference",
      description: "ملاحظات الدخول والمواصفة المطلوبة لكل سوق تصدير.",
      recordType: "market_reference", payloadKind: "market_note",
      stateKeys: [], affordances: ["export", "filter", "print"],
    },
    {
      id: "market-guide", title: "ما يجب التأكد منه قبل أي سوق", kind: "guide",
      description: "قائمة تحقق ثابتة قبل فتح مفاوضات في سوق جديد.",
      points: [
        "متطلبات الشهادات وقبول جهة الاستيراد.",
        "المقاس والتعبئة المطلوبان في هذا السوق.",
        "مدة الشحن وسلسلة التبريد الممكنة.",
        "شرط الدفع المقبول وحدود المخاطرة.",
      ],
      stateKeys: [], affordances: ["print"],
    },
  ]),

  area("local", "البيع المحلي المباشر والعملاء المتكررون.", [
    {
      id: "local-leads", title: "فرص البيع المحلي", kind: "records",
      description: "المشترون المحليون وتجار الجملة والمرحلة الحالية لكل منهم.",
      recordType: "lead_local",
      stateKeys: ["ep_local_leads"], affordances: ["export", "filter", "print"],
    },
    {
      id: "repeat-customers", title: "العملاء المتكررون", kind: "records",
      description: "من اشترى أكثر من مرة ومتى كان آخر طلب — سجل تسويقي لا يكرر مبيعات المحاسبة.",
      recordType: "repeat_customer",
      stateKeys: ["ep_repeat_customers"], affordances: ["export", "filter", "print"],
    },
    {
      id: "local-templates", title: "قالب الإعلان المحلي", kind: "templates",
      description: "نص الإعلان المحلي الجاهز للنسخ.",
      templateIds: templatesOf("local"), stateKeys: [], affordances: ["copy", "print"],
    },
  ]),

  area("shipping", "مراجع الشحن وتكلفة الوصول إلى السوق.", [
    {
      id: "freight-references", title: "مراجع الشحن", kind: "records",
      description: "تكلفة مرجعية لكل مسار مع تاريخ آخر مراجعة. راجع التاريخ قبل استخدامها في عرض.",
      recordType: "freight_reference",
      datasets: ["FREIGHT_RATES"], stateKeys: [], affordances: ["export", "filter", "print"],
    },
    {
      id: "landed-cost", title: "حاسبة التكلفة حتى السوق", kind: "calculator",
      description: "احسب تكلفة الكيلو حتى السوق من سعر EXW وتكلفة الشحن ونسبة الفاقد.",
      calculatorId: "landed-cost", stateKeys: [], affordances: ["copy"],
    },
  ]),

  area("logisticsResearch", "ملاحظات لوجستيات ٢٠٢٦ المراجَعة قبل التعاقد.", [
    {
      id: "logistics-notes", title: "ملاحظات اللوجستيات", kind: "reference",
      description: "ما تم التحقق منه فعلًا عن المسارات والمواعيد وسلسلة التبريد.",
      recordType: "market_reference", payloadKind: "logistics_note",
      stateKeys: [], affordances: ["export", "filter", "print"],
    },
    {
      id: "logistics-guide", title: "قواعد ثابتة", kind: "guide",
      description: "ما لا يتغيّر بين المواسم.",
      points: [
        "أي تكلفة شحن أقدم من موسم تُعامل كتقدير حتى تُراجع.",
        "سلسلة التبريد تُثبَّت في العرض قبل الاتفاق على السعر.",
        "مدة الشحن تدخل في حساب العمر التخزيني المعروض.",
      ],
      stateKeys: [], affordances: ["print"],
    },
  ]),

  area("quality", "الجودة وسلسلة التبريد والشهادات.", [
    {
      id: "qc-log", title: "سجل مراقبة الجودة", kind: "records",
      description: "نتيجة فحص كل دفعة: الدرجة والرطوبة والملاحظة.",
      recordType: "quality_batch",
      stateKeys: ["ep_qc_log"], affordances: ["export", "filter", "print"],
    },
    {
      id: "certificates", title: "سجل الشهادات", kind: "records",
      description: "الشهادات الأربع وحالتها وتاريخ انتهائها. تبدأ unverified ولا تُعرض كسارية قبل التحقق.",
      recordType: "certificate",
      datasets: ["CERT_DEFS"], stateKeys: ["ep_certs"], affordances: ["export", "filter", "print"],
    },
  ]),

  area("kuwait", "خطة الكويت: الموزّعون، حالتهم، ورسائل التواصل.", [
    {
      id: "kuwait-distributors", title: "موزّعو الكويت", kind: "contacts",
      description: "السجل الكامل للموزّعين مع الحالة والملاحظة وسجل المتابعة.",
      contactCategory: "kuwait_distributor",
      datasets: ["KUWAIT_DISTRIBUTORS"],
      stateKeys: ["ep_kuwait_dist_status", "ep_kuwait_dist_notes"],
      affordances: ["export", "filter", "paginate", "print"],
    },
    {
      id: "kuwait-followups", title: "متابعات الكويت", kind: "records",
      description: "مهمة متابعة لكل موزّع، مرتبطة بجهة الاتصال.",
      recordType: "task", payloadKind: "kuwait_followup",
      stateKeys: [], affordances: ["export", "filter", "print"],
    },
    {
      id: "kuwait-templates", title: "رسائل الكويت", kind: "templates",
      description: "النسخة العربية والإنجليزية لأول تواصل.",
      templateIds: templatesOf("kuwait"), stateKeys: [], affordances: ["copy", "print"],
    },
  ]),

  area("china", "خطة الصين ومتطلبات GACC.", [
    {
      id: "china-notes", title: "مراجع سوق الصين", kind: "reference",
      description: "متطلبات التسجيل والمواصفة والوسطاء المعتمدون.",
      recordType: "market_reference", payloadKind: "china_note",
      stateKeys: [], affordances: ["export", "filter", "print"],
    },
    {
      id: "china-guide", title: "شروط الدخول", kind: "guide",
      description: "ما يجب أن يكون جاهزًا قبل أول شحنة.",
      points: [
        "تسجيل GACC ساري ومطابق لاسم المنشأة.",
        "مطابقة المقاس والتعبئة لمواصفة المستورد.",
        "اتفاق مكتوب على الفحص عند الوصول ومن يتحمّل الرفض.",
      ],
      stateKeys: [], affordances: ["print"],
    },
  ]),

  area("crm", "الشركات والمتابعة: من تواصلنا معه، ومن يستحق المتابعة اليوم.", [
    {
      id: "crm-contacts", title: "شركات التصدير", kind: "contacts",
      description: "قائمة المصدّرين المنسّقة مع الحالة وسجل النشاط لكل شركة.",
      contactCategory: "exporter",
      datasets: ["EXPORTERS"],
      stateKeys: ["ep_crm", "ep_crm_meta"],
      affordances: ["export", "filter", "paginate", "print"],
    },
    {
      id: "hot-leads", title: "الفرص الساخنة", kind: "records",
      description: "الفرص التي تحتاج قرارًا هذا الأسبوع.",
      recordType: "hot_lead",
      stateKeys: ["ep_hot_leads"], affordances: ["export", "filter", "print"],
    },
  ]),

  area("exw", "مركز البيع تسليم أرض المزرعة: العروض الواردة، الحد الأدنى، وحاسبة الصافي.", [
    {
      id: "exw-bids", title: "العروض الواردة", kind: "records",
      description: "كل عرض EXW وارد بقيمته وصلاحيته. استخبارات سوق — لا تُسجَّل كإيراد.",
      recordType: "exw_bid",
      stateKeys: ["ep_bids"], affordances: ["export", "filter", "print"],
    },
    {
      id: "exw-settings", title: "إعدادات العرض والحد الأدنى", kind: "reference",
      description: "المقاس والحد الأدنى للكمية وشرط الدفع، والحد الأدنى للسعر المقبول.",
      recordType: "market_reference", payloadKind: "exw_settings",
      stateKeys: ["ep_exw", "ep_sales_floor"], affordances: ["export", "filter", "print"],
    },
    {
      id: "exw-net", title: "حاسبة صافي EXW", kind: "calculator",
      description: "احسب صافي الكيلو بعد العمولة والفاقد، وقارنه بالحد الأدنى قبل القبول.",
      calculatorId: "exw-net", stateKeys: [], affordances: ["copy"],
    },
    {
      id: "exw-template", title: "قالب عرض EXW", kind: "templates",
      description: "نص العرض الجاهز للنسخ بعد ملء الأرقام.",
      templateIds: templatesOf("exw"), stateKeys: [], affordances: ["copy", "print"],
    },
  ]),

  area("competitors", "المنافسون ونقاط التمايز.", [
    {
      id: "competitor-notes", title: "سجل المنافسين", kind: "records",
      description: "نقاط القوة والضعف لكل منافس في السوق المستهدف.",
      recordType: "competitor",
      stateKeys: ["ep_comps"], affordances: ["export", "filter", "print"],
    },
  ]),

  area("linkedin", "LinkedIn B2B: الملف، الفرص، وتسلسل الرسائل.", [
    {
      id: "linkedin-profile", title: "حالة الملف والروابط", kind: "records",
      description: "رابط صفحة الشركة وصفحة المزرعة وحالة كل منهما.",
      recordType: "platform_state", payloadKind: "linkedin_profile",
      stateKeys: ["ep_li"], affordances: ["export", "filter"],
    },
    {
      id: "linkedin-leads", title: "فرص LinkedIn", kind: "records",
      description: "كل مشترٍ محتمل من LinkedIn ومرحلته.",
      recordType: "lead_linkedin",
      stateKeys: ["ep_lileads"], affordances: ["export", "filter", "print"],
    },
    {
      id: "linkedin-templates", title: "تسلسل رسائل LinkedIn", kind: "templates",
      description: "النبذة، طلب الاتصال، الرسالة بعد القبول، المتابعة، والمنشور.",
      templateIds: templatesOf("linkedin"), stateKeys: [], affordances: ["copy", "print", "export"],
    },
  ]),

  area("brokers", "وسطاء التصدير وعمولاتهم.", [
    {
      id: "broker-tracking", title: "سجل الوسطاء", kind: "records",
      description: "حالة كل وسيط ونسبة عمولته والمنطقة التي يغطيها.",
      recordType: "broker_state",
      stateKeys: ["ep_broker_tracking"], affordances: ["export", "filter", "print"],
    },
    {
      id: "broker-template", title: "رسالة الوسيط", kind: "templates",
      description: "نص العرض على وسيط تصدير.",
      templateIds: templatesOf("brokers"), stateKeys: [], affordances: ["copy", "print"],
    },
  ]),

  area("socialprices", "رصد أسعار السوشيال كإشارة سوق منفصلة.", [
    {
      id: "social-sightings", title: "رصد أسعار السوشيال", kind: "records",
      description: "الأسعار المرصودة على المنصات الاجتماعية، موسومة بـ social_sighting لتمييزها عن أسعار السوق.",
      recordType: "price_observation", payloadKind: "social_sighting",
      stateKeys: ["ebeid_social_price_sightings_v1"], affordances: ["export", "filter", "print"],
    },
  ]),

  area("exportletter", "خطاب المصدرين ونسخته المختصرة.", [
    {
      id: "exporter-letter", title: "قوالب خطاب المصدرين", kind: "templates",
      description: "الخطاب الكامل والرسالة القصيرة، قابلان للتحرير والحفظ والنسخ والطباعة.",
      templateIds: templatesOf("exportletter"), stateKeys: [], affordances: ["copy", "print", "export"],
    },
  ]),

  area("gmail", "صياغة رسائل الحملة: مسودّات تُفتح يدويًا — لا إرسال آلي.", [
    {
      id: "compose-settings", title: "إعدادات الصياغة", kind: "reference",
      description: "الموضوع والقالب المستخدم في حملة اليوم.",
      recordType: "market_reference", payloadKind: "compose_settings",
      stateKeys: ["ep_gmail"], affordances: ["export", "filter"],
    },
    {
      id: "outbox", title: "قائمة المسودّات", kind: "outbox",
      description: "الجهات المختارة اليوم. كل زر يفتح بريدًا أو واتساب معبّأً في جهازك — النظام لا يرسل شيئًا، ويسجّل النشاط فقط بعد فتحك للمسودّة.",
      stateKeys: ["ep_csent"], affordances: ["copy", "print", "export"],
    },
    {
      id: "mail-template", title: "قالب البريد", kind: "templates",
      description: "نص الرسالة المستخدم في المسودّات.",
      templateIds: templatesOf("gmail"), stateKeys: [], affordances: ["copy", "print"],
    },
  ]),

  area("campaign", "الحملة اليومية: ست خطوات تُقفل كل يوم.", [
    {
      id: "daily-checklist", title: "قائمة الحملة اليومية", kind: "checklist",
      description: "الخطوات الست المحفوظة كمهام في قاعدة البيانات — يُعاد ضبطها كل يوم.",
      recordType: "task", payloadKind: "daily_campaign",
      stateKeys: ["ep_tasks"], affordances: ["print", "export"],
    },
  ]),

  area("platforms", "منصات الإعلان B2B وجاهزية كل منصة.", [
    {
      id: "platform-register", title: "سجل المنصات", kind: "records",
      description: "المنصات الثماني والعشرون وحالة العرض على كل منها.",
      recordType: "platform_state",
      datasets: ["B2B_PLATFORMS"], stateKeys: ["ep_platform_state"],
      affordances: ["export", "filter", "print"],
    },
    {
      id: "platform-readiness", title: "قائمة جاهزية المنصات", kind: "checklist",
      description: "المواد المطلوبة قبل النشر على أي منصة.",
      recordType: "task", payloadKind: "platform_readiness",
      stateKeys: ["ep_platform_tasks"], affordances: ["print", "export"],
    },
    {
      id: "platform-templates", title: "نص إعلان المنصة", kind: "templates",
      description: "العنوان والنص الكامل المستخدمان في كل عرض.",
      templateIds: templatesOf("platforms"), stateKeys: [], affordances: ["copy", "print"],
    },
  ]),

  area("materials", "المواد التسويقية الموحّدة.", [
    {
      id: "farm-page-desc", title: "وصف المزرعة الموحّد", kind: "templates",
      description: "الوصف الذي يُعاد استخدامه في كل منصة وملف.",
      templateIds: templatesOf("materials"), stateKeys: [], affordances: ["copy", "print", "export"],
    },
    {
      id: "materials-guide", title: "ما تحتاجه أي منصة", kind: "guide",
      description: "الحد الأدنى من المواد قبل نشر أي عرض.",
      points: [
        "شعار وصورة غلاف بجودة عالية.",
        "صور أصلية للمنتج والتعبئة.",
        "ملف الشهادات محدّث.",
        "جدول المقاسات والكميات وشروط EXW.",
      ],
      stateKeys: [], affordances: ["print"],
    },
  ]),

  area("dailyreport", "التقرير اليومي: ماذا حدث فعلًا اليوم.", [
    {
      id: "daily-reports", title: "التقارير اليومية", kind: "records",
      description: "عدد الجهات والردود والفرص المؤهلة والعروض وقرار اليوم.",
      recordType: "daily_sales_report",
      stateKeys: ["ep_daily_sales_reports"], affordances: ["export", "filter", "print"],
    },
    {
      id: "campaign-funnel", title: "حاسبة قمع الحملة", kind: "calculator",
      description: "نسب الرد والتأهيل والعرض من أرقام اليوم.",
      calculatorId: "campaign-funnel", stateKeys: [], affordances: ["copy"],
    },
    {
      id: "dsr-template", title: "ملخص واتساب", kind: "templates",
      description: "نص الملخص اليومي الجاهز للنسخ وإرساله يدويًا.",
      templateIds: templatesOf("dailyreport"), stateKeys: [], affordances: ["copy", "print"],
    },
  ]),

  area("reports", "أهداف القنوات والتقارير التسويقية.", [
    {
      id: "channel-targets", title: "أهداف القنوات", kind: "records",
      description: "هدف كل قناة تسويقية للفترة. أهداف تسويقية فقط — الأرقام المحاسبية تبقى في وحدة المحاسبة.",
      recordType: "channel_target",
      datasets: ["FIN_CHANNELS"], stateKeys: ["ep_finance"],
      affordances: ["export", "filter", "print"],
    },
    {
      id: "reports-guide", title: "حدود هذه الأرقام", kind: "guide",
      description: "لماذا لا تُقارن هذه الأرقام بالقوائم المالية.",
      points: [
        "أرقام التسويق مُعلنة ومقدّرة، والمحاسبة مصدرها المستندات.",
        "لا يُنقل رقم من هنا إلى قيد محاسبي.",
        "أي فرق بين الهدف والفعلي يُراجع في وحدة المحاسبة.",
      ],
      stateKeys: [], affordances: ["print"],
    },
  ]),

  area("contact", "دليل التواصل الكامل: البحث، الاختيار، والحالة.", [
    {
      id: "directory", title: "دليل جهات التصدير", kind: "contacts",
      description: "الدليل الكامل مع بحث وترقيم صفحات من الخادم. لا يُحمَّل الدليل كاملًا في المتصفح.",
      contactCategory: "buyer_lead",
      datasets: ["CONTACTS"],
      stateKeys: ["ep_csel", "ep_cstat"],
      affordances: ["export", "filter", "paginate", "print"],
    },
    {
      id: "owner-channel", title: "قناة تواصل المالك", kind: "guide",
      description: "رقم واتساب المالك إعداد موقع عام ويُدار في صفحة الموقع.",
      points: ["افتح /website لتعديل بيانات التواصل المعروضة للعامة."],
      stateKeys: ["ep_owner_whatsapp"], affordances: [],
    },
    {
      id: "source-import", title: "استيراد الملف المصدر", kind: "import",
      description: "معاينة الملفين المراجَعين ثم تنفيذ الاستيراد. المالك فقط.",
      stateKeys: [], affordances: [],
    },
  ]),
];

/* ------------------------------------------------------------------ *
 * 6. Derived lookups used by the routes, the nav and the tests.
 * ------------------------------------------------------------------ */

export function marketingAreaBlueprint(sourceId: string): MarketingAreaBlueprint | null {
  return MARKETING_AREA_BLUEPRINTS.find((blueprint) => blueprint.sourceId === sourceId) ?? null;
}

export function marketingAreaHref(sourceId: string): string {
  return `/marketing/area/${sourceId}`;
}

/** Every state key the manifest maps, with the area/section that owns it. */
export function marketingStateKeyOwners(): Map<string, { area: string; sectionId: string }> {
  const owners = new Map<string, { area: string; sectionId: string }>();
  for (const blueprint of MARKETING_AREA_BLUEPRINTS) {
    for (const section of blueprint.sections) {
      for (const key of section.stateKeys) {
        owners.set(key, { area: blueprint.sourceId, sectionId: section.id });
      }
    }
  }
  return owners;
}

/** Record types the workspace actually renders an editable or reference surface for. */
export function marketingMappedRecordTypes(): Set<FullMarketingRecordType> {
  const types = new Set<FullMarketingRecordType>();
  for (const blueprint of MARKETING_AREA_BLUEPRINTS) {
    for (const section of blueprint.sections) {
      if (section.recordType) types.add(section.recordType);
    }
  }
  return types;
}
