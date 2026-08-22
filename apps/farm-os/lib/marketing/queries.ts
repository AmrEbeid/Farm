import { createClient } from "@/lib/supabase/server";
import type { MarketingRecordRow } from "@/components/marketing/MarketingRecordTable";
import type { MarketingContactRow, MarketingContactActivityRow } from "@/components/marketing/MarketingContactTable";
import type { MarketingRecordType, Json } from "@/lib/database.types.ext";
import type { DailySalesSectorLedgerRow } from "@/lib/marketing/workspace/daily-sales-report";

/** The three roles the whole marketing module (nav + RLS + RPCs) is gated to. */
export const MARKETING_ROLES = ["owner", "accountant", "farm_manager"] as const;
const MARKETING_SUPPORT_ROW_LIMIT = 500;

export function canAccessMarketing(role: string): boolean {
  return (MARKETING_ROLES as readonly string[]).includes(role);
}

export interface MarketingDashboardActivity {
  id: string;
  contactId: string;
  contactName: string;
  kind: string;
  notes: string | null;
  occurredAt: string;
  followUpAt: string | null;
}

export interface MarketingDashboardSnapshot {
  activeContacts: number;
  selectedContacts: number;
  activeRecords: number;
  overdueFollowUps: number;
  dueFollowUps7Days: number;
  recordsByType: Record<string, number>;
  recordsByStatus: Record<string, number>;
  recentActivity: MarketingDashboardActivity[];
  latestImport: Record<string, Json> | null;
}

function jsonObject(value: Json | undefined): Record<string, Json> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json>
    : {};
}

function jsonCountMap(value: Json | undefined): Record<string, number> {
  return Object.fromEntries(
    Object.entries(jsonObject(value))
      .filter((entry): entry is [string, number] => typeof entry[1] === "number"),
  );
}

export async function loadMarketingDashboardSnapshot(orgId: string): Promise<MarketingDashboardSnapshot> {
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_marketing_dashboard_snapshot", { p_org: orgId });
  if (error) throw error;
  const value = jsonObject(data);
  const activities = Array.isArray(value.recentActivity) ? value.recentActivity : [];
  return {
    activeContacts: typeof value.activeContacts === "number" ? value.activeContacts : 0,
    selectedContacts: typeof value.selectedContacts === "number" ? value.selectedContacts : 0,
    activeRecords: typeof value.activeRecords === "number" ? value.activeRecords : 0,
    overdueFollowUps: typeof value.overdueFollowUps === "number" ? value.overdueFollowUps : 0,
    dueFollowUps7Days: typeof value.dueFollowUps7Days === "number" ? value.dueFollowUps7Days : 0,
    recordsByType: jsonCountMap(value.recordsByType),
    recordsByStatus: jsonCountMap(value.recordsByStatus),
    recentActivity: activities.flatMap((activity) => {
      const row = jsonObject(activity);
      if (typeof row.id !== "string" || typeof row.contact_id !== "string" || typeof row.contact_name !== "string") return [];
      return [{
        id: row.id,
        contactId: row.contact_id,
        contactName: row.contact_name,
        kind: typeof row.kind === "string" ? row.kind : "note",
        notes: typeof row.notes === "string" ? row.notes : null,
        occurredAt: typeof row.occurred_at === "string" ? row.occurred_at : "",
        followUpAt: typeof row.follow_up_at === "string" ? row.follow_up_at : null,
      }];
    }),
    latestImport: value.latestImport && typeof value.latestImport === "object" && !Array.isArray(value.latestImport)
      ? value.latestImport as Record<string, Json>
      : null,
  };
}

export async function loadMarketingWorkspaceControlValues(
  orgId: string,
  areaId: string,
): Promise<Record<string, Json>> {
  const sb = await createClient();
  const { data, error } = await sb
    .from("marketing_workspace_control")
    .select("control_key, value")
    .eq("org_id", orgId)
    .eq("area_id", areaId)
    .limit(500);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((row) => [row.control_key, row.value]));
}

export interface MarketingWorkspaceAggregates {
  dailySectorLedger: DailySalesSectorLedgerRow[];
  weeklyAvailability: { weeks: number; premiumTons: number; largeTons: number; commercialTons: number; totalTons: number };
}

export async function loadMarketingWorkspaceAggregates(orgId: string): Promise<MarketingWorkspaceAggregates> {
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_marketing_workspace_aggregates", { p_org: orgId });
  if (error) throw error;
  const value = jsonObject(data);
  const weekly = jsonObject(value.weeklyAvailability);
  const numberValue = (input: Json | undefined) => typeof input === "number" ? input : 0;
  return {
    dailySectorLedger: (Array.isArray(value.dailySectorLedger) ? value.dailySectorLedger : []).flatMap((item) => {
      const row = jsonObject(item);
      if (typeof row.name !== "string") return [];
      return [{
        name: row.name,
        days: numberValue(row.days),
        qtyKg: numberValue(row.qtyKg),
        revenue: numberValue(row.revenue),
        expenses: numberValue(row.expenses),
        net: numberValue(row.net),
        avgPrice: numberValue(row.avgPrice),
      }];
    }),
    weeklyAvailability: (() => {
      const premiumTons = numberValue(weekly.premiumTons);
      const largeTons = numberValue(weekly.largeTons);
      const commercialTons = numberValue(weekly.commercialTons);
      return {
        weeks: numberValue(weekly.weeks),
        premiumTons,
        largeTons,
        commercialTons,
        totalTons: premiumTons + largeTons + commercialTons,
      };
    })(),
  };
}

export async function loadMarketingRecords(orgId: string, recordTypes: MarketingRecordType[]): Promise<MarketingRecordRow[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from("marketing_record")
    .select("id, title, payload, contact_id, amount, status, archived, record_type")
    .eq("org_id", orgId)
    .in("record_type", recordTypes)
    .order("created_at", { ascending: false })
    .limit(MARKETING_SUPPORT_ROW_LIMIT + 1);
  if (error) throw error;
  if ((data?.length ?? 0) > MARKETING_SUPPORT_ROW_LIMIT) {
    throw new Error("Marketing record support query exceeded its reviewed row limit");
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    recordType: r.record_type as MarketingRecordType,
    title: r.title,
    payload: (r.payload as Record<string, Json>) ?? {},
    contactId: r.contact_id,
    amount: r.amount,
    status: r.status,
    archived: r.archived,
  }));
}

export interface MarketingRecordsPage {
  rows: MarketingRecordRow[];
  page: number;
  pages: number;
}

/** Page each requested record type independently so one busy register cannot starve another. */
export async function loadMarketingRecordsPage(
  orgId: string,
  recordTypes: MarketingRecordType[],
  page = 1,
  pageSize = 100,
): Promise<MarketingRecordsPage> {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safePageSize = Number.isInteger(pageSize) ? Math.min(Math.max(pageSize, 1), 100) : 100;
  const sb = await createClient();
  const results = await Promise.all(recordTypes.map(async (recordType) => {
    const from = (safePage - 1) * safePageSize;
    const { data, error, count } = await sb
      .from("marketing_record")
      .select("id, title, payload, contact_id, amount, status, archived, record_type", { count: "exact" })
      .eq("org_id", orgId)
      .eq("record_type", recordType)
      .order("created_at", { ascending: false })
      .range(from, from + safePageSize - 1);
    if (error) throw error;
    return {
      count: count ?? 0,
      rows: (data ?? []).map((r) => ({
        id: r.id,
        recordType: r.record_type as MarketingRecordType,
        title: r.title,
        payload: (r.payload as Record<string, Json>) ?? {},
        contactId: r.contact_id,
        amount: r.amount,
        status: r.status,
        archived: r.archived,
      })),
    };
  }));
  return {
    rows: results.flatMap((result) => result.rows),
    page: safePage,
    pages: results.reduce((max, result) => Math.max(max, Math.ceil(result.count / safePageSize)), 0),
  };
}

export async function loadMarketingContactsByCategory(
  orgId: string,
  category: "exporter" | "buyer_lead" | "kuwait_distributor" | "platform" | "freight" | "other",
): Promise<MarketingContactRow[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from("marketing_contact")
    .select("id, name, phone, email, org_name, category, source, notes, selected, archived, metadata")
    .eq("org_id", orgId)
    .eq("category", category)
    .eq("archived", false)
    .order("name")
    .limit(MARKETING_SUPPORT_ROW_LIMIT + 1);
  if (error) throw error;
  if ((data?.length ?? 0) > MARKETING_SUPPORT_ROW_LIMIT) {
    throw new Error("Marketing contact support query exceeded its reviewed row limit");
  }
  return (data ?? []).map((contact) => ({
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    orgName: contact.org_name,
    category: contact.category,
    source: contact.source,
    notes: contact.notes,
    status: typeof jsonObject(contact.metadata as Json).status === "string" ? String(jsonObject(contact.metadata as Json).status) : null,
    selected: contact.selected,
    archived: contact.archived,
  }));
}

export async function loadMarketingPipelineContacts(
  orgId: string,
  linkedContactIds: string[],
): Promise<MarketingContactRow[]> {
  const sb = await createClient();
  let query = sb
    .from("marketing_contact")
    .select("id, name, phone, email, org_name, category, source, notes, selected, archived, metadata")
    .eq("org_id", orgId)
    .eq("archived", false);
  query = linkedContactIds.length > 0
    ? query.or(`selected.eq.true,id.in.(${linkedContactIds.join(",")})`)
    : query.eq("selected", true);
  const { data, error } = await query.order("name").limit(MARKETING_SUPPORT_ROW_LIMIT + 1);
  if (error) throw error;
  if ((data?.length ?? 0) > MARKETING_SUPPORT_ROW_LIMIT) {
    throw new Error("Marketing pipeline support query exceeded its reviewed row limit");
  }
  return (data ?? []).map((contact) => ({
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    orgName: contact.org_name,
    category: contact.category,
    source: contact.source,
    notes: contact.notes,
    status: typeof jsonObject(contact.metadata as Json).status === "string" ? String(jsonObject(contact.metadata as Json).status) : null,
    selected: contact.selected,
    archived: contact.archived,
  }));
}

export interface MarketingContactsPage {
  rows: MarketingContactRow[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export async function loadMarketingContactsPage(
  orgId: string,
  options: {
    query?: string | null;
    category?: string | null;
    includeArchived?: boolean;
    page?: number;
    pageSize?: number;
  } = {},
): Promise<MarketingContactsPage> {
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_marketing_contacts_page", {
    p_org: orgId,
    p_query: options.query ?? null,
    p_category: options.category ?? null,
    p_archived: options.includeArchived ? null : false,
    p_page: options.page ?? 1,
    p_page_size: options.pageSize ?? 50,
  });
  if (error) throw error;
  const value = jsonObject(data);
  const sourceRows = Array.isArray(value.rows) ? value.rows : [];
  return {
    rows: sourceRows.flatMap((sourceRow) => {
      const row = jsonObject(sourceRow);
      if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.category !== "string") return [];
      return [{
        id: row.id,
        name: row.name,
        phone: typeof row.phone === "string" ? row.phone : null,
        email: typeof row.email === "string" ? row.email : null,
        orgName: typeof row.org_name === "string" ? row.org_name : null,
        category: row.category,
        source: typeof row.source === "string" ? row.source : null,
        notes: typeof row.notes === "string" ? row.notes : null,
        status: typeof jsonObject(row.metadata).status === "string" ? String(jsonObject(row.metadata).status) : null,
        selected: row.selected === true,
        archived: row.archived === true,
      }];
    }),
    total: typeof value.total === "number" ? value.total : 0,
    page: typeof value.page === "number" ? value.page : 1,
    pageSize: typeof value.pageSize === "number" ? value.pageSize : 50,
    pages: typeof value.pages === "number" ? value.pages : 0,
  };
}

export async function loadMarketingContactIdsByCategory(
  orgId: string,
  category: "exporter" | "buyer_lead" | "kuwait_distributor" | "platform" | "freight" | "other",
): Promise<string[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from("marketing_contact")
    .select("id")
    .eq("org_id", orgId)
    .eq("category", category)
    .eq("archived", false)
    .limit(MARKETING_SUPPORT_ROW_LIMIT + 1);
  if (error) throw error;
  if ((data?.length ?? 0) > MARKETING_SUPPORT_ROW_LIMIT) {
    throw new Error("Marketing contact ID query exceeded its reviewed row limit");
  }
  return (data ?? []).map((row) => row.id);
}

export async function loadMarketingContactActivityForContacts(
  orgId: string,
  contactIds: string[],
): Promise<MarketingContactActivityRow[]> {
  if (contactIds.length === 0) return [];
  const sb = await createClient();
  const { data, error } = await sb
    .from("marketing_contact_activity")
    .select("id, contact_id, kind, notes, occurred_at, follow_up_at")
    .eq("org_id", orgId)
    .in("contact_id", contactIds)
    .order("occurred_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []).map((activity) => ({
    id: activity.id,
    contactId: activity.contact_id,
    kind: activity.kind,
    notes: activity.notes,
    occurredAt: activity.occurred_at,
    followUpAt: activity.follow_up_at,
  }));
}

/** Contact options for the {id,name} pickers, active (non-archived) only. */
export function contactOptions(contacts: MarketingContactRow[]): { id: string; name: string }[] {
  return contacts.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name }));
}

/** Count contacts whose imported/edited status has moved beyond either source initial state. */
export async function loadMarketingContactedCount(
  orgId: string,
  category: "exporter" | "buyer_lead" | "kuwait_distributor" | "platform" | "freight" | "other",
): Promise<number> {
  const sb = await createClient();
  const { count, error } = await sb
    .from("marketing_contact")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("category", category)
    .eq("archived", false)
    .neq("metadata->>status", "لم يبدأ")
    .neq("metadata->>status", "لم يتم التواصل");
  if (error) throw error;
  return count ?? 0;
}

export async function loadMarketingSelectedContacts(orgId: string): Promise<MarketingContactRow[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from("marketing_contact")
    .select("id, name, phone, email, org_name, category, source, notes, selected, archived, metadata")
    .eq("org_id", orgId)
    .eq("selected", true)
    .eq("archived", false)
    .order("name")
    .limit(MARKETING_SUPPORT_ROW_LIMIT + 1);
  if (error) throw error;
  if ((data?.length ?? 0) > MARKETING_SUPPORT_ROW_LIMIT) {
    throw new Error("Marketing selected-contact query exceeded its reviewed row limit");
  }
  return (data ?? []).map((contact) => ({
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    orgName: contact.org_name,
    category: contact.category,
    source: contact.source,
    notes: contact.notes,
    status: typeof jsonObject(contact.metadata as Json).status === "string" ? String(jsonObject(contact.metadata as Json).status) : null,
    selected: contact.selected,
    archived: contact.archived,
  }));
}
