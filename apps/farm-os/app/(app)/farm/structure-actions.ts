"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";

/**
 * Server actions for the editable farm structure (STRUCT-1) — add/edit/remove sectors, hawshat,
 * lines and palms, plus node media. Every mutation goes through a SECURITY DEFINER RPC that enforces
 * the role gate IN THE DATABASE (structure.write = owner/farm_manager for structure; op.execute for
 * media), so these actions only keep the request authenticated and map the DB error to a field-safe
 * Arabic message (lib/errors). The DB is the single source of truth for the gate. 42501 → Arabic.
 */

const NO_STRUCTURE_PERM = "ليس لديك صلاحية لتعديل هيكل المزرعة";
const NO_MEDIA_PERM = "ليس لديك صلاحية لإضافة مرفقات";

type Result<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

function idFrom(data: unknown): string | undefined {
  return (data as { id?: string } | null)?.id;
}

// ── sectors ─────────────────────────────────────────────────────────────────────────────────────
export async function saveSector(input: {
  id?: string | null;
  farmId?: string | null;
  name: string;
  code: string;
  crop?: string | null;
  areaFeddan?: number | null;
  plantingDate?: string | null;
  notes?: string | null;
}): Promise<Result<string>> {
  await requireMembership();
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_save_sector", {
    p_id: input.id ?? null,
    p_farm_id: input.farmId ?? null,
    p_name: input.name,
    p_code: input.code,
    p_crop: input.crop ?? null,
    p_area_feddan: input.areaFeddan ?? null,
    p_planting_date: input.plantingDate ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_STRUCTURE_PERM }) };
  revalidatePath("/farm");
  const newId = idFrom(data);
  if (newId) revalidatePath(`/farm/sector/${newId}`);
  return { ok: true, data: newId };
}

// ── hawshat ─────────────────────────────────────────────────────────────────────────────────────
export async function saveHawsha(input: {
  id?: string | null;
  sectorId?: string | null;
  name: string;
  code: string;
  areaQirat?: number | null;
  rowCount?: number | null;
  palmCountBarhi?: number | null;
  palmCountMale?: number | null;
  plantingDate?: string | null;
  notes?: string | null;
}): Promise<Result<string>> {
  await requireMembership();
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_save_hawsha", {
    p_id: input.id ?? null,
    p_sector_id: input.sectorId ?? null,
    p_name: input.name,
    p_code: input.code,
    p_area_qirat: input.areaQirat ?? null,
    p_row_count: input.rowCount ?? null,
    p_palm_count_barhi: input.palmCountBarhi ?? null,
    p_palm_count_male: input.palmCountMale ?? null,
    p_planting_date: input.plantingDate ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_STRUCTURE_PERM }) };
  revalidatePath("/farm");
  if (input.sectorId) revalidatePath(`/farm/sector/${input.sectorId}`);
  const newId = idFrom(data);
  if (newId) revalidatePath(`/farm/hawsha/${newId}`);
  return { ok: true, data: newId };
}

// ── lines ───────────────────────────────────────────────────────────────────────────────────────
export async function saveLine(input: {
  id?: string | null;
  hawshaId?: string | null;
  lineNo: number;
  lineCode?: string | null;
  palmCount?: number | null;
  direction?: string | null;
  notes?: string | null;
}): Promise<Result<string>> {
  await requireMembership();
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_save_line", {
    p_id: input.id ?? null,
    p_hawsha_id: input.hawshaId ?? null,
    p_line_no: input.lineNo,
    p_line_code: input.lineCode ?? null,
    p_palm_count: input.palmCount ?? null,
    p_direction: input.direction ?? null,
    p_notes: input.notes ?? null,
  });
  if (error)
    return {
      ok: false,
      error: toArabicError(error, {
        "42501": NO_STRUCTURE_PERM,
        // 23505 = the (hawsha_id, line_no) partial-unique index (migration 0080).
        "23505": "رقم الخط مستخدم بالفعل في هذه الحوشة",
      }),
    };
  revalidatePath("/farm");
  if (input.hawshaId) revalidatePath(`/farm/hawsha/${input.hawshaId}`);
  const newId = idFrom(data);
  if (newId) revalidatePath(`/farm/line/${newId}`);
  return { ok: true, data: newId };
}

// ── palms ───────────────────────────────────────────────────────────────────────────────────────
export async function savePalm(input: {
  id?: string | null;
  hawshaId?: string | null;
  lineId?: string | null;
  name?: string | null;
  variety?: string | null;
  sex?: string | null;
  idTag?: string | null;
  plantingDate?: string | null;
  healthStatus?: string | null;
}): Promise<Result<string>> {
  await requireMembership();
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_save_palm", {
    p_id: input.id ?? null,
    p_hawsha_id: input.hawshaId ?? null,
    p_line_id: input.lineId ?? null,
    p_name: input.name ?? null,
    p_variety: input.variety ?? null,
    p_sex: input.sex ?? null,
    p_id_tag: input.idTag ?? null,
    p_planting_date: input.plantingDate ?? null,
    p_health_status: input.healthStatus ?? null,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_STRUCTURE_PERM }) };
  revalidatePath("/farm");
  if (input.hawshaId) revalidatePath(`/farm/hawsha/${input.hawshaId}`);
  const newId = idFrom(data);
  if (newId) revalidatePath(`/farm/palm/${newId}`);
  return { ok: true, data: newId };
}

// ── remove / restore (cascading soft-delete) ──────────────────────────────────────────────────────
export async function archiveStructure(
  type: "sector" | "hawsha" | "line" | "palm",
  id: string,
  archived: boolean,
): Promise<Result> {
  await requireMembership();
  const sb = await createClient();
  const { error } = await sb.rpc("fn_archive_structure", {
    p_type: type,
    p_id: id,
    p_archived: archived,
  });
  if (error)
    return {
      ok: false,
      error: toArabicError(error, {
        "42501": NO_STRUCTURE_PERM,
        // PT001 = fn_archive_structure refuses to restore a node whose parent is still archived.
        PT001: "استعد العنصر الأصلي (الأعلى) أولاً قبل استعادة هذا العنصر",
      }),
    };
  // A structural archive ripples to the parent's child-list AND every descendant view (and the archive
  // button redirects to the parent), so revalidate the whole /farm subtree — not just this node's own
  // page — else the just-removed row lingers on the parent until a manual refresh. The 'layout' mode
  // revalidates /farm and every nested /farm/* page in one call.
  revalidatePath("/farm", "layout");
  return { ok: true };
}

// ── node media ────────────────────────────────────────────────────────────────────────────────────
export async function addAttachment(input: {
  entityType: "farm" | "sector" | "hawsha" | "line" | "palm";
  entityId: string;
  storagePath: string;
  kind: "photo" | "document";
  caption?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
}): Promise<Result<string>> {
  await requireMembership();
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_add_attachment", {
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_storage_path: input.storagePath,
    p_kind: input.kind,
    p_caption: input.caption ?? null,
    p_content_type: input.contentType ?? null,
    p_size_bytes: input.sizeBytes ?? null,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_MEDIA_PERM }) };
  revalidatePath(`/farm/${input.entityType === "hawsha" ? "hawsha" : input.entityType}/${input.entityId}`);
  return { ok: true, data: idFrom(data) };
}

export async function archiveAttachment(id: string, archived = true): Promise<Result> {
  await requireMembership();
  const sb = await createClient();
  const { error } = await sb.rpc("fn_archive_attachment", { p_id: id, p_archived: archived });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_MEDIA_PERM }) };
  return { ok: true };
}

export interface AttachmentView {
  id: string;
  kind: "photo" | "document";
  caption: string | null;
  url: string | null;
  createdAt: string | null;
}

/**
 * List a node's live attachments with short-lived signed URLs (the bucket is private). RLS scopes the
 * metadata read; the storage RLS scopes the bytes. A missing/unprovisioned bucket degrades to url=null
 * rather than throwing, so the gallery still renders captions.
 */
export async function getAttachments(
  entityType: "farm" | "sector" | "hawsha" | "line" | "palm",
  entityId: string,
): Promise<AttachmentView[]> {
  await requireMembership();
  const sb = await createClient();
  const { data, error } = await sb
    .from("attachments")
    .select("id, kind, caption, storage_path, created_at")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("archived", false)
    .order("created_at", { ascending: false });
  if (error || !data) return [];

  // Batch the signed-URL creation into ONE round-trip (not N): createSignedUrls returns an array aligned
  // to the input paths. A missing/unprovisioned bucket → signed is null → each url falls back to null,
  // preserving the graceful degrade (captions still render).
  const paths = data.map((a) => a.storage_path);
  const { data: signed } = await sb.storage.from("farm-media").createSignedUrls(paths, 3600);
  return data.map((a, i) => ({
    id: a.id,
    kind: (a.kind as "photo" | "document") ?? "photo",
    caption: a.caption ?? null,
    url: signed?.[i]?.signedUrl ?? null,
    createdAt: a.created_at ?? null,
  }));
}
