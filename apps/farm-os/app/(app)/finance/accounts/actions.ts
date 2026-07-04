"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

// SPEC-0024 S-2 — write side of the editable chart-of-accounts tree. The live
// RPCs from migration 20260701440000 own all account-tree writes and audit/RLS
// checks; this file only validates UI input and maps DB errors to Arabic.

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type AccountKind = "operating" | "drawing" | "capex";
export type NormalBalance = "debit" | "credit";

export interface SaveAccountInput {
  id?: string | null;
  parentId?: string | null;
  code: string;
  nameAr: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  kind?: AccountKind | null;
  sortOrder?: number | null;
  active?: boolean;
}

type Result = { ok: boolean; error?: string; id?: string };

const ACCOUNT_TYPES: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];
const NORMAL_BALANCES: NormalBalance[] = ["debit", "credit"];
const ACCOUNT_KINDS: AccountKind[] = ["operating", "drawing", "capex"];

const KIND_TYPE: Record<AccountKind, AccountType> = {
  operating: "expense",
  drawing: "equity",
  capex: "asset",
};

const ACCOUNT_PERM = {
  "42501": "ليس لديك صلاحية تعديل شجرة الحسابات",
  "23505": "كود الحساب مستخدم بالفعل داخل نفس المؤسسة",
  "22023": "بيانات الحساب غير متوافقة مع مكانه في الشجرة",
  P0002: "الحساب المطلوب غير موجود",
};

function refreshAccountingSurfaces() {
  revalidatePath("/finance/accounts");
  revalidatePath("/accounting");
  revalidatePath("/expenses");
  revalidatePath("/custody");
}

export async function saveAccount(input: SaveAccountInput): Promise<Result> {
  const code = input.code?.trim();
  const nameAr = input.nameAr?.trim();
  if (!code) return { ok: false, error: "الكود مطلوب" };
  if (!nameAr) return { ok: false, error: "اسم الحساب مطلوب" };
  if (!ACCOUNT_TYPES.includes(input.accountType)) return { ok: false, error: "نوع الحساب غير صالح" };
  if (!NORMAL_BALANCES.includes(input.normalBalance)) return { ok: false, error: "الرصيد الطبيعي غير صالح" };
  if (input.kind && !ACCOUNT_KINDS.includes(input.kind)) return { ok: false, error: "تصنيف الحساب غير صالح" };
  if (input.sortOrder != null && !Number.isFinite(input.sortOrder)) {
    return { ok: false, error: "ترتيب العرض غير صالح" };
  }
  if (input.kind && KIND_TYPE[input.kind] !== input.accountType) {
    return {
      ok: false,
      error:
        "تصنيف الحساب لا يطابق نوعه: التشغيلي مصروف، الرأسمالي أصل، ومسحوبات المالك حقوق ملكية",
    };
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
    p_active: input.active ?? true,
  });
  if (error) {
    return { ok: false, error: toArabicError(error, ACCOUNT_PERM, "تعذّر حفظ الحساب") };
  }
  refreshAccountingSurfaces();
  return { ok: true, id: (data as { id?: string } | null)?.id };
}

export async function archiveAccount(id: string): Promise<Result> {
  if (!id) return { ok: false, error: "الحساب غير محدد" };
  await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const { error } = await sb.rpc("fn_archive_account", { p_id: id });
  if (error) {
    return { ok: false, error: toArabicError(error, ACCOUNT_PERM, "تعذّر أرشفة الحساب") };
  }
  refreshAccountingSurfaces();
  return { ok: true, id };
}

export async function mergeAccounts(sourceId: string, targetId: string): Promise<Result> {
  if (!sourceId || !targetId) return { ok: false, error: "حدّد الحساب المصدر والهدف" };
  if (sourceId === targetId) return { ok: false, error: "لا يمكن دمج الحساب في نفسه" };
  await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const { error } = await sb.rpc("fn_merge_accounts", { p_source: sourceId, p_target: targetId });
  if (error) {
    return { ok: false, error: toArabicError(error, ACCOUNT_PERM, "تعذّر دمج الحسابين") };
  }
  refreshAccountingSurfaces();
  return { ok: true };
}
