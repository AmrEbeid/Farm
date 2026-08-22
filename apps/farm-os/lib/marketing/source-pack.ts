import type { Json, MarketingRecordType } from "@/lib/database.types.ext";
import type { MarketingSourceManifest } from "./source-extractor";

export type FullMarketingRecordType =
  | MarketingRecordType
  | "freight_reference"
  | "market_reference"
  | "daily_sales_report"
  | "repeat_customer";

export interface MarketingSourcePackContact {
  sourceKey: string;
  name: string;
  phone: string | null;
  email: string | null;
  orgName: string | null;
  category: "exporter" | "buyer_lead" | "kuwait_distributor" | "platform" | "freight" | "other";
  source: string | null;
  notes: string | null;
  selected: boolean;
  metadata: Record<string, Json>;
}

export interface MarketingSourcePackRecord {
  sourceKey: string;
  recordType: FullMarketingRecordType;
  title: string;
  payload: Record<string, Json>;
  amount: number | null;
  status: string | null;
  contactSourceKey: string | null;
}

export interface MarketingSourcePack {
  version: 1;
  contacts: MarketingSourcePackContact[];
  records: MarketingSourcePackRecord[];
  coverage: {
    tabs: string[];
    templates: number;
    sourceRows: Record<string, number>;
    mutableStateKeys: string[];
    mappedElsewhere: { source: string; destination: string; reason: string }[];
    emptyRegisters: string[];
  };
}

type SourceObject = Record<string, Json>;

export const CAMPAIGN_TASKS = [
  "مراجعة تقرير الأسعار الصباحي",
  "مراسلة 5-10 شركات مركزة",
  "واتساب للأعلى أولوية",
  "تحديث حالة كل شركة",
  "تسجيل أي عرض جديد",
  "قرار اليوم",
] as const;

export const PLATFORM_TASKS = [
  "الشعار وصورة الغلاف",
  "10-15 صورة أصلية",
  "فيديو 60-120 ثانية",
  "ملف الشهادات",
  "جدول المقاسات والكميات",
  "شروط EXW والدفع",
] as const;

const TEMPLATE_LABELS: Record<string, string> = {
  offshootAdAr: "إعلان فسائل - عربي",
  offshootAdEn: "إعلان فسائل - إنجليزي",
  offshootWhats: "رسالة واتساب للفسائل",
  localAdAr: "إعلان البيع المحلي",
  kuwaitMsgAr: "رسالة الكويت - عربي",
  kuwaitMsgEn: "رسالة الكويت - إنجليزي",
  exwQuote: "عرض EXW",
  linkedinAbout: "نبذة LinkedIn",
  farmPageDesc: "وصف صفحة المزرعة",
  liConnect: "طلب اتصال LinkedIn",
  liAfter: "رسالة بعد قبول LinkedIn",
  liFollow: "متابعة LinkedIn",
  liPost: "منشور LinkedIn",
  exporterLetterBody: "خطاب المصدرين",
  exporterShortMsg: "رسالة قصيرة للمصدر",
  brokerMsg: "رسالة وسيط التصدير",
  mailTemplate: "قالب البريد",
  platformAdTitle: "عنوان إعلان المنصة",
  platformAdText: "نص إعلان المنصة",
  dsrWhatsappText: "ملخص التقرير اليومي لواتساب",
};

function object(value: Json | undefined): SourceObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as SourceObject
    : null;
}

function objects(value: Json | undefined): SourceObject[] {
  return Array.isArray(value) ? value.map((item) => object(item)).filter((item): item is SourceObject => item !== null) : [];
}

function text(value: Json | undefined): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized && normalized !== "—" ? normalized : null;
}

function number(value: Json | undefined): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSaved(value: unknown): Json | undefined {
  if (typeof value !== "string") return value as Json | undefined;
  try {
    return JSON.parse(value) as Json;
  } catch {
    return undefined;
  }
}

function firstEmail(value: string | null): string | null {
  return value?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? null;
}

function firstPhone(value: string | null): string | null {
  const candidate = value?.split(/[\/;,]/)[0]?.replace(/\D/g, "") ?? "";
  return candidate.length >= 8 ? candidate : null;
}

function websiteKey(value: string | null): string | null {
  if (!value) return null;
  return value.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

function identity(contact: Pick<MarketingSourcePackContact, "email" | "phone" | "metadata" | "name">): string {
  const website = typeof contact.metadata.website === "string"
    ? contact.metadata.website
    : null;
  return firstEmail(contact.email)
    ? `email:${firstEmail(contact.email)}`
    : firstPhone(contact.phone)
      ? `phone:${firstPhone(contact.phone)}`
      : websiteKey(website)
        ? `site:${websiteKey(website)}|name:${contact.name.trim().toLocaleLowerCase("ar")}`
        : `name:${contact.name.trim().toLocaleLowerCase("ar")}`;
}

function mergeContact(target: MarketingSourcePackContact, incoming: MarketingSourcePackContact): void {
  target.phone ??= incoming.phone;
  target.email ??= incoming.email;
  target.orgName ??= incoming.orgName;
  target.source ??= incoming.source;
  target.notes ??= incoming.notes;
  target.selected ||= incoming.selected;
  const existingRows = Array.isArray(target.metadata.sourceRows) ? target.metadata.sourceRows : [];
  const incomingRows = Array.isArray(incoming.metadata.sourceRows) ? incoming.metadata.sourceRows : [];
  target.metadata.sourceRows = [...existingRows, ...incomingRows];
  const keys = new Set([
    ...(Array.isArray(target.metadata.sourceKeys) ? target.metadata.sourceKeys : []),
    ...(Array.isArray(incoming.metadata.sourceKeys) ? incoming.metadata.sourceKeys : []),
  ].filter((value): value is string => typeof value === "string"));
  target.metadata.sourceKeys = [...keys];
}

function contactFromRow(
  sourceKey: string,
  row: SourceObject,
  sourceGroup: "exporters" | "directory" | "kuwait",
  selected: boolean,
): MarketingSourcePackContact | null {
  const directory = sourceGroup === "directory";
  const kuwait = sourceGroup === "kuwait";
  const name = text(row[directory ? "company" : kuwait ? "name" : "الاسم"]);
  if (!name) return null;
  const phone = text(row[directory ? "phones" : kuwait ? "contact" : "الهاتف"]);
  const email = text(row[directory ? "email" : "email"] ?? row["الإيميل"]);
  const website = text(row[directory ? "website" : kuwait ? "source" : "الموقع"]);
  const source = text(row[directory ? "source" : kuwait ? "source" : "المصدر"]) ?? website;
  const status = text(row[directory ? "status" : "حالة_التواصل"]);
  return {
    sourceKey,
    name,
    phone,
    email,
    orgName: name,
    category: kuwait ? "kuwait_distributor" : directory ? "buyer_lead" : "exporter",
    source,
    notes: status,
    selected,
    metadata: {
      sourceGroup,
      sourceKeys: [sourceKey],
      sourceRows: [{ ...row, sourceKey }],
      website,
      status,
      priority: text(row.priority ?? row["التصنيف"]),
      governorate: text(row.governorate ?? row["المحافظة_السوق"]),
      products: text(row.products ?? row["النوع"]),
    },
  };
}

function addRecord(
  records: MarketingSourcePackRecord[],
  record: MarketingSourcePackRecord,
): void {
  const index = records.findIndex((item) => item.sourceKey === record.sourceKey);
  if (index >= 0) records[index] = record;
  else records.push(record);
}

export function buildMarketingSourcePack(manifest: MarketingSourceManifest): MarketingSourcePack {
  const selectedIds = new Set(
    (parseSaved(manifest.savedState.ep_csel) as Json[] | undefined ?? [])
      .map((value) => number(value))
      .filter((value): value is number => value !== null),
  );
  const contactMap = new Map<string, MarketingSourcePackContact>();
  const addContact = (contact: MarketingSourcePackContact | null) => {
    if (!contact) return;
    const key = identity(contact);
    const existing = contactMap.get(key);
    if (existing) mergeContact(existing, contact);
    else contactMap.set(key, contact);
  };

  objects(manifest.datasets.EXPORTERS).forEach((row, index) => {
    addContact(contactFromRow(`source2026:exporter:${index + 1}`, row, "exporters", false));
  });
  objects(manifest.datasets.CONTACTS).forEach((row, index) => {
    const id = number(row.id) ?? index + 1;
    addContact(contactFromRow(`source2026:directory:${id}`, row, "directory", selectedIds.has(id)));
  });

  const kuwaitStatuses = object(parseSaved(manifest.savedState.ep_kuwait_dist_status)) ?? {};
  const kuwaitNotes = object(parseSaved(manifest.savedState.ep_kuwait_dist_notes)) ?? {};
  objects(manifest.datasets.KUWAIT_DISTRIBUTORS).forEach((row, index) => {
    const contact = contactFromRow(`source2026:kuwait:${index}`, row, "kuwait", false);
    if (!contact) return;
    const status = text(kuwaitStatuses[String(index)]);
    const note = text(kuwaitNotes[String(index)]);
    contact.notes = [status, note].filter(Boolean).join(" - ") || null;
    contact.metadata.status = status;
    contact.metadata.note = note;
    addContact(contact);
  });

  const records: MarketingSourcePackRecord[] = [];
  manifest.templates.forEach((template) => addRecord(records, {
    sourceKey: `source2026:template:${template.id}`,
    recordType: "message_template",
    title: TEMPLATE_LABELS[template.id] ?? template.id,
    payload: { body: template.body, templateId: template.id },
    amount: null,
    status: "ready",
    contactSourceKey: null,
  }));

  objects(manifest.datasets.B2B_PLATFORMS).forEach((row, index) => addRecord(records, {
    sourceKey: `source2026:platform:${index + 1}`,
    recordType: "platform_state",
    title: text(row.name) ?? `منصة ${index + 1}`,
    payload: { ...row, listingUrl: text(row.url) },
    amount: null,
    status: "draft",
    contactSourceKey: null,
  }));
  objects(manifest.datasets.CERT_DEFS).forEach((row, index) => addRecord(records, {
    sourceKey: `source2026:certificate:${text(row.id) ?? index + 1}`,
    recordType: "certificate",
    title: text(row.name) ?? `شهادة ${index + 1}`,
    payload: { ...row },
    amount: null,
    status: "unverified",
    contactSourceKey: null,
  }));
  objects(manifest.datasets.FREIGHT_RATES).forEach((row, index) => addRecord(records, {
    sourceKey: `source2026:freight:${index + 1}`,
    recordType: "freight_reference",
    title: text(row.label) ?? `مرجع شحن ${index + 1}`,
    payload: { ...row },
    amount: null,
    status: "reference",
    contactSourceKey: null,
  }));
  (manifest.datasets.PRICE_TYPES as Json[]).forEach((value, index) => addRecord(records, {
    sourceKey: `source2026:price-type:${index + 1}`,
    recordType: "market_reference",
    title: text(value) ?? `نوع سعر ${index + 1}`,
    payload: { kind: "price_type" },
    amount: null,
    status: "reference",
    contactSourceKey: null,
  }));
  (manifest.datasets.FIN_CHANNELS as Json[]).forEach((value, index) => addRecord(records, {
    sourceKey: `source2026:channel:${index + 1}`,
    recordType: "channel_target",
    title: text(value) ?? `قناة ${index + 1}`,
    payload: { period: "2026", channel: text(value) },
    amount: null,
    status: "planning",
    contactSourceKey: null,
  }));
  const approvedFarmFacts = { ...(object(manifest.datasets.FARM_FACTS) ?? {}) };
  delete approvedFarmFacts.palmsApprox;
  addRecord(records, {
    sourceKey: "source2026:farm-facts",
    recordType: "market_reference",
    title: "حقائق المزرعة المستخدمة في التسويق",
    payload: approvedFarmFacts,
    amount: null,
    status: "reference",
    contactSourceKey: null,
  });

  const defaultPrices = objects(manifest.loadDefaults.ep_prices);
  const savedPrices = objects(parseSaved(manifest.savedState.ep_prices));
  [...defaultPrices, ...savedPrices].forEach((row) => {
    const date = text(row.date);
    const priceType = text(row.type);
    const low = number(row.low);
    const high = number(row.high);
    if (!date || !priceType || low === null || high === null) return;
    addRecord(records, {
      sourceKey: `source2026:price:${date}:${priceType}`,
      recordType: "price_observation",
      title: `${priceType} - ${date}`,
      payload: { observedAt: date, commodity: "برحي", market: priceType, low, high, note: text(row.note) },
      amount: (low + high) / 2,
      status: "observed",
      contactSourceKey: null,
    });
  });
  objects(manifest.loadDefaults.ep_offshoot_leads).forEach((row, index) => addRecord(records, {
    sourceKey: `source2026:offshoot-lead:${index + 1}`,
    recordType: "lead_offshoot",
    title: text(row.buyer) ?? `عميل فسائل ${index + 1}`,
    payload: { ...row },
    amount: number(row.offer),
    status: text(row.stage) ?? "new",
    contactSourceKey: null,
  }));

  const taskState = Array.isArray(parseSaved(manifest.savedState.ep_tasks))
    ? parseSaved(manifest.savedState.ep_tasks) as Json[]
    : [];
  CAMPAIGN_TASKS.forEach((title, index) => addRecord(records, {
    sourceKey: `source2026:campaign-task:${index}`,
    recordType: "task",
    title,
    payload: { group: "daily_campaign" },
    amount: null,
    status: taskState[index] === true ? "done" : "todo",
    contactSourceKey: null,
  }));
  const platformTaskState = Array.isArray(parseSaved(manifest.savedState.ep_platform_tasks))
    ? parseSaved(manifest.savedState.ep_platform_tasks) as Json[]
    : [];
  PLATFORM_TASKS.forEach((title, index) => addRecord(records, {
    sourceKey: `source2026:platform-task:${index}`,
    recordType: "task",
    title,
    payload: { group: "platform_readiness" },
    amount: null,
    status: platformTaskState[index] === true ? "done" : "todo",
    contactSourceKey: null,
  }));

  const linkedIn = object(parseSaved(manifest.savedState.ep_li));
  const farmUrl = text(linkedIn?.farmUrl);
  if (farmUrl) addRecord(records, {
    sourceKey: "source2026:farm-url",
    recordType: "platform_state",
    title: "موقع مزرعة عبيد",
    payload: { listingUrl: farmUrl },
    amount: null,
    status: "live",
    contactSourceKey: null,
  });
  const finance = object(parseSaved(manifest.savedState.ep_finance));
  if (finance) Object.entries(finance).forEach(([channel, value]) => {
    const details = object(value);
    const target = number(details?.target);
    if (target === null) return;
    addRecord(records, {
      sourceKey: `source2026:channel-target:${channel}`,
      recordType: "channel_target",
      title: channel,
      payload: { period: "2026", channel },
      amount: target,
      status: "active",
      contactSourceKey: null,
    });
  });

  return {
    version: 1,
    contacts: [...contactMap.values()],
    records,
    coverage: {
      tabs: manifest.tabs.map((tab) => tab.id),
      templates: manifest.templates.length,
      sourceRows: { ...manifest.coverage.datasets },
      mutableStateKeys: Object.keys(manifest.loadDefaults).sort(),
      mappedElsewhere: [
        { source: "ep_harvest_log", destination: "/harvest", reason: "الحصاد سجل تشغيلي authoritative ولا يتكرر في التسويق" },
        { source: "ep_owner_whatsapp", destination: "/website", reason: "رقم المالك إعداد موقع وليس جهة اتصال CRM" },
        { source: "FARM_FACTS.palmsApprox", destination: "/farm", reason: "عدد النخيل متنازع عليه ولا يُستورد حتى اعتماد سجل وحدات مصحح" },
      ],
      emptyRegisters: [
        "ep_bids", "ep_comps", "ep_lileads", "ebeid_social_price_sightings_v1",
        "ep_local_leads", "ep_weekly_availability", "ep_hot_leads", "ep_daily_sales_reports",
        "ep_qc_log", "ep_repeat_customers",
      ],
    },
  };
}
