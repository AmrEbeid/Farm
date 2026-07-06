"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";

// Record a physical stock-take (جرد) for ONE item: reconcile the system on_hand to the counted quantity.
// The DB RPC fn_record_stock_take (SECURITY DEFINER, inventory.write-gated) posts the reconciling movement
// (an 'adjustment' inflow when the count is higher, a 'loss' outflow when lower) — the role gate + the
// audited, append-only movement are enforced there; this wrapper only carries the caller's session.
export async function recordStockTake(
  itemId: string,
  countedQty: number,
): Promise<{ ok: boolean; onHand?: number; error?: string }> {
  await requireRole(["owner", "farm_manager", "storekeeper"]);
  const sb = await createClient();

  if (!Number.isFinite(countedQty) || countedQty < 0) {
    return { ok: false, error: "أدخل كمية مجرودة صحيحة (صفر أو أكثر)." };
  }

  const { data, error } = await sb.rpc("fn_record_stock_take", {
    p_item: itemId,
    p_counted_qty: countedQty,
  });
  if (error) return { ok: false, error: error.message };

  for (const p of ["/inventory/stock-take", "/inventory/dashboard", "/purchase-requests"]) revalidatePath(p);
  return { ok: true, onHand: Number(data) };
}
