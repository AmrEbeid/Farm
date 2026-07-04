"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { OffshootMovementType } from "@/lib/offshoot-bank";

type Result = { ok: boolean; error?: string };

export interface RecordOffshootMovementInput {
  movementType: OffshootMovementType;
  qty: number;
  movementDate?: string | null;
  sourceCostCenterId?: string | null;
  destCostCenterId?: string | null;
  note?: string | null;
}

export interface SetOffshootValuationInput {
  lowPerUnit: number | null;
  highPerUnit: number | null;
}

const MOVEMENT_TYPES: OffshootMovementType[] = ["produce", "plant", "sell", "replant"];

const OFFSHOOT_ERRORS: Record<string, string> = {
  "42501": "ليس لديك صلاحية تعديل بنك الفسائل",
  "23502": "بيانات ناقصة مطلوبة",
  "22023": "تحقّق من نوع الحركة والكمية ومركز التكلفة",
};

function refreshOffshootSurfaces() {
  revalidatePath("/farm/offshoots");
  revalidatePath("/farm/dashboard");
  revalidatePath("/dashboard/manager");
  revalidatePath("/dashboard/owner");
  revalidatePath("/finance/dashboard");
}

function cleanId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function recordOffshootMovement(input: RecordOffshootMovementInput): Promise<Result> {
  if (!MOVEMENT_TYPES.includes(input.movementType)) return { ok: false, error: "نوع الحركة غير صالح" };
  if (!Number.isFinite(input.qty) || input.qty <= 0) return { ok: false, error: "الكمية يجب أن تكون أكبر من صفر" };
  if ((input.movementType === "plant" || input.movementType === "replant") && !cleanId(input.destCostCenterId)) {
    return { ok: false, error: "مركز الوجهة مطلوب لهذه الحركة" };
  }

  const m = await requireRole(["owner", "farm_manager"]);
  const sb = await createClient();
  const { error } = await sb.rpc("fn_record_offshoot_movement", {
    p_org: m.orgId,
    p_movement_type: input.movementType,
    p_qty: input.qty,
    p_movement_date: input.movementDate || null,
    p_source_cost_center_id: cleanId(input.sourceCostCenterId),
    p_dest_cost_center_id: input.movementType === "plant" || input.movementType === "replant"
      ? cleanId(input.destCostCenterId)
      : null,
    p_note: input.note?.trim() || null,
  });
  if (error) return { ok: false, error: toArabicError(error, OFFSHOOT_ERRORS, "تعذّر تسجيل حركة الفسائل") };
  refreshOffshootSurfaces();
  return { ok: true };
}

export async function setOffshootValuation(input: SetOffshootValuationInput): Promise<Result> {
  if (input.lowPerUnit != null && (!Number.isFinite(input.lowPerUnit) || input.lowPerUnit < 0)) {
    return { ok: false, error: "الحد الأدنى يجب ألا يكون سالبًا" };
  }
  if (input.highPerUnit != null && (!Number.isFinite(input.highPerUnit) || input.highPerUnit < 0)) {
    return { ok: false, error: "الحد الأعلى يجب ألا يكون سالبًا" };
  }
  if (input.lowPerUnit != null && input.highPerUnit != null && input.lowPerUnit > input.highPerUnit) {
    return { ok: false, error: "الحد الأدنى لا يمكن أن يزيد عن الحد الأعلى" };
  }

  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const { error } = await sb.rpc("fn_set_offshoot_valuation", {
    p_org: m.orgId,
    p_low: input.lowPerUnit,
    p_high: input.highPerUnit,
  });
  if (error) return { ok: false, error: toArabicError(error, OFFSHOOT_ERRORS, "تعذّر حفظ تقييم الفسائل") };
  refreshOffshootSurfaces();
  return { ok: true };
}
