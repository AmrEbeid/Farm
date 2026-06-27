"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";

/**
 * Server actions for ad-hoc activity recording (STAGE 3 / SPEC-0010). Every write goes through a
 * SECURITY DEFINER RPC that enforces op.execute IN the database (fn_record_event / fn_set_event_status /
 * fn_add_event_followup, migration 0054), so these only keep the request authenticated and map the DB
 * error to a field-safe Arabic message. A recorded event rolls up the full location chain, so revalidate
 * the whole /farm subtree.
 */

const NO_OP_PERM = "ليس لديك صلاحية لتسجيل نشاط";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export async function recordEvent(input: {
  locationType: "farm" | "sector" | "hawsha" | "line" | "palm";
  locationId: string;
  type: "operation" | "inspection" | "issue" | "note";
  subtype?: string | null;
  status?: string;
  note?: string | null;
  assignedTo?: string | null;
  qtyMeasure?: string | null;
  qtyValue?: number | null;
  qtyLabel?: string | null;
}): Promise<Result<string>> {
  await requireMembership();
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_record_event", {
    p_location_type: input.locationType,
    p_location_id: input.locationId,
    p_type: input.type,
    p_subtype: input.subtype ?? null,
    p_status: input.status ?? "done",
    p_occurred_at: null,
    p_note: input.note ?? null,
    p_assigned_to: input.assignedTo ?? null,
    p_qty_measure: input.qtyMeasure ?? null,
    p_qty_value: input.qtyValue ?? null,
    p_qty_label: input.qtyLabel ?? null,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_OP_PERM }) };
  revalidatePath("/farm", "layout");
  return { ok: true, data: (data as { event_id?: string } | null)?.event_id };
}

export async function setEventStatus(eventId: string, status: string, note?: string): Promise<Result> {
  await requireMembership();
  const sb = await createClient();
  const { error } = await sb.rpc("fn_set_event_status", {
    p_event_id: eventId,
    p_status: status,
    p_note: note ?? null,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_OP_PERM }) };
  revalidatePath("/farm", "layout");
  return { ok: true };
}

export async function addEventFollowup(input: {
  eventId: string;
  note: string;
  dueAt?: string | null;
  assignedTo?: string | null;
}): Promise<Result> {
  await requireMembership();
  const sb = await createClient();
  const { error } = await sb.rpc("fn_add_event_followup", {
    p_event_id: input.eventId,
    p_note: input.note,
    p_due_at: input.dueAt ?? null,
    p_assigned_to: input.assignedTo ?? null,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_OP_PERM }) };
  revalidatePath("/farm", "layout");
  return { ok: true };
}
