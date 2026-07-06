"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

// SPEC-0004 §7.3 — write side of the accounting period lock. The RPCs (migration 20260701550000) own the
// role gate (close = owner/accountant, reopen = owner-only), the overlap check, and audit; this file only
// validates UI input and maps DB errors to Arabic (non-negotiable #2). Reads go through the table's RLS.

const PERIOD_ERR: Record<string, string> = {
  "42501": "ليس لديك صلاحية لتنفيذ هذا الإجراء على الفترات المحاسبية",
  "23505": "الفترة تتداخل مع فترة مقفلة موجودة",
  "22023": "تواريخ الفترة غير صالحة (تأكد أن تاريخ النهاية ليس قبل البداية)",
  "23502": "بيانات الفترة ناقصة",
  P0002: "لا توجد فترة مقفلة بهذا المعرّف لإعادة فتحها",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RETURN_TO = {
  close: "/finance/close",
  periods: "/finance/periods",
} as const;

function returnPath(formData: FormData): string {
  const raw = String(formData.get("return_to") ?? "periods");
  return raw === "close" ? RETURN_TO.close : RETURN_TO.periods;
}

function back(kind: "ok" | "error", msg: string, formData: FormData): never {
  redirect(`${returnPath(formData)}?${kind}=${encodeURIComponent(msg)}`);
}

/** Close (lock) a period — owner or accountant. */
export async function closePeriod(formData: FormData): Promise<void> {
  const start = String(formData.get("period_start") ?? "").trim();
  const end = String(formData.get("period_end") ?? "").trim();
  const noteRaw = String(formData.get("note") ?? "").trim();

  const m = await requireRole(["owner", "accountant"]);
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) back("error", "حدّد تاريخ بداية ونهاية صحيحين للفترة", formData);
  if (end < start) back("error", "تاريخ نهاية الفترة قبل بدايتها", formData);

  const sb = await createClient();
  const { error } = await sb.rpc("fn_close_accounting_period", {
    p_org: m.orgId,
    p_period_start: start,
    p_period_end: end,
    p_note: noteRaw.length ? noteRaw : null,
  });
  if (error) back("error", toArabicError(error, PERIOD_ERR, "تعذّر إقفال الفترة"), formData);

  revalidatePath("/finance/periods");
  revalidatePath("/finance/close");
  back("ok", "تم إقفال الفترة بنجاح", formData);
}

/** Reopen (unlock) a period — owner only (enforced in the RPC; a non-owner gets 42501 → Arabic). */
export async function reopenPeriod(formData: FormData): Promise<void> {
  const id = String(formData.get("period_id") ?? "").trim();

  const m = await requireRole(["owner", "accountant"]);
  if (!id) back("error", "الفترة غير محددة", formData);

  const sb = await createClient();
  const { error } = await sb.rpc("fn_reopen_accounting_period", { p_org: m.orgId, p_period_id: id });
  if (error) back("error", toArabicError(error, PERIOD_ERR, "تعذّر إعادة فتح الفترة"), formData);

  revalidatePath("/finance/periods");
  revalidatePath("/finance/close");
  back("ok", "تمت إعادة فتح الفترة", formData);
}
