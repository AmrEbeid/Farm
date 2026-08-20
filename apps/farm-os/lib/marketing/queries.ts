import { createClient } from "@/lib/supabase/server";
import type { MarketingRecordRow } from "@/components/marketing/MarketingRecordTable";
import type { MarketingContactRow, MarketingContactActivityRow } from "@/components/marketing/MarketingContactTable";
import type { MarketingRecordType, Json } from "@/lib/database.types.ext";

/** The three roles the whole marketing module (nav + RLS + RPCs) is gated to. */
export const MARKETING_ROLES = ["owner", "accountant", "farm_manager"] as const;

export function canAccessMarketing(role: string): boolean {
  return (MARKETING_ROLES as readonly string[]).includes(role);
}

export async function loadMarketingRecords(orgId: string, recordTypes: MarketingRecordType[]): Promise<MarketingRecordRow[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from("marketing_record")
    .select("id, title, payload, contact_id, amount, status, archived, record_type")
    .eq("org_id", orgId)
    .in("record_type", recordTypes)
    .order("created_at", { ascending: false });
  if (error) throw error;
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

export async function loadMarketingContacts(orgId: string): Promise<MarketingContactRow[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from("marketing_contact")
    .select("id, name, phone, email, org_name, category, source, notes, selected, archived")
    .eq("org_id", orgId)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    orgName: c.org_name,
    category: c.category,
    source: c.source,
    notes: c.notes,
    selected: c.selected,
    archived: c.archived,
  }));
}

export async function loadMarketingContactActivity(orgId: string): Promise<MarketingContactActivityRow[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from("marketing_contact_activity")
    .select("id, contact_id, kind, notes, occurred_at, follow_up_at")
    .eq("org_id", orgId)
    .order("occurred_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((a) => ({
    id: a.id,
    contactId: a.contact_id,
    kind: a.kind,
    notes: a.notes,
    occurredAt: a.occurred_at,
    followUpAt: a.follow_up_at,
  }));
}

/** Contact options for the {id,name} pickers, active (non-archived) only. */
export function contactOptions(contacts: MarketingContactRow[]): { id: string; name: string }[] {
  return contacts.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name }));
}
