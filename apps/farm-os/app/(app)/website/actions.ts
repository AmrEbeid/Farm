"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";
import { sniffImage, galleryMediaPaths, ALLOWED_IMAGE_TYPES, IMAGE_EXT } from "@/lib/site-media";
import type { SiteContent } from "@/lib/site-content";
import type { Json } from "@/lib/database.types";

// Save the public-site content. The role gate (site.write = owner) is enforced IN THE DATABASE by
// fn_save_site_content (SECURITY DEFINER + authorize), so this only keeps the request authenticated,
// persists the FULL SiteContent object, and revalidates the public page + the editor.
//
// TYPES: fn_save_site_content is declared in the database.types.ext.ts augmentation (STRUCT-1), so the
// rpc name + args are type-checked (only the SiteContent→Json payload needs a boundary cast below).

const NO_PERM = "ليس لديك صلاحية لتعديل محتوى الموقع (تتطلب صلاحية المالك)";

type Result = { ok: true } | { ok: false; error: string };

export async function saveSiteContent(input: {
  orgId: string;
  content: SiteContent;
}): Promise<Result> {
  const m = await requireMembership();
  // AUTHZ GATE (security-360 HIGH-1): the storage cleanup below runs on the RLS-BYPASSING service-role
  // admin client, so it MUST be authorized HERE — the fn_save_site_content `site.write` gate cannot
  // protect a `storage.remove()` that runs before it. Require owner (same gate as the RPC and
  // uploadGalleryImage) AND pin the org to the caller's session membership, never the client-supplied
  // arg. Without this, any authenticated non-owner could wipe the public gallery (the RPC would then
  // reject the content write, but the images would already be gone), and a forged `orgId` would delete
  // another org's gallery objects (cross-tenant IDOR via the RLS-bypassing client).
  if (m.role !== "owner" || input.orgId !== m.orgId) {
    return { ok: false, error: NO_PERM };
  }
  const sb = await createClient();

  // Best-effort storage cleanup: delete site-media gallery objects this save removes/replaces so the
  // bucket doesn't accumulate orphans as the owner iterates on photos. Never blocks the save.
  try {
    const admin = createAdminClient();
    const { data: oldRow } = await admin
      .from("site_content")
      .select("content")
      .eq("org_id", input.orgId)
      .maybeSingle();
    const oldPaths = galleryMediaPaths(oldRow?.content as SiteContent | undefined);
    const newPaths = new Set(galleryMediaPaths(input.content));
    const removed = oldPaths.filter((p) => !newPaths.has(p));
    if (removed.length) await admin.storage.from("site-media").remove(removed);
  } catch {
    // storage hiccup must not fail the content save
  }

  const { error } = await sb.rpc("fn_save_site_content", {
    p_org: input.orgId,
    // SiteContent is a structural object; Supabase's Json type lacks its index signature, so a
    // narrow boundary cast is required (the rpc name + p_org are now type-checked).
    p_content: input.content as unknown as Json,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_PERM }) };
  revalidatePath("/");
  revalidatePath("/website");
  return { ok: true };
}

const MAX_BYTES = 5 * 1024 * 1024;

// Upload a gallery image to the public `site-media` bucket and return its public URL. Owner-gated
// (like the content save). Runs server-side via the service-role admin client, so no client write
// path to storage exists. The returned URL is stored as a gallery item's `image`.
//
// BUCKET: `site-media` is provisioned in prod (public read, 5 MB limit, image mime types) via the
// Supabase MCP — NOT a repo migration (the local pgTAP harness runs on a bare Postgres without the
// `storage` schema, so a storage.buckets insert would break it). Recorded in DEPLOY-STATUS.md.
export async function uploadGalleryImage(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const m = await requireMembership();
  if (m.role !== "owner") return { ok: false, error: NO_PERM };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "لم يتم اختيار ملف" };
  if (file.size > MAX_BYTES) return { ok: false, error: "الحد الأقصى لحجم الصورة 5 ميجابايت" };

  // Trust the file's CONTENT, not its declared type or name: sniff the magic bytes and derive both
  // the stored content-type and the extension server-side (no path/type comes from the client).
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type || !ALLOWED_IMAGE_TYPES.has(type)) {
    return { ok: false, error: "الملف ليس صورة صالحة (JPG / PNG / WebP / AVIF)" };
  }

  const path = `gallery/${crypto.randomUUID()}.${IMAGE_EXT[type]}`;
  const sb = createAdminClient();
  const { error } = await sb.storage
    .from("site-media")
    .upload(path, bytes, { contentType: type, upsert: false });
  if (error) return { ok: false, error: "تعذّر رفع الصورة، حاول مجددًا" };

  const { data } = sb.storage.from("site-media").getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}
