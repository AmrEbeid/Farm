import type { Json, MarketingRecordType } from "@/lib/database.types.ext";

// Only the small, user-edited state from the legacy tracker is importable. The large static lists
// stay as source inventory and are never copied into the application automatically.
const ALLOWED_KEYS = new Set([
  "ep_prices", "ep_finance", "ep_tasks", "ep_platform_tasks", "ep_kuwait_dist_status",
  "ep_csel", "ep_owner_whatsapp", "ep_harvest_log", "ep_li",
]);
const CONTACT_CATEGORIES = new Set(["exporter", "buyer_lead", "kuwait_distributor", "platform", "freight", "other"]);
const RECORD_TYPES = new Set<MarketingRecordType>([
  "price_observation", "exw_bid", "quality_batch", "weekly_availability", "competitor",
  "lead_local", "lead_offshoot", "lead_social", "lead_linkedin", "hot_lead", "task",
  "platform_state", "broker_state", "certificate", "channel_target", "message_template",
]);

const CAMPAIGN_TASKS = [
  "مراجعة تقرير الأسعار الصباحي", "مراسلة 5-10 شركات مركزة", "واتساب للأعلى أولوية",
  "تحديث حالة كل شركة", "تسجيل أي عرض جديد", "قرار اليوم",
] as const;

const PLATFORM_TASKS = [
  "الشعار وصورة الغلاف", "10-15 صورة أصلية", "فيديو 60-120 ثانية",
  "ملف الشهادات", "جدول المقاسات والكميات", "شروط EXW والدفع",
] as const;

export interface SourceInventoryCounts {
  exporters: number;
  contacts: number;
  kuwaitDistributors: number;
  platforms: number;
  freightRefs: number;
}

export interface MarketingSourceContact {
  kind: "contact";
  provenanceKey: string;
  name: string;
  phone: string | null;
  email: string | null;
  orgName: string | null;
  category: "exporter" | "buyer_lead" | "kuwait_distributor" | "platform" | "freight" | "other";
  source: string | null;
  notes: string | null;
  selected: boolean;
}

export interface MarketingSourceRecord {
  kind: "record";
  provenanceKey: string;
  recordType: MarketingRecordType;
  title: string;
  payload: Record<string, Json>;
  amount: number | null;
  status: string | null;
  contactSourceKey?: string | null;
}

export type StagedMarketingRecord = MarketingSourceContact | MarketingSourceRecord;

export interface SourceStagingIssue {
  path: string;
  reason: "unrelated_key" | "invalid_shape";
}

export interface SourceStagingResult {
  ok: boolean;
  inventory: SourceInventoryCounts;
  records: StagedMarketingRecord[];
  counts: {
    prices: number;
    kuwaitStatuses: number;
    selectedContacts: number;
    harvest: number;
    campaignTasks: number;
    platformTasks: number;
    target: number;
  };
  sourceMetadata: { ownerWhatsApp: string | null; farmUrl: string | null };
  rejectedKeys: string[];
  issues: SourceStagingIssue[];
}

type ContactSeed = Omit<MarketingSourceContact, "kind" | "provenanceKey">;

const SELECTED_CONTACTS: Record<number, ContactSeed> = {
  2: {
    name: "السعداوي للإستيراد والتصدير",
    phone: "00208467920 / 0020100620359 / 0020106895953",
    email: "europ@seadawyherbs.com",
    orgName: "السعداوي للإستيراد والتصدير",
    category: "exporter",
    source: "https://www.expoegypt.gov.eg/co/السعداوي-للإستيراد-والتصدير",
    notes: "جهة مختارة في ملف تسويق 2026",
    selected: true,
  },
  4: {
    name: "جرين فارم للحاصلات الزراعية",
    phone: "00204033284 / 00204033285 / 01227786992",
    email: "greenfarminternational@yahoo.com",
    orgName: "جرين فارم للحاصلات الزراعية",
    category: "exporter",
    source: "https://www.expoegypt.gov.eg/co/جرين-فارم-للحاصلات-الزراعية",
    notes: "جهة مختارة في ملف تسويق 2026",
    selected: true,
  },
};

const KUWAIT_CONTACTS: Record<number, ContactSeed> = {
  4: {
    name: "Jawad & Majed Company", phone: "+965 2464 3416 / +965 2484 0690",
    email: "info@jawadandmajed.com", orgName: "Jawad & Majed Company",
    category: "kuwait_distributor", source: "jawadandmajed.com",
    notes: "تم التواصل حسب ملف تسويق 2026", selected: false,
  },
  8: {
    name: "Fresh Vibes Trading", phone: null, email: "info@freshvibes.com.kw",
    orgName: "Fresh Vibes Trading", category: "kuwait_distributor", source: "freshvibes.com.kw",
    notes: "تم التواصل حسب ملف تسويق 2026", selected: false,
  },
  13: {
    name: "AgroFoods Global", phone: null, email: "sales@agrofoodsglobal.com",
    orgName: "AgroFoods Global", category: "kuwait_distributor", source: "agrofoodsglobal.com/kuwait",
    notes: "تم التواصل حسب ملف تسويق 2026؛ يلزم التحقق من الهوية قبل التعامل", selected: false,
  },
};

const INVENTORY: SourceInventoryCounts = {
  exporters: 75, contacts: 1513, kuwaitDistributors: 14, platforms: 28, freightRefs: 12,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStored(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return undefined; }
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function addRecord(records: StagedMarketingRecord[], seen: Set<string>, record: StagedMarketingRecord) {
  if (seen.has(record.provenanceKey)) return;
  seen.add(record.provenanceKey);
  records.push(record);
}

export function stageMarketingSource(raw: unknown): SourceStagingResult {
  const records: StagedMarketingRecord[] = [];
  const seen = new Set<string>();
  const issues: SourceStagingIssue[] = [];
  const rejectedKeys: string[] = [];
  let ownerWhatsApp: string | null = null;
  let farmUrl: string | null = null;
  let target = 0;

  if (!isObject(raw)) {
    return {
      ok: false, inventory: INVENTORY, records,
      counts: { prices: 0, kuwaitStatuses: 0, selectedContacts: 0, harvest: 0, campaignTasks: 0, platformTasks: 0, target },
      sourceMetadata: { ownerWhatsApp, farmUrl }, rejectedKeys,
      issues: [{ path: "$", reason: "invalid_shape" }],
    };
  }
  const source = raw;

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      rejectedKeys.push(key);
      issues.push({ path: key, reason: "unrelated_key" });
    }
  }

  const prices = parseStored(raw.ep_prices);
  if (Array.isArray(prices)) {
    prices.forEach((item, index) => {
      if (!isObject(item)) {
        issues.push({ path: `ep_prices[${index}]`, reason: "invalid_shape" });
        return;
      }
      const date = typeof item.date === "string" ? item.date.trim() : "";
      const type = typeof item.type === "string" ? item.type.trim() : "";
      const low = finiteNumber(item.low);
      const high = finiteNumber(item.high);
      if (!date || !type || low === null || high === null || low < 0 || high < low) {
        issues.push({ path: `ep_prices[${index}]`, reason: "invalid_shape" });
        return;
      }
      addRecord(records, seen, {
        kind: "record", provenanceKey: `legacy:ep_prices:${date}:${type}`,
        recordType: "price_observation", title: `${type} - ${date}`,
        payload: { observedAt: date, commodity: "برحي", market: "سوق العبور", low, high, note: typeof item.note === "string" ? item.note : "" },
        amount: (low + high) / 2, status: "observed",
      });
    });
  } else if (raw.ep_prices !== undefined) issues.push({ path: "ep_prices", reason: "invalid_shape" });

  const selected = parseStored(raw.ep_csel);
  if (Array.isArray(selected)) {
    selected.forEach((value, index) => {
      const id = finiteNumber(value);
      const contact = id === null ? undefined : SELECTED_CONTACTS[id];
      if (!contact) {
        issues.push({ path: `ep_csel[${index}]`, reason: "invalid_shape" });
        return;
      }
      addRecord(records, seen, { kind: "contact", provenanceKey: `legacy:ep_csel:${id}`, ...contact });
    });
  } else if (raw.ep_csel !== undefined) issues.push({ path: "ep_csel", reason: "invalid_shape" });

  const kuwait = parseStored(raw.ep_kuwait_dist_status);
  if (isObject(kuwait)) {
    Object.entries(kuwait).forEach(([rawIndex, status]) => {
      const index = Number(rawIndex);
      const contact = KUWAIT_CONTACTS[index];
      if (!contact || status !== "تم التواصل") {
        issues.push({ path: `ep_kuwait_dist_status.${rawIndex}`, reason: "invalid_shape" });
        return;
      }
      const contactSourceKey = `legacy:ep_kuwait_dist_status:${index}`;
      addRecord(records, seen, { kind: "contact", provenanceKey: contactSourceKey, ...contact });
      addRecord(records, seen, {
        kind: "record",
        provenanceKey: `legacy:ep_kuwait_dist_status:${index}:followup`,
        recordType: "task",
        title: `متابعة ${contact.name}`,
        payload: { group: "kuwait_distributor" },
        amount: null,
        status: "done",
        contactSourceKey,
      });
    });
  } else if (raw.ep_kuwait_dist_status !== undefined) issues.push({ path: "ep_kuwait_dist_status", reason: "invalid_shape" });

  function stageTasks(key: "ep_tasks" | "ep_platform_tasks", labels: readonly string[], group: string) {
    const values = parseStored(source[key]);
    if (!Array.isArray(values) || values.length > labels.length || values.some((value) => typeof value !== "boolean")) {
      if (source[key] !== undefined) issues.push({ path: key, reason: "invalid_shape" });
      return;
    }
    values.forEach((done, index) => addRecord(records, seen, {
      kind: "record", provenanceKey: `legacy:${key}:${index}`, recordType: "task",
      title: labels[index], payload: { group }, amount: null, status: done ? "done" : "todo",
    }));
  }
  stageTasks("ep_tasks", CAMPAIGN_TASKS, "daily_campaign");
  stageTasks("ep_platform_tasks", PLATFORM_TASKS, "platform_readiness");

  const finance = parseStored(raw.ep_finance);
  if (isObject(finance)) {
    const [channel, details] = Object.entries(finance)[0] ?? [];
    const parsedTarget = isObject(details) ? finiteNumber(details.target) : null;
    if (channel && parsedTarget !== null && parsedTarget >= 0) {
      target = parsedTarget;
      addRecord(records, seen, {
        kind: "record", provenanceKey: `legacy:ep_finance:${channel}`,
        recordType: "channel_target", title: channel, payload: { period: "2026", channel },
        amount: parsedTarget, status: "active",
      });
    } else if (raw.ep_finance !== undefined) issues.push({ path: "ep_finance", reason: "invalid_shape" });
  } else if (raw.ep_finance !== undefined) issues.push({ path: "ep_finance", reason: "invalid_shape" });

  const linkedIn = parseStored(raw.ep_li);
  if (isObject(linkedIn) && typeof linkedIn.farmUrl === "string") {
    farmUrl = linkedIn.farmUrl.trim();
    addRecord(records, seen, {
      kind: "record", provenanceKey: "legacy:ep_li:farmUrl", recordType: "platform_state",
      title: "موقع مزرعة عبيد", payload: { listingUrl: farmUrl }, amount: null, status: "live",
    });
  } else if (raw.ep_li !== undefined) issues.push({ path: "ep_li", reason: "invalid_shape" });

  const phone = parseStored(raw.ep_owner_whatsapp);
  if (typeof phone === "string" && phone.trim()) ownerWhatsApp = phone.trim();
  else if (raw.ep_owner_whatsapp !== undefined) issues.push({ path: "ep_owner_whatsapp", reason: "invalid_shape" });

  const harvest = parseStored(raw.ep_harvest_log);
  if (!Array.isArray(harvest)) {
    if (raw.ep_harvest_log !== undefined) issues.push({ path: "ep_harvest_log", reason: "invalid_shape" });
  } else if (harvest.length > 0) {
    // Harvest remains authoritative in the Farm OS harvest module; never duplicate it here.
    issues.push({ path: "ep_harvest_log", reason: "invalid_shape" });
  }

  const invalid = issues.some((issue) => issue.reason === "invalid_shape");
  return {
    ok: !invalid, inventory: INVENTORY, records,
    counts: {
      prices: records.filter((record) => record.kind === "record" && record.recordType === "price_observation").length,
      kuwaitStatuses: records.filter((record) => record.kind === "contact" && record.category === "kuwait_distributor").length,
      selectedContacts: records.filter((record) => record.kind === "contact" && record.selected).length,
      harvest: Array.isArray(harvest) ? harvest.length : 0,
      campaignTasks: records.filter((record) => record.kind === "record" && record.recordType === "task" && record.payload.group === "daily_campaign").length,
      platformTasks: records.filter((record) => record.kind === "record" && record.recordType === "task" && record.payload.group === "platform_readiness").length,
      target,
    },
    sourceMetadata: { ownerWhatsApp, farmUrl }, rejectedKeys, issues,
  };
}

export function validateStagedMarketingRecords(value: unknown): value is StagedMarketingRecord[] {
  if (!Array.isArray(value) || value.length > 100) return false;
  return value.every((record) => {
    if (!isObject(record) || typeof record.kind !== "string" || typeof record.provenanceKey !== "string") return false;
    if (!record.provenanceKey.startsWith("legacy:") || record.provenanceKey.length > 300) return false;
    if (record.kind === "contact") {
      return typeof record.name === "string" && record.name.length > 0 && record.name.length <= 200
        && typeof record.category === "string" && CONTACT_CATEGORIES.has(record.category)
        && typeof record.selected === "boolean"
        && (record.phone === null || typeof record.phone === "string")
        && (record.email === null || typeof record.email === "string")
        && (record.orgName === null || typeof record.orgName === "string")
        && (record.source === null || typeof record.source === "string")
        && (record.notes === null || typeof record.notes === "string");
    }
    return record.kind === "record" && typeof record.recordType === "string"
      && RECORD_TYPES.has(record.recordType as MarketingRecordType)
      && typeof record.title === "string" && record.title.length > 0 && record.title.length <= 200
      && isObject(record.payload) && JSON.stringify(record.payload).length <= 32768
      && (record.amount === null || typeof record.amount === "number")
      && (record.status === null || typeof record.status === "string")
      && (record.contactSourceKey === undefined || record.contactSourceKey === null
        || (typeof record.contactSourceKey === "string" && record.contactSourceKey.startsWith("legacy:")));
  });
}
