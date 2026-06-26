"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";

// assets.status — the closed set from migration 0003.
const ALLOWED_STATUS = ["active", "watch", "sick", "dead", "removed", "replaced"] as const;
type PalmStatus = (typeof ALLOWED_STATUS)[number];

/**
 * Update a palm's current status and append to its per-tree status history.
 * Field roles tend the trees (accountant/storekeeper don't change tree health);
 * RLS scopes both writes to the caller's org. `palm_status_history` is the audit
 * trail (DELETE revoked in migration 0027). The history insert never blocks the
 * status change — but if the status update fails, nothing is logged.
 */
export async function updatePalmStatus(assetId: string, status: string, reason: string) {
  const m = await requireRole(["supervisor", "agri_engineer", "farm_manager", "owner"]);

  if (!ALLOWED_STATUS.includes(status as PalmStatus)) {
    return { ok: false as const, error: "حالة غير صالحة" };
  }

  const sb = await createClient();

  // Update the asset's current status (RLS scopes to the caller's org).
  const { data: updated, error: upErr } = await sb
    .from("assets")
    .update({ status })
    .eq("id", assetId)
    .eq("type", "palm")
    .select("id, org_id");
  if (upErr) return { ok: false as const, error: toArabicError(upErr) };
  if (!updated || updated.length === 0) {
    return { ok: false as const, error: "النخلة غير موجودة" };
  }

  // Append the change to the per-tree history (audit trail). org_id comes from the
  // asset (the caller's org) so it satisfies the tenant_all WITH CHECK.
  const trimmed = reason.trim();
  const { error: histErr } = await sb.from("palm_status_history").insert({
    org_id: updated[0].org_id,
    asset_id: assetId,
    status,
    changed_by: m.userId,
    reason: trimmed.length > 0 ? trimmed : null,
  });
  if (histErr) return { ok: false as const, error: toArabicError(histErr) };

  revalidatePath(`/farm/palm/${assetId}`);
  return { ok: true as const };
}
