// Pure, framework-free guards for STAGING an already-generated reconciliation manifest
// (SPEC-0004 §8.3). No DB, no React, no filesystem — testable in isolation.
//
// Staging creates REVIEW ROWS ONLY. It inserts a `reconciliation_batches` row, its evidence items,
// and its unreviewed/hold batch rows. It never creates an expense, a sale, or a journal entry — those
// only ever appear at owner execution (fn_execute_reconciliation_batch), several gates later.
//
// The authoritative contract is public.fn_stage_reconciliation_manifest (migration
// "20260726140000 accounting reconciliation evidence contract and dimensional guard.sql"), which
// re-validates EVERY byte of the manifest inside the database. These helpers exist so that:
//   • an obviously-wrong upload (no file, empty file, oversized file, non-JSON, non-object root, or a
//     manifest built for a DIFFERENT org) never reaches the RPC at all, and
//   • the user gets a fixed Arabic message instead of a raw SQLSTATE or an English DB string.
//
// Redaction discipline (§2.7): parsing keeps the manifest in memory for the gated RPC, but no helper
// logs or embeds its amounts, labels, locators, filename, or raw DB errors in a user-facing message.
// Every message below is a fixed string chosen from a closed set.

import { isUuid } from "./reconciliation review";
import { num } from "./money";

/**
 * Conservative upper bound on an accepted manifest, in BYTES, checked BEFORE the file is read.
 *
 * The RPC caps a batch at 1000 rows; the pinned 698-row canonical manifest is well under this. The
 * bound is deliberately generous enough for a full real batch and far too small to be a memory
 * lever — a server action that read first and measured after would already have paid the cost.
 */
export const RECONCILIATION_MANIFEST_MAX_BYTES = 900_000;

/**
 * The minimum of the web `File` surface this path uses. Typing the port rather than `File` keeps the
 * guard pure (no DOM/undici globals needed to test it) and makes the "size is known before any read"
 * requirement explicit in the type.
 */
export interface ManifestFileLike {
  size: number;
  text: () => Promise<string>;
}

export type ManifestFileCheck =
  | { ok: true; file: ManifestFileLike }
  | { ok: false; error: string };

export type ManifestParse =
  | { ok: true; manifest: Record<string, unknown> }
  | { ok: false; error: string };

export type ManifestOrgCheck = { ok: true } | { ok: false; error: string };

// ── The closed set of user-facing Arabic messages this path can produce. ──────────────────────────
const MISSING_FILE_AR = "اختر ملف بيان الدفعة (JSON) الناتج عن الأداة المعتمدة.";
const EMPTY_FILE_AR = "الملف فارغ؛ اختر بيان دفعة صالحًا.";
const OVERSIZE_FILE_AR = `الملف أكبر من الحد المسموح (${num(RECONCILIATION_MANIFEST_MAX_BYTES)} بايت).`;
const MALFORMED_JSON_AR = "الملف ليس JSON صالحًا؛ أعد توليده بالأداة المعتمدة دون تعديل يدوي.";
const NOT_AN_OBJECT_AR = "بنية الملف غير صحيحة: المتوقَّع كائن بيان دفعة واحد، لا قائمة ولا قيمة مفردة.";
const WRONG_ORG_AR = "هذا البيان ليس لمؤسستك؛ لن يُجهَّز أي صف.";
const UNEXPECTED_STAGE_AR =
  "ردّ غير متوقَّع من خادم التجهيز. راجع قائمة الدفعات قبل إعادة المحاولة.";

/**
 * SQLSTATE → fixed Arabic message for fn_stage_reconciliation_manifest.
 *
 * The RPC raises exactly these classes: 42501 (not a member / lacks reconciliation.write), 23502
 * (org missing), 22023 (any manifest-contract violation — the validator's ~40 raise sites all use
 * this code), and 23505 (a deterministic id/position already exists with different bytes, i.e. a
 * replay that is NOT byte-identical). Anything else falls through to the caller's generic fallback,
 * so a future code can never surface as raw English.
 */
export const STAGE_MANIFEST_PERM: Record<string, string> = {
  "42501": "ليس لديك صلاحية تجهيز دفعات التسوية (المالك أو المحاسب فقط).",
  "23502": "بيانات المؤسسة ناقصة في الطلب؛ لم يُجهَّز أي صف.",
  "22023": "بيان الدفعة لا يطابق العقد المطلوب؛ أعد توليده بالأداة المعتمدة دون تعديل يدوي. لم يُجهَّز أي صف.",
  "23505":
    "تعارض في إعادة التجهيز: توجد دفعة بنفس الهوية ببيانات مختلفة. لم يُجهَّز أي صف ولم يتغيّر شيء.",
};

/** The generic fallback for this path (never a raw DB message). */
export const STAGE_MANIFEST_FALLBACK_AR = "تعذّر تجهيز الدفعة للمراجعة.";

/**
 * Accept exactly one uploaded file and bound it BEFORE any read.
 *
 * A wrong or missing form field (a string, null, a plain object) is rejected with the same "choose a
 * file" message — the reason is never elaborated with what was actually received, which would echo
 * client-supplied content back.
 */
export function checkManifestFile(value: unknown): ManifestFileCheck {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: MISSING_FILE_AR };
  }
  const candidate = value as Partial<ManifestFileLike>;
  if (typeof candidate.size !== "number" || !Number.isFinite(candidate.size)) {
    return { ok: false, error: MISSING_FILE_AR };
  }
  if (typeof candidate.text !== "function") {
    return { ok: false, error: MISSING_FILE_AR };
  }
  if (candidate.size <= 0) return { ok: false, error: EMPTY_FILE_AR };
  if (candidate.size > RECONCILIATION_MANIFEST_MAX_BYTES) {
    return { ok: false, error: OVERSIZE_FILE_AR };
  }
  return { ok: true, file: value as ManifestFileLike };
}

/**
 * Parse the uploaded text into a single manifest OBJECT.
 *
 * An array root, a bare string/number/boolean, and `null` are all rejected: `JSON.parse` accepts
 * every one of them, and only a plain object can carry the `batch`/`evidence_items`/`batch_rows`
 * contract. The re-check against the byte cap is a second, conservative bound (UTF-8 is never fewer
 * bytes than characters), so a `size` that under-reports cannot widen what actually gets parsed.
 */
export function parseManifestText(text: unknown): ManifestParse {
  if (typeof text !== "string") return { ok: false, error: MALFORMED_JSON_AR };
  if (text.length === 0) return { ok: false, error: EMPTY_FILE_AR };
  if (text.length > RECONCILIATION_MANIFEST_MAX_BYTES) {
    return { ok: false, error: OVERSIZE_FILE_AR };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // The thrown SyntaxError quotes the offending input — it is deliberately never surfaced.
    return { ok: false, error: MALFORMED_JSON_AR };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: NOT_AN_OBJECT_AR };
  }
  return { ok: true, manifest: parsed as Record<string, unknown> };
}

/**
 * The tenant binding, checked in the app BEFORE the RPC.
 *
 * `orgId` is ALWAYS the caller's own membership org (requireRole's `m.orgId`) — it is never read
 * from the upload. The manifest's own `batch.org_id` must match it EXACTLY; a manifest generated for
 * another tenant is refused here and would be refused again by the RPC (which compares against its
 * own `p_org` and re-checks membership + `reconciliation.write`).
 */
export function assertManifestOrg(
  manifest: Record<string, unknown>,
  orgId: string,
): ManifestOrgCheck {
  if (!isUuid(orgId)) return { ok: false, error: WRONG_ORG_AR };
  const batch = manifest.batch;
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) {
    return { ok: false, error: NOT_AN_OBJECT_AR };
  }
  const declared = (batch as Record<string, unknown>).org_id;
  if (typeof declared !== "string" || declared !== orgId) {
    return { ok: false, error: WRONG_ORG_AR };
  }
  return { ok: true };
}

export type StageOutcome =
  | { ok: true; batchId: string; status: string; idempotentReplay: boolean }
  | { ok: false; error: string };

/**
 * Inspect what fn_stage_reconciliation_manifest returned, failing CLOSED.
 *
 * The RPC answers `{batch_id, status, idempotent_replay, staged_rows, total_rows}`. Only a valid
 * UUID `batch_id` plus a non-empty `status` is treated as a success worth reporting or navigating
 * to — anything else (a malformed body, a missing/garbled id) is an unexpected response, because
 * routing a user to a fabricated id would be worse than saying "check the list".
 *
 * An idempotent replay IS a success: the RPC returns the SAME batch id having written nothing, which
 * is exactly the desired end state (the batch is staged). Its `status` is the batch's CURRENT status,
 * not necessarily `staged`, so no status value is required here.
 */
export function parseStageOutcome(data: unknown): StageOutcome {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: UNEXPECTED_STAGE_AR };
  }
  const source = data as Record<string, unknown>;
  const batchId = source.batch_id;
  if (!isUuid(batchId)) return { ok: false, error: UNEXPECTED_STAGE_AR };
  const status = source.status;
  if (typeof status !== "string" || status.trim().length === 0) {
    return { ok: false, error: UNEXPECTED_STAGE_AR };
  }
  return {
    ok: true,
    batchId: batchId.trim(),
    status,
    idempotentReplay: source.idempotent_replay === true,
  };
}
