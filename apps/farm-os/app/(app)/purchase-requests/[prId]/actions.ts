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
 * Record a receipt against an approved (or partially-received) PR: a `receipt` movement raises
 * inventory_bin.on_hand, received_qty advances per line, and the PR is marked `received` (every line
 * fully received) or `partially_received`. RLS-scoped. (Storekeeper / owner / farm_manager have
 * inventory.write.)
 *
 * `lines` (SPEC-0009 #155 partial receipts): an optional per-line received-quantity map
 * `[{ item_id, qty }, …]` passed straight through as the RPC's `p_lines` jsonb. When omitted (the
 * one-click "receive all remaining"), the RPC receives every line's FULL remaining qty — the original
 * all-or-nothing behaviour, byte-identical for an approved PR.
 */
export async function recordReceipt(
  prId: string,
  lines?: { item_id: string; qty: number }[],
) {
  await requireMembership();
  const sb = await createClient();

  // Defense-in-depth (independent-review finding): an EMPTY `lines` array is a PARTIAL submit with no
  // quantities entered — it must NOT fall through to the receive-all path (which only `lines === undefined`
  // should trigger). Without this, `lines && lines.length > 0` is false for `[]`, so the RPC would receive
  // the whole PR's remaining — overstating on_hand, the exact corruption SPEC-0009 prevents. Reject it.
  if (lines && lines.length === 0) {
    return { ok: false, error: "أدخل كمية مستلمة واحدة على الأقل." };
  }

  // RCP-ATOMIC-1: the whole receipt — the approved/partially_received claim AND every line-item
  // `receipt` movement — runs in ONE transaction inside the SECURITY DEFINER `fn_post_receipt` RPC
  // (migrations 0024/0045). A mid-loop failure (e.g. over-receipt) rolls the claim + all prior
  // receipts back, so the PR stays in its prior status and is cleanly retryable.
  //
  // Authz (inventory.write) + the org/membership guard + the claim-first idempotency gate all live
  // in the RPC (single source of truth). When `lines` is supplied we pass `p_lines` (per-line received
  // qtys); when omitted we call with `p_pr_id` only and the RPC defaults every line to its remaining.
  const { error } = await sb.rpc(
    "fn_post_receipt",
    lines && lines.length > 0 ? { p_pr_id: prId, p_lines: lines } : { p_pr_id: prId },
  );
  if (error) {
    // Map fn_post_receipt's SQLSTATEs to context-specific Arabic; toArabicError falls back to a
    // generic Arabic message for anything unlisted, so the raw English DB message never leaks
    // (non-negotiable #2, consistent with executeOperation/reserveStock).
    return {
      ok: false,
      error: toArabicError(error, {
        // 23514 — over-receipt: fn_post_receipt rejects a requested qty > remaining-on-order
        // (SPEC-0009 §4.3). The default 23514 (stock-floor) message would be misleading here.
        "23514": "الكمية المستلمة تتجاوز المتبقي في الطلب.",
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
