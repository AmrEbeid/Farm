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
  parseExecuteOutcome,
  parseRollbackOutcome,
  validateRollbackReason,
} from "@/lib/reconciliation review";
import {
  assertManifestOrg,
  checkManifestFile,
  parseManifestText,
  parseStageOutcome,
  STAGE_MANIFEST_FALLBACK_AR,
  STAGE_MANIFEST_PERM,
} from "@/lib/reconciliation staging";

export type ActionResult = { ok: boolean; error?: string };
export type StageManifestResult =
  | { ok: true; batchId: string; idempotentReplay: boolean }
  | { ok: false; error: string };
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

/**
 * Stage an already-generated reconciliation manifest — the ENTRY point of the workflow.
 *
 * This creates REVIEW ROWS ONLY: one `reconciliation_batches` row plus its evidence items and
 * unreviewed/hold batch rows. It creates no expense, no sale, and no journal entry; posting happens
 * only much later, at owner execution, after per-row review, freeze, and approval.
 *
 * The order below is deliberate:
 *   1. requireRole FIRST — an unauthorized caller never gets as far as an upload being read.
 *   2. the file is bounded BEFORE it is read (checkManifestFile inspects `size` only).
 *   3. the org comes from the caller's own membership (`m.orgId`) and is ALSO the value the
 *      manifest's `batch.org_id` must equal — an `org_id` is never accepted from the client, and a
 *      manifest built for another tenant is refused before the RPC (which refuses it again).
 *   4. the ONLY DB call is the gated RPC through the user-session client: no direct DML, no admin
 *      client, no service role, no network fetch, no temp file.
 *
 * Nothing about the upload is logged or echoed — not the filename, not the bytes, not a raw DB
 * message. Every failure returns one of a fixed set of Arabic strings.
 */
export async function stageManifest(formData: FormData): Promise<StageManifestResult> {
  const m = await requireRole(["owner", "accountant"]);

  const uploads =
    formData && typeof formData.getAll === "function" ? formData.getAll("manifest") : [];
  const picked = checkManifestFile(uploads.length === 1 ? uploads[0] : null);
  if (!picked.ok) return { ok: false, error: picked.error };

  let text: string;
  try {
    text = await picked.file.text();
  } catch {
    return { ok: false, error: "تعذّر قراءة الملف؛ حاول اختياره مرة أخرى." };
  }

  const parsed = parseManifestText(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const bound = assertManifestOrg(parsed.manifest, m.orgId);
  if (!bound.ok) return { ok: false, error: bound.error };

  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_stage_reconciliation_manifest", {
    p_org: m.orgId,
    p_manifest: parsed.manifest as unknown as Json,
  });
  if (error) {
    return { ok: false, error: toArabicError(error, STAGE_MANIFEST_PERM, STAGE_MANIFEST_FALLBACK_AR) };
  }
  // The returned body — not the absence of an error — decides what is reported. Only a real UUID can
  // be navigated to; an idempotent replay (the same manifest staged again, nothing written) is a
  // success and returns the SAME batch id.
  const outcome = parseStageOutcome(data);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  revalidateReconciliation(outcome.batchId);
  return { ok: true, batchId: outcome.batchId, idempotentReplay: outcome.idempotentReplay };
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

// The two owner-only MONEY paths. Both map every SQLSTATE the RPC can raise to a specific Arabic
// message: the shared default for 23514 ("المخزون غير كافٍ") belongs to the stock engine and would be
// nonsense here, so both maps override it.
const EXECUTE_PERM: Record<string, string> = {
  "42501": "التنفيذ للمالك فقط ويتطلب صلاحية التسويات.",
  "22023": "لا تُنفَّذ إلا دفعة معتمدة.",
  "23514": "فشل تحقّق مالي أثناء التنفيذ؛ لم يُرحَّل أي شيء ولم تتغيّر أي أرقام.",
  "23502": "بيانات المراجعة ناقصة؛ لم يُرحَّل أي شيء.",
  "55000": "فترة محاسبية مقفلة؛ افتحها أو صحّح التواريخ قبل التنفيذ.",
  P0002: "الدفعة المطلوبة غير موجودة.",
};

const ROLLBACK_PERM: Record<string, string> = {
  "42501": "التراجع للمالك فقط ويتطلب صلاحية التسويات.",
  "22023": "لا يمكن التراجع إلا عن دفعة مُنفَّذة، وبسبب لا يتجاوز ٥٠٠ حرف.",
  "23502": "سبب التراجع مطلوب.",
  "23514": "تعذّر إثبات التراجع بدقّة؛ لم يتغيّر أي قيد أو رقم.",
  "55000": "فترة محاسبية مقفلة؛ لا يمكن عكس أو إعادة قيد داخلها. الدفعة ما زالت مُنفَّذة.",
  P0002: "الدفعة المطلوبة غير موجودة.",
};

/**
 * Execute an approved batch (owner only; the RPC re-verifies owner + reconciliation.write + approved
 * + frozen + payload hashes, and is the authoritative gate). This MOVES REAL MONEY: it creates the
 * reviewed expenses/sales and posts their journals in one atomic transaction.
 */
export async function executeBatch(batchId: string): Promise<ActionResult> {
  if (!isUuid(batchId)) return { ok: false, error: "مُعرّف الدفعة غير صالح." };
  await requireRole(["owner"]);
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_execute_reconciliation_batch", { p_batch_id: batchId });
  if (error) return { ok: false, error: toArabicError(error, EXECUTE_PERM, "تعذّر تنفيذ الدفعة.") };
  // A non-transient execution failure comes back as a RETURNED `failed` verdict with no PostgREST
  // error, so the returned jsonb — not `error` — decides whether anything was posted. Both routes are
  // revalidated either way: a `failed` execution still moved the batch's status and result_summary,
  // and the owner must see that truthfully rather than a stale `approved`.
  const outcome = parseExecuteOutcome(data);
  revalidateReconciliation(batchId);
  return outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
}

/**
 * Roll back an executed batch (owner only). Reverses every posting the batch created and reinstates
 * every journal it reversed, atomically. The reason is mandatory and is validated here with the same
 * trim-then-bound rule the RPC applies, so a bad reason never becomes a raw SQLSTATE.
 */
export async function rollbackBatch(input: unknown): Promise<ActionResult> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "بيانات التراجع غير صالحة." };
  }
  const candidate = input as Record<string, unknown>;
  if (!isUuid(candidate.batchId)) return { ok: false, error: "مُعرّف الدفعة غير صالح." };
  const reason = validateRollbackReason(candidate.reason);
  if (!reason.ok) return { ok: false, error: reason.error };

  await requireRole(["owner"]);
  const sb = await createClient();
  const { data, error } = await sb.rpc("fn_rollback_reconciliation_batch", {
    p_batch_id: candidate.batchId as string,
    p_reason: reason.reason,
  });
  if (error) return { ok: false, error: toArabicError(error, ROLLBACK_PERM, "تعذّر التراجع عن الدفعة.") };
  // Symmetrical with executeBatch. This RPC has no terminal failure state — it raises or it returns
  // `rolled_back` — but the verdict is still read from the response rather than assumed, so an
  // unexpected body can never be reported to the owner as "the money was put back".
  const outcome = parseRollbackOutcome(data);
  revalidateReconciliation(candidate.batchId as string);
  return outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
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
