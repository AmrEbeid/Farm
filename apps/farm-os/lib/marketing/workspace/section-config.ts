// SPEC-0032 marketing workspace — per-section config for every "records" / "reference" area
// blueprint section (lib/marketing/fidelity-manifest.ts). One generic <MarketingRecordTable> renders
// all of them; this file only supplies the field shape, status options, and — for the several
// blueprint sections that share one `recordType` across more than one legacy tab (e.g.
// `market_reference` backs price-types/market-notes/logistics-notes/china-notes/exw-settings/
// compose-settings) — the `payload.kind` discriminator that both creates new rows tagged correctly
// (`fixedPayload`) and filters existing ones back out (`filter`).
import type { MarketingRecordField, MarketingRecordRow } from "@/components/marketing/MarketingRecordTable";
import type { MarketingRecordType, Json } from "@/lib/database.types.ext";
import {
  QUALITY_BATCH_FIELDS,
  WEEKLY_AVAILABILITY_FIELDS,
  FARM_MARKETING_FACT_FIELDS,
  PRICE_OBSERVATION_FIELDS,
  COMPETITOR_FIELDS,
  LEAD_FIELDS,
  LEAD_STATUS_OPTIONS,
  EXW_BID_FIELDS,
  BROKER_STATE_FIELDS,
  BROKER_STATUS_OPTIONS,
  TASK_STATUS_OPTIONS,
  PLATFORM_STATE_FIELDS,
  PLATFORM_STATUS_OPTIONS,
  CERTIFICATE_FIELDS,
  CERTIFICATE_STATUS_OPTIONS,
  CHANNEL_TARGET_FIELDS,
  FREIGHT_REFERENCE_FIELDS,
  MARKET_REFERENCE_FIELDS,
  DAILY_SALES_REPORT_FIELDS,
  REPEAT_CUSTOMER_FIELDS,
  EXW_SETTINGS_FIELDS,
  COMPOSE_SETTINGS_FIELDS,
  LINKEDIN_PROFILE_FIELDS,
} from "../fields";

export interface WorkspaceRecordSectionConfig {
  recordType: MarketingRecordType;
  fields: MarketingRecordField[];
  hasAmount?: boolean;
  amountLabel?: string;
  hasStatus?: boolean;
  statusOptions?: { value: string; label: string }[];
  fixedPayload?: Record<string, Json>;
  filter?: (row: MarketingRecordRow) => boolean;
  contactCategory?: "exporter" | "kuwait_distributor";
  addLabel?: string;
  empty?: string;
}

const byKind = (kind: string) => (row: MarketingRecordRow) => row.payload.kind === kind;

/** Keyed by the area blueprint's `section.id` — every "records"/"reference" section must have one
 *  (asserted in `section-config.test.ts`). */
export const WORKSPACE_RECORD_SECTIONS: Record<string, WorkspaceRecordSectionConfig> = {
  "weekly-availability": { recordType: "weekly_availability", fields: WEEKLY_AVAILABILITY_FIELDS },
  "farm-facts": {
    recordType: "market_reference",
    fields: FARM_MARKETING_FACT_FIELDS,
    filter: (row) => row.payload.farmAreaFeddan != null,
  },
  "offshoot-leads": { recordType: "lead_offshoot", fields: LEAD_FIELDS, hasAmount: true, amountLabel: "القيمة المتوقعة (دولار)", hasStatus: true, statusOptions: LEAD_STATUS_OPTIONS },
  "price-log": { recordType: "price_observation", fields: PRICE_OBSERVATION_FIELDS, hasAmount: true, amountLabel: "متوسط السعر (جنيه/كجم)" },
  "price-types": {
    recordType: "market_reference",
    fields: MARKET_REFERENCE_FIELDS,
    fixedPayload: { kind: "price_type" },
    filter: byKind("price_type"),
  },
  "market-references": {
    recordType: "market_reference",
    fields: MARKET_REFERENCE_FIELDS,
    fixedPayload: { kind: "market_note" },
    filter: byKind("market_note"),
  },
  "local-leads": { recordType: "lead_local", fields: LEAD_FIELDS, hasAmount: true, amountLabel: "القيمة المتوقعة (دولار)", hasStatus: true, statusOptions: LEAD_STATUS_OPTIONS },
  "repeat-customers": { recordType: "repeat_customer", fields: REPEAT_CUSTOMER_FIELDS },
  "freight-references": { recordType: "freight_reference", fields: FREIGHT_REFERENCE_FIELDS },
  "logistics-notes": {
    recordType: "market_reference",
    fields: MARKET_REFERENCE_FIELDS,
    fixedPayload: { kind: "logistics_note" },
    filter: byKind("logistics_note"),
  },
  "qc-log": { recordType: "quality_batch", fields: QUALITY_BATCH_FIELDS },
  certificates: { recordType: "certificate", fields: CERTIFICATE_FIELDS, hasStatus: true, statusOptions: CERTIFICATE_STATUS_OPTIONS },
  "kuwait-followups": {
    recordType: "task",
    fields: [],
    hasStatus: true,
    statusOptions: TASK_STATUS_OPTIONS,
    fixedPayload: { group: "kuwait_followup" },
    filter: (row) => row.payload.group === "kuwait_followup",
    contactCategory: "kuwait_distributor",
    addLabel: "+ إضافة متابعة موزّع",
    empty: "لا توجد متابعات لموزّعي الكويت بعد",
  },
  "china-notes": {
    recordType: "market_reference",
    fields: MARKET_REFERENCE_FIELDS,
    fixedPayload: { kind: "china_note" },
    filter: byKind("china_note"),
  },
  "hot-leads": { recordType: "hot_lead", fields: LEAD_FIELDS, hasAmount: true, amountLabel: "القيمة المتوقعة (دولار)", hasStatus: true, statusOptions: LEAD_STATUS_OPTIONS, contactCategory: "exporter" },
  "exw-bids": { recordType: "exw_bid", fields: EXW_BID_FIELDS, hasAmount: true, amountLabel: "السعر (دولار/طن)" },
  "exw-settings": {
    recordType: "market_reference",
    fields: EXW_SETTINGS_FIELDS,
    fixedPayload: { kind: "exw_settings" },
    filter: byKind("exw_settings"),
  },
  "competitor-notes": { recordType: "competitor", fields: COMPETITOR_FIELDS },
  "linkedin-profile": {
    recordType: "platform_state",
    fields: LINKEDIN_PROFILE_FIELDS,
    hasStatus: true,
    statusOptions: PLATFORM_STATUS_OPTIONS,
    fixedPayload: { kind: "linkedin_profile" },
    filter: byKind("linkedin_profile"),
  },
  "linkedin-leads": { recordType: "lead_linkedin", fields: LEAD_FIELDS, hasAmount: true, amountLabel: "القيمة المتوقعة (دولار)", hasStatus: true, statusOptions: LEAD_STATUS_OPTIONS },
  "broker-tracking": { recordType: "broker_state", fields: BROKER_STATE_FIELDS, hasStatus: true, statusOptions: BROKER_STATUS_OPTIONS },
  "social-sightings": {
    recordType: "price_observation",
    fields: PRICE_OBSERVATION_FIELDS,
    hasAmount: true,
    amountLabel: "متوسط السعر (جنيه/كجم)",
    fixedPayload: { kind: "social_sighting" },
    filter: byKind("social_sighting"),
  },
  "compose-settings": {
    recordType: "market_reference",
    fields: COMPOSE_SETTINGS_FIELDS,
    fixedPayload: { kind: "compose_settings" },
    filter: byKind("compose_settings"),
  },
  "platform-register": {
    recordType: "platform_state",
    fields: PLATFORM_STATE_FIELDS,
    hasStatus: true,
    statusOptions: PLATFORM_STATUS_OPTIONS,
    filter: (row) => row.payload.kind !== "linkedin_profile",
  },
  "daily-reports": { recordType: "daily_sales_report", fields: DAILY_SALES_REPORT_FIELDS },
  "channel-targets": { recordType: "channel_target", fields: CHANNEL_TARGET_FIELDS, hasAmount: true, amountLabel: "الهدف (دولار)" },
};
