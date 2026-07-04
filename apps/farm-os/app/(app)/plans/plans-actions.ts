"use server";

import { addPlanOperationMulti } from "./[planId]/actions";
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

/**
 * SPEC-0026 P-2 — «انسخ الأسبوع الماضي»: clone a plan into a NEW draft with dates shifted by one
 * period length. Composes the existing gated RPCs only (fn_create_plan + fn_add_plan_operation_multi),
 * copying every operation line with its materials + labor. Assignees are NOT copied (people
 * availability changes week to week — the manager re-assigns; SPEC-0026 §4 decision 4 default).
 */
export async function clonePlan(sourcePlanId: string): Promise<Result<string>> {
  await requireMembership();
  const sb = await createClient();
  const { data: src, error: srcError } = await sb
    .from("plans")
    .select("id, type, period_start, period_end, scope_type, scope_id")
    .eq("id", sourcePlanId)
    .maybeSingle();
  if (srcError || !src) return { ok: false, error: "الخطة المصدر غير موجودة" };

  const shiftDays =
    src.period_start && src.period_end
      ? Math.max(1, Math.round((Date.parse(src.period_end) - Date.parse(src.period_start)) / 86400000) + 1)
      : 7;
  const shift = (d: string | null) =>
    d ? new Date(Date.parse(d) + shiftDays * 86400000).toISOString().slice(0, 10) : null;

  const created = await createPlan({
    type: (src.type as "weekly" | "monthly" | "quarterly" | "annual") ?? "weekly",
    periodStart: shift(src.period_start),
    periodEnd: shift(src.period_end),
    scopeType: (src.scope_type as "farm" | "sector" | "hawsha") ?? "farm",
    scopeId: src.scope_id ?? null,
  });
  if (!created.ok || !created.data) return { ok: false, error: ("error" in created && created.error) || "تعذّر إنشاء الخطة الجديدة" };
  const newPlanId = created.data;

  // ends_on/harvest_stage/… exist in the DB (migrations 0090/0350000) but not in the generated types
  // (known stale-typegen gap; the ext file covers other columns). Cast the read locally.
  interface CloneOpRow {
    id: string;
    subtype: string | null;
    planned_at: string | null;
    ends_on: string | null;
    est_cost: number | string | null;
    preferred_time_of_day: string | null;
    harvest_stage: string | null;
    irrigation_basis: string | null;
    soil_moisture_reading: string | null;
  }
  const [{ data: ops }, { data: mats }, { data: labor }] = await Promise.all([
    sb
      .from("plan_operations")
      .select("id, subtype, planned_at, ends_on, est_cost, preferred_time_of_day, harvest_stage, irrigation_basis, soil_moisture_reading")
      .eq("plan_id", sourcePlanId)
      .then((r) => ({ ...r, data: (r.data ?? null) as unknown as CloneOpRow[] | null })),
    sb.from("plan_material_requirements").select("plan_op_id, item_id, qty, unit"),
    sb.from("plan_labor_requirements").select("plan_op_id, person_or_team, count, days"),
  ]);

  let copied = 0;
  let failed = 0;
  for (const op of ops ?? []) {
    const opMats = (mats ?? [])
      .filter((r) => r.plan_op_id === op.id && r.item_id)
      .map((r) => ({ item_id: r.item_id as string, qty: Number(r.qty ?? 0), unit: r.unit ?? "" }));
    const opLabor = (labor ?? [])
      .filter((r) => r.plan_op_id === op.id && r.person_or_team)
      .map((r) => ({ person_or_team: r.person_or_team as string, count: Number(r.count ?? 1), days: Number(r.days ?? 1) }));
    if (opMats.length === 0 && opLabor.length === 0) {
      failed += 1; // the multi RPC requires at least one need; skip honestly and report
      continue;
    }
    const r = await addPlanOperationMulti(newPlanId, {
      subtype: op.subtype ?? "other",
      planned_at: shift(op.planned_at ? String(op.planned_at).slice(0, 10) : null) ?? "",
      ends_on: shift(op.ends_on ? String(op.ends_on).slice(0, 10) : null),
      est_cost: Number(op.est_cost ?? 0),
      materials: opMats,
      labor: opLabor,
      assignee_ids: [],
      lead_id: null,
      harvest_stage: (op.harvest_stage as never) ?? null,
      preferred_time_of_day: op.preferred_time_of_day ?? null,
      irrigation_basis: (op.irrigation_basis as never) ?? null,
      soil_moisture_reading: op.soil_moisture_reading ?? null,
    });
    if (!r.ok) failed += 1;
    else copied += 1;
  }
  revalidatePath("/plans");
  if (copied === 0 && (ops ?? []).length > 0) return { ok: false, error: "لم يُنسخ أي سطر — راجع الخطة المصدر" };
  if (failed > 0) console.warn(`clonePlan: ${failed} line(s) skipped (no material/labor need or RPC error)`);
  return { ok: true, data: newPlanId };
}
