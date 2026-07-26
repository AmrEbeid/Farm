"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";
import type { Json } from "@/lib/database.types.ext";
import { fmtDate } from "@/lib/dates";
import { egp } from "@/lib/money";
import {
  buildReviewDecision,
  isUuid,
} from "@/lib/reconciliation review";

export type ActionResult = { ok: boolean; error?: string };
export type CorrectionTarget = { id: string; label: string };
export type CorrectionSearchResult =
  | { ok: true; targets: CorrectionTarget[] }
  | { ok: false; error: string };

/** Both routes are revalidated so counts/status refresh after any write. */
function revalidateReconciliation(batchId?: string) {
  revalidatePath("/finance/reconciliation");
  if (batchId && isUuid(batchId)) {
    revalidatePath(`/finance/reconciliation/${batchId}`);
  }
}

const REVIEW_PERM: Record<string, string> = {
  "42501": "ليس لديك صلاحية مراجعة التسويات (المالك أو المحاسب فقط).",
  "22023": "قرار غير صالح؛ راجع الحقول المطلوبة.",
  P0002: "الصف المطلوب غير موجود.",
};

const FREEZE_PERM: Record<string, string> = {
  "42501": "ليس لديك صلاحية تجميد الدفعة (المالك أو المحاسب فقط).",
  "22023": "لا يمكن التجميد: يجب أن يكون لكل صف قرار مراجعة صريح والدفعة قيد المراجعة.",
  P0002: "الدفعة المطلوبة غير موجودة.",
};

const APPROVE_PERM: Record<string, string> = {
  // The RPC raises 42501 for owner-only AND for separation-of-duties; surface both clearly.
  "42501":
    "الاعتماد للمالك فقط، ولا يجوز أن يعتمد الدفعة من أنشأها أو راجع أيًّا من صفوفها (فصل المهام).",
  "22023": "لا يُعتمد إلا بعد تجميد الدفعة (مراجَعة).",
  P0002: "الدفعة المطلوبة غير موجودة.",
};

/**
 * Save one row's review / hold / reject decision. The decision is re-validated server-side (never
 * trusts the client) and passed to fn_review_reconciliation_row, which is the authoritative gate for
 * membership, reconciliation.write, batch-still-staged, typed-required, and correction-classification.
 */
export async function reviewRow(input: unknown): Promise<ActionResult> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "بيانات المراجعة غير صالحة." };
  }
  const candidate = input as Record<string, unknown>;
  if (!isUuid(candidate.rowId)) return { ok: false, error: "مُعرّف الصف غير صالح." };
  if (!isUuid(candidate.batchId)) return { ok: false, error: "مُعرّف الدفعة غير صالح." };
  const built = buildReviewDecision(candidate.decision);
  if (!built.ok) return { ok: false, error: built.error };

  await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const { error } = await sb.rpc("fn_review_reconciliation_row", {
    p_row_id: candidate.rowId,
    p_decision: built.payload as unknown as Json,
  });
  if (error) return { ok: false, error: toArabicError(error, REVIEW_PERM, "تعذّر حفظ القرار.") };
  revalidateReconciliation(candidate.batchId);
  return { ok: true };
}

/** Freeze a fully-reviewed batch (owner/accountant). */
export async function freezeBatch(batchId: string): Promise<ActionResult> {
  if (!isUuid(batchId)) return { ok: false, error: "مُعرّف الدفعة غير صالح." };
  await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const { error } = await sb.rpc("fn_freeze_reconciliation_batch", { p_batch_id: batchId });
  if (error) return { ok: false, error: toArabicError(error, FREEZE_PERM, "تعذّر تجميد الدفعة.") };
  revalidateReconciliation(batchId);
  return { ok: true };
}

/** Approve a frozen batch (owner only, separation of duties enforced by the RPC). */
export async function approveBatch(batchId: string): Promise<ActionResult> {
  if (!isUuid(batchId)) return { ok: false, error: "مُعرّف الدفعة غير صالح." };
  await requireRole(["owner"]);
  const sb = await createClient();
  const { error } = await sb.rpc("fn_approve_reconciliation_batch", { p_batch_id: batchId });
  if (error) return { ok: false, error: toArabicError(error, APPROVE_PERM, "تعذّر اعتماد الدفعة.") };
  revalidateReconciliation(batchId);
  return { ok: true };
}

function normalizeArabicDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

/**
 * Bounded, RLS-scoped target lookup for amount corrections. Reviewers search by the value they can
 * see in the source workbook (date, exact amount, category/crop, or description) and choose a human
 * label; raw UUID entry is never part of the workflow.
 */
export async function searchCorrectionTargets(input: unknown): Promise<CorrectionSearchResult> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "بيانات البحث غير صالحة." };
  }
  const candidate = input as Record<string, unknown>;
  const targetTable = candidate.targetTable;
  if (targetTable !== "expenses" && targetTable !== "sales") {
    return { ok: false, error: "نوع السجل المطلوب غير صالح." };
  }
  if (typeof candidate.query !== "string") {
    return { ok: false, error: "اكتب تاريخًا أو مبلغًا أو كلمة للبحث." };
  }
  const query = normalizeArabicDigits(candidate.query).trim().slice(0, 80);
  if (!query) return { ok: false, error: "اكتب تاريخًا أو مبلغًا أو كلمة للبحث." };

  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(query);
  const amount = Number(query.replaceAll(",", ""));
  const isAmount = Number.isFinite(amount) && amount >= 0;
  const queryIsUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query);

  if (targetTable === "expenses") {
    const select = "id, date, category, description, total";
    const queries = queryIsUuid
      ? [sb.from("expenses").select(select).eq("org_id", m.orgId).eq("id", query).limit(1)]
      : isDate
        ? [sb.from("expenses").select(select).eq("org_id", m.orgId).eq("date", query).order("id").limit(20)]
        : isAmount
          ? [sb.from("expenses").select(select).eq("org_id", m.orgId).eq("total", amount).order("date", { ascending: false }).limit(20)]
          : query.length >= 2
            ? [
                sb.from("expenses").select(select).eq("org_id", m.orgId).ilike("category", `%${query}%`).order("date", { ascending: false }).limit(10),
                sb.from("expenses").select(select).eq("org_id", m.orgId).ilike("description", `%${query}%`).order("date", { ascending: false }).limit(10),
              ]
            : [];
    if (queries.length === 0) return { ok: false, error: "اكتب حرفين على الأقل للبحث النصي." };
    const results = await Promise.all(queries);
    const failed = results.find((result) => result.error);
    if (failed?.error) return { ok: false, error: "تعذّر البحث في المصروفات." };
    const rows = new Map(results.flatMap((result) => result.data ?? []).map((row) => [row.id, row]));
    return {
      ok: true,
      targets: [...rows.values()].slice(0, 20).map((row) => ({
        id: row.id,
        label: [row.date ? fmtDate(row.date) : "بدون تاريخ", row.category, row.description, egp(row.total)]
          .filter(Boolean)
          .join(" · "),
      })),
    };
  }

  const select = "id, sale_date, crop, notes, total";
  const queries = queryIsUuid
    ? [sb.from("sales").select(select).eq("org_id", m.orgId).eq("id", query).limit(1)]
    : isDate
      ? [sb.from("sales").select(select).eq("org_id", m.orgId).eq("sale_date", query).order("id").limit(20)]
      : isAmount
        ? [sb.from("sales").select(select).eq("org_id", m.orgId).eq("total", amount).order("sale_date", { ascending: false }).limit(20)]
        : query.length >= 2
          ? [
              sb.from("sales").select(select).eq("org_id", m.orgId).ilike("crop", `%${query}%`).order("sale_date", { ascending: false }).limit(10),
              sb.from("sales").select(select).eq("org_id", m.orgId).ilike("notes", `%${query}%`).order("sale_date", { ascending: false }).limit(10),
            ]
          : [];
  if (queries.length === 0) return { ok: false, error: "اكتب حرفين على الأقل للبحث النصي." };
  const results = await Promise.all(queries);
  const failed = results.find((result) => result.error);
  if (failed?.error) return { ok: false, error: "تعذّر البحث في المبيعات." };
  const rows = new Map(results.flatMap((result) => result.data ?? []).map((row) => [row.id, row]));
  return {
    ok: true,
    targets: [...rows.values()].slice(0, 20).map((row) => ({
      id: row.id,
      label: [row.sale_date ? fmtDate(row.sale_date) : "بدون تاريخ", row.crop, row.notes, egp(row.total)]
        .filter(Boolean)
        .join(" · "),
    })),
  };
}
