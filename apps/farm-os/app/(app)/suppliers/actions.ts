"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";

export interface SupplierInput {
  name: string;
  phone: string | null;
  terms: string | null;
  leadTimeDays: number | null;
}

/**
 * Create a supplier in the active org. RLS (suppliers.tenant_all WITH CHECK) re-enforces
 * authorize('inventory.write', org_id) server-side, so a non-write role is rejected even if it
 * reaches this action. Validates input app-side for a clean Arabic error.
 */
export async function createSupplier(
  input: SupplierInput,
): Promise<{ ok: boolean; error?: string }> {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: "اسم المورّد مطلوب" };
  if (
    input.leadTimeDays != null &&
    (!Number.isFinite(input.leadTimeDays) || input.leadTimeDays < 0)
  ) {
    return { ok: false, error: "مدة التوريد غير صالحة" };
  }

  const m = await requireMembership();
  const sb = await createClient();
  const { error } = await sb.from("suppliers").insert({
    org_id: m.orgId,
    name,
    phone: input.phone?.trim() || null,
    terms: input.terms?.trim() || null,
    lead_time_days: input.leadTimeDays,
  });
  if (error) {
    return { ok: false, error: "تعذّر إضافة المورّد (تحقّق من صلاحياتك)" };
  }
  revalidatePath("/suppliers");
  return { ok: true };
}
