"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";

/**
 * Update a palm's current status and append to its per-tree status history.
 *
 * Both writes go through the SECURITY DEFINER RPC fn_update_palm_status (migration 0039), which
 * (a) enforces the FIELD-role gate IN THE DATABASE — op.execute = owner/farm_manager/agri_engineer/
 * supervisor, scoped to the asset's org — so accountant/storekeeper cannot change tree health even
 * via direct PostgREST (the bare `assets` RLS is org-scoped only, no role gate); and (b) runs the
 * status UPDATE + the history INSERT in ONE transaction, so a history failure rolls the status
 * change back — the status never flips without its audit trail. requireMembership() keeps the action
 * authenticated; the DB is the single source of truth for the role gate. 42501 → Arabic permission.
 */
export async function updatePalmStatus(assetId: string, status: string, reason: string) {
  await requireMembership();

  const sb = await createClient();
  const { error } = await sb.rpc("fn_update_palm_status", {
    p_asset_id: assetId,
    p_status: status,
    p_note: reason,
  });
  if (error) {
    return {
      ok: false as const,
      error: toArabicError(error, {
        "42501": "ليس لديك صلاحية لتغيير حالة النخلة",
      }),
    };
  }

  revalidatePath(`/farm/palm/${assetId}`);
  return { ok: true as const };
}
