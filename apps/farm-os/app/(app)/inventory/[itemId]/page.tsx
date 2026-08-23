// SPEC-0033 R4a — «ملف الصنف 360». ONE exact, bounded, active-organisation, role-scoped snapshot per
// page view. Nothing on this route reads a table directly any more.
//
// NOT FOUND MEANS NOT FOUND. `fn_inventory_item_snapshot` returns SQL NULL for an item outside the
// active organisation — deliberately the SAME answer as an id that does not exist anywhere — so the
// 404 below can never be read as "this id exists, but not for you".
//
// THE RETURN LINK IS REBUILT, NOT ECHOED. The list keeps its whole state in the URL, so opening a row
// must carry that state or lose it. `?from=` is therefore accepted, but it is parsed, restricted to
// the inventory list path and REBUILT from validated parts before it is ever rendered as a link
// (lib/inventory-list-context). The caller's bytes never reach an href.

import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  INVENTORY_ITEM_MOVEMENT_LIMIT,
  INVENTORY_ITEM_PURCHASE_LIMIT,
  inventoryScopeForRole,
  parseInventoryItemSnapshot,
} from "@/lib/inventory-snapshot-reads";
import { parseInventoryReturnTo } from "@/lib/inventory-list-context";
import { InventoryItemView } from "./inventory-item-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InventoryItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ itemId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const membership = await requireMembership();
  const { itemId } = await params;
  // A route segment that is not a uuid is a 404, not a database error: `p_item uuid` would raise
  // 22P02 and reach the segment error boundary as a server fault instead of a missing page.
  if (!UUID.test(itemId)) notFound();

  const scope = inventoryScopeForRole(membership.role);
  const returnTo = parseInventoryReturnTo((await searchParams).from, scope);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_inventory_item_snapshot", {
    p_org: membership.orgId,
    p_item: itemId,
    p_movement_limit: INVENTORY_ITEM_MOVEMENT_LIMIT,
    p_purchase_limit: INVENTORY_ITEM_PURCHASE_LIMIT,
  });
  if (error) throw error;
  if (data === null) notFound();

  return (
    <InventoryItemView
      snapshot={parseInventoryItemSnapshot(data, {
        orgId: membership.orgId,
        itemId,
        scope,
        movementLimit: INVENTORY_ITEM_MOVEMENT_LIMIT,
        purchaseLimit: INVENTORY_ITEM_PURCHASE_LIMIT,
      })}
      returnTo={returnTo}
    />
  );
}
