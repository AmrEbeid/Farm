"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Switch the signed-in user's active org (Stage 1, migration 0085).
 *
 * fn_set_active_org validates membership server-side and upserts the preference; we then
 * refresh the session so the custom_access_token hook re-mints the JWT with the new
 * active_org_id claim — only after that does RLS (public.user_org_ids()) narrow to the new
 * org. The caller should reload so every server component re-reads under the new token.
 */
export async function setActiveOrg(
  orgId: string,
): Promise<{ ok: boolean; error?: string }> {
  const sb = await createClient();
  const { error } = await sb.rpc("fn_set_active_org", { p_org: orgId });
  if (error) return { ok: false, error: "تعذّر تبديل المزرعة" };
  await sb.auth.refreshSession();
  revalidatePath("/", "layout");
  return { ok: true };
}
