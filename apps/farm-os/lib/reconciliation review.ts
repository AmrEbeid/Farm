// Pure, framework-free helpers for the accounting reconciliation review workspace
// (SPEC-0004 Slice 4 UI). No DB, no React — testable in isolation.
//
// This module mirrors, on the client/server side, the EXACT contracts already enforced by the
// live DB:
//   • fn_review_reconciliation_row / fn_freeze_reconciliation_batch / fn_approve_reconciliation_batch
//     (migration "20260726120000 accounting reconciliation review rpcs.sql"), and
//   • the slice-1A table CHECKs + tenant/correction guards
//     (migration 20260725201546_accounting_reconciliation_provenance.sql).
// The DB is the authoritative backstop; these helpers fail closed BEFORE any RPC call so the field
// user sees an Arabic validation message and keeps their input. Never fabricates a value: a missing
// number stays missing (a validation error), it is not defaulted to 0.

import { num } from "./money";

export const RECONCILIATION_PAGE_SIZE = 50;
export const RECONCILIATION_MAX_BATCHES = 50;
/** Slice-2 staging RPC caps a batch at 1000 rows; the summary read is bounded to this. */
export const RECONCILIATION_MAX_ROWS = 1000;

export type BatchStatus =
  | "staged"
  | "reviewed"
  | "approved"
  | "executing"
  | "executed"
  | "failed"
  | "rolled_back";
export type ReviewState = "unreviewed" | "reviewed" | "frozen" | "executed" | "rejected";
export type Disposition = "include" | "hold";
export type Classification =
  | "source_addition_candidate"
  | "amount_correction_candidate"
  | "production_orphan_candidate"
  | "zero_value_source_placeholder"
  | "ambiguous_identity_group";
export type OriginKind = "source_workbook_row" | "production_snapshot_row";
export type ExecutionResult = "pending" | "posted" | "reversed" | "skipped" | "failed";
export type ExpenseKind = "operating" | "drawing" | "capex";
export type ExpensePaymentDecision = "routed_now";
export type SaleHistoricalDateDecision =
  | "use_source_text_date"
  | "use_matched_production_date"
  | "manual_override";
export type ReviewAction = "review" | "hold" | "reject";
export type TargetTable = "expenses" | "sales";

export type Tone = "neutral" | "info" | "warning" | "ok" | "danger" | "accent";

// ── Arabic label maps (single source of truth for both the server pages and the client controls). ──
export const BATCH_STATUS_AR: Record<BatchStatus, { label: string; tone: Tone }> = {
  staged: { label: "قيد المراجعة", tone: "warning" },
  reviewed: { label: "مُجمَّدة بانتظار الاعتماد", tone: "info" },
  approved: { label: "معتمدة", tone: "ok" },
  executing: { label: "قيد التنفيذ", tone: "info" },
  executed: { label: "مُنفَّذة", tone: "ok" },
  failed: { label: "فشل", tone: "danger" },
  rolled_back: { label: "متراجَع عنها", tone: "neutral" },
};

export const REVIEW_STATE_AR: Record<ReviewState, { label: string; tone: Tone }> = {
  unreviewed: { label: "بدون قرار", tone: "warning" },
  reviewed: { label: "تمت المراجعة", tone: "info" },
  frozen: { label: "مُجمَّد", tone: "accent" },
  executed: { label: "مُنفَّذ", tone: "ok" },
  rejected: { label: "مرفوض", tone: "danger" },
};

export const DISPOSITION_AR: Record<Disposition, string> = {
  include: "تضمين",
  hold: "تعليق",
};

export const CLASSIFICATION_AR: Record<Classification, string> = {
  source_addition_candidate: "إضافة من الدفتر المصدر",
  amount_correction_candidate: "تصحيح مبلغ",
  production_orphan_candidate: "سطر إنتاج بلا مصدر",
  zero_value_source_placeholder: "سطر مصدر بقيمة صفرية",
  ambiguous_identity_group: "هوية غير محسومة",
};

export const ORIGIN_KIND_AR: Record<OriginKind, string> = {
  source_workbook_row: "دفتر مصدر",
  production_snapshot_row: "لقطة إنتاج",
};

export const EXECUTION_RESULT_AR: Record<ExecutionResult, string> = {
  pending: "لم يُنفَّذ",
  posted: "مُرحَّل",
  reversed: "معكوس",
  skipped: "متجاوَز",
  failed: "فشل",
};

export const EXPENSE_KIND_AR: Record<ExpenseKind, string> = {
  operating: "تشغيلي",
  drawing: "مسحوبات مالك",
  capex: "رأسمالي",
};

export const PAYMENT_DECISION_AR: Record<ExpensePaymentDecision, string> = {
  routed_now: "ترحيل تاريخي على خزينة المزرعة",
};

export const HISTORICAL_DATE_DECISION_AR: Record<SaleHistoricalDateDecision, string> = {
  use_source_text_date: "استخدام تاريخ نص المصدر",
  use_matched_production_date: "استخدام تاريخ الإنتاج المطابق",
  manual_override: "تحديد يدوي",
};

const EXPENSE_KINDS: ExpenseKind[] = ["operating", "drawing", "capex"];
const PAYMENT_DECISIONS: ExpensePaymentDecision[] = ["routed_now"];
const HISTORICAL_DATE_DECISIONS: SaleHistoricalDateDecision[] = [
  "use_source_text_date",
  "use_matched_production_date",
  "manual_override",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** UUID shape guard used to reject a malformed id BEFORE it reaches an RPC (which would 22P02). */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export interface CorrectionTargetSummary {
  targetTable: TargetTable;
  referenceLabel: string;
  dateLabel: string;
  amountLabel: string;
  primaryLabel?: string | null;
  secondaryLabel?: string | null;
}

/**
 * Permanent, human-readable identity for the production record an amount-correction row targets.
 * The server page renders this outside editable controls, so it remains visible after reload/freeze.
 */
export function correctionTargetLabel(summary: CorrectionTargetSummary): string {
  const target = summary.targetTable === "expenses" ? "مصروف" : "بيع";
  return [
    `السجل المُصحَّح: ${target}`,
    summary.referenceLabel,
    summary.dateLabel,
    summary.primaryLabel?.trim(),
    summary.secondaryLabel?.trim(),
    summary.amountLabel,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

// ── Pagination (bounded, deterministic — never trusts a raw query param). ──────────────────────────
export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  from: number; // 1-based index of the first row on this page (0 when empty)
  to: number; // 1-based index of the last row on this page
  offset: number; // 0-based offset for a range() query
  hasPrev: boolean;
  hasNext: boolean;
}

export function parsePageParam(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export function paginate(
  total: number,
  requestedPage: number,
  pageSize: number = RECONCILIATION_PAGE_SIZE,
): Pagination {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const safeSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : RECONCILIATION_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(safeTotal / safeSize));
  const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pageCount);
  const offset = (page - 1) * safeSize;
  const from = safeTotal === 0 ? 0 : offset + 1;
  const to = Math.min(offset + safeSize, safeTotal);
  return {
    page,
    pageSize: safeSize,
    total: safeTotal,
    pageCount,
    from,
    to,
    offset,
    hasPrev: page > 1,
    hasNext: page < pageCount,
  };
}

// ── Row-state summary + freeze/approve gates (honest, never fabricated). ───────────────────────────
export interface RowStateCounts {
  total: number;
  unreviewed: number;
  reviewed: number;
  rejected: number;
  frozen: number;
  executed: number;
  included: number;
  held: number;
  decided: number;
  allDecided: boolean;
}

export function summarizeRowStates(
  rows: { review_state: string; disposition: string }[],
): RowStateCounts {
  const counts: RowStateCounts = {
    total: rows.length,
    unreviewed: 0,
    reviewed: 0,
    rejected: 0,
    frozen: 0,
    executed: 0,
    included: 0,
    held: 0,
    decided: 0,
    allDecided: false,
  };
  for (const row of rows) {
    switch (row.review_state) {
      case "unreviewed":
        counts.unreviewed += 1;
        break;
      case "reviewed":
        counts.reviewed += 1;
        break;
      case "rejected":
        counts.rejected += 1;
        break;
      case "frozen":
        counts.frozen += 1;
        break;
      case "executed":
        counts.executed += 1;
        break;
    }
    if (row.disposition === "include") counts.included += 1;
    else if (row.review_state === "reviewed") counts.held += 1;
  }
  counts.decided = counts.total - counts.unreviewed;
  counts.allDecided = counts.total > 0 && counts.unreviewed === 0;
  return counts;
}

export function freezeGate(
  status: string,
  counts: RowStateCounts,
): { canFreeze: boolean; reason: string | null } {
  if (status !== "staged") {
    return { canFreeze: false, reason: "لا يمكن التجميد إلا لدفعة قيد المراجعة." };
  }
  if (counts.total === 0) {
    return { canFreeze: false, reason: "لا توجد صفوف في هذه الدفعة." };
  }
  if (counts.unreviewed > 0) {
    return {
      canFreeze: false,
      reason: `لا يمكن التجميد: ${counts.unreviewed} صف بدون قرار مراجعة.`,
    };
  }
  return { canFreeze: true, reason: null };
}

export function approveGate(
  status: string,
  role: string,
): { canApprove: boolean; reason: string | null } {
  if (status !== "reviewed") {
    return { canApprove: false, reason: "لا يُعتمد إلا بعد تجميد الدفعة (مراجَعة)." };
  }
  if (role !== "owner") {
    return { canApprove: false, reason: "الاعتماد للمالك فقط." };
  }
  return { canApprove: true, reason: null };
}

// ── Execute / rollback gates. Both mirror fn_execute_reconciliation_batch and
//    fn_rollback_reconciliation_batch exactly: owner ONLY, and one specific batch status. The DB is
//    the authoritative gate; these exist so an accountant is never shown a control they cannot use
//    and an owner gets an Arabic reason instead of a raw SQLSTATE. ──────────────────────────────────
export function executeGate(
  status: string,
  role: string,
): { canExecute: boolean; reason: string | null } {
  if (role !== "owner") {
    return { canExecute: false, reason: "التنفيذ للمالك فقط." };
  }
  if (status !== "approved") {
    return { canExecute: false, reason: "لا يُنفَّذ إلا بعد اعتماد الدفعة." };
  }
  return { canExecute: true, reason: null };
}

export function rollbackGate(
  status: string,
  role: string,
): { canRollback: boolean; reason: string | null } {
  if (role !== "owner") {
    return { canRollback: false, reason: "التراجع للمالك فقط." };
  }
  if (status === "rolled_back") {
    return { canRollback: false, reason: "تم التراجع عن هذه الدفعة بالفعل." };
  }
  if (status !== "executed") {
    return { canRollback: false, reason: "لا يمكن التراجع إلا عن دفعة مُنفَّذة." };
  }
  return { canRollback: true, reason: null };
}

/** The exact bound fn_rollback_reconciliation_batch enforces on a trimmed reason. */
export const ROLLBACK_REASON_MAX = 500;

export type ReasonResult = { ok: true; reason: string } | { ok: false; error: string };

/**
 * Validate the mandatory rollback reason BEFORE any RPC call, with the same trim-then-bound rule the
 * RPC applies, so the owner keeps their text and sees an Arabic message instead of a 23502/22023.
 */
export function validateRollbackReason(value: unknown): ReasonResult {
  if (typeof value !== "string") {
    return { ok: false, error: "سبب التراجع مطلوب ولا يمكن أن يكون فارغًا." };
  }
  const reason = value.trim();
  if (reason.length === 0) {
    return { ok: false, error: "سبب التراجع مطلوب ولا يمكن أن يكون فارغًا." };
  }
  if (reason.length > ROLLBACK_REASON_MAX) {
    // The bound stays the NUMBER 500 for every comparison; only the rendered digits are localized.
    // A bare `${ROLLBACK_REASON_MAX}` leaks Western "500" into an otherwise Arabic string.
    return {
      ok: false,
      error: `سبب التراجع طويل جدًا (الحد ${num(ROLLBACK_REASON_MAX)} حرفًا).`,
    };
  }
  return { ok: true, reason };
}

// ── result_summary rendering (counts and the owner's own reason ONLY). ─────────────────────────────
export const EXECUTION_FAILURE_AR: Record<string, string> = {
  locked_period: "فترة محاسبية مقفلة",
  integrity_check: "فشل تحقّق سلامة البيانات",
  invalid_state: "حالة غير صالحة للتنفيذ",
  execution_failed: "فشل التنفيذ",
};

// ── Money-RPC response inspection — the authority on whether anything was actually posted. ─────────
//
// fn_execute_reconciliation_batch does NOT raise on a non-transient failure. It catches, records the
// verdict on the batch, and RETURNS `{status:"failed", failure_code, safe_locator}` with NO PostgREST
// error at all (only a retryable 40001/40P01/55P03 is re-raised). A caller that checks `error` alone
// therefore reports success on a batch that atomically posted nothing. These parsers are the single
// place that reads the returned jsonb, and they fail CLOSED: only an explicit, recognised success
// status is a success, and `safe_locator` is never read, so it can never reach a user-facing string.

/** The undo message both failure paths end on: the DB is atomic, so nothing partial ever survives. */
const NO_CHANGE_AR = "لم يُرحَّل أي شيء ولم تتغيّر أي أرقام.";
const UNEXPECTED_EXECUTE_AR =
  `ردّ غير متوقَّع من خادم التنفيذ. ${NO_CHANGE_AR} راجع حالة الدفعة قبل إعادة المحاولة.`;
const UNEXPECTED_ROLLBACK_AR =
  "ردّ غير متوقَّع من خادم التراجع. راجع حالة الدفعة قبل إعادة المحاولة.";

export type BatchOutcome =
  | { ok: true; status: "executed" | "rolled_back"; idempotent: boolean }
  | { ok: false; error: string };

/**
 * Arabic for one execution `failure_code`. An unrecognised (or missing) code degrades to the generic
 * "unclassified" wording rather than echoing the raw code, so a future DB code can never leak.
 */
export function executionFailureMessage(failureCode: unknown): string {
  const label = typeof failureCode === "string" ? EXECUTION_FAILURE_AR[failureCode] : undefined;
  return `فشل تنفيذ الدفعة: ${label ?? "فشل غير مصنَّف"}. ${NO_CHANGE_AR}`;
}

/** The one shape check both parsers share: a plain object carrying a non-empty string `status`. */
function readOutcome(
  data: unknown,
): { status: string; idempotent: boolean; source: Record<string, unknown> } | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const source = data as Record<string, unknown>;
  if (typeof source.status !== "string" || source.status.trim().length === 0) return null;
  return { status: source.status, idempotent: source.idempotent === true, source };
}

/**
 * Inspect what fn_execute_reconciliation_batch returned.
 *
 * `executed` is the ONLY success, and it covers the idempotent repeat (the RPC returns the same
 * status with `idempotent:true` when an already-executed batch is re-submitted, having written
 * nothing). `failed` and `rolled_back` are truthful terminal verdicts that posted nothing, and any
 * other/malformed body is treated as unknown — all four report ok:false.
 */
export function parseExecuteOutcome(data: unknown): BatchOutcome {
  const outcome = readOutcome(data);
  if (!outcome) return { ok: false, error: UNEXPECTED_EXECUTE_AR };
  if (outcome.status === "executed") {
    return { ok: true, status: "executed", idempotent: outcome.idempotent };
  }
  if (outcome.status === "failed") {
    return { ok: false, error: executionFailureMessage(outcome.source.failure_code) };
  }
  if (outcome.status === "rolled_back") {
    return { ok: false, error: `لا يمكن تنفيذ دفعة سبق التراجع عنها. ${NO_CHANGE_AR}` };
  }
  return { ok: false, error: UNEXPECTED_EXECUTE_AR };
}

/**
 * Inspect what fn_rollback_reconciliation_batch returned. That RPC has no terminal failure state by
 * design — it either raises (and the whole transaction disappears) or returns `rolled_back`, the
 * idempotent repeat included. Anything else means the undo cannot be claimed to have happened.
 */
export function parseRollbackOutcome(data: unknown): BatchOutcome {
  const outcome = readOutcome(data);
  if (!outcome || outcome.status !== "rolled_back") {
    return { ok: false, error: UNEXPECTED_ROLLBACK_AR };
  }
  return { ok: true, status: "rolled_back", idempotent: outcome.idempotent };
}

/**
 * One display row of a batch `result_summary`. A discriminated union rather than optional fields, so
 * a `count` line always HAS its number and a renderer can never fall back to a fabricated 0.
 */
export type ResultSummaryLine =
  | { key: string; label: string; kind: "count"; count: number }
  | { key: string; label: string; kind: "text"; text: string };

const RESULT_COUNT_LABELS: [string, string][] = [
  ["executed_rows", "صفوف نُفِّذت"],
  ["skipped_rows", "صفوف متجاوَزة"],
  ["reversed_journals", "قيود عُكِست"],
  ["reinstated_journals", "قيود أُعيدت"],
  ["zero_value_rows", "صفوف بقيمة صفرية"],
  ["ledger_rows_reversed", "سجلات تنفيذ تراجعت"],
  ["rows_marked_reversed", "صفوف صارت معكوسة"],
];

/**
 * Turn a batch `result_summary` into a short, safe display list.
 *
 * Only the keys enumerated here are ever surfaced, and only when the stored value has the expected
 * type — an unknown or malformed key is DROPPED, never guessed at and never rendered as a number it
 * is not. `safe_locator` is deliberately excluded: it is a row-level locator, and §2.7's redaction
 * discipline keeps row-level identifiers out of a batch-level summary.
 */
export function summarizeResultSummary(summary: unknown): ResultSummaryLine[] {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return [];
  const source = summary as Record<string, unknown>;
  const lines: ResultSummaryLine[] = [];

  for (const [key, label] of RESULT_COUNT_LABELS) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      lines.push({ key, label, kind: "count", count: value });
    }
  }

  const failure = source.failure_code;
  if (typeof failure === "string" && failure.trim().length > 0) {
    lines.push({
      key: "failure_code",
      label: "سبب الفشل",
      kind: "text",
      text: EXECUTION_FAILURE_AR[failure] ?? "فشل غير مصنَّف",
    });
  }

  const reason = source.rollback_reason;
  if (typeof reason === "string" && reason.trim().length > 0) {
    lines.push({
      key: "rollback_reason",
      label: "سبب التراجع",
      kind: "text",
      text: reason.trim().slice(0, ROLLBACK_REASON_MAX),
    });
  }

  return lines;
}

// ── Evidence provenance display (pure label building — no formatting side effects). ─────────────────
export interface EvidenceLike {
  origin_kind: string;
  sheet_name: string | null;
  row_locator: string | null;
  snapshot_target_table: string | null;
  snapshot_target_id: string | null;
}

/** A short human locator for one evidence position — workbook cell or production-snapshot target. */
export function evidenceTargetLabel(evidence: EvidenceLike): string {
  if (evidence.origin_kind === "source_workbook_row") {
    const sheet = evidence.sheet_name ?? "—";
    const row = evidence.row_locator ?? "—";
    return `${ORIGIN_KIND_AR.source_workbook_row}: ورقة «${sheet}» صف ${row}`;
  }
  if (evidence.origin_kind === "production_snapshot_row") {
    const table =
      evidence.snapshot_target_table === "expenses"
        ? "مصروف"
        : evidence.snapshot_target_table === "sales"
          ? "بيع"
          : "—";
    const id = evidence.snapshot_target_id ?? "";
    const shortId = id ? id.slice(0, 8) : "—";
    return `${ORIGIN_KIND_AR.production_snapshot_row}: ${table} · ${shortId}`;
  }
  return "—";
}

// ── Decision payload build/validate — the EXACT fn_review_reconciliation_row jsonb contract. ────────
export interface ExpenseReviewInput {
  category?: string;
  description?: string;
  kind?: string;
  account_id?: string;
  cost_center_id?: string;
  supplier_id?: string;
  payment_decision?: string;
}

export interface SaleReviewInput {
  crop?: string;
  quantity?: number | null;
  unit?: string;
  unit_price?: number | null;
  recorded_total?: number | null;
  buyer_id?: string;
  cost_center_id?: string;
  farm_id?: string;
  sector_id?: string;
  hawsha_id?: string;
  season?: string;
  delivery_date?: string;
  notes?: string;
  historical_date_decision?: string;
  effective_date?: string;
}

export type DecisionInput =
  | { action: "hold"; reason: string }
  | { action: "reject"; reason: string }
  | {
      action: "review";
      target_table: "expenses";
      reason: string;
      classification?: string;
      expense: ExpenseReviewInput;
      corrects_expense_id?: string | null;
    }
  | {
      action: "review";
      target_table: "sales";
      reason: string;
      classification?: string;
      sale: SaleReviewInput;
      corrects_sale_id?: string | null;
    };

export type BuildResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string };

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function optionalUuidInto(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  labelAr: string,
): string | null {
  const text = cleanText(value);
  if (text === undefined) return null;
  if (!isUuid(text)) return `${labelAr} غير صالح`;
  target[key] = text;
  return null;
}

function optionalDateInto(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  labelAr: string,
): string | null {
  const text = cleanText(value);
  if (text === undefined) return null;
  if (!DATE_RE.test(text)) return `${labelAr} يجب أن يكون بصيغة سنة-شهر-يوم`;
  target[key] = text;
  return null;
}

/**
 * Build and validate the p_decision jsonb for fn_review_reconciliation_row. Returns an Arabic error
 * (never throws) on the first problem so the caller can surface it and keep the user's input.
 *
 * `classification` (optional) lets the UI enforce the correction-target rule up front: a correction id
 * is required ONLY for amount_correction_candidate rows, and forbidden otherwise (the DB guard is the
 * authoritative backstop — this just gives a friendlier message).
 */
export function buildReviewDecision(input: unknown): BuildResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "بيانات القرار غير صالحة." };
  }
  const decision = input as Record<string, unknown>;
  const action = decision.action;
  if (action !== "hold" && action !== "reject" && action !== "review") {
    return { ok: false, error: "نوع القرار غير صالح." };
  }

  const reason = cleanText(decision.reason);
  if (!reason) return { ok: false, error: "سبب القرار مطلوب ولا يمكن أن يكون فارغًا." };

  if (action === "hold") {
    return { ok: true, payload: { action: "hold", reason } };
  }
  if (action === "reject") {
    return { ok: true, payload: { action: "reject", reason } };
  }

  // action === "review" → include this row for a target domain.
  const targetTable = decision.target_table;
  if (targetTable !== "expenses" && targetTable !== "sales") {
    return { ok: false, error: "وجهة التضمين غير صالحة." };
  }
  const isCorrection = decision.classification === "amount_correction_candidate";

  if (targetTable === "expenses") {
    if (!decision.expense || typeof decision.expense !== "object" || Array.isArray(decision.expense)) {
      return { ok: false, error: "بيانات المصروف غير صالحة." };
    }
    const exp = decision.expense as Record<string, unknown>;
    const category = cleanText(exp.category);
    if (!category) return { ok: false, error: "التصنيف (بند الحساب) مطلوب عند التضمين." };
    const kind = cleanText(exp.kind);
    if (!kind || !EXPENSE_KINDS.includes(kind as ExpenseKind)) {
      return { ok: false, error: "نوع المصروف مطلوب (تشغيلي/مسحوبات/رأسمالي)." };
    }
    const accountId = cleanText(exp.account_id);
    if (!accountId) return { ok: false, error: "الحساب المحاسبي مطلوب عند التضمين." };
    if (!isUuid(accountId)) return { ok: false, error: "الحساب المحاسبي غير صالح." };

    const expense: Record<string, unknown> = { category, kind, account_id: accountId };
    const description = cleanText(exp.description);
    if (description) expense.description = description;
    const paymentDecision = cleanText(exp.payment_decision);
    if (!paymentDecision) {
      return { ok: false, error: "قرار الترحيل على خزينة المزرعة مطلوب." };
    }
    if (!PAYMENT_DECISIONS.includes(paymentDecision as ExpensePaymentDecision)) {
      return { ok: false, error: "قرار الدفع غير صالح." };
    }
    expense.payment_decision = paymentDecision;
    for (const [key, label] of [
      ["cost_center_id", "مركز التكلفة"],
      ["supplier_id", "المورد"],
    ] as const) {
      const err = optionalUuidInto(expense, key, exp[key], label);
      if (err) return { ok: false, error: err };
    }

    const payload: Record<string, unknown> = {
      action: "review",
      reason,
      target_table: "expenses",
      expense,
    };
    const correction = cleanText(decision.corrects_expense_id);
    if (correction) {
      if (!isCorrection) {
        return { ok: false, error: "لا يمكن ربط تصحيح إلا بصف مُصنَّف «تصحيح مبلغ»." };
      }
      if (!isUuid(correction)) return { ok: false, error: "مُعرّف المصروف المُصحَّح غير صالح." };
      payload.corrects_expense_id = correction;
    } else if (isCorrection) {
      return { ok: false, error: "صف «تصحيح مبلغ» يتطلب تحديد المصروف المُصحَّح." };
    }
    return { ok: true, payload };
  }

  // target_table === "sales"
  if (!decision.sale || typeof decision.sale !== "object" || Array.isArray(decision.sale)) {
    return { ok: false, error: "بيانات البيع غير صالحة." };
  }
  const sl = decision.sale as Record<string, unknown>;
  const crop = cleanText(sl.crop);
  if (!crop) return { ok: false, error: "المحصول مطلوب عند التضمين." };
  if (!finiteNonNegative(sl.quantity)) return { ok: false, error: "الكمية مطلوبة ولا يمكن أن تكون سالبة." };
  if (!finiteNonNegative(sl.unit_price)) {
    return { ok: false, error: "سعر الوحدة مطلوب ولا يمكن أن يكون سالبًا." };
  }
  if (!finiteNonNegative(sl.recorded_total)) {
    return { ok: false, error: "الإجمالي المُسجَّل مطلوب ولا يمكن أن يكون سالبًا." };
  }

  const sale: Record<string, unknown> = {
    crop,
    quantity: sl.quantity,
    unit_price: sl.unit_price,
    recorded_total: sl.recorded_total,
  };
  const unit = cleanText(sl.unit);
  if (unit) sale.unit = unit;
  const season = cleanText(sl.season);
  if (season) sale.season = season;
  const notes = cleanText(sl.notes);
  if (notes) sale.notes = notes;
  const historical = cleanText(sl.historical_date_decision);
  if (historical) {
    if (!HISTORICAL_DATE_DECISIONS.includes(historical as SaleHistoricalDateDecision)) {
      return { ok: false, error: "قرار التاريخ التاريخي غير صالح." };
    }
    sale.historical_date_decision = historical;
  }
  for (const [key, label] of [
    ["buyer_id", "المشتري"],
    ["cost_center_id", "مركز التكلفة"],
    ["farm_id", "المزرعة"],
    ["sector_id", "القطاع"],
    ["hawsha_id", "الحوشة"],
  ] as const) {
    const err = optionalUuidInto(sale, key, sl[key], label);
    if (err) return { ok: false, error: err };
  }
  for (const [key, label] of [
    ["delivery_date", "تاريخ التسليم"],
    ["effective_date", "التاريخ الفعلي"],
  ] as const) {
    const err = optionalDateInto(sale, key, sl[key], label);
    if (err) return { ok: false, error: err };
  }

  const payload: Record<string, unknown> = {
    action: "review",
    reason,
    target_table: "sales",
    sale,
  };
  const correction = cleanText(decision.corrects_sale_id);
  if (correction) {
    if (!isCorrection) {
      return { ok: false, error: "لا يمكن ربط تصحيح إلا بصف مُصنَّف «تصحيح مبلغ»." };
    }
    if (!isUuid(correction)) return { ok: false, error: "مُعرّف البيع المُصحَّح غير صالح." };
    payload.corrects_sale_id = correction;
  } else if (isCorrection) {
    return { ok: false, error: "صف «تصحيح مبلغ» يتطلب تحديد البيع المُصحَّح." };
  }
  return { ok: true, payload };
}
