"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";
import { coverageDemandContext, coveragePrNeededBy } from "@/lib/coverage-pr";

/**
 * Reserve stock for a quantity: bumps inventory_bin.reserved (available drops,
 * on_hand unchanged) and logs a `reserve` movement. RLS-scoped — inventory_bin
 * and inventory_movements both carry a tenant_all policy.
 */
async function reserveStock(
  sb: Awaited<ReturnType<typeof createClient>>,
  itemId: string,
  qty: number,
  planId: string,
) {
  // D2 / AUTHZ-3 (#182): reserve via the role-gated wrapper fn_reserve_stock — posts a `reserve`
  // movement and recomputes bin.reserved = Σ(reserve)−Σ(release) from the ledger (no racy
  // read-modify-write; the RPC derives org from the item server-side). fn_post_movement is now an
  // INTERNAL primitive (no client EXECUTE); fn_reserve_stock enforces inventory.write before
  // delegating to it, and raises the SAME 42501/22023 SQLSTATEs.
  const { error } = await sb.rpc("fn_reserve_stock", {
    p_item: itemId,
    p_qty: qty,
    p_plan_id: planId,
  });
  // Return a structured result rather than throwing: the caller propagates this as
  // `{ ok: false, error }` so a reserve failure surfaces in the UI (CreatePrButton
  // reads `res.ok`) instead of becoming an unhandled server-action rejection.
  // Map fn_reserve_stock's SQLSTATEs to Arabic (non-negotiable #2; consistent with
  // executeOperation/recordReceipt) — never leak the raw English DB message to the field UI.
  if (error) {
    const msg = toArabicError(error, {
      "42501": "ليس لديك صلاحية حجز المخزون",
      "22023": "كمية الحجز غير صالحة",
    });
    return { ok: false as const, error: msg };
  }
  return { ok: true as const };
}

/**
 * Create a draft purchase request from a stock shortage. For unambiguous plan demand,
 * also reserve the planned quantity. Step 4 of the wedge loop. Returns the new PR id.
 *
 * - inserts purchase_requests (status='draft', requested_by = current user)
 * - inserts a purchase_request_items line for the recommended qty
 * - reserves the planned requirement only when the PR belongs to exactly one plan
 *   (available drops, on_hand unchanged)
 */
export async function createPurchaseRequestFromShortage(
  itemId: string,
  recommendQty: number,
  reserveQty: number,
) {
  const m = await requireMembership();
  const sb = await createClient();

  // AUTHZ-3 (#182 / #188 interaction): gate UP FRONT on inventory.write — the same permission the
  // downstream reserve (fn_reserve_stock) requires. Without this, a non-inventory.write member could
  // create a PR + line and only fail at the reserve step, leaving an ORPHANED draft PR behind. Checked
  // before any insert so a forbidden caller mutates nothing.
  const { data: canWrite } = await sb.rpc("authorize", {
    perm: "inventory.write",
    p_org: m.orgId,
  });
  if (!canWrite) {
    return { ok: false, error: "ليس لديك صلاحية لإنشاء طلب شراء وحجز المخزون" };
  }

  // Validate quantities before any write. The legit UI path always passes engine-derived positive
  // values, but a crafted direct server-action call with a negative/non-finite recommendQty would
  // persist a negative line qty AND a negative est_cost (recommendQty * unit_cost); reserveQty feeds
  // fn_reserve_stock. Reject up front so a bad call mutates nothing.
  if (
    !Number.isFinite(recommendQty) ||
    recommendQty <= 0 ||
    !Number.isFinite(reserveQty) ||
    reserveQty <= 0
  ) {
    return { ok: false, error: "الكمية غير صالحة" };
  }

  const { data: item, error: itemError } = await sb
    .from("inventory_items")
    .select("name, unit, preferred_supplier_id, unit_cost")
    .eq("id", itemId)
    .single();
  // A6: a transient read error must NOT masquerade as "item not found" and silently block a
  // legitimate PR. PGRST116 is .single()'s genuine 0-row (nonexistent / RLS-hidden cross-org item)
  // case — keep the specific message for it; any other error is a real failure, surfaced retryably.
  if (itemError && itemError.code !== "PGRST116") {
    return { ok: false, error: toArabicError(itemError) };
  }
  // Don't create a PR line for a nonexistent / cross-org item (RLS hides it → .single() returns null):
  // that would persist an orphan PR pointing at an invalid item_id.
  if (!item) {
    return { ok: false, error: "الصنف غير موجود" };
  }

  // Resolve the live demand rows that made this item actionable. The coverage engine reads live
  // plan_material_requirements across plans; creating the PR against a hard-coded seed plan routes
  // budget checks/reservations to the wrong plan. If several plans demand the same item, keep the PR
  // planless rather than pinning it to the wrong plan.
  const { data: demandOps, error: demandErr } = await sb
    .from("plan_operations")
    .select("planned_at, plan_id, plan_material_requirements!inner(item_id), plans!inner(status)")
    .eq("org_id", m.orgId)
    // Live ops with un-issued demand = the app's LIVE_OP set; matches fn_stock_coverage's demand filter
    // (migration 20260701130000) so the PR's needed_by reflects an in_progress/approved op's date too.
    .in("status", ["planned", "approved", "reserved", "ready", "in_progress"])
    .eq("plan_material_requirements.item_id", itemId)
    .in("plans.status", ["draft", "active", "approved"])
    .order("planned_at", { ascending: true, nullsFirst: false });
  // Distinguish a FAILED read from a genuine "no demand op". On error, abort — silently stamping
  // a PR onto the wrong/default plan would decouple procurement from the plan that triggered it.
  if (demandErr) return { ok: false, error: toArabicError(demandErr) };
  const demand = coverageDemandContext(
    (demandOps ?? []).map((op) => ({
      plan_id: op.plan_id,
      planned_at: op.planned_at,
    })),
  );
  const demandPlanId = demand.planId;
  // Match fn_stock_coverage's forward anchor: past-due demand is treated as period 1 (today),
  // and a null-dated/planless live op is immediate. A stale/null PR needed_by would be excluded from
  // the scheduled-receipts projection, so clamp it to today when the source date is absent or old.
  const neededBy = coveragePrNeededBy(demand.plannedAt);

  // CREATE-1: idempotency. A double-submit / network retry would otherwise create a duplicate draft
  // PR AND post a second `reserve` movement (over-stating `reserved`). If an OPEN (draft/submitted) PR
  // for this plan/general-stock scope already carries a line for this item, reuse it — no duplicate,
  // no re-reserve.
  // (Conservative residual: a truly concurrent pair of calls could still both create, which only
  // over-reserves — it can never mask a shortage. A fully race-safe guard would need a DB constraint
  // spanning purchase_requests.plan_id/status and purchase_request_items.item_id.)
  const openPrsBase = sb
    .from("purchase_requests")
    .select("id, code")
    .eq("org_id", m.orgId)
    .in("status", ["draft", "submitted"]);
  const { data: openPrs, error: openPrsErr } = await (demandPlanId
    ? openPrsBase.eq("plan_id", demandPlanId)
    : openPrsBase.is("plan_id", null));
  // A FAILED read must not be treated as "no open PR" — that would skip the idempotency guard and
  // fall through to create a duplicate draft PR + a second reserve (the exact double-reserve this guard
  // prevents). Abort on error instead of proceeding on a silent null.
  if (openPrsErr) return { ok: false, error: toArabicError(openPrsErr) };
  if (openPrs && openPrs.length > 0) {
    const { data: dup, error: dupErr } = await sb
      .from("purchase_request_items")
      .select("pr_id")
      .eq("item_id", itemId)
      .in(
        "pr_id",
        openPrs.map((p) => p.id),
      )
      .limit(1)
      .maybeSingle();
    if (dupErr) return { ok: false, error: toArabicError(dupErr) };
    const existing = dup ? openPrs.find((p) => p.id === dup.pr_id) : undefined;
    if (existing) {
      // CREATE-1-RESERVE (#188): the PR/line insert and the reserve are two NON-atomic writes. If a
      // prior call inserted the PR + line but its reserveStock then failed (e.g. a transient
      // fn_post_movement error), this dedup branch would otherwise return the existing PR as success
      // WITHOUT the reserve ever being posted — an orphaned PR holding no `reserve` movement, so
      // inventory_bin.reserved understates the true commitment and the coverage engine can miss a real
      // shortage for that window (and every retry keeps masking it here). Make the dedup path
      // reserve-aware: if no `reserve` movement exists for this (plan, item), the reserve never landed,
      // so re-attempt it and propagate the result. (A reserve failure on the original FRESH-insert path
      // does NOT roll back the committed PR/line, which is why the orphan is reachable; the fully
      // race/atomicity-safe fix is to fold the line-insert + reserve into one SECURITY DEFINER RPC —
      // tracked as the migration-gated follow-up in #188.)
      if (demandPlanId) {
        const { data: existingReserve, error: existingReserveErr } = await sb
          .from("inventory_movements")
          .select("id")
          .eq("org_id", m.orgId)
          .eq("item_id", itemId)
          .eq("type", "reserve")
          .eq("plan_id", demandPlanId)
          .limit(1)
          .maybeSingle();
        // A failed read here would look like "no reserve exists" and re-post a duplicate reserve —
        // abort instead of double-reserving.
        if (existingReserveErr) return { ok: false, error: toArabicError(existingReserveErr) };
        if (!existingReserve) {
          const reserve = await reserveStock(sb, itemId, reserveQty, demandPlanId);
          if (!reserve.ok) return { ok: false, error: reserve.error };
          revalidatePath(`/inventory/${itemId}/coverage`);
          revalidatePath(`/purchase-requests`);
          revalidatePath(`/budget/${demandPlanId}/check`);
        }
      }
      return { ok: true, prId: existing.id, code: existing.code, planId: demandPlanId, deduped: true };
    }
  }

  const code = `PR-${Date.now().toString().slice(-6)}`;
  const { data: pr, error: prErr } = await sb
    .from("purchase_requests")
    .insert({
      org_id: m.orgId,
      code,
      requested_by: m.userId,
      needed_by: neededBy,
      reason: demandPlanId ? `نقص ${item.name} لاحتياج مخطّط` : `إعادة طلب ${item.name} حسب تغطية المخزون`,
      plan_id: demandPlanId,
      status: "draft",
      version: 1,
    })
    .select("id, code")
    .single();
  if (prErr || !pr) return { ok: false, error: toArabicError(prErr, {}, "تعذّر إنشاء طلب الشراء") };

  const { error: itemErr } = await sb.from("purchase_request_items").insert({
    pr_id: pr.id,
    org_id: m.orgId,
    item_id: itemId,
    qty: recommendQty,
    unit: item?.unit ?? "kg",
    supplier_id: item?.preferred_supplier_id ?? null,
    // #89 (Option C): estimate from the item's manually-maintained standard unit_cost. When
    // unit_cost is NULL the price is genuinely UNKNOWN, so leave est_cost NULL rather than
    // fabricate one (the old `recommendQty * 84` stamped the potassium price on every item —
    // non-negotiable #1). Numeric columns arrive as strings from PostgREST → Number().
    est_cost: item?.unit_cost != null ? recommendQty * Number(item.unit_cost) : null,
  });
  if (itemErr) return { ok: false, error: toArabicError(itemErr) };

  // Reserve only when the demand belongs to one clear plan. Planless safety-stock and multi-plan
  // replenishment PRs should not post a generic reserve movement, because that would reduce
  // availability without a real plan commitment.
  if (demandPlanId) {
    const reserve = await reserveStock(sb, itemId, reserveQty, demandPlanId);
    if (!reserve.ok) return { ok: false, error: reserve.error };
  }

  revalidatePath(`/inventory/${itemId}/coverage`);
  revalidatePath(`/purchase-requests`);
  if (demandPlanId) revalidatePath(`/budget/${demandPlanId}/check`);
  return { ok: true, prId: pr.id, code: pr.code, planId: demandPlanId };
}
