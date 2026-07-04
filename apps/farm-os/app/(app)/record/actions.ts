"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { toArabicError } from "@/lib/errors";

// SPEC-0025 U-1 — the guided expense flow. One server action composes what previously took four screens:
// create the expense, classify kind (gated RPC), link the account + cost center, and route the payment
// (custody cash-out posts its journal via fn_set_expense_payment_status). Each step reports honestly on
// partial failure (#1): the caller is told exactly what WAS saved and what still needs attention.

export type GuidedKind = "operating" | "drawing" | "capex";
export type GuidedPayment = "custody" | "later" | "none";

export interface GuidedExpenseInput {
  date: string | null;
  category: string;
  description: string | null;
  total: number;
  supplierId: string | null;
  kind: GuidedKind;
  accountId: string | null;
  costCenterId: string | null;
  payment: GuidedPayment;
  custodyAccountId: string | null;
}

export interface GuidedExpenseResult {
  ok: boolean;
  /** The saved expense id when the base record was created (even if a later step failed). */
  expenseId?: string;
  /** Fatal error (nothing saved) OR the honest partial-failure message. */
  error?: string;
  /** True when the custody payment posted (movement + journal). */
  paid?: boolean;
}

const KINDS: GuidedKind[] = ["operating", "drawing", "capex"];

export async function recordGuidedExpense(input: GuidedExpenseInput): Promise<GuidedExpenseResult> {
  const category = input.category?.trim();
  if (!category) return { ok: false, error: "اكتب على ماذا صُرف المبلغ (الفئة)" };
  if (!Number.isFinite(input.total) || input.total <= 0) return { ok: false, error: "المبلغ غير صالح" };
  if (!KINDS.includes(input.kind)) return { ok: false, error: "نوع المصروف غير صالح" };
  if (input.payment === "custody" && !input.custodyAccountId) {
    return { ok: false, error: "اختر حساب العهدة الذي دُفع منه" };
  }

  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();

  // 1) The base expense row (same columns the classic form writes).
  const { data, error } = await sb
    .from("expenses")
    .insert({
      org_id: m.orgId,
      date: input.date || null,
      category,
      description: input.description?.trim() || null,
      total: input.total,
      supplier_id: input.supplierId || null,
      payment_method: null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "تعذّر تسجيل المصروف (تحقّق من صلاحياتك)" };
  const expenseId = data.id as string;
  const saved = (msg: string): GuidedExpenseResult => ({ ok: false, expenseId, error: msg });

  // 2) Kind BEFORE account (the account guard checks kind-consistency, #6).
  if (input.kind !== "operating") {
    const { error: kindError } = await sb.rpc("fn_set_expense_kind", { p_id: expenseId, p_kind: input.kind });
    if (kindError) return saved("سُجّل المصروف كـ«تشغيلي» لكن تعذّر تغيير نوعه — راجعه من صفحة المصروفات");
  }

  // 3) Account link (validated by expense_account_guard: same org, active leaf, kind match).
  if (input.accountId) {
    const { error: accountError } = await sb
      .from("expenses")
      .update({ account_id: input.accountId })
      .eq("id", expenseId);
    if (accountError) {
      return saved(
        toArabicError(
          accountError,
          { "22023": "سُجّل المصروف، لكن الحساب المختار لا يطابق نوع المصروف — اختر حسابًا آخر من صفحة المصروفات" },
          "سُجّل المصروف، لكن تعذّر ربطه بالحساب المحاسبي",
        ),
      );
    }
  }

  // 4) Cost center (validated by expense_cost_center_guard: same org, active leaf).
  if (input.costCenterId) {
    const { error: ccError } = await sb
      .from("expenses")
      .update({ cost_center_id: input.costCenterId })
      .eq("id", expenseId);
    if (ccError) return saved("سُجّل المصروف، لكن تعذّر ربطه بمركز التكلفة — راجعه من صفحة المصروفات");
  }

  // 5) Payment routing. «من العهدة» posts the cash movement + journal atomically inside the gated RPC.
  if (input.payment === "custody") {
    const { error: payError } = await sb.rpc("fn_set_expense_payment_status", {
      p_expense: expenseId,
      p_status: "paid_from_custody",
      p_custody_account: input.custodyAccountId,
      p_paid_by: null,
    });
    if (payError) {
      return saved(
        toArabicError(
          payError,
          { "22023": "سُجّل المصروف لكن لم يُسجَّل الدفع من العهدة — تحقّق من رصيد/حالة العهدة ثم وجّهه من صفحة العهدة" },
          "سُجّل المصروف لكن لم يُسجَّل الدفع — وجّهه من صفحة العهدة",
        ),
      );
    }
  } else if (input.payment === "later") {
    const { error: payError } = await sb.rpc("fn_set_expense_payment_status", {
      p_expense: expenseId,
      p_status: "post_paid_unpaid",
      p_custody_account: null,
      p_paid_by: null,
    });
    if (payError) return saved("سُجّل المصروف لكن لم يُعلَّم كآجل — وجّهه من صفحة العهدة");
  }

  for (const p of ["/expenses", "/custody", "/accounting", "/finance/accounts", "/record"]) revalidatePath(p);
  return { ok: true, expenseId, paid: input.payment === "custody" };
}

// ── SPEC-0025 U-2 part 2 — «حصّلت من عميل» ────────────────────────────────────────────────────────────
export interface CollectInput {
  saleId: string;
  amount: number;
  note: string | null;
}

/** Record a (possibly partial) collection against a finalized sale. The gated RPC clears the
 *  receivable, posts the journal, and derives payment_status — the Σ ≤ total guard lives in the DB. */
export async function recordGuidedCollection(input: CollectInput): Promise<{ ok: boolean; error?: string }> {
  if (!input.saleId) return { ok: false, error: "اختر البيع" };
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { ok: false, error: "المبلغ غير صالح" };
  await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const { error } = await sb.rpc("fn_record_sale_collection", {
    p_sale: input.saleId,
    p_amount: input.amount,
    p_occurred_at: new Date().toISOString().slice(0, 10),
    p_collected_by: null,
    p_note: input.note ?? null,
  });
  if (error) {
    return {
      ok: false,
      error: toArabicError(
        error,
        { "22023": "المبلغ أكبر من المتبقي على هذا البيع — راجع الرصيد" },
        "تعذّر تسجيل التحصيل",
      ),
    };
  }
  for (const p of ["/transactions", "/finance/revenue-reports", "/record/collect"]) revalidatePath(p);
  return { ok: true };
}

// ── SPEC-0027 H-A — شاشة الميزان ──────────────────────────────────────────────────────────────────────
export interface ScaleInput {
  crop: string;
  crates: number;
  grossKg: number;
  tarePerCrate: number;
  buyerId: string | null;
  costCenterId: string | null;
  notes: string | null;
}
export interface ScaleResult {
  ok: boolean;
  error?: string;
  noteNo?: number;
  netKg?: number;
  tareKg?: number;
}

/** One call = the whole scale event: net computed in the DB, بون serial minted under a per-org lock,
 *  and the delivery lands as a PENDING-price sale (posts nothing until priced — #1). */
export async function recordScaleDelivery(input: ScaleInput): Promise<ScaleResult> {
  if (!input.crop?.trim()) return { ok: false, error: "اختر المحصول" };
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_record_scale_delivery", {
    p_org: m.orgId,
    p_crop: input.crop.trim(),
    p_crates: input.crates,
    p_gross_kg: input.grossKg,
    p_tare_per_crate: input.tarePerCrate,
    p_buyer_id: input.buyerId ?? null,
    p_cost_center_id: input.costCenterId ?? null,
    p_sale_date: new Date().toISOString().slice(0, 10),
    p_notes: input.notes ?? null,
  });
  if (error || !data) {
    return {
      ok: false,
      error: toArabicError(error, { "22023": "تحقق من الأرقام — الصافي يجب أن يكون موجبًا" }, "تعذّر تسجيل التسليم"),
    };
  }
  const d = data as { delivery_note_no: number; net_kg: number; tare_kg: number };
  for (const p of ["/transactions", "/finance/revenue-reports", "/record/scale"]) revalidatePath(p);
  return { ok: true, noteNo: d.delivery_note_no, netKg: Number(d.net_kg), tareKg: Number(d.tare_kg) };
}

/** Inline «مشترٍ جديد» from the scale screen — the season rule: every delivery carries a NAMED trader. */
export async function quickAddBuyer(name: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const n = name?.trim();
  if (!n) return { ok: false, error: "اكتب اسم التاجر" };
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_save_buyer", {
    p_id: null, p_org: m.orgId, p_name: n, p_buyer_type: "trader", p_phone: null, p_active: true,
  });
  if (error || !data) return { ok: false, error: toArabicError(error, {}, "تعذّر إضافة التاجر") };
  return { ok: true, id: (data as { id: string }).id };
}

// ── R-3 — «حدّدت سعرًا»: pricing a pending delivery posts Dr ذمم / Cr إيراد in the gated RPC ──────────
export async function finalizeSalePrice(saleId: string, unitPrice: number): Promise<{ ok: boolean; error?: string; total?: number }> {
  if (!saleId) return { ok: false, error: "اختر التسليم" };
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return { ok: false, error: "السعر غير صالح" };
  await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_finalize_sale_price", { p_sale: saleId, p_unit_price: unitPrice });
  if (error || !data) {
    return { ok: false, error: toArabicError(error, { "22023": "تحقّق من حالة البيع — قد يكون مُسعّرًا بالفعل" }, "تعذّر تحديد السعر") };
  }
  for (const p of ["/transactions", "/finance/revenue-reports", "/record/price", "/record/collect"]) revalidatePath(p);
  return { ok: true, total: Number((data as { total?: number }).total ?? 0) };
}

// ── SPEC-0027 H-B — يوم قطف (field crate counter; quantities only) ───────────────────────────────────
export async function recordHarvestDay(input: { crates: number; costCenterId: string | null; crewCount: number | null; note: string | null }): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(input.crates) || input.crates <= 0) return { ok: false, error: "عدد العبوات غير صالح" };
  const m = await requireRole(["owner", "farm_manager"]);
  const sb = await createClient();
  const { error } = await sb.rpc("fn_record_harvest_day", {
    p_org: m.orgId,
    p_crates: input.crates,
    p_cost_center_id: input.costCenterId ?? null,
    p_crop: "برحي",
    p_day: new Date().toISOString().slice(0, 10),
    p_crew_count: input.crewCount ?? null,
    p_note: input.note ?? null,
  });
  if (error) return { ok: false, error: toArabicError(error, {}, "تعذّر تسجيل الدفعة") };
  for (const p of ["/m/harvest", "/finance/season"]) revalidatePath(p);
  return { ok: true };
}
