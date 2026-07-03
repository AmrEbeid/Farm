"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";
import type { SiteContent } from "@/lib/site-content";

// Save the public-site content. The role gate (site.write = owner) is enforced IN THE DATABASE by
// fn_save_site_content (SECURITY DEFINER + authorize), so this only keeps the request authenticated,
// persists the FULL SiteContent object, and revalidates the public page + the editor.
//
// TYPES: fn_save_site_content is added by migration 20260701420000; database.types.ext.ts regenerates
// after the Owner applies it (A1). Until then the rpc name/args are cast.

const NO_PERM = "ليس لديك صلاحية لتعديل محتوى الموقع (تتطلب صلاحية المالك)";

type Result = { ok: true } | { ok: false; error: string };

export async function saveSiteContent(input: {
  orgId: string;
  content: SiteContent;
}): Promise<Result> {
  await requireMembership();
  const sb = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fn_save_site_content untyped until post-apply regen (A1)
  const { error } = await (sb.rpc as any)("fn_save_site_content", {
    p_org: input.orgId,
    p_content: input.content,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_PERM }) };
  revalidatePath("/");
  revalidatePath("/website");
  return { ok: true };
}
