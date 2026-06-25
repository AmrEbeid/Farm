"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";

/** Submit a draft PR for approval (draft → submitted). Any member with the org. */
export async function submitPurchaseRequest(prId: string) {
  await requireMembership();
  const sb = await createClient();
  const { data, error } = await sb
    .from("purchase_requests")
    .update({ status: "submitted" })
    .eq("id", prId)
    .eq("status", "draft")
    .select("id");
  if (error) return { ok: false, error: toArabicError(error) };
  if (!data || data.length === 0) {
    return { ok: false, error: "تعذّر الإرسال: الطلب ليس مسودة أو تم إرساله بالفعل." };
  }
  revalidatePath(`/purchase-requests/${prId}`);
  return { ok: true };
}

/**
 * Approve a submitted PR. AP-1 (owner-only) and AP-2 (author≠approver) are
 * enforced by the pr_update RLS policy, NOT here — a non-owner or the author
 * gets zero rows updated / a policy violation. AP-3: version guard rejects
 * stale. The audit_pr AFTER trigger writes the immutable audit_log row (AP-4).
 */
export async function approvePurchaseRequest(prId: string, version: number) {
  const m = await requireMembership();
  const sb = await createClient();
  const { data, error } = await sb
    .from("purchase_requests")
    .update({ status: "approved", approved_by: m.userId, approved_at: new Date().toISOString() })
    .eq("id", prId)
    .eq("version", version)
    .eq("status", "submitted")
    .select("id");
  if (error) return { ok: false, error: toArabicError(error) };
  if (!data || data.length === 0) {
    return { ok: false, error: "تعذّر الاعتماد: قد لا تملك صلاحية المالك أو أنك صاحب الطلب." };
  }
  revalidatePath(`/purchase-requests/${prId}`);
  return { ok: true };
}

/**
 * Record a receipt against an approved PR: a `receipt` movement raises
 * inventory_bin.on_hand, and the PR is marked received. RLS-scoped.
 * (Storekeeper / owner / farm_manager have inventory.write.)
 */
export async function recordReceipt(prId: string) {
  await requireMembership();
  const sb = await createClient();

  // RCP-ATOMIC-1: the whole receipt — the approved→received claim AND every line-item `receipt`
  // movement — now runs in ONE transaction inside the SECURITY DEFINER `fn_post_receipt` RPC
  // (migration 0024). The previous app-layer version claim-flipped then LOOPED fn_post_movement
  // per item: if item ≥1 failed after item 0 committed, the PR was left `received` with only partial
  // stock posted and no clean retry path (claim consumed) → corrupt half-received state. The RPC
  // makes a mid-loop failure roll the claim + all prior receipts back, so the PR stays `approved`
  // and is cleanly retryable — mirroring the fn_execute_operation precedent.
  //
  // Authz (inventory.write) + the org/membership guard + the claim-first idempotency gate all live
  // in the RPC now (single source of truth), so the app-layer authorize() check + the client claim +
  // the per-item loop are gone.
  const { error } = await sb.rpc("fn_post_receipt", { p_pr_id: prId });
  if (error) {
    // Map fn_post_receipt's SQLSTATEs to context-specific Arabic; toArabicError falls back to a
    // generic Arabic message for anything unlisted, so the raw English DB message never leaks
    // (non-negotiable #2, consistent with executeOperation/reserveStock).
    return {
      ok: false,
      error: toArabicError(error, {
        // 23505 — claim-first idempotency abort (not approved / already received).
        "23505": "تعذّر تسجيل الاستلام: الطلب غير معتمد أو تم استلامه بالفعل.",
        // 42501 — authz failure (no inventory.write / cross-org).
        "42501": "ليس لديك صلاحية استلام المخزون",
        // P0002 — "purchase request not found" raise from fn_post_receipt.
        P0002: "الطلب غير موجود.",
        // 22023 — a malformed PR line (qty ≤ 0) rejected by fn_post_movement.
        "22023": "بند في الطلب يحمل كمية غير صالحة",
      }),
    };
  }

  revalidatePath(`/purchase-requests/${prId}`);
  revalidatePath(`/inventory`);
  return { ok: true };
}
