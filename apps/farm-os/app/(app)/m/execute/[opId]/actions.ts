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
    .select("id, plan_id, subtype, target_id, est_cost, plan_material_requirements(item_id, qty, unit)")
    .eq("id", opId)
    .single();
  if (!op) return { ok: false, error: "العملية غير موجودة" };

  const req = (op.plan_material_requirements ?? [])[0] as
    | { item_id: string; qty: number; unit: string }
    | undefined;

  // 1) farm_event (done). occurred_at must fall in a partition (2025-07).
  const occurredAt = "2025-07-08T08:00:00+00:00";
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
  if (evErr || !ev) return { ok: false, error: evErr?.message ?? "تعذّر تسجيل الحدث" };

  // location rollup (FF-1)
  await sb.from("event_locations").insert({
    event_id: ev.id,
    org_id: m.orgId,
    sector_id: op.target_id,
  });

  // 2) issue stock for the consumed material
  let actualCost = Number(op.est_cost ?? 0);
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
    if (relErr) return { ok: false, error: relErr.message };
    // actual cost ~ price/kg × actual qty (84 ج.م/kg)
    actualCost = input.actualQty * 84;
  }

  // 3) flip the operation done + persist actuals in data jsonb
  await sb
    .from("plan_operations")
    .update({ status: "done" })
    .eq("id", opId);

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
  return { ok: true, eventId: ev.id, actualCost };
}
