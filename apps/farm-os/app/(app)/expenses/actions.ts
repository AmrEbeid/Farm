"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireMembership, requireRole } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";
import {
  parseExpenseCorrection,
  parseExpensePaymentReversal,
  type ExpenseCorrectionInput,
  type ExpensePaymentReversalInput,
} from "@/lib/expense-payment-reversal";

// Expense classification (matches the expenses.kind CHECK). Owner drawings (مسحوبات) MUST be separable from
// operating expenses in any P&L (non-negotiable #6); the finance dashboard classifies by this column.
export type ExpenseKind = "operating" | "drawing" | "capex";
const EXPENSE_KINDS: ExpenseKind[] = ["operating", "drawing", "capex"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    return {
      ok: false,
      error: toArabicError(
        error,
        { "42501": "تعذّر تسجيل المصروف (تحقّق من صلاحياتك)" },
        "تعذّر تسجيل المصروف",
      ),
    };
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

export async function reverseExpensePayment(
  input: ExpensePaymentReversalInput,
): Promise<{ ok: boolean; error?: string; idempotent?: boolean }> {
  const parsed = parseExpensePaymentReversal(input);
  if (!parsed.ok) return parsed;

  const membership = await requireMembership();
  if (membership.role !== "owner" && membership.role !== "accountant") {
    return { ok: false, error: "هذا التصحيح متاح للمالك والمحاسب فقط" };
  }

  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_reverse_expense_payment", {
    p_expense: parsed.value.expenseId,
    p_expected_movement: parsed.value.movementId,
    p_outcome: parsed.value.outcome,
    p_reason: parsed.value.reason,
    p_reversal_date: parsed.value.reversalDate,
  });
  if (error) {
    return {
      ok: false,
      error: toArabicError(
        error,
        {
          "23502": "أكمل سبب التصحيح وتاريخه",
          "22023": "لا يمكن تصحيح هذا السداد بهذه الحالة؛ راجع ارتباطه بإذن الصرف أو القيود",
          "42501": "ليس لديك صلاحية تصحيح سداد هذا المصروف",
          "55000": "لا يمكن التصحيح داخل فترة محاسبية مقفلة",
          "P0002": "المصروف أو حركة السداد غير موجودة",
        },
        "تعذّر تصحيح سداد المصروف",
      ),
    };
  }

  revalidatePath(`/expenses/${parsed.value.expenseId}`);
  revalidatePath("/expenses");
  revalidatePath("/custody");
  revalidatePath("/transactions");
  revalidatePath("/accounting");
  revalidatePath("/finance/dashboard");
  revalidatePath("/finance/pnl");
  revalidatePath("/finance/income-statement");
  return {
    ok: true,
    idempotent: Boolean(data && typeof data === "object" && "idempotent" in data && data.idempotent),
  };
}

export async function correctAndRerouteExpense(
  input: ExpenseCorrectionInput,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = parseExpenseCorrection(input);
  if (!parsed.ok) return parsed;

  const membership = await requireMembership();
  if (membership.role !== "owner" && membership.role !== "accountant") {
    return { ok: false, error: "هذا التصحيح متاح للمالك والمحاسب فقط" };
  }

  const sb = await createClient();
  const { error } = await sb.rpc("fn_correct_and_route_reversed_expense", {
    p_expense: parsed.value.expenseId,
    p_date: parsed.value.date,
    p_category: parsed.value.category,
    p_description: parsed.value.description,
    p_total: parsed.value.total,
    p_supplier: parsed.value.supplierId,
    p_account: parsed.value.accountId,
    p_cost_center: parsed.value.costCenterId,
    p_route: parsed.value.route,
    p_custody_account: parsed.value.custodyAccountId,
  });
  if (error) {
    return {
      ok: false,
      error: toArabicError(
        error,
        {
          "22023": "تغيّرت حالة المصروف أو بيانات التوجيه غير صالحة؛ حدّث الصفحة وراجع الاختيارات",
          "42501": "ليست لديك صلاحية حفظ هذا التصحيح أو أحد الاختيارات يتبع مزرعة أخرى",
          "P0002": "المصروف غير موجود في المزرعة النشطة",
        },
        "تعذّر حفظ تصحيح المصروف؛ لم تُحفظ تغييرات",
      ),
    };
  }

  revalidateExpenseCorrectionPaths(parsed.value.expenseId);
  return { ok: true };
}

function revalidateExpenseCorrectionPaths(expenseId: string) {
  for (const path of [
    `/expenses/${expenseId}`,
    "/expenses",
    "/custody",
    "/transactions",
    "/accounting",
    "/finance/dashboard",
    "/finance/accounts",
    "/finance/pnl",
    "/finance/income-statement",
  ]) {
    revalidatePath(path);
  }
}

export async function setMissingExpenseDate(formData: FormData): Promise<void> {
  const expenseId = String(formData.get("expense_id") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  if (!expenseId || !DATE_RE.test(date)) {
    redirect(`/expenses/${encodeURIComponent(expenseId)}?error=${encodeURIComponent("اختر تاريخًا صحيحًا")}`);
  }

  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const { error } = await sb.rpc("fn_set_missing_expense_date", {
    p_org: m.orgId,
    p_expense: expenseId,
    p_date: date,
  });
  if (error) {
    redirect(
      `/expenses/${encodeURIComponent(expenseId)}?error=${encodeURIComponent(
        toArabicError(
          error,
          {
            "55000": "لا يمكن وضع التاريخ داخل فترة محاسبية مقفلة، أو أن المصروف مؤرّخ بالفعل",
          },
          "تعذّر حفظ تاريخ المصروف",
        ),
      )}`,
    );
  }

  revalidatePath("/expenses");
  revalidatePath(`/expenses/${expenseId}`);
  revalidatePath("/finance/close");
  redirect(`/expenses/${encodeURIComponent(expenseId)}?ok=${encodeURIComponent("تم حفظ تاريخ المصروف")}`);
}
