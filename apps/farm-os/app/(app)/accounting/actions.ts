"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";
import type { ExpenseKind } from "@/lib/pnl";

/**
 * Server actions for the accounting framework (Stage 7 / SPEC-0004). Revenue entry + the #6 expense
 * classification both go through SECURITY DEFINER RPCs that re-enforce budget.write (owner/accountant)
 * in the DB. NOTE: this is the SYNTHETIC-data framework — the authoritative P&L still depends on the
 * gated dual-run reconciliation against the real 7-yr Excel (Stage M / privacy review), and the money
 * logic requires independent review before prod.
 */

const NO_PERM = "ليس لديك صلاحية مالية (تتطلب مالك أو محاسب)";
const EXPENSE_KINDS = new Set<string>(["operating", "drawing", "capex"]);

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function isExpenseKind(kind: string): kind is ExpenseKind {
  return EXPENSE_KINDS.has(kind);
}

export async function saveSale(input: {
  id?: string | null;
  orgId: string;
  date?: string | null;
  crop?: string | null;
  total: number;
  buyer?: string | null;
  season?: string | null;
}): Promise<Result<string>> {
  await requireMembership();
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_save_sale", {
    p_id: input.id ?? null,
    p_org: input.orgId,
    p_date: input.date ?? null,
    p_crop: input.crop ?? null,
    p_total: input.total,
    p_buyer: input.buyer ?? null,
    p_season: input.season ?? null,
  });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_PERM }) };
  revalidatePath("/accounting");
  return { ok: true, data: (data as { id?: string } | null)?.id };
}

export async function setExpenseKind(input: { id: string; kind: string }): Promise<Result> {
  await requireMembership();
  if (!isExpenseKind(input.kind)) {
    return { ok: false, error: "تصنيف المصروف غير صالح" };
  }
  const sb = await createClient();
  const { error } = await sb.rpc("fn_set_expense_kind", { p_id: input.id, p_kind: input.kind });
  if (error) return { ok: false, error: toArabicError(error, { "42501": NO_PERM }) };
  revalidatePath("/accounting");
  return { ok: true };
}
