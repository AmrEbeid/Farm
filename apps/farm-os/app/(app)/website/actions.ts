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

export async function saveSiteContent(input: {
  orgId: string;
  content: SiteContent;
}): Promise<Result> {
  await requireMembership();
  const sb = await createClient();
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
  if (!ALLOWED.has(file.type)) return { ok: false, error: "الصيغة غير مدعومة (JPG / PNG / WebP / AVIF)" };

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `gallery/${crypto.randomUUID()}.${ext}`;
  const sb = createAdminClient();
  const { error } = await sb.storage
    .from("site-media")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { ok: false, error: "تعذّر رفع الصورة، حاول مجددًا" };

  const { data } = sb.storage.from("site-media").getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}
