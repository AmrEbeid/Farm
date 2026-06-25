"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";

/** Submit a draft PR for approval (draft → submitted). Any member with the org. */
export async function submitPurchaseRequest(prId: string) {
  await requireMembership();
  const sb = await createClient();
  const { error } = await sb
    .from("purchase_requests")
    .update({ status: "submitted" })
    .eq("id", prId)
    .eq("status", "draft");
  if (error) return { ok: false, error: error.message };
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
  if (error) return { ok: false, error: error.message };
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

  // RCP-AUTHZ-3 (app-layer, like #71 Option C): receiving stock is `inventory.write`
  // (owner/farm_manager/storekeeper). The action only checked membership, and the approved→received
  // PR transition is open to any org member, so a non-storekeeper could mark a PR received and inflate
  // on_hand. Gate via the DB's authorize() map (single source of truth); DB-layer enforcement is next.
  const { data: canWrite } = await sb.rpc("authorize", { perm: "inventory.write" });
  if (!canWrite) return { ok: false, error: "ليس لديك صلاحية استلام المخزون" };

  // RCP-1: claim-first idempotency gate (same class as EXE-1). recordReceipt is a server
  // action = a POST endpoint, so a double-submit / network retry / concurrent call would
  // re-post every `receipt` movement → phantom stock IN (on_hand inflated, the ledger
  // corrupted). Flip approved→received FIRST, guarded by `status='approved'`, and abort if
  // no row (already received, or never approved) BEFORE posting any movement. This also
  // adds the missing precondition: only an approved PR can be received.
  const { data: claimed, error: claimErr } = await sb
    .from("purchase_requests")
    .update({ status: "received" })
    .eq("id", prId)
    .eq("status", "approved")
    .select("id");
  if (claimErr) return { ok: false, error: claimErr.message };
  if (!claimed || claimed.length === 0) {
    return { ok: false, error: "تعذّر تسجيل الاستلام: الطلب غير معتمد أو تم استلامه بالفعل." };
  }

  const { data: items } = await sb
    .from("purchase_request_items")
    .select("item_id, qty, unit, supplier_id")
    .eq("pr_id", prId);

  // B1: one transactional, ledger-reconciled RPC per item instead of the racy
  // read-modify-write on inventory_bin.on_hand + separate movement insert.
  for (const [i, it] of (items ?? []).entries()) {
    const { error } = await sb.rpc("fn_post_movement", {
      p_item: it.item_id,
      p_type: "receipt",
      p_qty: Number(it.qty),
      p_location: "main",
      p_unit: it.unit ?? "kg",
      p_supplier_id: it.supplier_id ?? null,
    });
    if (error) {
      // Only if the FIRST item failed (nothing posted yet) is it safe to release the claim
      // so the receipt can be retried cleanly. After that, keep status=received (reverting
      // would let a retry double-post the already-received items) and surface the error.
      if (i === 0) {
        await sb.from("purchase_requests").update({ status: "approved" }).eq("id", prId);
      }
      return { ok: false, error: error.message };
    }
  }

  revalidatePath(`/purchase-requests/${prId}`);
  revalidatePath(`/inventory`);
  return { ok: true };
}
