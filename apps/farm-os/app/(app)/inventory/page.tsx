// SPEC-0033 R4a — «المخزون». ONE exact, bounded, active-organisation, role-scoped snapshot per page
// view. Nothing on this route reads a table directly any more.
//
// WHAT REPLACED WHAT. The old page selected EVERY inventory item with a nested `inventory_bin` join
// and then read `inventory_bin[0]` in JavaScript, so an item stored in two locations reported the
// FIRST bin's balance as if it were the whole stock, an item with no bin row at all reported «٠»
// when the truth was "never recorded", and search / filter / export all ran over an unbounded set in
// the browser. All of that is now decided in PostgreSQL: every balance sums EVERY bin, an unrecorded
// balance stays explicitly unknown, and the page is a real limit/offset page whose exact totals are
// published separately from it.
//
// THE ROLE SCOPE IS THE DATABASE'S DECISION, NOT THE COMPONENT'S. The storekeeper receives the
// `operational` payload, which contains no cost, valuation, supplier, purchase free text or
// purchase-request id AT ALL — the bytes are never built, so they cannot be read from the network
// tab, the RSC payload or a cache. Every other member role receives the `finance` payload and keeps
// exactly the capability the enforced `/inventory*` policy (`requireMembership()`) already gives it.
// `inventoryScopeForRole` is the single place a role becomes a scope, and the parser re-checks that
// the payload it got is the one that scope is allowed.

import { redirect } from "next/navigation";
import { requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  INVENTORY_LIST_PAGE_SIZE,
  inventoryScopeForRole,
  parseInventoryListSnapshot,
} from "@/lib/inventory-snapshot-reads";
import {
  inventoryListHref,
  inventoryListOffset,
  inventoryPageCount,
  readInventoryListRequest,
} from "@/lib/inventory-list-context";
import { InventoryListView } from "./inventory-list-view";

/** The roles `fn_record_stock_take` (inventory.write) actually accepts. */
const CAN_COUNT_STOCK = new Set(["owner", "farm_manager", "storekeeper"]);

export default async function InventoryListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string }>;
}) {
  const membership = await requireMembership();
  const scope = inventoryScopeForRole(membership.role);
  // The url is normalised to exactly one spelling of this list state before anything is read, so a
  // hostile or stale parameter (`?filter=uncosted` for a storekeeper, `?page=0`, control characters
  // in `q`) can never be echoed back into a link. `redirect` throws, so nothing below this line runs
  // on the discarded spelling.
  const { context, redirectTo } = readInventoryListRequest(await searchParams, scope);
  if (redirectTo) redirect(redirectTo);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_inventory_list_snapshot", {
    p_org: membership.orgId,
    p_query: context.query === "" ? null : context.query,
    p_filter: context.filter,
    p_limit: INVENTORY_LIST_PAGE_SIZE,
    p_offset: inventoryListOffset(context.page),
  });
  // A read failure reaches the segment error boundary rather than rendering an empty store.
  if (error) throw error;
  const snapshot = parseInventoryListSnapshot(data, {
    orgId: membership.orgId,
    scope,
    query: context.query === "" ? null : context.query,
    filter: context.filter,
    limit: INVENTORY_LIST_PAGE_SIZE,
    offset: inventoryListOffset(context.page),
  });
  const pageCount = inventoryPageCount(snapshot.counts.matching, snapshot.limit);
  // A stale bookmark can point beyond the now-smaller exact result set. Canonicalize it to the last
  // real page instead of showing an empty list while claiming matching items exist.
  if (context.page > pageCount) {
    redirect(inventoryListHref({ ...context, page: pageCount }));
  }

  return (
    <InventoryListView
      snapshot={snapshot}
      context={context}
      canCountStock={CAN_COUNT_STOCK.has(membership.role)}
    />
  );
}
