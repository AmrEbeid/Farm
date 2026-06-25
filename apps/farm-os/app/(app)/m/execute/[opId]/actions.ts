"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";

export interface ExecuteInput {
  actualQty: number; // material used
  laborCount: number;
  note: string;
}

/**
 * Record the actual execution of a planned operation (step 8 of the loop).
 *  - inserts a `done` farm_event for the operation, with event_locations and a
 *    quantities row carrying the negative inventory_adjustment (consumption),
 *  - issues stock: inventory_bin.on_hand drops by actualQty and the reservation
 *    is cleared; an `issue` movement is logged,
 *  - flips the plan_operation status reserved/planned → done and records the
 *    actual qty + cost in plan_operations.* for the planned-vs-actual report.
 *
 * RLS-scoped (op.execute role: supervisor/engineer/manager/owner).
 */
export async function executeOperation(opId: string, input: ExecuteInput) {
  const m = await requireMembership();

  // B4: validate inputs at the action boundary (RLS does not range-check values).
  // A negative actualQty would otherwise *raise* on_hand via the issue path below.
  if (!Number.isFinite(input.actualQty) || input.actualQty < 0) {
    return { ok: false, error: "الكمية المستخدمة غير صالحة" };
  }
  if (!Number.isInteger(input.laborCount) || input.laborCount < 0) {
    return { ok: false, error: "عدد العمالة غير صالح" };
  }

  const sb = await createClient();

  const { data: op } = await sb
    .from("plan_operations")
    .select("id, plan_id, subtype, target_id, est_cost, status, plan_material_requirements(item_id, qty, unit)")
    .eq("id", opId)
    .single();
  if (!op) return { ok: false, error: "العملية غير موجودة" };

  const req = (op.plan_material_requirements ?? [])[0] as
    | { item_id: string; qty: number; unit: string }
    | undefined;

  // EXE-1: claim-first idempotency gate. A server action is a POST endpoint, so a
  // double-submit / network retry / concurrent call bypasses the page's "done" guard
  // and would otherwise re-run the whole issue/release path (double stock loss,
  // over-release, duplicate `done` event). Atomically flip → done ONLY if not already
  // done; if no row comes back, another caller already executed this op — abort BEFORE
  // touching stock. This replaces the unconditional status flip that used to run last.
  const prevStatus = op.status as string;
  const { data: claimed, error: claimErr } = await sb
    .from("plan_operations")
    .update({ status: "done" })
    .eq("id", opId)
    .neq("status", "done")
    .select("id");
  if (claimErr) return { ok: false, error: claimErr.message };
  if (!claimed || claimed.length === 0) {
    return { ok: false, error: "العملية نُفِّذت بالفعل" };
  }
  // Release the claim so the op can be retried — but ONLY before anything is persisted
  // (i.e. if the farm_event insert itself fails). Once the event/quantities rows exist,
  // reverting would let a retry duplicate them, so we keep status=done from there on.
  const revertClaim = async () =>
    (await sb.from("plan_operations").update({ status: prevStatus }).eq("id", opId)).error;

  // 1) farm_event (done). B3: real execution time (was hardcoded to the seed window);
  // dates outside the seed months land in the farm_event_default partition.
  const occurredAt = new Date().toISOString();
  const { data: ev, error: evErr } = await sb
    .from("farm_event")
    .insert({
      org_id: m.orgId,
      type: "operation",
      subtype: op.subtype,
      status: "done",
      occurred_at: occurredAt,
      planned_at: occurredAt,
      performed_by_person_id: m.personId,
      plan_id: op.plan_id,
      notes: input.note,
      data: { labor_count: input.laborCount },
    })
    .select("id")
    .single();
  if (evErr || !ev) {
    // Nothing persisted yet — safe to release the claim. If the revert ITSELF fails, the
    // op is stuck `done` with nothing recorded; surface that so it isn't silently lost.
    const revErr = await revertClaim();
    const base = evErr?.message ?? "تعذّر تسجيل الحدث";
    return {
      ok: false,
      error: revErr
        ? `${base} (وتعذّر التراجع — العملية ما زالت معلَّمة كمنفّذة: ${revErr.message})`
        : base,
    };
  }

  // location rollup (FF-1)
  await sb.from("event_locations").insert({
    event_id: ev.id,
    org_id: m.orgId,
    sector_id: op.target_id,
  });

  // 2) issue stock for the consumed material
  let actualCost = Number(op.est_cost ?? 0);
  let releaseError: { message: string } | null = null;
  if (req) {
    await sb.from("quantities").insert({
      org_id: m.orgId,
      event_id: ev.id,
      measure: "weight",
      value_num: input.actualQty,
      unit_term_id: null,
      label: "كمية مستخدمة",
      material_id: req.item_id,
      inventory_adjustment: -input.actualQty,
    });

    // B1: issue stock via the transactional, ledger-reconciled RPC (replaces the racy
    // on_hand read-modify-write + separate movement insert).
    const { error: issErr } = await sb.rpc("fn_post_movement", {
      p_item: req.item_id,
      p_type: "issue",
      p_qty: input.actualQty,
      p_location: "main",
      p_unit: req.unit ?? "kg",
      p_event_id: ev.id,
      p_plan_id: op.plan_id,
    });
    // No revertClaim() here: the farm_event + quantities rows above are already
    // committed, so releasing the claim would let a retry create DUPLICATE done
    // events/quantities. fn_post_movement is transactional (no stock committed on
    // failure), so we keep status=done and surface the error for reconciliation.
    if (issErr) return { ok: false, error: issErr.message };
    // D2: release the reservation via a ledger movement; fn_bin_rebuild recomputes
    // bin.reserved = Σ(reserve)−Σ(release) (no racy read-modify-write).
    const { error: relErr } = await sb.rpc("fn_post_movement", {
      p_item: req.item_id,
      p_type: "release",
      p_qty: Number(req.qty),
      p_location: "main",
      p_unit: req.unit ?? "kg",
      p_event_id: ev.id,
      p_plan_id: op.plan_id,
    });
    // No revertClaim() here: the `issue` above already committed (on_hand dropped), so
    // re-running would double-issue. Capture the release error but DON'T early-return —
    // we still persist actuals below so the PvA report is consistent — then surface it.
    if (relErr) releaseError = relErr;
    // B3: actual cost = actual qty × the plan's unit rate (est_cost ÷ planned qty), not a
    // hardcoded price. Future refinement: use the actual paid receipt price (OWNER-DECISIONS §4).
    const plannedUnit = Number(req.qty) > 0 ? Number(op.est_cost ?? 0) / Number(req.qty) : 0;
    actualCost = input.actualQty * plannedUnit;
  }

  // 3) persist actuals in data jsonb (status was already claimed → done at the top, EXE-1)
  // record the actual figures on the farm_event data for the PvA report
  await sb
    .from("farm_event")
    .update({
      data: {
        labor_count: input.laborCount,
        actual_qty: input.actualQty,
        actual_cost: actualCost,
        op_id: opId,
      },
    })
    .eq("id", ev.id)
    .eq("occurred_at", occurredAt);

  revalidatePath(`/m`);
  revalidatePath(`/reports/${op.plan_id}/pva`);
  // The issue committed and actuals are persisted; if the reservation release failed,
  // surface it now (status stays done) so the over-reservation can be reconciled.
  if (releaseError) return { ok: false, error: releaseError.message };
  return { ok: true, eventId: ev.id, actualCost };
}
