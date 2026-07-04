"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";

// SPEC-0024 S-2 — write side of the editable chart-of-accounts tree. Every write goes through the
// budget.write-gated RPCs from migration 20260701430000 (fn_save_account / fn_archive_account /
// fn_merge_accounts); RLS re-enforces authorize('budget.write', org) server-side, so a non-write role
// is rejected in the DB even if it reaches here.

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type AccountKind = "operating" | "drawing" | "capex";

export interface SaveAccountInput {
  id?: string | null;
  parentId?: string | null;
  code: string;
  nameAr: string;
  accountType: AccountType;
  normalBalance: "debit" | "credit";
  kind?: AccountKind | null;
  sortOrder?: number | null;
}

type Result = { ok: boolean; error?: string; id?: string };

const ACCOUNT_TYPES: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];

export async function saveAccount(input: SaveAccountInput): Promise<Result> {
  const code = input.code?.trim();
  const nameAr = input.nameAr?.trim();
  if (!code) return { ok: false, error: "الكود مطلوب" };
  if (!nameAr) return { ok: false, error: "اسم الحساب مطلوب" };
  if (!ACCOUNT_TYPES.includes(input.accountType)) return { ok: false, error: "نوع الحساب غير صالح" };
  if (input.kind && input.accountType !== "expense") {
    return { ok: false, error: "التصنيف (تشغيلي/مسحوبات/رأسمالي) يُسمح به لحسابات المصروفات فقط" };
  }

  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_save_account", {
    p_id: input.id ?? null,
    p_org: m.orgId,
    p_parent_id: input.parentId ?? null,
    p_code: code,
    p_name_ar: nameAr,
    p_account_type: input.accountType,
    p_normal_balance: input.normalBalance,
    p_kind: input.kind ?? null,
    p_sort_order: input.sortOrder ?? null,
    p_active: true,
  });
  if (error) {
    return { ok: false, error: toArabicError(error, {}, "تعذّر حفظ الحساب (تحقّق من الكود والصلاحيات)") };
  }
  revalidatePath("/finance/accounts");
  return { ok: true, id: (data as { id?: string } | null)?.id };
}

export async function archiveAccount(id: string): Promise<Result> {
  if (!id) return { ok: false, error: "الحساب غير محدد" };
  await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const { error } = await sb.rpc("fn_archive_account", { p_id: id });
  if (error) {
    return { ok: false, error: toArabicError(error, {}, "تعذّر أرشفة الحساب") };
  }
  revalidatePath("/finance/accounts");
  return { ok: true, id };
}

export async function mergeAccounts(sourceId: string, targetId: string): Promise<Result> {
  if (!sourceId || !targetId) return { ok: false, error: "حدّد الحساب المصدر والهدف" };
  if (sourceId === targetId) return { ok: false, error: "لا يمكن دمج الحساب في نفسه" };
  await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const { error } = await sb.rpc("fn_merge_accounts", { p_source: sourceId, p_target: targetId });
  if (error) {
    return { ok: false, error: toArabicError(error, {}, "تعذّر دمج الحسابين") };
  }
  revalidatePath("/finance/accounts");
  return { ok: true };
}
