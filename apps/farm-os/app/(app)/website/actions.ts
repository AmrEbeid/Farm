"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";
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

const BUCKET_PREFIX = "/site-media/";

// Object paths of gallery images that live in the `site-media` bucket (placeholders under
// /site/gallery and external URLs are ignored — we only ever delete objects we uploaded).
function galleryMediaPaths(content: SiteContent | null | undefined): string[] {
  const paths: string[] = [];
  for (const it of content?.gallery?.items ?? []) {
    const url = it?.image ?? "";
    const idx = url.indexOf(BUCKET_PREFIX);
    if (idx >= 0) paths.push(url.slice(idx + BUCKET_PREFIX.length));
  }
  return paths;
}

export async function saveSiteContent(input: {
  orgId: string;
  content: SiteContent;
}): Promise<Result> {
  await requireMembership();
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
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

// Determine the real image type from magic bytes — do NOT trust the client-declared file.type.
// Returns null for anything that isn't one of the allowed image formats.
function sniffImage(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return null;
}

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
  if (!type || !ALLOWED.has(type)) {
    return { ok: false, error: "الملف ليس صورة صالحة (JPG / PNG / WebP / AVIF)" };
  }

  const path = `gallery/${crypto.randomUUID()}.${EXT[type]}`;
  const sb = createAdminClient();
  const { error } = await sb.storage
    .from("site-media")
    .upload(path, bytes, { contentType: type, upsert: false });
  if (error) return { ok: false, error: "تعذّر رفع الصورة، حاول مجددًا" };

  const { data } = sb.storage.from("site-media").getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}
