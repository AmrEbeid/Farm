"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";
import type { Json } from "@/lib/database.types";

/**
 * Update a palm's current status and append to its per-tree status history.
 *
 * Both writes go through the SECURITY DEFINER RPC fn_update_palm_status (migration 0039), which
 * (a) enforces the FIELD-role gate IN THE DATABASE — op.execute = owner/farm_manager/agri_engineer/
 * supervisor, scoped to the asset's org — so accountant/storekeeper cannot change tree health even
 * via direct PostgREST (the bare `assets` RLS is org-scoped only, no role gate); and (b) runs the
 * status UPDATE + the history INSERT in ONE transaction, so a history failure rolls the status
 * change back — the status never flips without its audit trail. requireMembership() keeps the action
 * authenticated; the DB is the single source of truth for the role gate. 42501 → Arabic permission.
 */
export async function updatePalmStatus(assetId: string, status: string, reason: string) {
  await requireMembership();

  const sb = await createClient();
  const { error } = await sb.rpc("fn_update_palm_status", {
    p_asset_id: assetId,
    p_status: status,
    p_note: reason,
  });
  if (error) {
    return {
      ok: false as const,
      error: toArabicError(error, {
        "42501": "ليس لديك صلاحية لتغيير حالة النخلة",
      }),
    };
  }

  // A status change affects every view that reads this tree's status: its own file, the farm
  // landing's "palms needing attention" list, and the sector/hawsha palm grids. The RPC doesn't
  // return the tree's location, so fetch it (RLS-scoped) and revalidate all affected views.
  // Restores the freshness #244 added before #245's RPC rewrite dropped the multi-path revalidate.
  const { data: loc } = await sb
    .from("assets")
    .select("sector_id, hawsha_id")
    .eq("id", assetId)
    .maybeSingle();
  revalidatePath(`/farm/palm/${assetId}`);
  revalidatePath("/farm");
  if (loc?.sector_id) revalidatePath(`/farm/sector/${loc.sector_id}`);
  if (loc?.hawsha_id) revalidatePath(`/farm/hawsha/${loc.hawsha_id}`);
  return { ok: true as const };
}

export interface NewPalmTreatmentInput {
  subtype: string;
  planned_at: string; // yyyy-mm-dd
  note: string;
  item_id: string | null; // optional single material line
  qty: number | null;
  unit: string | null;
}

/**
 * Log a lightweight individual-palm rescue/exception treatment (e.g. a root-stimulant drench for
 * one ailing tree) — distinct from, and much lighter than, authoring a full plan operation via
 * OperationBuilder. Reuses the EXISTING fn_add_plan_operation_multi RPC (no new operation-creation
 * RPC — see migration 20260701340000's header for why a new RPC would duplicate already-reviewed
 * authz/atomicity/dedup logic), called with target_type='palm'/target_id=this palm and at most ONE
 * material line (never the multi-material builder UI).
 *
 * DESIGN DECISION — plan_id: fn_add_plan_operation_multi still requires a plan_id (the operation's
 * parent container). Rather than make the field user pick/know about a plan (there may be zero, one,
 * or several, scoped to different sectors/hawshat — none obviously "the" palm's plan), this resolves
 * (or, on first use per org, creates) ONE implicit ad-hoc "individual treatments" plan per org via
 * the new fn_get_or_create_individual_treatment_plan RPC. The field user never sees a plan picker.
 */
export async function logPalmTreatment(assetId: string, input: NewPalmTreatmentInput) {
  const m = await requireMembership();

  if (!input.note.trim() && !input.item_id) {
    return { ok: false as const, error: "أضف ملاحظة أو خامة مستخدمة على الأقل" };
  }
  if (input.item_id && (input.qty == null || !Number.isFinite(input.qty) || input.qty <= 0)) {
    return { ok: false as const, error: "أدخل كمية صحيحة أكبر من صفر للخامة المستخدمة" };
  }

  const sb = await createClient();

  // Confirm the target is actually a palm in the caller's org — a defence-in-depth check ahead of
  // the RPC's own org/type validation, so a bad id fails with a clear Arabic message immediately.
  const { data: palm, error: palmErr } = await sb
    .from("assets")
    .select("id")
    .eq("id", assetId)
    .eq("type", "palm")
    .maybeSingle();
  if (palmErr) return { ok: false as const, error: toArabicError(palmErr) };
  if (!palm) return { ok: false as const, error: "النخلة غير موجودة" };

  // Resolve (or, on first use per org, create) the org's implicit "individual treatments" plan —
  // fn_add_plan_operation_multi still requires a plan_id, and this spares the field user a plan
  // picker (see the migration header + the docstring above for the full design rationale).
  const { data: planId, error: planErr } = await sb.rpc(
    "fn_get_or_create_individual_treatment_plan",
    { p_org: m.orgId },
  );
  if (planErr) {
    return {
      ok: false as const,
      error: toArabicError(planErr, {
        "42501": "ليس لديك صلاحية لتسجيل معالجة فردية",
      }),
    };
  }

  const materials: Json = input.item_id
    ? [{ item_id: input.item_id, qty: input.qty, unit: input.unit || undefined }]
    : [];

  const { data, error } = await sb.rpc("fn_add_plan_operation_multi", {
    p_plan_id: planId as string,
    p_subtype: input.subtype,
    p_planned_at: input.planned_at,
    p_ends_on: null,
    p_est_cost: 0,
    p_materials: materials,
    p_labor: [],
    p_assignee_ids: [],
    p_lead_id: null,
    p_target_type: "palm",
    p_target_id: assetId,
    p_note: input.note.trim() || null,
  });
  if (error) {
    return {
      ok: false as const,
      error: toArabicError(error, {
        "42501": "ليس لديك صلاحية لتسجيل معالجة فردية",
      }),
    };
  }
  // The multi-op dedup natural key is (plan, subtype, planned_at, target) — it does NOT include the note or
  // material. So a SECOND treatment of the same subtype on the same palm+date is silently deduped (nothing
  // created), and this note is lost. Surface that honestly instead of a false "saved" (non-negotiable #1 — never
  // fabricate success). The user can change the date/subtype to record an additional treatment.
  if (data && typeof data === "object" && (data as { deduped?: boolean }).deduped) {
    return {
      ok: false as const,
      error: "توجد بالفعل معالجة بنفس النوع والتاريخ على هذه النخلة — لم تُسجَّل معالجة جديدة. غيّر التاريخ أو النوع.",
    };
  }

  revalidatePath(`/farm/palm/${assetId}`);
  return { ok: true as const };
}
