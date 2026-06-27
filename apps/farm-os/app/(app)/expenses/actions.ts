"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";

export interface ExpenseInput {
  date: string | null;
  category: string;
  description: string | null;
  total: number;
  supplierId: string | null;
  paymentMethod: string | null;
}

/**
 * Record an operating expense in the active org. RLS (expenses.tenant_all WITH CHECK) re-enforces
 * authorize('budget.write', org_id) server-side, so a non-write role is rejected even here.
 */
export async function createExpense(
  input: ExpenseInput,
): Promise<{ ok: boolean; error?: string }> {
  const category = input.category?.trim();
  if (!category) return { ok: false, error: "الفئة مطلوبة" };
  if (!Number.isFinite(input.total) || input.total <= 0) {
    return { ok: false, error: "المبلغ غير صالح" };
  }

  const m = await requireMembership();
  const sb = await createClient();
  const { error } = await sb.from("expenses").insert({
    org_id: m.orgId,
    date: input.date || null,
    category,
    description: input.description?.trim() || null,
    total: input.total,
    supplier_id: input.supplierId || null,
    payment_method: input.paymentMethod?.trim() || null,
  });
  if (error) {
    return { ok: false, error: "تعذّر تسجيل المصروف (تحقّق من صلاحياتك)" };
  }
  revalidatePath("/expenses");
  return { ok: true };
}
