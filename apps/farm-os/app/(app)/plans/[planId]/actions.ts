"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";
import {
  budgetCheckResultForKnownCost,
  summarizePlannedFertilizationCost,
} from "@/lib/budget-check";
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
  const { data: canWrite } = await sb.rpc("authorize", { perm: "plan.write", p_org: m.orgId });
  if (!canWrite) return { ok: false, error: "ليس لديك صلاحية تعديل الخطة" };

  // distinct materials required across this plan's operations
  const { data: ops, error: opsErr } = await sb
    .from("plan_operations")
    .select("id, est_cost, subtype, status, plan_material_requirements(item_id, qty)")
    .eq("plan_id", planId);
  // Do NOT proceed on a failed read: an empty `ops` would compute plannedCost=0 and zero
  // materials, then persist stock/budget = "ok" — a false pass that can MASK a real shortage
  // (the wedge's whole point). Abort rather than record a passing check we didn't actually run.
  if (opsErr) return { ok: false, error: "تعذّر قراءة عمليات الخطة، حاول مرة أخرى." };

  const materialIds = new Set<string>();
  const plannedCost = summarizePlannedFertilizationCost(ops ?? []);
  for (const op of ops ?? []) {
    for (const r of (op.plan_material_requirements ?? []) as { item_id: string }[]) {
      materialIds.add(r.item_id);
    }
  }

  // stock check: any shortage among the plan's materials blocks
  let stockResult: "ok" | "block" = "ok";
  const stockDetail: Record<string, Json> = {};
  // fn_stock_coverage is a read-only projection per material and the calls are independent, so
  // fire them in parallel instead of N serial round-trips. Semantics are unchanged: we still
  // abort on any per-item error and the shortage/detail outcome is order-independent.
  const itemIds = [...materialIds];
  const coverages = await Promise.all(
    itemIds.map((itemId) => sb.rpc("fn_stock_coverage", { p_item: itemId, p_location: "main" })),
  );
  for (let i = 0; i < itemIds.length; i++) {
    const itemId = itemIds[i];
    const { data, error: covErr } = coverages[i];
    // A failed coverage check must NOT silently count as "no shortage" — abort rather than
    // persist a passing stock check that could mask a shortage.
    if (covErr) return { ok: false, error: "تعذّر التحقق من تغطية المخزون، حاول مرة أخرى." };
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
  const { data: line, error: budgetErr } = await sb
    .from("budget_lines")
    .select("category, approved, committed, actual")
    .eq("org_id", m.orgId)
    .eq("category", "أسمدة")
    .maybeSingle();
  // A read error must not be confused with "no budget line" (a legitimate null): a failed read
  // would otherwise persist budget = "ok" (a false pass). A genuinely-absent line stays "ok"
  // unless the plan also has unknown costs, which must not be treated as free.
  if (budgetErr) return { ok: false, error: "تعذّر قراءة بنود الميزانية، حاول مرة أخرى." };
  let budgetResult: "ok" | "warn" | "block" = "ok";
  let budgetDetail: Json = {};
  if (line) {
    const available =
      Number(line.approved) - Number(line.committed) - Number(line.actual);
    const added = plannedCost.knownCost;
    budgetResult = budgetCheckResultForKnownCost(available, added, plannedCost.hasUnknownCost);
    budgetDetail = {
      category: "أسمدة",
      available,
      added,
      after: available - added,
      unknown_cost_count: plannedCost.unknownCostCount,
    };
  } else if (plannedCost.hasUnknownCost) {
    budgetResult = "warn";
    budgetDetail = {
      category: "أسمدة",
      added: plannedCost.knownCost,
      unknown_cost_count: plannedCost.unknownCostCount,
      note: "تكلفة بعض عمليات الأسمدة غير معروفة",
    };
  }

  const checks = [
    { kind: "stock", result: stockResult, detail: stockDetail },
    { kind: "budget", result: budgetResult, detail: budgetDetail },
    // SPEC-0007 §2(4)/§4(3): weather is advisory and NOT yet wired into runPlanChecks. It must not
    // assert green ("ok"→"سليم") as if a forecast was verified. The plans page renders only
    // block/warn/(default-green) — there is no "unknown" branch, so "unknown" would still show green.
    // Use "warn" (the only supported non-green status → amber "منخفض") to signal not-yet-evaluated/advisory.
    { kind: "weather", result: "warn", detail: { note: "لم يُقيَّم الطقس بعد (إرشادي)" } },
    { kind: "labor", result: "ok", detail: {} },
    { kind: "responsibility", result: "ok", detail: {} },
  ];

  const { error: delErr } = await sb
    .from("plan_checks")
    .delete()
    .eq("plan_id", planId);
  if (delErr) return { ok: false, error: toArabicError(delErr) };
  // If this insert fails after the delete, plan_checks is left empty — surface the
  // error rather than reporting a successful (but empty) recompute.
  const { error: insErr } = await sb.from("plan_checks").insert(
    checks.map((c) => ({ plan_id: planId, org_id: m.orgId, ...c })),
  );
  if (insErr) return { ok: false, error: toArabicError(insErr) };

  revalidatePath(`/plans/${planId}`);
  return { ok: true, checks };
}

export type PlanStatus = "draft" | "active" | "closed" | "abandoned";

/**
 * Move a plan through its lifecycle (draft → active → closed/abandoned) via the
 * plan.write-gated SECURITY DEFINER RPC fn_set_plan_status (migration 0084). The RPC enforces
 * both the org-scoped authorize() check and the cross-org guard; this action only keeps the
 * request authenticated and maps the DB error to a field-safe Arabic message (mirrors
 * addPlanOperation's SQLSTATE map — P0002 = plan not found, 42501 = missing plan.write).
 */
export async function setPlanStatus(planId: string, status: PlanStatus) {
  await requireMembership();
  const sb = await createClient();

  const { error } = await sb.rpc("fn_set_plan_status", { p_plan_id: planId, p_status: status });
  if (error) {
    return {
      ok: false,
      error: toArabicError(
        error,
        { "42501": "ليس لديك صلاحية تعديل الخطة", P0002: "الخطة غير موجودة" },
        "تعذّر تغيير حالة الخطة",
      ),
    };
  }

  // The list page also renders plan.status (plans/page.tsx), so revalidate both.
  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  return { ok: true };
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
 *
 * CREATE-3 (#196): the op + its material requirement are written atomically by the SECURITY DEFINER
 * RPC fn_add_plan_operation (migration 0038) — ONE transaction, so a requirement failure rolls the op
 * back. The old two-write app path could leave an ORPHAN op (no requirement) when the 2nd write failed;
 * the CREATE-2 dedup (it only matches ops that already carry a requirement for the item) then missed it
 * on retry → a duplicate op whose est_cost still over-counts the budget while contributing no demand.
 * The RPC also enforces plan.write (org-scoped), the cross-org guard, and the CREATE-2 dedup server-side.
 */
export async function addPlanOperation(planId: string, input: NewOperationInput) {
  await requireMembership();

  // B4: validate inputs at the action boundary (RLS/RPC does not range-check these values).
  if (!Number.isFinite(input.est_cost) || input.est_cost < 0) {
    return { ok: false, error: "التكلفة التقديرية غير صالحة" };
  }
  if (!Number.isFinite(input.material_qty) || input.material_qty <= 0) {
    return { ok: false, error: "كمية الخامة يجب أن تكون أكبر من صفر" };
  }

  const sb = await createClient();

  // Single atomic call: authz (plan.write, org-scoped) + plan-scope lookup + CREATE-2 dedup + the two
  // inserts all happen inside fn_add_plan_operation. Errors are mapped to field-safe Arabic by SQLSTATE
  // (42501 → permission, P0002 → plan not found, …) — never a raw English message.
  const { data, error } = await sb.rpc("fn_add_plan_operation", {
    p_plan_id: planId,
    p_subtype: input.subtype,
    p_planned_at: input.planned_at,
    p_est_cost: input.est_cost,
    p_item_id: input.item_id,
    p_qty: input.material_qty,
    p_unit: input.material_unit,
  });
  if (error) {
    return {
      ok: false,
      error: toArabicError(
        error,
        { "42501": "ليس لديك صلاحية تعديل الخطة", P0002: "الخطة غير موجودة" },
        "تعذّر إنشاء العملية",
      ),
    };
  }

  const result = data as { operationId: string; deduped: boolean } | null;
  if (!result?.operationId) return { ok: false, error: "تعذّر إنشاء العملية" };

  revalidatePath(`/plans/${planId}`);
  return result.deduped
    ? { ok: true, operationId: result.operationId, deduped: true }
    : { ok: true, operationId: result.operationId };
}

export interface MaterialLineInput {
  item_id: string;
  qty: number;
  unit: string;
}
export interface LaborLineInput {
  person_or_team: string;
  count: number;
  days: number;
}
export interface NewMultiOperationInput {
  subtype: string;
  planned_at: string; // yyyy-mm-dd (the start / demand date)
  ends_on: string | null; // yyyy-mm-dd or null = single-day
  est_cost: number;
  materials: MaterialLineInput[]; // several needs: fertilizers, fuel/gas, any item
  labor: LaborLineInput[];
  assignee_ids: string[]; // one or more employees
  lead_id: string | null; // which assignee is the lead (must be in assignee_ids)
}

/**
 * Add a planned operation carrying SEVERAL needs (N materials + N labour lines), a multi-day span, and
 * one-or-more employee assignees — all created atomically by fn_add_plan_operation_multi (#398, migration
 * 0091). One transaction: any bad line rolls the whole op back (no orphan). The RPC enforces plan.write
 * (org-scoped), the cross-org guard, item/person in-org validation, and the multi-day/lead invariants.
 */
export async function addPlanOperationMulti(planId: string, input: NewMultiOperationInput) {
  await requireMembership();

  // Validate at the action boundary (mirror addPlanOperation; the RPC re-checks server-side).
  if (!Number.isFinite(input.est_cost) || input.est_cost < 0) {
    return { ok: false, error: "التكلفة التقديرية غير صالحة" };
  }
  if (input.materials.length === 0 && input.labor.length === 0) {
    return { ok: false, error: "أضف احتياجًا واحدًا على الأقل (خامة أو عمالة)" };
  }
  for (const m of input.materials) {
    if (!m.item_id) return { ok: false, error: "اختر الصنف لكل سطر خامة" };
    if (!Number.isFinite(m.qty) || m.qty < 0) {
      return { ok: false, error: "كمية الخامة يجب ألا تكون سالبة" };
    }
  }
  for (const l of input.labor) {
    if (!Number.isFinite(l.count) || l.count < 0 || !Number.isFinite(l.days) || l.days < 0) {
      return { ok: false, error: "عدد العمال والأيام يجب ألا يكونا سالبين" };
    }
  }
  if (input.ends_on && input.ends_on < input.planned_at) {
    return { ok: false, error: "تاريخ الانتهاء يجب ألا يسبق تاريخ البدء" };
  }
  if (input.lead_id && !input.assignee_ids.includes(input.lead_id)) {
    return { ok: false, error: "المسؤول يجب أن يكون من بين المكلّفين" };
  }

  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_add_plan_operation_multi", {
    p_plan_id: planId,
    p_subtype: input.subtype,
    p_planned_at: input.planned_at,
    p_ends_on: input.ends_on,
    p_est_cost: input.est_cost,
    // line arrays serialize to jsonb; cast through Json (interfaces lack the index signature Json wants).
    p_materials: input.materials as unknown as Json,
    p_labor: input.labor as unknown as Json,
    p_assignee_ids: input.assignee_ids,
    p_lead_id: input.lead_id,
  });
  if (error) {
    return {
      ok: false,
      error: toArabicError(
        error,
        {
          "42501": "ليس لديك صلاحية تعديل الخطة",
          P0002: "الخطة غير موجودة",
          "22023": "بيانات العملية غير صالحة",
        },
        "تعذّر إنشاء العملية",
      ),
    };
  }
  const result = data as { operationId: string } | null;
  if (!result?.operationId) return { ok: false, error: "تعذّر إنشاء العملية" };

  revalidatePath(`/plans/${planId}`);
  return { ok: true, operationId: result.operationId };
}

/**
 * Un-assign a person from a plan operation (#398 follow-up — assignees could be added but never
 * removed through the app). Wraps fn_unassign_plan_operation (migration 20260701220000), which is
 * plan.write-gated org-scoped, resolving the org directly from the operation (mirrors
 * fn_add_plan_operation_multi's org resolution). Un-assigning someone who isn't actually assigned is a
 * safe no-op server-side (the RPC returns removed:false, no exception) — the action always reports
 * `ok: true` for that case rather than surfacing a confusing error for what is, from the caller's point
 * of view, already the desired end state (the person is not assigned).
 */
export async function unassignPlanOperationAssignee(planId: string, opId: string, personId: string) {
  await requireMembership();
  const sb = await createClient();

  const { error } = await sb.rpc("fn_unassign_plan_operation", {
    p_op_id: opId,
    p_person_id: personId,
  });
  if (error) {
    return {
      ok: false,
      error: toArabicError(
        error,
        { "42501": "ليس لديك صلاحية تعديل الخطة", P0002: "العملية غير موجودة" },
        "تعذّر إزالة المكلّف",
      ),
    };
  }

  revalidatePath(`/plans/${planId}`);
  return { ok: true };
}

interface InstantiateTemplateResult {
  templateId: string;
  created: number;
  deduped: number;
  occurrences: { operationId: string; plannedAt: string; deduped: boolean }[];
}

/**
 * Instantiate a named operation template (SPEC-0019 P1-3 "جداول العمليات") onto a plan: creates one
 * dated operation per occurrence in the template's recurrence, anchored to `anchorDate`. Delegates
 * ALL operation-creation logic (validation/atomicity/the (plan,subtype,planned_at) dedup) to
 * fn_instantiate_operation_template, which itself only ever calls the existing
 * fn_add_plan_operation_multi in a loop — no operation-creation logic is duplicated here or in SQL.
 *
 * A repeat call with the SAME anchor date on the SAME plan is dedup-safe: every occurrence lands on
 * the SAME planned_at as before, so the RPC's existing CREATE-2 dedup returns `deduped: true` for
 * each one instead of creating a duplicate — surfaced honestly via `deduped`/`created` counts rather
 * than reported as a plain success.
 */
export async function instantiateOperationTemplate(
  planId: string,
  templateId: string,
  anchorDate: string, // yyyy-mm-dd
) {
  await requireMembership();

  if (!anchorDate) {
    return { ok: false as const, error: "اختر تاريخًا مرجعيًا لبدء البرنامج" };
  }

  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_instantiate_operation_template", {
    p_plan_id: planId,
    p_template_id: templateId,
    p_anchor_date: anchorDate,
  });
  if (error) {
    return {
      ok: false as const,
      error: toArabicError(
        error,
        {
          "42501": "ليس لديك صلاحية تعديل الخطة",
          P0002: "الخطة أو البرنامج غير موجود",
          "22023": "بيانات غير صالحة",
        },
        "تعذّر تطبيق البرنامج",
      ),
    };
  }

  const result = data as InstantiateTemplateResult | null;
  if (!result) return { ok: false as const, error: "تعذّر تطبيق البرنامج" };

  revalidatePath(`/plans/${planId}`);
  return { ok: true as const, ...result };
}
