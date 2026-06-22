"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { SEED_PLAN_ID } from "@/lib/nav";

/**
 * Reserve stock for a quantity: bumps inventory_bin.reserved (available drops,
 * on_hand unchanged) and logs a `reserve` movement. RLS-scoped — inventory_bin
 * and inventory_movements both carry a tenant_all policy.
 */
async function reserveStock(
  sb: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  itemId: string,
  qty: number,
  planId: string,
) {
  const { data: bin } = await sb
    .from("inventory_bin")
    .select("reserved, on_hand, ordered")
    .eq("item_id", itemId)
    .eq("location", "main")
    .single();
  const reserved = Number(bin?.reserved ?? 0) + qty;
  await sb
    .from("inventory_bin")
    .update({ reserved })
    .eq("item_id", itemId)
    .eq("location", "main");
  await sb.from("inventory_movements").insert({
    org_id: orgId,
    item_id: itemId,
    type: "reserve",
    qty,
    unit: "kg",
    location: "main",
    plan_id: planId,
  });
}

/**
 * Create a draft purchase request from a stock shortage and reserve the planned
 * quantity. Step 4 of the wedge loop. Returns the new PR id.
 *
 * - inserts purchase_requests (status='draft', requested_by = current user)
 * - inserts a purchase_request_items line for the recommended qty
 * - reserves the planned requirement (available drops, on_hand unchanged)
 */
export async function createPurchaseRequestFromShortage(
  itemId: string,
  recommendQty: number,
  reserveQty: number,
) {
  const m = await requireMembership();
  const sb = await createClient();

  const { data: item } = await sb
    .from("inventory_items")
    .select("name, unit, preferred_supplier_id")
    .eq("id", itemId)
    .single();

  const code = `PR-${Date.now().toString().slice(-6)}`;
  const { data: pr, error: prErr } = await sb
    .from("purchase_requests")
    .insert({
      org_id: m.orgId,
      code,
      requested_by: m.userId,
      needed_by: "2025-07-08",
      reason: `نقص ${item?.name ?? "صنف"} لعملية التسميد المخطّطة`,
      plan_id: SEED_PLAN_ID,
      status: "draft",
      version: 1,
    })
    .select("id, code")
    .single();
  if (prErr || !pr) return { ok: false, error: prErr?.message ?? "insert failed" };

  const { error: itemErr } = await sb.from("purchase_request_items").insert({
    pr_id: pr.id,
    org_id: m.orgId,
    item_id: itemId,
    qty: recommendQty,
    unit: item?.unit ?? "kg",
    supplier_id: item?.preferred_supplier_id ?? null,
    est_cost: recommendQty * 84, // ~84 ج.م/kg potassium sulfate (real Ebeid price)
  });
  if (itemErr) return { ok: false, error: itemErr.message };

  // reserve the planned requirement
  await reserveStock(sb, m.orgId, itemId, reserveQty, SEED_PLAN_ID);

  revalidatePath(`/inventory/${itemId}/coverage`);
  revalidatePath(`/purchase-requests`);
  return { ok: true, prId: pr.id, code: pr.code };
}
