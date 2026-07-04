"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";

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
  accountId?: string | null;
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
  const accountId = input.accountId?.trim() || null;

  const m = await requireMembership();
  const sb = await createClient();
  if (accountId) {
    const { data: account, error: accountReadError } = await sb
      .from("accounts")
      .select("id, org_id, kind, active")
      .eq("id", accountId)
      .maybeSingle();
    if (accountReadError || !account) {
      return { ok: false, error: "الحساب المحاسبي المختار غير موجود" };
    }
    if (account.org_id !== m.orgId || !account.active || account.kind !== kind) {
      return { ok: false, error: "الحساب المحاسبي المختار لا يطابق نوع المصروف" };
    }
    const { data: children, error: childError } = await sb
      .from("accounts")
      .select("id")
      .eq("parent_id", accountId)
      .eq("active", true)
      .limit(1);
    if (childError) return { ok: false, error: "تعذّر التحقق من الحساب المحاسبي" };
    if ((children ?? []).length > 0) {
      return { ok: false, error: "اختر حسابًا فرعيًا لا يحتوي على فروع نشطة" };
    }
  }
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
  if (accountId) {
    const { error: accountError } = await sb.from("expenses").update({ account_id: accountId }).eq("id", data.id);
    if (accountError) {
      return {
        ok: false,
        error: toArabicError(
          accountError,
          {
            "22023": "سُجّل المصروف، لكن الحساب المختار لا يطابق نوع المصروف أو ليس حسابًا فرعيًا نشطًا",
            "42501": "سُجّل المصروف، لكن ليست لديك صلاحية ربطه بالحساب",
          },
          "سُجّل المصروف، لكن تعذّر ربطه بالحساب المحاسبي",
        ),
      };
    }
  }
  revalidatePath("/expenses");
  revalidatePath("/finance/accounts");
  revalidatePath("/accounting");
  revalidatePath("/custody");
  return { ok: true };
}
