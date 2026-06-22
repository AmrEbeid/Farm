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
  const m = await requireMembership();
  const sb = await createClient();

  const { data: items } = await sb
    .from("purchase_request_items")
    .select("item_id, qty, unit, supplier_id")
    .eq("pr_id", prId);

  for (const it of items ?? []) {
    const { data: bin } = await sb
      .from("inventory_bin")
      .select("on_hand")
      .eq("item_id", it.item_id)
      .eq("location", "main")
      .single();
    const onHand = Number(bin?.on_hand ?? 0) + Number(it.qty);
    await sb
      .from("inventory_bin")
      .update({ on_hand: onHand })
      .eq("item_id", it.item_id)
      .eq("location", "main");
    await sb.from("inventory_movements").insert({
      org_id: m.orgId,
      item_id: it.item_id,
      type: "receipt",
      qty: Number(it.qty),
      unit: it.unit ?? "kg",
      location: "main",
      supplier_id: it.supplier_id ?? null,
    });
  }

  await sb.from("purchase_requests").update({ status: "received" }).eq("id", prId);

  revalidatePath(`/purchase-requests/${prId}`);
  revalidatePath(`/inventory`);
  return { ok: true };
}
