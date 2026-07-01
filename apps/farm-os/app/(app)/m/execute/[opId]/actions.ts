"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";
import type { Json } from "@/lib/database.types.ext";

/**
 * One material's actual, for a multi-material operation (#520). `requirementId` (=
 * plan_material_requirements.id) is the AUTHORITATIVE match key sent to the RPC — an operation can
 * carry two requirement rows for the SAME itemId (e.g. two applications of the same fertilizer on
 * different sub-dates), so the RPC matches actuals back to requirement rows by requirementId, never
 * by itemId (which is included alongside only for debuggability).
 */
export interface MaterialActualInput {
  requirementId: string;
  itemId: string;
  actualQty: number;
}

export interface ExecuteInput {
  // Legacy scalar: authoritative for a 0/1-material op (the common case — matches the pre-#520
  // single-field form exactly). For a >1-material op, materialActuals is authoritative instead and
  // this value is ignored server-side (fn_execute_operation still requires SOME non-negative number
  // here, since it is a required positional RPC parameter — see the migration header).
  actualQty: number;
  // Required for a >1-material op: one entry per plan_material_requirements row on the op.
  materialActuals?: MaterialActualInput[];
  laborCount: number;
  note: string;
}

/**
 * Record the actual execution of a planned operation (step 8 of the loop).
 *
 * AUTHZ-1 + EXE-1 + atomicity (SPEC-0002 Option A): the entire execution runs in ONE bypassrls RPC
 * transaction, `fn_execute_operation`, which:
 *  - enforces `op.execute` server-side (refuses a role without it, regardless of REST access) —
 *    superseding the prior app-layer-only check (#71 Option C),
 *  - claims the operation `reserved/planned → done` idempotently (a double-submit is rejected),
 *  - records the `done` farm_event + event_locations + a `quantities` consumption row PER MATERIAL
 *    (#520 — every material on the op, not just the first),
 *  - issues stock (on_hand drops) via `fn_post_movement` for EACH material against its own item, and
 *  - computes the actual qty × unit cost for the planned-vs-actual report —
 * all atomically: either everything commits or nothing does (no partial desync, no app-layer revert).
 */
export async function executeOperation(opId: string, input: ExecuteInput) {
  await requireMembership(); // require a session (redirects to /login otherwise)
  const sb = await createClient();

  const { data, error } = await sb.rpc("fn_execute_operation", {
    p_op_id: opId,
    p_actual_qty: input.actualQty,
    p_labor_count: input.laborCount,
    p_note: input.note,
    // omitted (undefined) for a 0/1-material op — the RPC's legacy fallback then uses p_actual_qty.
    // requirement_id is the field the RPC matches on; item_id rides along only for debuggability.
    p_material_actuals:
      input.materialActuals && input.materialActuals.length > 0
        ? (input.materialActuals.map((m) => ({
            requirement_id: m.requirementId,
            item_id: m.itemId,
            actual_qty: m.actualQty,
          })) as unknown as Json)
        : undefined,
  });

  if (error) {
    // Map the RPC's SQLSTATEs to Arabic action errors (Postgres is the source of truth).
    // Centralized through toArabicError so contention/timeout codes (40001/40P01/57014)
    // raised by the fn_post_movement FOR UPDATE lock never leak raw English to the field UI
    // (non-negotiable #2). Context-specific phrasings kept as overrides.
    const msg = toArabicError(error, {
      "42501": "ليس لديك صلاحية تنفيذ هذه العملية",
      "23505": "العملية نُفِّذت بالفعل",
      "22023": "الكمية أو عدد العمالة غير صالح",
      "P0002": "العملية غير موجودة",
    });
    return { ok: false, error: msg };
  }

  const result = data as { event_id: string; actual_cost: number; plan_id: string };
  revalidatePath(`/m`);
  revalidatePath(`/reports/${result.plan_id}/pva`);
  return { ok: true, eventId: result.event_id, actualCost: Number(result.actual_cost) };
}
