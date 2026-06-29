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

/**
 * Adapter so the generic MasterTable (SPEC-0017) can call the gated createSupplier with its
 * key→value form payload. Stays a server action (gated path preserved); maps the loose record to the
 * typed SupplierInput. Keys match the MasterTable `fields` declared on the suppliers page.
 */
export async function createSupplierFromForm(
  values: Record<string, string | number | null>,
): Promise<{ ok: boolean; error?: string }> {
  return createSupplier({
    name: values.name != null ? String(values.name) : "",
    phone: values.phone != null ? String(values.phone) : null,
    terms: values.terms != null ? String(values.terms) : null,
    leadTimeDays: values.leadTimeDays != null ? Number(values.leadTimeDays) : null,
  });
}
