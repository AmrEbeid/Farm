import type { CrossFieldError, WriteImportDescriptor } from "../types";

const MARKETING_ROLES = ["owner", "accountant", "farm_manager"] as const;
const RECORD_TYPES = [
  "price_observation", "exw_bid", "quality_batch", "weekly_availability", "competitor",
  "lead_local", "lead_offshoot", "lead_social", "lead_linkedin", "hot_lead", "task",
  "platform_state", "broker_state", "certificate", "channel_target", "message_template",
];

function payloadErrors(row: Record<string, unknown>): CrossFieldError[] {
  try {
    const payload = JSON.parse(String(row.payloadJson || "{}"));
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new Error();
    if (JSON.stringify(payload).length > 32768) throw new Error();
    return [];
  } catch {
    return [{ column: "payloadJson", reason: "يجب أن تكون التفاصيل كائن JSON صالحًا وأقل من 32 كيلوبايت" }];
  }
}

export const marketingContactsDescriptor: WriteImportDescriptor = {
  key: "marketing-contacts",
  titleAr: "جهات الاتصال التسويقية",
  rpc: "fn_save_marketing_contact",
  role: "marketing.write",
  allowedRoles: [...MARKETING_ROLES],
  table: "marketing_contact",
  matchKey: ["name", "category"],
  dedupeKey: ["name", "category"],
  columns: [
    { key: "name", labelAr: "الاسم", type: "string", required: true, example: "شركة استيراد" },
    { key: "category", labelAr: "الفئة", type: "enum", required: true, enumValues: ["exporter", "buyer_lead", "kuwait_distributor", "platform", "freight", "other"], example: "exporter" },
    { key: "orgName", labelAr: "الجهة", type: "string", required: false, example: "شركة استيراد" },
    { key: "phone", labelAr: "الهاتف", type: "string", required: false, example: "+965 0000 0000" },
    { key: "email", labelAr: "البريد الإلكتروني", type: "string", required: false, example: "buyer@example.com" },
    { key: "source", labelAr: "المصدر", type: "string", required: false, example: "معرض تجاري" },
    { key: "notes", labelAr: "ملاحظات", type: "string", required: false, example: "" },
    { key: "selected", labelAr: "جهة مختارة", type: "bool", required: false, example: "false" },
  ],
  fromRow: (row) => ({
    name: row.name, category: row.category, orgName: row.org_name ?? "", phone: row.phone ?? "",
    email: row.email ?? "", source: row.source ?? "", notes: row.notes ?? "", selected: row.selected ?? false,
  }),
  toRpcArgs: (row, matchedId) => ({
    p_id: matchedId ?? null, p_org: null, p_name: row.name, p_phone: row.phone ?? null,
    p_email: row.email ?? null, p_org_name: row.orgName ?? null, p_category: row.category,
    p_source: row.source ?? null, p_notes: row.notes ?? null, p_selected: row.selected ?? false,
    p_source_key: null,
  }),
};

export const marketingRecordsDescriptor: WriteImportDescriptor = {
  key: "marketing-records",
  titleAr: "سجلات التسويق",
  rpc: "fn_save_marketing_record",
  role: "marketing.write",
  allowedRoles: [...MARKETING_ROLES],
  table: "marketing_record",
  matchKey: ["recordType", "title"],
  dedupeKey: ["recordType", "title"],
  crossFieldCheck: payloadErrors,
  columns: [
    { key: "recordType", labelAr: "نوع السجل", type: "enum", required: true, enumValues: RECORD_TYPES, example: "price_observation" },
    { key: "title", labelAr: "العنوان", type: "string", required: true, example: "سعر البرحي" },
    { key: "status", labelAr: "الحالة", type: "string", required: false, example: "observed" },
    { key: "amount", labelAr: "القيمة السوقية", type: "decimal", required: false, example: "50" },
    {
      key: "contactId", labelAr: "جهة الاتصال", type: "string", required: false, example: "شركة استيراد",
      ref: { table: "marketing_contact", codeColumn: "name", activeColumn: "archived", activeValue: false },
    },
    { key: "payloadJson", labelAr: "التفاصيل JSON", type: "string", required: false, example: "{}" },
  ],
  fromRow: (row) => ({
    recordType: row.record_type, title: row.title, status: row.status ?? "", amount: row.amount ?? "",
    contactId: row.contact_id ?? "", payloadJson: JSON.stringify(row.payload ?? {}),
  }),
  toRpcArgs: (row, matchedId) => ({
    p_id: matchedId ?? null, p_org: null, p_record_type: row.recordType, p_title: row.title,
    p_payload: JSON.parse(String(row.payloadJson || "{}")), p_contact_id: row.contactId ?? null,
    p_amount: row.amount ?? null, p_status: row.status ?? null, p_source_key: null,
  }),
};
