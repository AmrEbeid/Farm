"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import type { Json } from "@/lib/database.types";

interface CoverageResult {
  shortage?: boolean;
  first_shortage_period?: number | null;
  message_ar?: string;
  available?: number;
  recommend_qty?: number;
}

/**
 * Run the five plan checks for a plan and persist them to plan_checks.
 * Stock uses fn_stock_coverage per distinct material in the plan; budget uses an
 * available-vs-added comparison on budget_lines. Weather/labor/responsibility are
 * deterministic passes in MVP-0. RLS-scoped (per-user session client).
 */
export async function runPlanChecks(planId: string) {
  const m = await requireMembership();
  const sb = await createClient();

  // PLAN-AUTHZ-1 (app-layer, like #71 Option C): plan checks delete + re-insert plan_checks, which is
  // `plan.write` (owner/farm_manager). The action only checked membership. Gate via authorize().
  const { data: canWrite } = await sb.rpc("authorize", { perm: "plan.write" });
  if (!canWrite) return { ok: false, error: "ليس لديك صلاحية تعديل الخطة" };

  // distinct materials required across this plan's operations
  const { data: ops } = await sb
    .from("plan_operations")
    .select("id, est_cost, plan_material_requirements(item_id, qty)")
    .eq("plan_id", planId);

  const materialIds = new Set<string>();
  let plannedCost = 0;
  for (const op of ops ?? []) {
    plannedCost += Number(op.est_cost ?? 0);
    for (const r of (op.plan_material_requirements ?? []) as { item_id: string }[]) {
      materialIds.add(r.item_id);
    }
  }

  // stock check: any shortage among the plan's materials blocks
  let stockResult: "ok" | "block" = "ok";
  const stockDetail: Record<string, Json> = {};
  for (const itemId of materialIds) {
    const { data } = await sb.rpc("fn_stock_coverage", {
      p_item: itemId,
      p_location: "main",
    });
    const cov = data as CoverageResult | null;
    if (cov?.shortage) {
      stockResult = "block";
      stockDetail[itemId] = {
        available: cov.available,
        recommend_qty: cov.recommend_qty,
        message_ar: cov.message_ar,
      };
    }
  }

  // budget check: compare added plan cost against the أسمدة line's available
  const { data: line } = await sb
    .from("budget_lines")
    .select("category, approved, committed, actual")
    .eq("org_id", m.orgId)
    .eq("category", "أسمدة")
    .maybeSingle();
  let budgetResult: "ok" | "warn" | "block" = "ok";
  let budgetDetail: Json = {};
  if (line) {
    const available =
      Number(line.approved) - Number(line.committed) - Number(line.actual);
    const added = plannedCost;
    budgetResult = available - added < 0 ? "block" : available - added < available * 0.2 ? "warn" : "ok";
    budgetDetail = { category: "أسمدة", available, added, after: available - added };
  }

  const checks = [
    { kind: "stock", result: stockResult, detail: stockDetail },
    { kind: "budget", result: budgetResult, detail: budgetDetail },
    { kind: "weather", result: "ok", detail: { note: "deferred in MVP-0" } },
    { kind: "labor", result: "ok", detail: {} },
    { kind: "responsibility", result: "ok", detail: {} },
  ];

  const { error: delErr } = await sb
    .from("plan_checks")
    .delete()
    .eq("plan_id", planId);
  if (delErr) return { ok: false, error: delErr.message };
  // If this insert fails after the delete, plan_checks is left empty — surface the
  // error rather than reporting a successful (but empty) recompute.
  const { error: insErr } = await sb.from("plan_checks").insert(
    checks.map((c) => ({ plan_id: planId, org_id: m.orgId, ...c })),
  );
  if (insErr) return { ok: false, error: insErr.message };

  revalidatePath(`/plans/${planId}`);
  return { ok: true, checks };
}

export interface NewOperationInput {
  subtype: string;
  planned_at: string; // yyyy-mm-dd
  est_cost: number;
  item_id: string;
  material_qty: number;
  material_unit: string;
}

/**
 * Add a planned operation with one material requirement to a plan.
 * Writes plan_operations + plan_material_requirements (both tenant_all RLS).
 * The material requirement is what fn_stock_coverage reads as planned demand.
 */
export async function addPlanOperation(planId: string, input: NewOperationInput) {
  const m = await requireMembership();

  // B4: validate inputs at the action boundary (RLS does not range-check values).
  if (!Number.isFinite(input.est_cost) || input.est_cost < 0) {
    return { ok: false, error: "التكلفة التقديرية غير صالحة" };
  }
  if (!Number.isFinite(input.material_qty) || input.material_qty <= 0) {
    return { ok: false, error: "كمية الخامة يجب أن تكون أكبر من صفر" };
  }

  const sb = await createClient();

  // PLAN-AUTHZ-1 (app-layer, like #71 Option C): authoring a planned operation is `plan.write`
  // (owner/farm_manager). The action only checked membership. Gate via authorize().
  const { data: canWrite } = await sb.rpc("authorize", { perm: "plan.write" });
  if (!canWrite) return { ok: false, error: "ليس لديك صلاحية تعديل الخطة" };

  // plan scope (target) for the operation. Fail loudly on a missing/failed plan rather
  // than silently defaulting scope_type to "sector" (which would create an orphan op
  // with a null target on a bad planId).
  const { data: plan, error: planErr } = await sb
    .from("plans")
    .select("scope_type, scope_id")
    .eq("id", planId)
    .single();
  if (planErr || !plan) return { ok: false, error: planErr?.message ?? "الخطة غير موجودة" };

  const { data: op, error: opErr } = await sb
    .from("plan_operations")
    .insert({
      org_id: m.orgId,
      plan_id: planId,
      subtype: input.subtype,
      target_type: plan?.scope_type ?? "sector",
      target_id: plan?.scope_id ?? null,
      planned_at: input.planned_at,
      priority: 1,
      responsible_person_id: m.personId,
      est_cost: input.est_cost,
      approval_needed: true,
      status: "planned",
    })
    .select("id")
    .single();
  if (opErr || !op) return { ok: false, error: opErr?.message ?? "insert failed" };

  const { error: matErr } = await sb.from("plan_material_requirements").insert({
    org_id: m.orgId,
    plan_op_id: op.id,
    item_id: input.item_id,
    qty: input.material_qty,
    unit: input.material_unit,
  });
  if (matErr) return { ok: false, error: matErr.message };

  revalidatePath(`/plans/${planId}`);
  return { ok: true, operationId: op.id };
}
