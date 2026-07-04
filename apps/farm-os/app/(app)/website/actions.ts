"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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
