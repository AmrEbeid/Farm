"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";

/**
 * Plan-builder server actions (STAGE 4 / SPEC-0011). Plan creation + status go through the plan.write-
 * gated SECURITY DEFINER RPCs (fn_create_plan / fn_set_plan_status, migration 0055); these only keep the
 * request authenticated and map the DB error to a field-safe Arabic message.
 */

const NO_PLAN_PERM = "ليس لديك صلاحية لإنشاء أو تعديل الخطط";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export async function createPlan(input: {
  type: "weekly" | "monthly" | "quarterly" | "annual";
  periodStart?: string | null;
  periodEnd?: string | null;
  scopeType?: "farm" | "sector" | "hawsha";
  scopeId?: string | null;
}): Promise<Result<string>> {
  await requireMembership();
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_create_plan", {
    p_type: input.type,
    p_period_start: input.periodStart || null,
    p_period_end: input.periodEnd || null,
    p_scope_type: input.scopeType ?? "farm",
    p_scope_id: input.scopeId ?? null,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_PLAN_PERM }) };
  revalidatePath("/plans");
  return { ok: true, data: (data as { id?: string } | null)?.id };
}
