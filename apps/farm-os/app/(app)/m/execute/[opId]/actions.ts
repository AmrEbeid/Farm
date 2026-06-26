"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";

export interface ExecuteInput {
  actualQty: number; // material used
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
 *  - records the `done` farm_event + event_locations + the consumption `quantities` row,
 *  - issues stock (on_hand drops) and releases the reservation via `fn_post_movement`,
 *  - and computes the actual qty × unit cost for the planned-vs-actual report —
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
