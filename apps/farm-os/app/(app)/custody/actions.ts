"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";

type Result = { ok: boolean; error?: string };

const PERM: Record<string, string> = {
  "42501": "ليس لديك صلاحية لهذا الإجراء",
  "22023": "قيمة غير صالحة",
  "P0002": "العنصر غير موجود",
};

/** Create a custody account (holder + target float). RLS (custody_accounts WITH CHECK) enforces custody.write. */
export async function createCustodyAccount(input: { holderLabel: string; targetFloat: number }): Promise<Result> {
  const label = input.holderLabel?.trim();
  if (!label) return { ok: false, error: "اسم صاحب العهدة مطلوب" };
  if (!Number.isFinite(input.targetFloat) || input.targetFloat < 0) return { ok: false, error: "العهدة المستهدفة غير صالحة" };
  const m = await requireMembership();
  const sb = await createClient();
  const { error } = await sb
    .from("custody_accounts")
    .insert({ org_id: m.orgId, holder_label: label, target_float: input.targetFloat });
  if (error) return { ok: false, error: toArabicError(error, PERM, "تعذّر إضافة حساب العهدة (تحقّق من صلاحياتك)") };
  revalidatePath("/custody");
  return { ok: true };
}

/** Record a custody cash movement (receipt / handover / cash spend / settlement). Gated: custody.write. */
export async function recordCustodyMovement(input: {
  accountId: string;
  movementType: string;
  amountIn: number;
  amountOut: number;
  note?: string | null;
}): Promise<Result> {
  if (!input.accountId || !input.movementType) return { ok: false, error: "البيانات ناقصة" };
  if ((input.amountIn > 0) === (input.amountOut > 0)) {
    return { ok: false, error: "أدخل مبلغًا واردًا أو صادرًا واحدًا فقط" };
  }
  await requireMembership();
  const sb = await createClient();
  const { error } = await sb.rpc("fn_record_custody_movement", {
    p_account: input.accountId,
    p_movement_type: input.movementType,
    p_amount_in: input.amountIn,
    p_amount_out: input.amountOut,
    p_note: input.note ?? null,
  });
  if (error) return { ok: false, error: toArabicError(error, PERM, "تعذّر تسجيل الحركة") };
  revalidatePath("/custody");
  return { ok: true };
}

/** Route an expense's payment: paid_from_custody posts one custody out-movement; others just tag it. budget.write. */
export async function setExpensePaymentStatus(input: {
  expenseId: string;
  status: "paid_from_custody" | "post_paid_unpaid" | "paid_by_owner" | "cancelled";
  custodyAccountId?: string | null;
  paidBy?: string | null;
}): Promise<Result> {
  await requireMembership();
  const sb = await createClient();
  const { error } = await sb.rpc("fn_set_expense_payment_status", {
    p_expense: input.expenseId,
    p_status: input.status,
    p_custody_account: input.custodyAccountId ?? null,
    p_paid_by: input.paidBy ?? null,
  });
  if (error) return { ok: false, error: toArabicError(error, PERM, "تعذّر تحديث حالة الدفع") };
  revalidatePath("/custody");
  revalidatePath("/expenses");
  return { ok: true };
}

/** Create a draft monthly payment request. Gated: request.prepare. Returns the new id. */
export async function createPaymentRequest(input: {
  periodStart?: string | null;
  periodEnd?: string | null;
  custodyAccountId?: string | null;
  note?: string | null;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  const m = await requireMembership();
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_create_payment_request", {
    p_org: m.orgId,
    p_period_start: input.periodStart ?? null,
    p_period_end: input.periodEnd ?? null,
    p_custody_account: input.custodyAccountId ?? null,
    p_note: input.note ?? null,
  });
  if (error) return { ok: false, error: toArabicError(error, PERM, "تعذّر إنشاء الطلب") };
  revalidatePath("/custody");
  return { ok: true, id: data as string };
}

async function callOnRequest(rpc: string, requestId: string, fallback: string): Promise<Result> {
  await requireMembership();
  const sb = await createClient();
  const { error } = await sb.rpc(rpc as "fn_submit_payment_request", { p_request: requestId });
  if (error) return { ok: false, error: toArabicError(error, PERM, fallback) };
  revalidatePath("/custody");
  revalidatePath(`/custody/request/${requestId}`);
  return { ok: true };
}

/** Add an expense line to a draft request. request.prepare. */
export async function addExpenseToRequest(requestId: string, expenseId: string): Promise<Result> {
  await requireMembership();
  const sb = await createClient();
  const { error } = await sb.rpc("fn_add_expense_to_request", { p_request: requestId, p_expense: expenseId });
  if (error) return { ok: false, error: toArabicError(error, PERM, "تعذّر إضافة البند") };
  revalidatePath(`/custody/request/${requestId}`);
  return { ok: true };
}

export async function submitPaymentRequest(id: string): Promise<Result> {
  return callOnRequest("fn_submit_payment_request", id, "تعذّر إرسال الطلب");
}
export async function approveRequestOperational(id: string): Promise<Result> {
  return callOnRequest("fn_approve_request_operational", id, "تعذّر الاعتماد التشغيلي");
}
export async function approveRequestFinal(id: string): Promise<Result> {
  return callOnRequest("fn_approve_request_final", id, "تعذّر الاعتماد النهائي");
}
