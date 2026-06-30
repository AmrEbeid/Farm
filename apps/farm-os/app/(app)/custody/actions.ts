"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";

type Result = { ok: boolean; error?: string };
type RequestLifecycleRpc =
  | "fn_submit_payment_request"
  | "fn_approve_request_operational"
  | "fn_approve_request_final";

const PERM: Record<string, string> = {
  "42501": "ليس لديك صلاحية لهذا الإجراء",
  "22023": "قيمة غير صالحة",
  "P0002": "العنصر غير موجود",
};

async function requireCustodyFinanceRole() {
  return requireRole(["owner", "accountant"]);
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeOptionalDate(value?: string | null): string | null {
  const date = value?.trim();
  return date ? date : null;
}

/** Create a custody account through the backend RPC-only write path. */
export async function createCustodyAccount(input: { holderLabel: string; targetFloat: number }): Promise<Result> {
  const label = input.holderLabel?.trim();
  if (!label) return { ok: false, error: "اسم صاحب العهدة مطلوب" };
  if (!isFiniteNonNegative(input.targetFloat)) return { ok: false, error: "العهدة المستهدفة غير صالحة" };
  const m = await requireCustodyFinanceRole();
  const sb = await createClient();
  const { error } = await sb.rpc("fn_save_custody_account", {
    p_id: null,
    p_org: m.orgId,
    p_holder_label: label,
    p_holder_user_id: null,
    p_target_float: input.targetFloat,
    p_active: true,
  });
  if (error) return { ok: false, error: toArabicError(error, PERM, "تعذّر إضافة حساب العهدة (تحقّق من صلاحياتك)") };
  revalidatePath("/custody");
  return { ok: true };
}

/** Record a custody cash movement (receipt / handover / cash spend / settlement). */
export async function recordCustodyMovement(input: {
  accountId: string;
  movementType: string;
  amountIn: number;
  amountOut: number;
  note?: string | null;
}): Promise<Result> {
  if (!input.accountId || !input.movementType) return { ok: false, error: "البيانات ناقصة" };
  if (!isFiniteNonNegative(input.amountIn) || !isFiniteNonNegative(input.amountOut)) {
    return { ok: false, error: "المبلغ غير صالح" };
  }
  if (isFinitePositive(input.amountIn) === isFinitePositive(input.amountOut)) {
    return { ok: false, error: "أدخل مبلغًا واردًا أو صادرًا واحدًا فقط" };
  }
  await requireCustodyFinanceRole();
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

/** Route an expense's payment: paid_from_custody posts one custody out-movement; others just tag it. */
export async function setExpensePaymentStatus(input: {
  expenseId: string;
  status: "paid_from_custody" | "post_paid_unpaid" | "paid_by_owner" | "cancelled";
  custodyAccountId?: string | null;
  paidBy?: string | null;
}): Promise<Result> {
  await requireCustodyFinanceRole();
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

/** Create a draft monthly payment request. Returns the new id. */
export async function createPaymentRequest(input: {
  periodStart?: string | null;
  periodEnd?: string | null;
  custodyAccountId?: string | null;
  note?: string | null;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  const periodStart = normalizeOptionalDate(input.periodStart);
  const periodEnd = normalizeOptionalDate(input.periodEnd);
  if ((periodStart && !isValidDateOnly(periodStart)) || (periodEnd && !isValidDateOnly(periodEnd))) {
    return { ok: false, error: "تاريخ الطلب غير صالح" };
  }
  if (periodStart && periodEnd && periodStart > periodEnd) {
    return { ok: false, error: "تاريخ بداية الفترة يجب أن يكون قبل تاريخ النهاية" };
  }
  const m = await requireCustodyFinanceRole();
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_create_payment_request", {
    p_org: m.orgId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_custody_account: input.custodyAccountId ?? null,
    p_note: input.note ?? null,
  });
  if (error) return { ok: false, error: toArabicError(error, PERM, "تعذّر إنشاء الطلب") };
  revalidatePath("/custody");
  return { ok: true, id: data as string };
}

async function callOnRequest(rpc: RequestLifecycleRpc, requestId: string, fallback: string): Promise<Result> {
  await requireCustodyFinanceRole();
  const sb = await createClient();
  const { error } = await sb.rpc(rpc, { p_request: requestId });
  if (error) return { ok: false, error: toArabicError(error, PERM, fallback) };
  revalidatePath("/custody");
  revalidatePath(`/custody/request/${requestId}`);
  return { ok: true };
}

/** Add an operating post-paid expense line to a draft request. */
export async function addExpenseToRequest(requestId: string, expenseId: string): Promise<Result> {
  await requireCustodyFinanceRole();
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
