"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";

// Expense classification (matches the expenses.kind CHECK). Owner drawings (مسحوبات) MUST be separable from
// operating expenses in any P&L (non-negotiable #6); the finance dashboard classifies by this column.
export type ExpenseKind = "operating" | "drawing" | "capex";
const EXPENSE_KINDS: ExpenseKind[] = ["operating", "drawing", "capex"];

export interface ExpenseInput {
  date: string | null;
  category: string;
  description: string | null;
  total: number;
  supplierId: string | null;
  paymentMethod: string | null;
  kind?: ExpenseKind;
}

/**
 * Record an expense in the active org, classified by `kind` (operating / drawing / capex). RLS
 * (expenses.tenant_all WITH CHECK) re-enforces authorize('budget.write', org_id) server-side, so a non-write
 * role is rejected even here; the expenses.kind CHECK constraint validates the classification in the DB.
 */
export async function createExpense(
  input: ExpenseInput,
): Promise<{ ok: boolean; error?: string }> {
  const category = input.category?.trim();
  if (!category) return { ok: false, error: "الفئة مطلوبة" };
  if (!Number.isFinite(input.total) || input.total <= 0) {
    return { ok: false, error: "المبلغ غير صالح" };
  }
  const kind: ExpenseKind = input.kind ?? "operating";
  if (!EXPENSE_KINDS.includes(kind)) return { ok: false, error: "نوع المصروف غير صالح" };

  const m = await requireMembership();
  const sb = await createClient();
  const { data, error } = await sb
    .from("expenses")
    .insert({
      org_id: m.orgId,
      date: input.date || null,
      category,
      description: input.description?.trim() || null,
      total: input.total,
      supplier_id: input.supplierId || null,
      payment_method: input.paymentMethod?.trim() || null,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: "تعذّر تسجيل المصروف (تحقّق من صلاحياتك)" };
  }
  // Classify via the gated RPC — the ONLY write path for expenses.kind (it's omitted from the Insert type).
  // A new expense defaults to 'operating', so only reclassify when the user chose otherwise. Drawings
  // (مسحوبات) must be separated from operating expenses (non-negotiable #6); this is the write side of #501.
  if (kind !== "operating") {
    const { error: kindError } = await sb.rpc("fn_set_expense_kind", { p_id: data.id, p_kind: kind });
    if (kindError) {
      return { ok: false, error: "سُجّل المصروف كـ«تشغيلي»، لكن تعذّر تصنيفه — غيّر النوع لاحقًا" };
    }
  }
  revalidatePath("/expenses");
  return { ok: true };
}
