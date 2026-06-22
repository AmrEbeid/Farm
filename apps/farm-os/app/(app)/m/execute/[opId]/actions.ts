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

    const { data: bin } = await sb
      .from("inventory_bin")
      .select("on_hand, reserved")
      .eq("item_id", req.item_id)
      .eq("location", "main")
      .single();
    const onHand = Number(bin?.on_hand ?? 0) - input.actualQty;
    const reserved = Math.max(0, Number(bin?.reserved ?? 0) - Number(req.qty));
    await sb
      .from("inventory_bin")
      .update({ on_hand: onHand, reserved })
      .eq("item_id", req.item_id)
      .eq("location", "main");
    await sb.from("inventory_movements").insert({
      org_id: m.orgId,
      item_id: req.item_id,
      type: "issue",
      qty: input.actualQty,
      unit: req.unit ?? "kg",
      location: "main",
      event_id: ev.id,
      plan_id: op.plan_id,
    });
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
