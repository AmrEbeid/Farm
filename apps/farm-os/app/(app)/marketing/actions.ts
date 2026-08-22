"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";
import type { Json } from "@/lib/database.types.ext";
import type { MarketingRecordType } from "@/lib/database.types.ext";
import { validateMarketingRecordInput } from "@/lib/marketing/validate-record";

/**
 * Server actions for the Marketing module (SPEC-0032). Every mutation goes through a SECURITY
 * DEFINER RPC that enforces the owner/accountant/farm_manager role gate IN THE DATABASE (an explicit
 * inline check against organization_member — no authorize() re-emit), so these only keep the request
 * authenticated, revalidate the touched pages, and map the DB error to an Arabic message.
 */

const NO_PERM = "ليس لديك صلاحية لتعديل بيانات التسويق (تتطلب مالك أو محاسب أو مدير مزرعة)";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const MARKETING_PATHS = [
  "/marketing",
  "/marketing/product",
  "/marketing/markets",
  "/marketing/pipeline",
  "/marketing/campaigns",
] as const;

function revalidateMarketing() {
  for (const path of MARKETING_PATHS) revalidatePath(path);
}

export interface MarketingContactInput {
  id?: string | null;
  orgId?: string | null;
  name: string;
  phone?: string | null;
  email?: string | null;
  orgName?: string | null;
  category: string;
  source?: string | null;
  notes?: string | null;
  selected?: boolean;
  sourceKey?: string | null;
}

export async function saveMarketingContact(input: MarketingContactInput): Promise<Result<string>> {
  await requireMembership();
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_save_marketing_contact", {
    p_id: input.id ?? null,
    p_org: input.orgId ?? null,
    p_name: input.name,
    p_phone: input.phone ?? null,
    p_email: input.email ?? null,
    p_org_name: input.orgName ?? null,
    p_category: input.category,
    p_source: input.source ?? null,
    p_notes: input.notes ?? null,
    p_selected: input.selected ?? false,
    p_source_key: input.sourceKey ?? null,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_PERM }) };
  revalidateMarketing();
  return { ok: true, data: (data as { id?: string } | null)?.id };
}

export async function archiveMarketingContact(id: string, archived = true): Promise<Result> {
  await requireMembership();
  const sb = await createClient();
  const { error } = await sb.rpc("fn_archive_marketing_contact", { p_id: id, p_archived: archived });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_PERM }) };
  revalidateMarketing();
  return { ok: true };
}

export async function logMarketingContactActivity(input: {
  contactId: string;
  kind: string;
  notes?: string | null;
  occurredAt?: string | null;
  followUpAt?: string | null;
}): Promise<Result<string>> {
  await requireMembership();
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_log_marketing_contact_activity", {
    p_contact_id: input.contactId,
    p_kind: input.kind,
    p_notes: input.notes ?? null,
    p_occurred_at: input.occurredAt ?? undefined,
    p_follow_up_at: input.followUpAt ?? null,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_PERM }) };
  revalidateMarketing();
  return { ok: true, data: (data as { id?: string } | null)?.id };
}

export interface MarketingRecordInput {
  id?: string | null;
  orgId?: string | null;
  recordType: MarketingRecordType;
  title: string;
  payload: Json;
  contactId?: string | null;
  amount?: number | null;
  status?: string | null;
  sourceKey?: string | null;
}

export async function saveMarketingRecord(input: MarketingRecordInput): Promise<Result<string>> {
  const validation = validateMarketingRecordInput(input.recordType, {
    title: input.title,
    payload: input.payload,
    amount: input.amount,
  });
  if (!validation.ok) return { ok: false, error: validation.error ?? "بيانات السجل غير صالحة." };

  await requireMembership();
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_save_marketing_record", {
    p_id: input.id ?? null,
    p_org: input.orgId ?? null,
    p_record_type: input.recordType,
    p_title: input.title,
    p_payload: input.payload,
    p_contact_id: input.contactId ?? null,
    p_amount: input.amount ?? null,
    p_status: input.status ?? null,
    p_source_key: input.sourceKey ?? null,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_PERM }) };
  revalidateMarketing();
  return { ok: true, data: (data as { id?: string } | null)?.id };
}

export async function archiveMarketingRecord(id: string, archived = true): Promise<Result> {
  await requireMembership();
  const sb = await createClient();
  const { error } = await sb.rpc("fn_archive_marketing_record", { p_id: id, p_archived: archived });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_PERM }) };
  revalidateMarketing();
  return { ok: true };
}
