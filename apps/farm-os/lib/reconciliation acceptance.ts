// Pure logic for the accounting reconciliation ACCEPTANCE report — the printable artifact an
// accountant/owner signs against a staged batch — and for the CSV annex attached to that signature.
// No DB, no React. (Node only: the package digest below uses node:crypto, so this module is imported
// by server pages/route handlers and tests, never by a client component.)
//
// READ-ONLY BY CONSTRUCTION. Nothing in this module (or the report it drives) writes, stages,
// freezes, approves, executes, or rolls back anything: it summarises the rows exactly as the batch
// already stores them. The DB remains the authority; this module only counts and labels.
//
// TRUTHFULNESS RULES (CLAUDE.md #1 — never fabricate a financial figure):
//   • A missing source amount is NEVER read as 0. Every money total carries the count of rows that
//     had no recorded amount (`DecimalSummary.unknownCount`), and the renderer shows it.
//   • Amounts are exact decimals end to end (lib/decimal.ts): summed as scaled integers, printed with
//     exactly two decimals, and exported to CSV as the canonical decimal string — never re-derived
//     from a JavaScript float.
//   • A hash that is absent or malformed in `result_summary` is reported as "not recorded", never
//     guessed at and never echoed raw.
//   • `frozen` / `executed` are counted from the executor's own bookkeeping columns (the `frozen`
//     flag and `execution_result`), NOT inferred from `review_state` or the batch status — so these
//     numbers agree exactly with the batch page's KPI strip.
//   • Destination totals separate the rows whose destination is an ordinary posting (included →
//     expenses / included → sales) from those that post nothing (held, rejected, undecided). A held
//     row's amount is never shown inside a posting total. An included AMOUNT CORRECTION is a third
//     thing and gets its own group and its own figures: it does post, but execution first REVERSES the
//     record it names, so its source amount is a replacement and its net effect on the books is
//     `new − old`. Putting it in an ordinary posting total would overstate that total by the whole
//     reversed amount, so it is excluded from plannedPostingTotal and from every control-total
//     postingAmount, and reported as correctionReplacementTotal — labelled a gross replacement amount,
//     never a net effect and never a P&L figure (ACCEPTANCE_CORRECTION_CAVEAT_AR). The WORDING of the
//     posting groups follows the
//     batch's own status: "will be recorded" is only ever said about a batch that has not executed
//     yet — an executed batch says "was recorded", a rolled-back one says "was recorded then
//     reversed", and an interrupted/unknown one claims nothing at all (see AcceptancePhase).
//   • The report states, in Arabic, that no dual-run comparison and no acceptance signature is
//     recorded anywhere in the system, because no such record exists (see ACCEPTANCE_NO_DUAL_RUN_AR).
//
// ONE CONTENT FORMAT, ONE DIGEST. The page and CSV endpoint each build a package from their own
// complete read. Matching SHA-256 digests prove that the two requests returned the same captured
// content; a later, different read cannot silently be filed against a signed report.
//
// WHAT THE DIGEST COVERS — AND WHAT IT DOES NOT. It is taken over the batch record and the per-row
// CONTENT CELLS only (acceptancePayloadDocument). The computed aggregates on this report — the
// classification/destination totals, the control totals, the posting and correction figures — are NOT
// hashed themselves; they are derived views over rows the digest already binds. That is enough,
// because every input those aggregates read is a digested cell: a row's `destination` cell is one of
// them, so the same row moving between an ordinary addition and an amount correction changes the
// digested bytes and therefore the package digest, even though no aggregate is hashed directly.

import { createHash } from "node:crypto";

import { parseDecimal, sumDecimals, type DecimalString, type DecimalSummary } from "./decimal";
import type { CsvColumn, CsvRow } from "./export-csv";
import { num } from "./money";
import { isCalendarDate } from "./payroll-close";
import {
  CLASSIFICATION_AR,
  DISPOSITION_AR,
  EXECUTION_RESULT_AR,
  EXPENSE_KIND_AR,
  HISTORICAL_DATE_DECISION_AR,
  ORIGIN_KIND_AR,
  PAYMENT_DECISION_AR,
  RECONCILIATION_MAX_ROWS,
  REVIEW_STATE_AR,
  summarizeRowStates,
  type BatchStatus,
  type Classification,
  type Disposition,
  type ExecutionResult,
  type ExpenseKind,
  type ExpensePaymentDecision,
  type OriginKind,
  type ReviewState,
  type RowStateCounts,
  type SaleHistoricalDateDecision,
} from "./reconciliation review";

/**
 * The staging RPC caps a batch at 1000 rows, so a whole-batch load is bounded by construction.
 * The reader still asks for MAX+1 and fails closed if it ever gets more — an acceptance report that
 * silently dropped rows would be worse than no report at all.
 */
export const ACCEPTANCE_MAX_ROWS = RECONCILIATION_MAX_ROWS;

// ── Fail-closed Arabic messages. Each one means "no report was produced", never "a partial one". ───
export const ACCEPTANCE_OVERFLOW_AR =
  `تعذّر إصدار تقرير القبول: عدد صفوف هذه الدفعة يتجاوز الحد الأقصى القابل للتحميل كاملًا ` +
  `(${num(ACCEPTANCE_MAX_ROWS)} صف). لم يُعرض أي رقم، لأن تقريرًا ناقصًا لا يصلح للتوقيع.`;

export const ACCEPTANCE_READ_FAILED_AR =
  "تعذّرت قراءة صفوف الدفعة كاملة، فلم يصدر تقرير قبول ولم يُعرض أي رقم جزئي. " +
  "أعد المحاولة، وإن تكرر الخطأ راجع صلاحيات القراءة قبل أي توقيع.";

export const ACCEPTANCE_INCOMPLETE_AR =
  "تعذّر إصدار تقرير القبول: عدد الصفوف المقروءة لا يطابق عدد صفوف الدفعة المسجَّل، " +
  "أي أن جزءًا من الأدلة غير مقروء. لم يُعرض أي رقم.";

export const ACCEPTANCE_COUNT_MISMATCH_AR =
  "تعذّر إصدار تقرير القبول: أعداد صفوف الدفعة أو أدلتها المخزَّنة الآن تخالف ما سجّلته أداة التجهيز " +
  "في بيان الدفعة، أو أن البيان نفسه غير صالح للقراءة. هذا خلل في سلامة البيانات لا يصلح معه توقيع، " +
  "فلم يُعرض أي رقم. راجع الدفعة وسجل التدقيق قبل أي قبول.";

/**
 * A batch with no rows is not "a report with zero rows" — it is a batch that cannot be accepted at
 * all. Rendering one would produce a fully-formed, signable page whose every total is zero, which is
 * exactly the document nobody should ever be handed.
 */
export const ACCEPTANCE_EMPTY_AR =
  "تعذّر إصدار تقرير القبول: لا تحتوي هذه الدفعة على أي صف. لا يوجد ما يُقبل أو يُوقَّع عليه، " +
  "ولم يُعرض أي رقم — تقرير بأصفار ليس قبولًا.";

/**
 * The one statement the whole report exists to keep honest.
 *
 * There is no dual-run comparison record and no acceptance-signature record anywhere in the schema:
 * `reconciliation_batches` carries only id/org/workbook hash/label/status/created/approved_by/
 * approved_at/result_summary. `approved_by`/`approved_at` are the OWNER's execution approval gate —
 * a different act from an accountant's acceptance of a dual run — so the report must not present one
 * as the other.
 */
export const ACCEPTANCE_NO_DUAL_RUN_AR =
  "لم يُسجَّل في النظام أي تشغيل مزدوج (dual run) مقارنًا بالدفتر المصدر، ولم يُسجَّل أي توقيع قبول " +
  "محاسبي لهذه الدفعة — لا يوجد في قاعدة البيانات حقل يحفظ أيًّا منهما. اعتماد المالك (إن وُجد) هو " +
  "بوابة تنفيذ مالي، وليس قبولًا محاسبيًا. لا توقّع هذا التقرير كقبول قبل إجراء التشغيل المزدوج " +
  "ومراجعة كل الاستثناءات. بعد ذلك فقط يصبح قبولًا عند توقيع النسخة المطبوعة منه وحفظها مع الدفعة.";

/**
 * What the package digest does and — just as important — what it does NOT do. It is a content
 * fingerprint, not a seal: the rows in the database stay editable, and this text must not suggest
 * otherwise.
 */
export const ACCEPTANCE_DIGEST_NOTE_AR =
  "بصمة حزمة القبول (SHA-256) محسوبة من محتوى هذه القراءة كاملًا: بيانات الدفعة وحالتها وبصمات " +
  "مصدرها، وكل صف بأدلته وقراره وحمولته المحاسبية. البصمة نفسها مطبوعة هنا ومكرَّرة في كل سطر من " +
  "ملف CSV، فإن اختلفت بصمة الملف عن بصمة الورقة الموقَّعة فالملف من قراءة أخرى ولا يخصّ هذا " +
  "التوقيع. تطابق البصمتين يثبت أن الورقة والملف يصفان المحتوى نفسه الذي قُرئ في هذه اللحظة — ولا " +
  "يعني أن البيانات مُحصَّنة ضد التغيير: أي تعديل لاحق على الدفعة يُنتج بصمة جديدة مختلفة.";

// ── Row shapes (exactly the columns the reader selects — nothing else is needed to summarise). ─────

/** A joined lookup row. Only display columns are read; ids are carried on the batch row itself. */
export interface AcceptanceCodeNameRef {
  code: string | null;
  name_ar: string | null;
}
export interface AcceptanceNameRef {
  name: string | null;
}
export interface AcceptanceCodeLatinNameRef {
  code: string | null;
  name: string | null;
}

export interface AcceptanceEvidence {
  id: string;
  origin_kind: string;
  sheet_name: string | null;
  row_locator: string | null;
  snapshot_target_table: string | null;
  snapshot_target_id: string | null;
  source_workbook_sha256: string | null;
  production_snapshot_sha256: string | null;
  source_identity_fingerprint: string | null;
  /**
   * ALWAYS canonical decimal TEXT (or null). The read RPC serialises every `numeric` with ::text
   * before the JSON leaves PostgreSQL, and the loader refuses a payload that sends one as a JSON
   * number — which would already have passed through a binary double. Typing it `string` makes that
   * a compile error here too, so no future caller can reintroduce a float on this path.
   */
  source_amount: string | null;
  source_date_text: string | null;
  source_date_parsed: string | null;
  classification: string;
  invalid_calendar_quality_flag: boolean;
  evidence_label: string | null;
}

/**
 * One batch row, with the COMPLETE posting payload — every reviewed field that determines what the
 * execution RPCs will write, in the same set the DB itself hashes into `payload_hash`
 * (private.fn_reconciliation_execution_payload_hash). An acceptance signature that did not show
 * these fields would be a signature on a decision the signer could not see.
 */
export interface AcceptanceRow {
  id: string;
  evidence_item_id: string;
  review_state: ReviewState;
  disposition: Disposition;
  reviewer_id: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
  target_table: string | null;
  // reviewed expense payload
  expense_category: string | null;
  expense_description: string | null;
  expense_kind: string | null;
  expense_account_id: string | null;
  expense_cost_center_id: string | null;
  expense_supplier_id: string | null;
  expense_payment_decision: string | null;
  // reviewed sale payload — the three `numeric` fields are canonical decimal TEXT, never a JS number
  // (see AcceptanceEvidence.source_amount).
  sale_crop: string | null;
  sale_quantity: string | null;
  sale_unit: string | null;
  sale_unit_price: string | null;
  sale_recorded_total: string | null;
  sale_buyer_id: string | null;
  sale_cost_center_id: string | null;
  sale_farm_id: string | null;
  sale_sector_id: string | null;
  sale_hawsha_id: string | null;
  sale_season: string | null;
  sale_delivery_date: string | null;
  sale_notes: string | null;
  sale_historical_date_decision: string | null;
  sale_effective_date: string | null;
  // correction targets
  corrects_expense_id: string | null;
  corrects_sale_id: string | null;
  // freeze / execution bookkeeping
  payload_hash: string | null;
  frozen: boolean;
  frozen_at: string | null;
  execution_result: ExecutionResult;
  execution_error: string | null;
  // joined readable labels (one embed each — no per-row query)
  expense_account: AcceptanceCodeNameRef | null;
  expense_cost_center: AcceptanceCodeNameRef | null;
  expense_supplier: AcceptanceNameRef | null;
  sale_buyer: AcceptanceNameRef | null;
  sale_cost_center: AcceptanceCodeNameRef | null;
  sale_farm: AcceptanceNameRef | null;
  sale_sector: AcceptanceNameRef | null;
  sale_hawsha: AcceptanceCodeLatinNameRef | null;
  evidence: AcceptanceEvidence | null;
}

/** Batch identity + provenance, exactly the columns the reader selects. */
export interface AcceptanceBatchIdentity {
  id: string;
  source_label: string | null;
  source_workbook_sha256: string | null;
  status: BatchStatus;
  created_at: string;
  created_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  result_summary: unknown;
}

// ── Deterministic evidence-locator order. ──────────────────────────────────────────────────────────
//
// The page and the CSV MUST list the batch in one and the same order, and that order must be stable
// across reloads and across machines — an accountant reconciles the printed report against the CSV
// line by line. PostgREST ordering cannot express "workbook cell order" across an embedded relation,
// so the read is ordered by a stable key (evidence_item_id) and the human order is applied here, as
// a pure total order that ends on a unique tiebreak.

const ORIGIN_RANK: Record<string, number> = {
  source_workbook_row: 0,
  production_snapshot_row: 1,
};

/** Unknown origins sort last (rank 2) rather than being dropped or interleaved unpredictably. */
function originRank(kind: string | null | undefined): number {
  return ORIGIN_RANK[kind ?? ""] ?? 2;
}

/**
 * Natural compare: digit runs compare by VALUE ("صف ٢" before "صف ١٠"), everything else by code
 * point. Digit runs are compared by significant length then lexically — exact for locators of any
 * length, with no Number() precision cliff — and equal values with different zero-padding fall back
 * to a deterministic tiebreak so the order is total, never arbitrary.
 */
export function compareLocatorText(a: string, b: string): number {
  if (a === b) return 0;
  const segments = /\d+|\D+/g;
  const as = a.match(segments) ?? [];
  const bs = b.match(segments) ?? [];
  // Each segment is either all digits or all non-digits, so its first character classifies it.
  const isDigitRun = (segment: string) => /^\d/.test(segment);
  const shared = Math.min(as.length, bs.length);
  for (let i = 0; i < shared; i += 1) {
    const x = as[i];
    const y = bs[i];
    if (x === y) continue;
    if (isDigitRun(x) && isDigitRun(y)) {
      const sx = x.replace(/^0+(?=\d)/, "");
      const sy = y.replace(/^0+(?=\d)/, "");
      if (sx.length !== sy.length) return sx.length - sy.length;
      if (sx !== sy) return sx < sy ? -1 : 1;
      return x.length - y.length; // same value, different padding
    }
    return x < y ? -1 : 1;
  }
  return as.length - bs.length;
}

/**
 * The evidence-locator order: workbook cells first (sheet, then row), then production-snapshot rows
 * (target table, then target id), ending on the evidence item id — which is unique per batch row
 * (`reconciliation_batch_rows_batch_evidence_uq`), so the order is total and reload-stable.
 */
export function compareAcceptanceRows(a: AcceptanceRow, b: AcceptanceRow): number {
  const ea = a.evidence;
  const eb = b.evidence;
  const byOrigin = originRank(ea?.origin_kind) - originRank(eb?.origin_kind);
  if (byOrigin !== 0) return byOrigin;
  for (const key of ["sheet_name", "row_locator", "snapshot_target_table", "snapshot_target_id"] as const) {
    const compared = compareLocatorText(ea?.[key] ?? "", eb?.[key] ?? "");
    if (compared !== 0) return compared;
  }
  if (a.evidence_item_id === b.evidence_item_id) return 0;
  return a.evidence_item_id < b.evidence_item_id ? -1 : 1;
}

/** A new array in evidence-locator order; never mutates the caller's rows. */
export function orderByEvidenceLocator(rows: AcceptanceRow[]): AcceptanceRow[] {
  return [...rows].sort(compareAcceptanceRows);
}

// ── Whole-batch summary. ───────────────────────────────────────────────────────────────────────────

/** Fixed display order for the five classifications; drift-guarded against CLASSIFICATION_AR. */
export const ACCEPTANCE_CLASSIFICATION_ORDER: Classification[] = [
  "source_addition_candidate",
  "amount_correction_candidate",
  "production_orphan_candidate",
  "zero_value_source_placeholder",
  "ambiguous_identity_group",
];

/** The target domain of a row, used for the CSV's readable «الوجهة» column. */
export type AcceptanceDataset = "expenses" | "sales" | "undecided";

export const ACCEPTANCE_DATASET_AR: Record<AcceptanceDataset, string> = {
  expenses: "مصروف",
  sales: "بيع",
  undecided: "بدون وجهة بعد",
};

/**
 * What actually happens to a row at execution — the only honest basis for a "totals by destination"
 * table. `held`, `rejected` and `undecided` rows post NOTHING, so their amounts must never appear
 * inside a planned-posting figure.
 */
export type AcceptanceDestination =
  | "included_expenses"
  | "included_sales"
  /**
   * An included row that NAMES the production record it corrects. It is a posting group like the two
   * above — it is emphatically NOT "posts nothing" — but its money shape is different: execution
   * reverses the named record's journal and posts a REPLACEMENT at the row's own source amount, so the
   * row's net effect on the books is `replacement − reversed`, not `replacement`. Adding a replacement
   * amount into an ordinary posting total would overstate that total by the whole reversed amount,
   * which is why this group is its own destination and is excluded from every posting figure.
   */
  | "included_correction"
  | "correction_invalid"
  | "execution_skipped"
  | "execution_unsettled"
  | "held"
  | "rejected"
  | "undecided"
  | "included_no_target";

/**
 * WHERE THE BATCH IS IN ITS OWN LIFECYCLE — the only honest basis for the TENSE of a destination
 * label. A batch that already executed has not "planned" anything; a rolled-back one posted and then
 * un-posted; an `executing`/`failed`/unrecognised batch is mid-flight and this report must not claim
 * either outcome for it.
 */
export type AcceptancePhase = "planned" | "executed" | "reverted" | "unsettled";

/**
 * Only the three settled statuses get a settled tense. `executing` and `failed` are deliberately
 * "unsettled" — a failed execution may have posted nothing or may have been rolled back — and an
 * UNRECOGNISED status falls to "unsettled" too, so a future status can never inherit "will post".
 */
const PHASE_BY_BATCH_STATUS: Record<string, AcceptancePhase> = {
  staged: "planned",
  reviewed: "planned",
  approved: "planned",
  executing: "unsettled",
  failed: "unsettled",
  executed: "executed",
  rolled_back: "reverted",
};

export function acceptancePhase(status: string): AcceptancePhase {
  return PHASE_BY_BATCH_STATUS[status] ?? "unsettled";
}

/**
 * The destination groups that post NOTHING in the displayed phase. Present tense on purpose: "does
 * not get recorded" is true before, during and after execution, so these need no phase variant.
 */
const ACCEPTANCE_NON_POSTING_AR: Record<
  Exclude<AcceptanceDestination, "included_expenses" | "included_sales" | "included_correction">,
  string
> = {
  correction_invalid:
    "مُضمَّنة كتصحيح لكن دليل التصحيح ورابط السجل غير متطابقين — لا يُحتسب لها تنفيذ",
  execution_skipped: "مُضمَّنة لكن تخطّاها التنفيذ — لم تُسجَّل بهذه الدفعة",
  execution_unsettled: "مُضمَّنة لكن نتيجة تنفيذها غير محسومة — لا تُحتسب كمُسجَّلة",
  held: "مُعلَّقة — لا تُسجَّل",
  rejected: "مرفوضة — لا تُسجَّل",
  undecided: "بدون قرار — لا تُسجَّل",
  included_no_target: "مُضمَّنة بلا وجهة مقروءة — غير محسوبة في أي إجمالي",
};

/** The phase-dependent wording: the posting groups, their figures, and the notes that qualify them. */
export interface AcceptancePhaseCopy {
  includedExpenses: string;
  includedSales: string;
  /**
   * The amount-correction group's destination label. It must say THREE things in every phase: that the
   * row is a correction, that the old record is reversed, and that the amount shown is the REPLACEMENT
   * — never that a correction records nothing.
   */
  includedCorrection: string;
  /** Heading of the "rows that post" figure on the report. Ordinary additions only. */
  postingRowsLabel: string;
  /** Heading of the "amount that posts" figure on the report. Ordinary additions only. */
  postingTotalLabel: string;
  /** The clause that states what the posting total means in THIS phase. */
  postingNote: string;
  /** Heading of the "correction rows" figure on the report. */
  correctionRowsLabel: string;
  /** Heading of the correction REPLACEMENT amount — never the net effect on the books. */
  correctionTotalLabel: string;
  /** The clause that states what the correction figures mean in THIS phase. */
  correctionNote: string;
}

export const ACCEPTANCE_PHASE_COPY: Record<AcceptancePhase, AcceptancePhaseCopy> = {
  planned: {
    includedExpenses: "مُضمَّنة — وجهتها المصروفات، ستُسجَّل عند التنفيذ",
    includedSales: "مُضمَّنة — وجهتها المبيعات، ستُسجَّل عند التنفيذ",
    includedCorrection:
      "مُضمَّنة — تصحيح مبلغ: سيَعكس التنفيذ السجل القديم، ويسجّل بديلًا إذا كان مبلغ الاستبدال " +
      "أكبر من صفر؛ والصفر يعني عكس السجل القديم بلا بديل",
    postingRowsLabel: "صفوف إضافة ستُسجَّل عند التنفيذ",
    postingTotalLabel: "إجمالي ما سيُسجَّل عند التنفيذ (إضافات فقط)",
    postingNote: "لم تُنفَّذ هذه الدفعة بعد، فالمبلغ أدناه متوقَّع عند التنفيذ ولم يدخل الدفاتر.",
    correctionRowsLabel: "صفوف تصحيح مبلغ ستُنفَّذ",
    correctionTotalLabel: "إجمالي مبالغ الاستبدال لصفوف التصحيح — لا الأثر الصافي",
    correctionNote:
      "لم تُنفَّذ هذه الدفعة بعد. عند التنفيذ سيَعكس كل صف تصحيح السجل القديم الذي يسمّيه، ثم يسجّل " +
      "بديلًا فقط إذا كان مبلغ الاستبدال أكبر من صفر.",
  },
  executed: {
    includedExpenses: "مُضمَّنة — سُجِّلت مصروفًا بالتنفيذ",
    includedSales: "مُضمَّنة — سُجِّلت بيعًا بالتنفيذ",
    includedCorrection:
      "مُضمَّنة — تصحيح مبلغ: عَكَس التنفيذ السجل القديم، وسجّل بديلًا عندما كان مبلغ الاستبدال " +
      "أكبر من صفر؛ والصفر يعني عكس السجل القديم بلا بديل",
    postingRowsLabel: "صفوف إضافة سُجِّلت بالتنفيذ",
    postingTotalLabel: "إجمالي ما سُجِّل بالتنفيذ (إضافات فقط)",
    postingNote: "نُفِّذت هذه الدفعة بالفعل، فالمبلغ أدناه سُجِّل في الدفاتر ولم يعد متوقَّعًا.",
    correctionRowsLabel: "صفوف تصحيح مبلغ نُفِّذت",
    correctionTotalLabel: "إجمالي مبالغ الاستبدال المُسجَّلة لصفوف التصحيح — لا الأثر الصافي",
    correctionNote:
      "نُفِّذت هذه الدفعة بالفعل: عُكِس السجل القديم لكل صف تصحيح، وسُجِّل بديل فقط عندما كان مبلغ " +
      "الاستبدال أكبر من صفر.",
  },
  reverted: {
    includedExpenses: "مُضمَّنة — سُجِّلت مصروفًا ثم عُكِست بالتراجع",
    includedSales: "مُضمَّنة — سُجِّلت بيعًا ثم عُكِست بالتراجع",
    includedCorrection:
      "مُضمَّنة — تصحيح مبلغ: نُفِّذ (عكس السجل القديم، وتسجيل مبلغ الاستبدال إذا كان أكبر من " +
      "صفر) ثم تراجعت الدفعة؛ والصفر كان عكسًا بلا بديل",
    postingRowsLabel: "صفوف إضافة سُجِّلت ثم عُكِست",
    postingTotalLabel: "إجمالي ما سُجِّل ثم عُكِس (إضافات فقط)",
    postingNote:
      "تراجَعت هذه الدفعة بعد تنفيذها، فالمبلغ أدناه سُجِّل ثم عُكِس، وأثره الصافي في الدفاتر صفر.",
    correctionRowsLabel: "صفوف تصحيح مبلغ نُفِّذت ثم تراجعت",
    correctionTotalLabel: "إجمالي مبالغ الاستبدال التي نُفِّذت ثم تراجعت — لا الأثر الصافي",
    correctionNote:
      "نُفِّذت هذه الدفعة ثم تراجَعت: عُكِس السجل القديم لكل صف تصحيح، وسُجِّل بديل للمبلغ الأكبر " +
      "من صفر، ثم تراجع ذلك كله. لا يحسب هذا التقرير أثر التصحيح ولا أثر التراجع عليه.",
  },
  unsettled: {
    includedExpenses: "مُضمَّنة — وجهتها المصروفات، وحالة تسجيلها غير محسومة",
    includedSales: "مُضمَّنة — وجهتها المبيعات، وحالة تسجيلها غير محسومة",
    includedCorrection:
      "مُضمَّنة — تصحيح مبلغ سُجِّلت له نتيجة تنفيذ «معكوس»، وحالة الدفعة نفسها غير محسومة، " +
      "والمعروض هو مبلغ الاستبدال لا الأثر الصافي",
    postingRowsLabel: "صفوف إضافة مُضمَّنة — حالة تسجيلها غير محسومة",
    postingTotalLabel: "إجمالي صفوف الإضافة المُضمَّنة — حالة تسجيلها غير محسومة",
    // Deliberately free of any tense claim about the posting: this batch is mid-flight, and the only
    // truthful source for a given row is its own `execution_result`.
    postingNote:
      "حالة هذه الدفعة لا تحسم ما إذا كان التسجيل قد تم من عدمه، فلا يقرّر هذا التقرير أثر المبلغ " +
      "أدناه في الدفاتر. راجع «نتيجة التنفيذ» لكل صف في ملف CSV قبل أي قبول.",
    correctionRowsLabel: "صفوف تصحيح مبلغ — حالة الدفعة غير محسومة",
    correctionTotalLabel: "إجمالي مبالغ الاستبدال لصفوف التصحيح — غير محسومة، ولا الأثر الصافي",
    correctionNote:
      "حالة هذه الدفعة لا تحسم ما إذا كان تنفيذ التصحيحات قد تم من عدمه. لا تظهر هنا إلا صفوف " +
      "التصحيح التي سُجِّلت لها نتيجة «معكوس»؛ وما نتيجته «قيد الانتظار» أو «فاشل» أو «مُسجَّل» " +
      "يظهر في مجموعة «نتيجة تنفيذها غير محسومة». راجع «نتيجة التنفيذ» لكل صف في ملف CSV قبل أي قبول.",
  },
};

/**
 * Printed with the correction figures, ALWAYS — including on a batch that holds no correction row at
 * all, because the fact this report never computes a net ledger effect is exactly what a signer needs
 * to know before signing.
 *
 * Three claims it must make and one it must refuse to make: a correction reverses the named record and
 * posts a replacement only for a positive amount; zero is reversal-only. The figure is the gross
 * REPLACEMENT source amount;
 * the net effect is `new − old` and is NOT computed anywhere in this report. And it is not a P&L line:
 * these rows span owner drawings, capital spend, operating expenses and sales, which CLAUDE.md #6
 * forbids adding into one claimed result.
 */
export const ACCEPTANCE_CORRECTION_CAVEAT_AR =
  "صف تصحيح المبلغ هو الصف المُضمَّن الذي يسمّي سجل الإنتاج الذي يصحّحه. تنفيذه لا يسجّل شيئًا " +
  "جديدًا فحسب: هو يعكس قيد السجل القديم أولًا ثم يسجّل بديلًا عندما يكون مبلغ المصدر أكبر من صفر؛ " +
  "أما مبلغ الاستبدال صفر فيعني عكس السجل القديم بلا إنشاء سجل أو قيد بديل. لذلك أُخرجت " +
  "صفوف التصحيح من «إجمالي ما يُسجَّل» ومن عمود إجمالي التسجيل في جداول الرقابة، وإلا لكان ذلك " +
  "الإجمالي أكبر من الحقيقة بمقدار كل مبلغ معكوس. والمبلغ المعروض هنا هو مبلغ الاستبدال الإجمالي " +
  "فقط: الأثر الصافي في الدفاتر هو (الجديد ناقص القديم) لكل صف على حدة، ولا يحسبه هذا التقرير ولا " +
  "يخزّنه النظام — يُحتسب من السجل المُصحَّح نفسه بعد ربط كل صف تصحيح بسجله. وهذا الرقم ليس بندًا في " +
  "قائمة نتائج: هو مجموع مبالغ مصدر إجمالية قد تخلط مسحوبات المالك ومصروفات رأسمالية ومصروفات " +
  "تشغيلية ومبيعات، فلا يُقرأ كربح ولا كمصروف ولا كإيراد.";

/** The destination labels for one batch phase — the ONLY source of a destination's Arabic wording. */
export function acceptanceDestinationLabels(
  phase: AcceptancePhase,
): Record<AcceptanceDestination, string> {
  const copy = ACCEPTANCE_PHASE_COPY[phase];
  return {
    included_expenses: copy.includedExpenses,
    included_sales: copy.includedSales,
    included_correction: copy.includedCorrection,
    ...ACCEPTANCE_NON_POSTING_AR,
  };
}

/**
 * The groups whose amounts are genuinely "what gets recorded", and whose source amount IS that amount.
 *
 * `included_correction` is deliberately NOT here. A correction row does post — that is why it has its
 * own destination and its own figures — but its source amount is a REPLACEMENT for a reversed record,
 * so adding it to this total would overstate the total by the reversed amount. Its own subtotal is
 * `AcceptanceReport.correctionReplacementTotal`.
 */
export const ACCEPTANCE_PLANNED_DESTINATIONS: AcceptanceDestination[] = [
  "included_expenses",
  "included_sales",
];

/**
 * Fixed display order for the groups that are ALWAYS shown. `included_correction`,
 * `execution_skipped`, `execution_unsettled` and `included_no_target` are inserted only when such a
 * row actually exists, so a batch with no correction row prints exactly the table it printed before.
 */
const ACCEPTANCE_DESTINATION_ORDER: AcceptanceDestination[] = [
  "included_expenses",
  "included_sales",
  "held",
  "rejected",
  "undecided",
];

/**
 * Whether this row must be treated as an amount correction by the acceptance report.
 *
 * Healthy included rows satisfy both halves: the evidence is classified as a correction candidate
 * and the reviewed row names the corrected record for its target dataset. Database guards enforce
 * that contract. This reader is deliberately more conservative: either signal is enough to keep a
 * malformed row out of ordinary posting totals. The existing correction-linked quality counts then
 * expose the missing-link case instead of silently restating it as an addition.
 */
export function isAcceptanceCorrectionRow(row: AcceptanceRow): boolean {
  return (
    row.evidence?.classification === "amount_correction_candidate" ||
    row.corrects_expense_id !== null ||
    row.corrects_sale_id !== null
  );
}

function hasValidAcceptanceCorrectionShape(row: AcceptanceRow): boolean {
  if (row.evidence?.classification !== "amount_correction_candidate") return false;
  if (row.target_table === "expenses") {
    return row.corrects_expense_id !== null && row.corrects_sale_id === null;
  }
  if (row.target_table === "sales") {
    return row.corrects_sale_id !== null && row.corrects_expense_id === null;
  }
  return false;
}

/**
 * Exactly one destination per row, checked in decision order: a rejection is final; an explicit
 * include is what posts; a row with no decision yet is undecided; everything else is held. Every row
 * therefore lands in exactly one group and the groups add up to the batch (asserted in the tests and
 * shown as an "all rows accounted for" line on the report).
 */
export function destinationOf(row: AcceptanceRow): AcceptanceDestination {
  if (row.review_state === "rejected") return "rejected";
  if (row.disposition === "include") {
    // Checked first, and safe to: isAcceptanceCorrectionRow is false for any target_table that is not
    // one of the two datasets, so an unreadable target still falls through to `included_no_target`.
    if (isAcceptanceCorrectionRow(row)) {
      return hasValidAcceptanceCorrectionShape(row)
        ? "included_correction"
        : "correction_invalid";
    }
    if (row.target_table === "expenses") return "included_expenses";
    if (row.target_table === "sales") return "included_sales";
    return "included_no_target";
  }
  if (row.review_state === "unreviewed") return "undecided";
  return "held";
}

/** The included destinations that execution refines — the ordinary postings AND the corrections. */
const ACCEPTANCE_EXECUTED_DESTINATIONS: AcceptanceDestination[] = [
  ...ACCEPTANCE_PLANNED_DESTINATIONS,
  "included_correction",
];

/**
 * Refine an included destination with the row's actual execution result. A terminal batch can contain
 * included rows that were skipped because another batch already executed their evidence; those rows
 * must never inherit "was posted by this batch" wording or enter its posted amount.
 *
 * A CORRECTION's expected result is `reversed`, not `posted`: both execution RPCs write `reversed` for
 * a row that names a corrected record, because the row reversed a journal as well as posting one.
 * `reversed` is therefore the only result that keeps a correction in its own group — a `posted`,
 * `pending` or `failed` correction is a result this build does not expect from the executor, so it
 * falls to `execution_unsettled` and claims nothing rather than being read as a completed correction.
 */
export function reportedDestinationOf(
  row: AcceptanceRow,
  phase: AcceptancePhase,
): AcceptanceDestination {
  const destination = destinationOf(row);
  if (!ACCEPTANCE_EXECUTED_DESTINATIONS.includes(destination)) return destination;
  if (phase === "planned") return destination;
  if (destination === "included_correction") {
    if (row.execution_result === "skipped") return "execution_skipped";
    // Holds for all three settled/unsettled phases alike: `reversed` is the executor's own record that
    // this correction ran. In `reverted` the phase copy adds that the batch then rolled back.
    if (row.execution_result === "reversed") return destination;
    return "execution_unsettled";
  }
  if (row.execution_result === "skipped") return "execution_skipped";
  if (phase === "executed" && row.execution_result !== "posted") return "execution_unsettled";
  if (phase === "reverted" && row.execution_result !== "reversed") return "execution_unsettled";
  if (
    phase === "unsettled" &&
    row.execution_result !== "posted" &&
    row.execution_result !== "reversed"
  ) {
    return "execution_unsettled";
  }
  return destination;
}

/**
 * One total group. `rowCount` counts every row in the group; `amount` sums ONLY the rows that
 * actually carry a source amount and reports the rest as `unknownCount` — a row with no recorded
 * amount is never counted as zero.
 */
export interface AcceptanceTotal {
  key: string;
  label: string;
  rowCount: number;
  withSourceAmount: number;
  amount: DecimalSummary;
}

export interface AcceptanceQualityCounts {
  /** Rows with no review decision at all yet. */
  unresolved: number;
  /** Reviewed but deliberately held back. */
  held: number;
  rejected: number;
  /** Evidence flagged as carrying a source date that is not a real calendar date. */
  invalidDate: number;
  /** Rows classified as an amount correction (they must name the production record they correct). */
  correctionCandidates: number;
  /** Rows that actually name a corrected expense/sale. */
  correctionLinked: number;
  /**
   * Correction candidates that do NOT yet name their target. Kept explicit because it is the exact
   * gap that blocks a truthful acceptance of a correction row.
   */
  correctionUnlinked: number;
  /** Rows whose evidence records no source amount (production orphans, and any unamounted row). */
  missingSourceAmount: number;
  /** Rows whose evidence row did not come back at all — always 0 in a healthy read, never hidden. */
  missingEvidence: number;
  /**
   * Frozen rows carrying no `payload_hash`. The freeze RPC always writes one, so a non-zero count
   * means the freeze bookkeeping is inconsistent and the batch is not safely acceptable.
   */
  frozenWithoutPayloadHash: number;
}

export interface AcceptanceReadiness {
  decided: number;
  undecided: number;
  allDecided: boolean;
  frozen: number;
  notFrozen: number;
  allFrozen: boolean;
  executed: number;
  notExecuted: number;
}

export interface AcceptanceReport {
  rowCount: number;
  /** The batch's lifecycle phase — every posting label/figure below is worded for exactly this. */
  phase: AcceptancePhase;
  copy: AcceptancePhaseCopy;
  counts: RowStateCounts;
  readiness: AcceptanceReadiness;
  byClassification: AcceptanceTotal[];
  /** Included-to-expenses / included-to-sales / held / rejected / undecided — an exact partition. */
  byDestination: AcceptanceTotal[];
  /** The same rows re-grouped by calendar period and by workbook sheet, for dual-run preparation. */
  controlTotals: AcceptanceControlTotals;
  /**
   * The ORDINARY-ADDITION posting rows, summed. Never includes held/rejected/undecided — and never an
   * amount correction, whose source amount is a replacement for a reversed record and would overstate
   * this figure by the reversed amount.
   */
  plannedPostingTotal: DecimalSummary;
  plannedPostingRowCount: number;
  /**
   * The amount-correction rows in the `included_correction` group, summed — the GROSS REPLACEMENT
   * source amount only.
   *
   * NOT a net ledger effect and not a P&L figure. Each correction's net effect is `replacement −
   * reversed`, computable only from the corrected record itself, which this report never reads; and
   * these rows may span owner drawings, capital spend, operating expenses and sales at once, which
   * CLAUDE.md #6 forbids adding into any one claimed result. The report states both, unconditionally
   * (ACCEPTANCE_CORRECTION_CAVEAT_AR).
   *
   * Exactly the rows of the `included_correction` destination group, so the figure and the group's row
   * in the destination table always agree.
   */
  correctionReplacementTotal: DecimalSummary;
  correctionRowCount: number;
  /** Every row's source amount, whatever its destination — the batch-wide evidence total. */
  sourceTotal: DecimalSummary;
  quality: AcceptanceQualityCounts;
}

/** `posted` and `reversed` are the only two results that represent a real money action. */
const EXECUTED_RESULTS = new Set(["posted", "reversed"]);

function sourceAmountsOf(rows: AcceptanceRow[]): (string | null)[] {
  return rows.map((row) => row.evidence?.source_amount ?? null);
}

function totalFor(key: string, label: string, rows: AcceptanceRow[]): AcceptanceTotal {
  const amount = sumDecimals(sourceAmountsOf(rows));
  return {
    key,
    label,
    rowCount: rows.length,
    withSourceAmount: amount.knownCount,
    amount,
  };
}

// ── Source control totals: the SAME rows, re-grouped by calendar period and by workbook sheet. ─────
//
// WHY. Preparing a dual run means comparing this batch against the source workbook one period and one
// sheet at a time. Both breakdowns are computed from the rows this one snapshot ALREADY loaded — no
// extra read, no stored figure, no decision taken on any row.
//
// WHAT A PERIOD KEY IS, EXACTLY. `YYYY-MM` sliced from `evidence.source_date_parsed` — the `date`
// column the staging tool wrote — and ONLY when `invalid_calendar_quality_flag` is false AND the
// recorded value is a real calendar day. `source_date_text` is the raw workbook cell; it is NEVER
// parsed here, because inventing a date from free text is precisely the fabrication CLAUDE.md #1
// forbids, and the flag exists because the staging tool already found some of those cells unreadable.
//
// WHAT IT IS NOT. A calendar month is not a fiscal period, and these totals are not the workbook's
// own totals. Mapping these buckets onto the accounting periods a dual run is filed against — and
// choosing which of them to run — remains the accountant's decision. The report says so
// unconditionally (ACCEPTANCE_CONTROL_TOTALS_CAVEAT_AR).

/** Printed above the breakdowns, always — never conditional on what the data happens to contain. */
export const ACCEPTANCE_CONTROL_TOTALS_CAVEAT_AR =
  "مجموعات الفترة أدناه تقويمية بحتة: مفتاح كل مجموعة (YYYY-MM) مأخوذ من تاريخ المصدر المُحلَّل " +
  "المسجَّل على الدليل — وهو العمود «تاريخ المصدر (مُحلَّل)» نفسه في ملف CSV — ولا يُستنتج أبدًا من " +
  "نص التاريخ الخام. الشهر التقويمي ليس فترة محاسبية: ربط هذه المجموعات بالفترات المالية، واختيار " +
  "ما يجري عليه التشغيل المزدوج وترتيبه، قرار المحاسب وحده؛ لا يقرّره هذا التقرير ولا يخزّنه النظام. " +
  "وهذه إعادة تجميع لصفوف هذه القراءة نفسها فقط، ولا تدّعي مطابقة أي إجمالي في الدفتر المصدر.";

/** The three fixed groups holding every row whose calendar period cannot be read. */
export type AcceptanceUndatedGroup = "invalid_source_date" | "no_source_date" | "no_evidence";

/**
 * Fixed order, and all three are ALWAYS present — an empty group is itself a printable fact ("no row
 * carries an unreadable source date"), and merging any two would hide one data problem behind
 * another: a flagged-invalid date, a row that records no date at all, and a row whose evidence did
 * not come back are three different reasons, with three different next steps.
 */
export const ACCEPTANCE_UNDATED_ORDER: AcceptanceUndatedGroup[] = [
  "invalid_source_date",
  "no_source_date",
  "no_evidence",
];

const ACCEPTANCE_UNDATED_AR: Record<AcceptanceUndatedGroup, string> = {
  invalid_source_date: "بلا فترة — تاريخ المصدر ليس يومًا تقويميًا صالحًا",
  no_source_date: "بلا فترة — لا تاريخ مصدر مسجَّل (صفوف لقطة الإنتاج وما لا يحمل تاريخًا)",
  no_evidence: "بلا فترة — لا دليل مقروء لهذا الصف",
};

/** The two fixed groups holding every row that carries no readable workbook sheet name. */
export type AcceptanceSheetFallback = "no_sheet_name" | "no_evidence";

/** Fixed order, always present, always AFTER the named sheets. */
export const ACCEPTANCE_SHEET_FALLBACK_ORDER: AcceptanceSheetFallback[] = [
  "no_sheet_name",
  "no_evidence",
];

const ACCEPTANCE_SHEET_FALLBACK_AR: Record<AcceptanceSheetFallback, string> = {
  no_sheet_name: "بلا اسم ورقة مسجَّل (صفوف لقطة الإنتاج وما لا يحمل ورقة)",
  no_evidence: "بلا دليل مقروء لهذا الصف",
};

/** Which calendar bucket one row falls in. Exactly one, for every row, always. */
export type AcceptancePeriodBucket =
  | { kind: "period"; period: string; year: string }
  | { kind: "undated"; group: AcceptanceUndatedGroup };

/** Which sheet bucket one row falls in. Exactly one, for every row, always. */
export type AcceptanceSheetBucket =
  | { kind: "sheet"; sheet: string }
  | { kind: "fallback"; group: AcceptanceSheetFallback };

/**
 * The calendar bucket of one row, checked in the only order that keeps each reason distinct:
 * no readable evidence at all, then a date the staging tool itself flagged as not a calendar date,
 * then no recorded date, then a recorded value that is not a real calendar day (2026-02-30 and
 * "not a date" alike). Only what survives all four yields a `YYYY-MM` key.
 */
export function acceptancePeriodBucket(row: AcceptanceRow): AcceptancePeriodBucket {
  const ev = row.evidence;
  if (!ev) return { kind: "undated", group: "no_evidence" };
  if (ev.invalid_calendar_quality_flag === true) {
    return { kind: "undated", group: "invalid_source_date" };
  }
  const parsed = ev.source_date_parsed;
  if (parsed === null || parsed.trim() === "") return { kind: "undated", group: "no_source_date" };
  // The column is a `date`, so this can only fail on a damaged payload — which is reported as an
  // unreadable date, never quietly re-read as "no date recorded" or guessed from source_date_text.
  if (!isCalendarDate(parsed)) return { kind: "undated", group: "invalid_source_date" };
  return { kind: "period", period: parsed.slice(0, 7), year: parsed.slice(0, 4) };
}

/**
 * Arabic-Indic (٠-٩, U+0660..U+0669) and Persian/Urdu (۰-۹, U+06F0..U+06F9) digits, mapped to ASCII
 * for COMPARISON ONLY. Nothing displayed, exported, or hashed is ever rewritten by this.
 */
const AR_INDIC_DIGITS = /[٠-٩۰-۹]/g;

function toAsciiDigits(text: string): string {
  return text.replace(AR_INDIC_DIGITS, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code - (code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

/**
 * Sheet-name order for THIS breakdown only.
 *
 * A workbook written in Arabic numbers («ورقة ١٠») must sort after «ورقة ٢», exactly as «ورقة 10»
 * sorts after «ورقة 2». `compareLocatorText` compares digit runs by value, but only recognises ASCII
 * digits — and it is the comparator the signed row order and the CSV annex depend on, so it is left
 * exactly as it is. This wrapper normalises the digit SCRIPT first, then defers to it.
 *
 * Two different names that normalise to the same text («ورقة ٢» and «ورقة 2») are still two recorded
 * sheets: they fall back to the raw comparator, which is a total order, so their relative position is
 * deterministic and reload-stable rather than dependent on the input order.
 */
export function compareControlSheetNames(a: string, b: string): number {
  if (a === b) return 0;
  const normalised = compareLocatorText(toAsciiDigits(a), toAsciiDigits(b));
  return normalised !== 0 ? normalised : compareLocatorText(a, b);
}

/**
 * The sheet bucket of one row. The recorded name is used VERBATIM (two names differing only in
 * spacing are two recorded names, and merging them would be a claim about the workbook); a blank or
 * absent one falls to a fixed group rather than dropping the row from the breakdown.
 */
export function acceptanceSheetBucket(row: AcceptanceRow): AcceptanceSheetBucket {
  const ev = row.evidence;
  if (!ev) return { kind: "fallback", group: "no_evidence" };
  const sheet = ev.sheet_name;
  if (sheet === null || sheet.trim() === "") return { kind: "fallback", group: "no_sheet_name" };
  return { kind: "sheet", sheet };
}

/**
 * One control-total group: the same three figures every other total on this report carries, plus the
 * part of the amount whose REPORTED destination is a posting — the one subtotal a dual run compares
 * against the books rather than against the workbook.
 */
export interface AcceptanceControlTotal extends AcceptanceTotal {
  /** Rows in this group with NO recorded source amount. Never counted as zero (== amount.unknownCount). */
  unknownCount: number;
  /** Rows in this group whose reported destination is one of the two ORDINARY posting groups. */
  postingRowCount: number;
  /**
   * Their source amount. Held/rejected/undecided/skipped/unsettled rows are never inside it — and
   * neither are amount corrections, whose source amount is a replacement for a reversed record rather
   * than the amount the books move by (see `included_correction`). A correction's amount is still
   * inside this group's `amount` (the source total), which partitions the whole batch.
   */
  postingAmount: DecimalSummary;
}

/** One calendar year: its months in ascending order, and the year's own subtotal (which is labelled). */
export interface AcceptanceControlYear {
  key: string;
  /** Ascending `YYYY-MM`. */
  periods: AcceptanceControlTotal[];
  subtotal: AcceptanceControlTotal;
}

export interface AcceptanceControlTotals {
  /** Ascending calendar years, each with its ascending months. */
  years: AcceptanceControlYear[];
  /** The three fixed non-period groups, in ACCEPTANCE_UNDATED_ORDER, always all three. */
  undated: AcceptanceControlTotal[];
  /** Named sheets in `compareControlSheetNames` order, then the two fixed fallbacks — always both. */
  sheets: AcceptanceControlTotal[];
  /**
   * Every row of the batch, exactly once. Both breakdowns partition the SAME rows, so this single
   * footer closes both of them — and its `amount` is the report's own `sourceTotal`.
   */
  total: AcceptanceControlTotal;
}

function controlTotalFor(
  key: string,
  label: string,
  rows: AcceptanceRow[],
  phase: AcceptancePhase,
): AcceptanceControlTotal {
  const base = totalFor(key, label, rows);
  const posting = rows.filter((row) =>
    ACCEPTANCE_PLANNED_DESTINATIONS.includes(reportedDestinationOf(row, phase)),
  );
  return {
    ...base,
    unknownCount: base.amount.unknownCount,
    postingRowCount: posting.length,
    postingAmount: sumDecimals(sourceAmountsOf(posting)),
  };
}

/** Append `row` to its group, creating the group on first sight. */
function collect<K>(groups: Map<K, AcceptanceRow[]>, key: K, row: AcceptanceRow): void {
  const bucket = groups.get(key);
  if (bucket) bucket.push(row);
  else groups.set(key, [row]);
}

/**
 * The two breakdowns, both exact partitions of the same rows.
 *
 * Ordering is deterministic end to end: `YYYY-MM` and `YYYY` are fixed-width, so a plain string
 * compare IS calendar order; sheets use the report's own natural compare, widened to Arabic-Indic and
 * Persian digits (compareControlSheetNames), so «ورقة ١٠» follows «ورقة ٢»; and every fixed group
 * keeps its declared position whether or not it holds a row. Two reads of the same rows therefore
 * print identically.
 */
export function buildAcceptanceControlTotals(
  rows: AcceptanceRow[],
  phase: AcceptancePhase,
): AcceptanceControlTotals {
  const periodRows = new Map<string, AcceptanceRow[]>();
  const undatedRows = new Map<AcceptanceUndatedGroup, AcceptanceRow[]>();
  const sheetRows = new Map<string, AcceptanceRow[]>();
  const fallbackRows = new Map<AcceptanceSheetFallback, AcceptanceRow[]>();

  // ONE pass, TWO placements per row: every row lands in exactly one period bucket and exactly one
  // sheet bucket, because both bucket functions are total (every branch returns a group).
  for (const row of rows) {
    const period = acceptancePeriodBucket(row);
    if (period.kind === "period") collect(periodRows, period.period, row);
    else collect(undatedRows, period.group, row);

    const sheet = acceptanceSheetBucket(row);
    if (sheet.kind === "sheet") collect(sheetRows, sheet.sheet, row);
    else collect(fallbackRows, sheet.group, row);
  }

  const years = new Map<string, string[]>();
  for (const period of [...periodRows.keys()].sort()) {
    const year = period.slice(0, 4);
    const months = years.get(year);
    if (months) months.push(period);
    else years.set(year, [period]);
  }

  return {
    // The years map was filled from already-sorted period keys, so its insertion order IS calendar
    // order — sorted again here so the guarantee does not depend on that.
    years: [...years.keys()].sort().map((year) => {
      const periods = years.get(year) ?? [];
      return {
        key: `year:${year}`,
        periods: periods.map((period) =>
          controlTotalFor(`period:${period}`, period, periodRows.get(period) ?? [], phase),
        ),
        subtotal: controlTotalFor(
          `year-subtotal:${year}`,
          `إجمالي سنة ${year}`,
          periods.flatMap((period) => periodRows.get(period) ?? []),
          phase,
        ),
      };
    }),
    undated: ACCEPTANCE_UNDATED_ORDER.map((group) =>
      controlTotalFor(
        `undated:${group}`,
        ACCEPTANCE_UNDATED_AR[group],
        undatedRows.get(group) ?? [],
        phase,
      ),
    ),
    sheets: [
      ...[...sheetRows.keys()]
        .sort(compareControlSheetNames)
        .map((sheet) => controlTotalFor(`sheet:${sheet}`, sheet, sheetRows.get(sheet) ?? [], phase)),
      ...ACCEPTANCE_SHEET_FALLBACK_ORDER.map((group) =>
        controlTotalFor(
          `sheet-fallback:${group}`,
          ACCEPTANCE_SHEET_FALLBACK_AR[group],
          fallbackRows.get(group) ?? [],
          phase,
        ),
      ),
    ],
    total: controlTotalFor("all", "الإجمالي — كل صفوف الدفعة", rows, phase),
  };
}

/**
 * Summarise a WHOLE batch (every row, already loaded and bounded) into the acceptance figures.
 *
 * `frozen` and `executed` deliberately override what summarizeRowStates derives from `review_state`:
 * an included row moves to review_state='frozen', but a held/rejected row keeps its state with
 * frozen=true, and "executed" is true only for a row whose execution actually posted or reversed.
 * Counting the columns directly is what makes these numbers match the batch page exactly.
 */
export function buildAcceptanceReport(
  rows: AcceptanceRow[],
  phase: AcceptancePhase,
): AcceptanceReport {
  const destinationLabels = acceptanceDestinationLabels(phase);
  const counts: RowStateCounts = {
    ...summarizeRowStates(rows),
    frozen: rows.filter((row) => row.frozen === true).length,
    executed: rows.filter((row) => {
      const destination = reportedDestinationOf(row, phase);
      if (destination === "included_correction") {
        return row.execution_result === "reversed";
      }
      return (
        ACCEPTANCE_PLANNED_DESTINATIONS.includes(destination) &&
        EXECUTED_RESULTS.has(row.execution_result)
      );
    }).length,
  };

  const seenClassifications = new Set(rows.map((row) => row.evidence?.classification ?? ""));
  const extraClassifications = [...seenClassifications]
    .filter(
      (value) => value !== "" && !ACCEPTANCE_CLASSIFICATION_ORDER.includes(value as Classification),
    )
    .sort();
  // Unclassifiable rows (no evidence at all) still get a group, so no row can vanish from the totals.
  const unknownGroup = seenClassifications.has("") ? [""] : [];

  const byClassification = [...ACCEPTANCE_CLASSIFICATION_ORDER, ...extraClassifications, ...unknownGroup].map(
    (classification) =>
      totalFor(
        classification || "unclassified",
        CLASSIFICATION_AR[classification as Classification] ?? (classification || "بدون تصنيف مقروء"),
        rows.filter((row) => (row.evidence?.classification ?? "") === classification),
      ),
  );

  const reportedDestinations = rows.map((row) => reportedDestinationOf(row, phase));
  const destinations = [
    ...ACCEPTANCE_DESTINATION_ORDER.slice(0, 2),
    // Shown right after the two ordinary posting groups it is deliberately kept out of, so the reason
    // the posting total excludes it is visible in the same table.
    ...(reportedDestinations.includes("included_correction")
      ? (["included_correction"] as AcceptanceDestination[])
      : []),
    ...(reportedDestinations.includes("correction_invalid")
      ? (["correction_invalid"] as AcceptanceDestination[])
      : []),
    ...(reportedDestinations.includes("execution_skipped")
      ? (["execution_skipped"] as AcceptanceDestination[])
      : []),
    ...(reportedDestinations.includes("execution_unsettled")
      ? (["execution_unsettled"] as AcceptanceDestination[])
      : []),
    ...ACCEPTANCE_DESTINATION_ORDER.slice(2),
    // Constraint reconciliation_batch_rows_target_required makes this impossible in the DB; it is
    // still shown when it happens rather than dropped, so the groups always add up to the batch.
    ...(rows.some((row) => destinationOf(row) === "included_no_target")
      ? (["included_no_target"] as AcceptanceDestination[])
      : []),
  ];
  const byDestination = destinations.map((destination) =>
    totalFor(
      destination,
      destinationLabels[destination],
      rows.filter((row) => reportedDestinationOf(row, phase) === destination),
    ),
  );

  const plannedRows = rows.filter((row) =>
    ACCEPTANCE_PLANNED_DESTINATIONS.includes(reportedDestinationOf(row, phase)),
  );
  // Exactly the rows the `included_correction` group prints, so the two figures can never disagree.
  const correctionRows = rows.filter(
    (row) => reportedDestinationOf(row, phase) === "included_correction",
  );
  const sourceTotal = sumDecimals(sourceAmountsOf(rows));
  const correctionCandidates = rows.filter(
    (row) => row.evidence?.classification === "amount_correction_candidate",
  );
  const isLinked = (row: AcceptanceRow) =>
    row.corrects_expense_id !== null || row.corrects_sale_id !== null;

  return {
    rowCount: rows.length,
    phase,
    copy: ACCEPTANCE_PHASE_COPY[phase],
    counts,
    readiness: {
      decided: counts.decided,
      undecided: counts.unreviewed,
      allDecided: counts.allDecided,
      frozen: counts.frozen,
      notFrozen: counts.total - counts.frozen,
      allFrozen: counts.total > 0 && counts.frozen === counts.total,
      executed: counts.executed,
      notExecuted: counts.total - counts.executed,
    },
    byClassification,
    byDestination,
    controlTotals: buildAcceptanceControlTotals(rows, phase),
    plannedPostingTotal: sumDecimals(sourceAmountsOf(plannedRows)),
    plannedPostingRowCount: plannedRows.length,
    correctionReplacementTotal: sumDecimals(sourceAmountsOf(correctionRows)),
    correctionRowCount: correctionRows.length,
    sourceTotal,
    quality: {
      unresolved: counts.unreviewed,
      held: counts.held,
      rejected: counts.rejected,
      invalidDate: rows.filter((row) => row.evidence?.invalid_calendar_quality_flag === true).length,
      correctionCandidates: correctionCandidates.length,
      correctionLinked: rows.filter(isLinked).length,
      correctionUnlinked: correctionCandidates.filter((row) => !isLinked(row)).length,
      missingSourceAmount: sourceTotal.unknownCount,
      missingEvidence: rows.filter((row) => !row.evidence).length,
      frozenWithoutPayloadHash: rows.filter((row) => row.frozen === true && !row.payload_hash).length,
    },
  };
}

// ── Batch-level provenance: the workbook + tool hashes, exactly as recorded (or "not recorded"). ────

const SHA256_RE = /^[0-9a-f]{64}$/;

/** A displayed hash line. `value === null` means "not recorded" — never a placeholder or a guess. */
export interface AcceptanceHashLine {
  key: string;
  label: string;
  value: string | null;
}

export interface AcceptanceStagedCounts {
  evidenceItemCount: number;
  batchRowCount: number;
}

function hexOrNull(value: unknown): string | null {
  return typeof value === "string" && SHA256_RE.test(value.trim()) ? value.trim() : null;
}

function summaryObject(summary: unknown): Record<string, unknown> {
  return summary && typeof summary === "object" && !Array.isArray(summary)
    ? (summary as Record<string, unknown>)
    : {};
}

/**
 * The four provenance hashes of a batch: the source workbook (a column on the batch), and the three
 * tool hashes the staging RPC recorded in `result_summary` (`staging_manifest_sha256` and
 * `tool_metadata.{production_snapshot_sha256, exception_evidence_sha256}`).
 *
 * NOTE — executing or rolling back a batch REPLACES `result_summary` with the execution verdict, so
 * the tool hashes are legitimately absent afterwards. They are reported as not recorded; they are
 * never reconstructed, and a value that is not a 64-char lowercase hex digest is treated as absent
 * rather than echoed into a signed document.
 */
export function acceptanceHashLines(batch: {
  source_workbook_sha256: string | null;
  result_summary: unknown;
}): AcceptanceHashLine[] {
  const summary = summaryObject(batch.result_summary);
  const tool = summaryObject(summary.tool_metadata);
  return [
    { key: "source_workbook_sha256", label: "بصمة الدفتر المصدر", value: hexOrNull(batch.source_workbook_sha256) },
    { key: "staging_manifest_sha256", label: "بصمة بيان التجهيز", value: hexOrNull(summary.staging_manifest_sha256) },
    {
      key: "production_snapshot_sha256",
      label: "بصمة لقطة الإنتاج",
      value: hexOrNull(tool.production_snapshot_sha256),
    },
    {
      key: "exception_evidence_sha256",
      label: "بصمة أدلة الاستثناءات",
      value: hexOrNull(tool.exception_evidence_sha256),
    },
  ];
}

/**
 * The staging counts are one of three states, and conflating two of them is how an unverifiable batch
 * came to look verified:
 *   • `absent`    — NEITHER key is present AND the batch has an exact, status-matched terminal
 *                   execution/failure/rollback verdict. Nothing can be cross-checked, and the report
 *                   says exactly that.
 *   • `recorded`  — both keys present and readable. They MUST match what is stored, or the report is
 *                   refused.
 *   • `malformed` — one key present without the other, or a value that is not a non-negative safe
 *                   integer. This is NOT "absent": it means the batch's own provenance record is
 *                   damaged, which is a refusal, never a silently skipped check.
 */
export type AcceptanceStagedCountsResult =
  | { kind: "recorded"; counts: AcceptanceStagedCounts }
  | { kind: "absent" }
  | { kind: "malformed" };

/** Postgres wrote these with ::int, so anything outside a 32-bit non-negative integer is damage. */
const MAX_STAGED_COUNT = 2_147_483_647;

function stagedCount(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_STAGED_COUNT
    ? value
    : null;
}

function hasExactKeys(source: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(source).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isRequiredText(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function hasRecognizedTerminalSummary(status: string, source: Record<string, unknown>): boolean {
  if (status === "executed") {
    return (
      hasExactKeys(source, ["executed_rows", "skipped_rows"]) &&
      stagedCount(source.executed_rows) !== null &&
      stagedCount(source.skipped_rows) !== null
    );
  }
  if (status === "failed") {
    return (
      hasExactKeys(source, ["failure_code", "safe_locator"]) &&
      isRequiredText(source.failure_code) &&
      (source.safe_locator === null || isRequiredText(source.safe_locator))
    );
  }
  if (status === "rolled_back") {
    return (
      hasExactKeys(source, [
        "rolled_back_at",
        "rollback_reason",
        "reversed_journals",
        "reinstated_journals",
        "zero_value_rows",
        "ledger_rows_reversed",
        "rows_marked_reversed",
      ]) &&
      isRequiredText(source.rolled_back_at) &&
      isRequiredText(source.rollback_reason) &&
      [
        source.reversed_journals,
        source.reinstated_journals,
        source.zero_value_rows,
        source.ledger_rows_reversed,
        source.rows_marked_reversed,
      ].every((value) => stagedCount(value) !== null)
    );
  }
  return false;
}

export function acceptanceStagedCounts(
  status: string,
  summary: unknown,
): AcceptanceStagedCountsResult {
  const source = summaryObject(summary);
  const hasEvidence = Object.hasOwn(source, "evidence_item_count");
  const hasRows = Object.hasOwn(source, "batch_row_count");
  if (!hasEvidence && !hasRows) {
    return hasRecognizedTerminalSummary(status, source) ? { kind: "absent" } : { kind: "malformed" };
  }
  if (!["staged", "reviewed", "approved"].includes(status)) return { kind: "malformed" };
  // One without the other is a damaged record, not a partial one.
  if (!hasEvidence || !hasRows) return { kind: "malformed" };

  const evidenceItemCount = stagedCount(source.evidence_item_count);
  const batchRowCount = stagedCount(source.batch_row_count);
  if (evidenceItemCount === null || batchRowCount === null) return { kind: "malformed" };
  return { kind: "recorded", counts: { evidenceItemCount, batchRowCount } };
}

// ── Canonical serialisation of the batch's whole lifecycle record. ─────────────────────────────────
//
// `result_summary` carries the batch's ENTIRE provenance/outcome record — the staging manifest hash
// and tool hashes and per-dataset counts while staged, the executed/skipped row counts once executed,
// the rollback reason and reversal counts once rolled back. Binding only the four hashes and two
// counts into the acceptance digest left the rest unbound: a batch could be re-executed with a
// different verdict, and a report over the same rows would digest identically.
//
// The digest therefore covers the WHOLE structure, canonically:
//   • object keys are sorted, so a re-serialisation in a different key order is the same digest;
//   • array order is preserved, because order is meaning in an array;
//   • every scalar is TAGGED with its JSON type, so 1 / "1" / true / null can never collide, and an
//     object can never collide with the array of pairs that represents it.

type CanonicalValue = [string] | [string, unknown];

function canonicalValue(value: unknown): CanonicalValue {
  if (value === null) return ["z"];
  if (Array.isArray(value)) return ["a", value.map(canonicalValue)];
  switch (typeof value) {
    case "string":
      return ["s", value];
    case "boolean":
      return ["b", value];
    case "number":
      // String() is the shortest round-tripping form of the double the JSON parser produced.
      return Number.isFinite(value) ? ["n", String(value)] : ["x", String(value)];
    case "object":
      return [
        "o",
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((key) => [key, canonicalValue((value as Record<string, unknown>)[key])]),
      ];
    default:
      // undefined / function / symbol cannot come from JSON. Tagged rather than dropped, so nothing
      // ever falls out of the digest silently.
      return ["x", String(value)];
  }
}

/** The canonical text of any JSON-shaped value. Key order in, digest out, are independent. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

// ── The batch lifecycle outcome, rendered readably. ────────────────────────────────────────────────
//
// REDACTION (§2.7). `result_summary` may contain `safe_locator` — a ROW-LEVEL locator the execution
// RPC records on failure. Row-level identifiers must not appear in anything a user sees, least of all
// a printed document, so display works from an ALLOW-LIST: a key not on it is counted, never shown.
// The digest above still binds the whole structure, because a hash discloses nothing.

export interface AcceptanceOutcomeLine {
  key: string;
  label: string;
  value: string;
}

export interface AcceptanceOutcome {
  /** One line per displayable recorded field, in a fixed order. */
  lines: AcceptanceOutcomeLine[];
  /** Fields present in the record but deliberately not displayed (row-level / unrecognised). */
  withheldCount: number;
  /** True when `result_summary` holds nothing at all (null, or replaced mid-execution). */
  empty: boolean;
}

/** Only these keys are ever rendered. `safe_locator` is deliberately absent. */
const ACCEPTANCE_OUTCOME_LABELS_AR: Record<string, string> = {
  evidence_item_count: "عدد الأدلة عند التجهيز",
  batch_row_count: "عدد الصفوف عند التجهيز",
  matched_invalid_calendar_quality_flag_count: "تواريخ مصدر غير صالحة عند التجهيز",
  staging_manifest_sha256: "بصمة بيان التجهيز",
  executed_rows: "صفوف نُفِّذت",
  skipped_rows: "صفوف تُجووزت",
  failure_code: "رمز سبب الفشل",
  rolled_back_at: "تاريخ التراجع",
  rollback_reason: "سبب التراجع",
  reversed_journals: "قيود عُكِست",
  reinstated_journals: "قيود أُعيدت",
  zero_value_rows: "صفوف بقيمة صفرية",
  ledger_rows_reversed: "سطور سجل التنفيذ المعكوسة",
  rows_marked_reversed: "صفوف وُسِمت معكوسة",
};

/** The display order — a fixed order so two reads of the same batch print identically. */
const ACCEPTANCE_OUTCOME_ORDER = Object.keys(ACCEPTANCE_OUTCOME_LABELS_AR);

/** Scalars only: an object/array value is structure, not a figure, and is withheld rather than dumped. */
function outcomeScalar(value: unknown): string | null {
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number") return Number.isFinite(value) ? num(value) : null;
  if (typeof value === "boolean") return value ? YES_AR : NO_AR;
  return null;
}

/**
 * What the batch's own record says happened to it — the readable half of the provenance the digest
 * binds. Never invents a field: only what `result_summary` actually holds is shown.
 */
export function acceptanceOutcome(summary: unknown): AcceptanceOutcome {
  const source = summaryObject(summary);
  const keys = Object.keys(source);
  const lines: AcceptanceOutcomeLine[] = [];
  for (const key of ACCEPTANCE_OUTCOME_ORDER) {
    if (!Object.hasOwn(source, key)) continue;
    const value = outcomeScalar(source[key]);
    if (value === null) continue;
    lines.push({ key, label: ACCEPTANCE_OUTCOME_LABELS_AR[key], value });
  }
  return {
    lines,
    withheldCount: keys.length - lines.length,
    empty: keys.length === 0,
  };
}

// ── CSV annex: every row, in the same evidence-locator order the report is signed against. ──────────
//
// Serialised by lib/export-csv.ts `rowsToCsv` (UTF-8 BOM for Excel/Arabic, RFC-4180 quoting, and the
// `= + - @` formula-injection guard on string cells). Raw machine codes AND Arabic labels are both
// exported: the codes keep the annex joinable back to the batch, the labels keep it readable by the
// accountant who signs it. Amounts stay canonical decimal STRINGS — a spreadsheet still reads them as
// numbers, but no digit is lost while generating the CSV bytes. Spreadsheet applications may apply
// their own numeric precision when opening those bytes.

const YES_AR = "نعم";
const NO_AR = "لا";

/** The digest column, repeated on every row so no line of the annex can be filed on its own. */
export const ACCEPTANCE_DIGEST_COLUMN: CsvColumn = {
  id: "acceptance_digest",
  header: "بصمة حزمة القبول (SHA-256)",
};

/** The content columns — everything the digest is computed over. */
export const ACCEPTANCE_CONTENT_COLUMNS: CsvColumn[] = [
  { id: "sequence", header: "الترتيب" },
  { id: "batch_row_id", header: "مُعرّف صف الدفعة" },
  { id: "evidence_item_id", header: "مُعرّف الدليل" },
  { id: "evidence_label", header: "وصف الدليل" },
  { id: "origin_kind", header: "نوع المصدر (رمز)" },
  { id: "origin_kind_ar", header: "نوع المصدر" },
  { id: "sheet_name", header: "ورقة الدفتر" },
  { id: "row_locator", header: "صف الدفتر" },
  { id: "snapshot_target_table", header: "جدول لقطة الإنتاج" },
  { id: "snapshot_target_id", header: "مُعرّف لقطة الإنتاج" },
  { id: "source_workbook_sha256", header: "بصمة الدفتر المصدر" },
  { id: "production_snapshot_sha256", header: "بصمة لقطة الإنتاج" },
  { id: "source_identity_fingerprint", header: "بصمة هوية المصدر" },
  { id: "classification", header: "التصنيف (رمز)" },
  { id: "classification_ar", header: "التصنيف" },
  { id: "source_amount", header: "مبلغ المصدر" },
  { id: "source_amount_recorded", header: "مبلغ مصدر مسجَّل" },
  { id: "source_date_text", header: "تاريخ المصدر (نص)" },
  { id: "source_date_parsed", header: "تاريخ المصدر (مُحلَّل)" },
  { id: "invalid_calendar_quality_flag", header: "تاريخ غير صالح" },
  { id: "review_state", header: "حالة المراجعة (رمز)" },
  { id: "review_state_ar", header: "حالة المراجعة" },
  { id: "disposition", header: "القرار (رمز)" },
  { id: "disposition_ar", header: "القرار" },
  { id: "reviewer_id", header: "مُعرّف المراجع" },
  { id: "reviewed_at", header: "تاريخ المراجعة" },
  { id: "review_reason", header: "سبب القرار" },
  { id: "target_table", header: "الوجهة (رمز)" },
  { id: "target_table_ar", header: "الوجهة" },
  { id: "destination", header: "مآل الصف (رمز)" },
  { id: "destination_ar", header: "مآل الصف" },
  // ── the reviewed expense payload: what an included expense row will post ──
  { id: "expense_category", header: "بند المصروف" },
  { id: "expense_description", header: "وصف المصروف" },
  { id: "expense_kind", header: "نوع المصروف (رمز)" },
  { id: "expense_kind_ar", header: "نوع المصروف" },
  { id: "expense_account_id", header: "مُعرّف الحساب" },
  { id: "expense_account_label", header: "الحساب" },
  { id: "expense_cost_center_id", header: "مُعرّف مركز التكلفة (مصروف)" },
  { id: "expense_cost_center_label", header: "مركز التكلفة (مصروف)" },
  { id: "expense_supplier_id", header: "مُعرّف المورّد" },
  { id: "expense_supplier_label", header: "المورّد" },
  { id: "expense_payment_decision", header: "قرار السداد (رمز)" },
  { id: "expense_payment_decision_ar", header: "قرار السداد" },
  // ── the reviewed sale payload: what an included sale row will post ──
  { id: "sale_crop", header: "المحصول" },
  { id: "sale_quantity", header: "الكمية" },
  { id: "sale_unit", header: "الوحدة" },
  { id: "sale_unit_price", header: "سعر الوحدة" },
  { id: "sale_recorded_total", header: "الإجمالي المُراجَع" },
  { id: "sale_buyer_id", header: "مُعرّف المشتري" },
  { id: "sale_buyer_label", header: "المشتري" },
  { id: "sale_cost_center_id", header: "مُعرّف مركز التكلفة (بيع)" },
  { id: "sale_cost_center_label", header: "مركز التكلفة (بيع)" },
  { id: "sale_farm_id", header: "مُعرّف المزرعة" },
  { id: "sale_farm_label", header: "المزرعة" },
  { id: "sale_sector_id", header: "مُعرّف القطاع" },
  { id: "sale_sector_label", header: "القطاع" },
  { id: "sale_hawsha_id", header: "مُعرّف الحوش" },
  { id: "sale_hawsha_label", header: "الحوش" },
  { id: "sale_season", header: "الموسم" },
  { id: "sale_delivery_date", header: "تاريخ التسليم" },
  { id: "sale_notes", header: "ملاحظات البيع" },
  { id: "sale_historical_date_decision", header: "قرار التاريخ التاريخي (رمز)" },
  { id: "sale_historical_date_decision_ar", header: "قرار التاريخ التاريخي" },
  { id: "sale_effective_date", header: "تاريخ السريان" },
  // ── correction targets and the freeze/execution bookkeeping ──
  { id: "corrects_expense_id", header: "يصحّح مصروفًا" },
  { id: "corrects_sale_id", header: "يصحّح بيعًا" },
  { id: "payload_hash", header: "بصمة الحمولة عند التجميد" },
  { id: "frozen", header: "مُجمَّد" },
  { id: "frozen_at", header: "تاريخ التجميد" },
  { id: "execution_result", header: "نتيجة التنفيذ (رمز)" },
  { id: "execution_result_ar", header: "نتيجة التنفيذ" },
  { id: "execution_error", header: "خطأ التنفيذ" },
];

/** The annex as downloaded: the package digest first, then the content columns. */
export const ACCEPTANCE_CSV_COLUMNS: CsvColumn[] = [
  ACCEPTANCE_DIGEST_COLUMN,
  ...ACCEPTANCE_CONTENT_COLUMNS,
];

function yesNo(value: boolean): string {
  return value ? YES_AR : NO_AR;
}

/** "1010 · النقدية بالخزينة" — both halves, or whichever one is readable, or empty. */
function codeNameLabel(ref: { code: string | null; name_ar?: string | null; name?: string | null } | null): string {
  if (!ref) return "";
  const name = ref.name_ar ?? ref.name ?? null;
  return [ref.code, name].filter((part) => part != null && part !== "").join(" · ");
}

/**
 * An exact decimal cell: the canonical decimal STRING, or "" when nothing was recorded. The CSV
 * bytes preserve every digit without a JS float conversion; a spreadsheet may still coerce long
 * numeric literals when opening the file. Empty means "not recorded", never zero — the paired
 * `*_recorded` column says so in words for the amount.
 */
function decimalCell(value: string | null | undefined): DecimalString | "" {
  return parseDecimal(value) ?? "";
}

/**
 * Every row as CSV content — WITHOUT the digest column, which is stamped by the package builder.
 * `phase` decides the wording of `destination_ar` exactly as it does on the page, so the annex and
 * the printed report never describe the same row in two different tenses.
 */
export function acceptanceCsvRows(rows: AcceptanceRow[], phase: AcceptancePhase): CsvRow[] {
  const destinationLabels = acceptanceDestinationLabels(phase);
  return orderByEvidenceLocator(rows).map((row, index) => {
    const ev = row.evidence;
    const sourceAmount = decimalCell(ev?.source_amount ?? null);
    const destination = reportedDestinationOf(row, phase);
    return {
      sequence: index + 1,
      batch_row_id: row.id,
      evidence_item_id: row.evidence_item_id,
      evidence_label: ev?.evidence_label ?? "",
      origin_kind: ev?.origin_kind ?? "",
      origin_kind_ar: ORIGIN_KIND_AR[(ev?.origin_kind ?? "") as OriginKind] ?? "",
      sheet_name: ev?.sheet_name ?? "",
      row_locator: ev?.row_locator ?? "",
      snapshot_target_table: ev?.snapshot_target_table ?? "",
      snapshot_target_id: ev?.snapshot_target_id ?? "",
      source_workbook_sha256: ev?.source_workbook_sha256 ?? "",
      production_snapshot_sha256: ev?.production_snapshot_sha256 ?? "",
      source_identity_fingerprint: ev?.source_identity_fingerprint ?? "",
      classification: ev?.classification ?? "",
      classification_ar: CLASSIFICATION_AR[(ev?.classification ?? "") as Classification] ?? "",
      source_amount: sourceAmount,
      source_amount_recorded: yesNo(sourceAmount !== ""),
      source_date_text: ev?.source_date_text ?? "",
      source_date_parsed: ev?.source_date_parsed ?? "",
      invalid_calendar_quality_flag: yesNo(ev?.invalid_calendar_quality_flag === true),
      review_state: row.review_state,
      review_state_ar: REVIEW_STATE_AR[row.review_state as ReviewState]?.label ?? "",
      disposition: row.disposition,
      disposition_ar: DISPOSITION_AR[row.disposition as Disposition] ?? "",
      reviewer_id: row.reviewer_id ?? "",
      reviewed_at: row.reviewed_at ?? "",
      review_reason: row.review_reason ?? "",
      target_table: row.target_table ?? "",
      target_table_ar: row.target_table
        ? (ACCEPTANCE_DATASET_AR[row.target_table as AcceptanceDataset] ?? "")
        : "",
      destination,
      destination_ar: destinationLabels[destination],
      expense_category: row.expense_category ?? "",
      expense_description: row.expense_description ?? "",
      expense_kind: row.expense_kind ?? "",
      expense_kind_ar: EXPENSE_KIND_AR[(row.expense_kind ?? "") as ExpenseKind] ?? "",
      expense_account_id: row.expense_account_id ?? "",
      expense_account_label: codeNameLabel(row.expense_account),
      expense_cost_center_id: row.expense_cost_center_id ?? "",
      expense_cost_center_label: codeNameLabel(row.expense_cost_center),
      expense_supplier_id: row.expense_supplier_id ?? "",
      expense_supplier_label: row.expense_supplier?.name ?? "",
      expense_payment_decision: row.expense_payment_decision ?? "",
      expense_payment_decision_ar:
        PAYMENT_DECISION_AR[(row.expense_payment_decision ?? "") as ExpensePaymentDecision] ?? "",
      sale_crop: row.sale_crop ?? "",
      sale_quantity: decimalCell(row.sale_quantity),
      sale_unit: row.sale_unit ?? "",
      sale_unit_price: decimalCell(row.sale_unit_price),
      sale_recorded_total: decimalCell(row.sale_recorded_total),
      sale_buyer_id: row.sale_buyer_id ?? "",
      sale_buyer_label: row.sale_buyer?.name ?? "",
      sale_cost_center_id: row.sale_cost_center_id ?? "",
      sale_cost_center_label: codeNameLabel(row.sale_cost_center),
      sale_farm_id: row.sale_farm_id ?? "",
      sale_farm_label: row.sale_farm?.name ?? "",
      sale_sector_id: row.sale_sector_id ?? "",
      sale_sector_label: row.sale_sector?.name ?? "",
      sale_hawsha_id: row.sale_hawsha_id ?? "",
      sale_hawsha_label: codeNameLabel(row.sale_hawsha),
      sale_season: row.sale_season ?? "",
      sale_delivery_date: row.sale_delivery_date ?? "",
      sale_notes: row.sale_notes ?? "",
      sale_historical_date_decision: row.sale_historical_date_decision ?? "",
      sale_historical_date_decision_ar:
        HISTORICAL_DATE_DECISION_AR[
          (row.sale_historical_date_decision ?? "") as SaleHistoricalDateDecision
        ] ?? "",
      sale_effective_date: row.sale_effective_date ?? "",
      corrects_expense_id: row.corrects_expense_id ?? "",
      corrects_sale_id: row.corrects_sale_id ?? "",
      payload_hash: row.payload_hash ?? "",
      frozen: yesNo(row.frozen === true),
      frozen_at: row.frozen_at ?? "",
      execution_result: row.execution_result,
      execution_result_ar: EXECUTION_RESULT_AR[row.execution_result as ExecutionResult] ?? "",
      execution_error: row.execution_error ?? "",
    };
  });
}

// ── The acceptance package: one snapshot, one digest, shared by the page and the annex. ─────────────

export const ACCEPTANCE_DIGEST_ALGORITHM = "SHA-256";

/**
 * Identifies HOW the digest is built. Bump it if the canonicalisation below ever changes, so an old
 * digest can never be mistaken for a new one computed a different way.
 */
export const ACCEPTANCE_DIGEST_VERSION = "farm-os.reconciliation-acceptance.v1";

/** How many leading hex characters go in the CSV filename (the full digest is inside the file). */
const DIGEST_SHORT_LENGTH = 12;

/**
 * The exact bytes the digest is taken over: a JSON array — arrays, so ORDER is part of the format
 * rather than an object-key-order assumption — holding the format version, the batch identity, its
 * COMPLETE lifecycle record, the content column ids, and every row's content cells in evidence-locator
 * order.
 *
 * The extracted hashes and staged counts stay as their own entries because they are what the page
 * PRINTS, and `result_summary_canonical` binds the whole structure they were extracted from — every
 * nested field, at any depth, including the ones the page deliberately does not display. Two reads
 * that differ anywhere inside that record therefore differ in digest, and re-serialising the same
 * record with its object keys in another order does not (see `canonicalJson`).
 *
 * Every other value is normalised to a string or null, so a cell can never hash differently because
 * the driver returned 1 instead of "1".
 */
export function acceptancePayloadDocument(
  batch: AcceptanceBatchIdentity,
  contentRows: CsvRow[],
): string {
  const columnIds = ACCEPTANCE_CONTENT_COLUMNS.map((column) => column.id);
  const staged = acceptanceStagedCounts(batch.status, batch.result_summary);
  return JSON.stringify([
    ACCEPTANCE_DIGEST_VERSION,
    [
      ["batch_id", batch.id],
      ["status", batch.status],
      ["source_label", cell(batch.source_label)],
      ["created_at", cell(batch.created_at)],
      ["created_by", cell(batch.created_by)],
      ["approved_at", cell(batch.approved_at)],
      ["approved_by", cell(batch.approved_by)],
      ...acceptanceHashLines(batch).map((hash) => [hash.key, hash.value] as const),
      ["staged_counts_state", staged.kind],
      [
        "staged_evidence_item_count",
        staged.kind === "recorded" ? String(staged.counts.evidenceItemCount) : null,
      ],
      [
        "staged_batch_row_count",
        staged.kind === "recorded" ? String(staged.counts.batchRowCount) : null,
      ],
      ["result_summary_canonical", canonicalJson(batch.result_summary ?? null)],
      ["row_count", String(contentRows.length)],
    ],
    columnIds,
    contentRows.map((row) => columnIds.map((id) => cell(row[id]))),
  ]);
}

function cell(value: string | number | null | undefined): string | null {
  return value == null ? null : String(value);
}

/** The whole acceptance package for one read: figures, annex rows, and their content digest. */
export interface AcceptancePackage {
  batch: AcceptanceBatchIdentity;
  /** The rows in evidence-locator order — the exact order the report and the annex both use. */
  rows: AcceptanceRow[];
  report: AcceptanceReport;
  hashes: AcceptanceHashLine[];
  staged: AcceptanceStagedCountsResult;
  /** The batch's own lifecycle record, rendered readably (row-level fields withheld). */
  outcome: AcceptanceOutcome;
  /** 64-char lowercase hex SHA-256 over `acceptancePayloadDocument`. */
  digest: string;
  /** The first characters of the digest, for the filename and for an at-a-glance comparison. */
  digestShort: string;
  /** Annex rows with the digest stamped into every one of them. */
  csvRows: CsvRow[];
  csvFilename: string;
}

/**
 * Build everything one report or annex request needs from its complete read.
 *
 * The page renders `report`/`digest`; the endpoint serialises `csvRows`. The requests are separate,
 * so the accountant must compare their digests. Equal digests prove equal captured content; a CSV
 * produced by a different read carries a different digest and does not belong to the signed report.
 */
export function buildAcceptancePackage(
  batch: AcceptanceBatchIdentity,
  rows: AcceptanceRow[],
): AcceptancePackage {
  // The batch's own status decides the tense of every posting label, on the page and in the annex
  // alike — derived here once so the two artifacts cannot disagree.
  const phase = acceptancePhase(batch.status);
  const ordered = orderByEvidenceLocator(rows);
  const contentRows = acceptanceCsvRows(ordered, phase);
  const digest = createHash("sha256")
    .update(acceptancePayloadDocument(batch, contentRows), "utf8")
    .digest("hex");
  return {
    batch,
    rows: ordered,
    report: buildAcceptanceReport(ordered, phase),
    hashes: acceptanceHashLines(batch),
    staged: acceptanceStagedCounts(batch.status, batch.result_summary),
    outcome: acceptanceOutcome(batch.result_summary),
    digest,
    digestShort: digest.slice(0, DIGEST_SHORT_LENGTH),
    csvRows: contentRows.map((row) => ({ [ACCEPTANCE_DIGEST_COLUMN.id]: digest, ...row })),
    csvFilename: acceptanceCsvFilename(batch.id, digest),
  };
}

/**
 * ASCII-only filename (no quotes, no CRLF) so it can never break the Content-Disposition header.
 * The digest is part of the name, so two downloads of a changed batch never overwrite each other in
 * the accountant's downloads folder and the mismatch is visible before the file is even opened.
 */
export function acceptanceCsvFilename(batchId: string, digest?: string): string {
  const safeId = batchId.replace(/[^0-9a-zA-Z-]/g, "");
  const safeDigest = (digest ?? "").replace(/[^0-9a-f]/g, "").slice(0, DIGEST_SHORT_LENGTH);
  const suffix = safeDigest ? `-${safeDigest}` : "";
  return `reconciliation-acceptance-${safeId}${suffix}.csv`;
}

// ── The printed acceptance assertion. ──────────────────────────────────────────────────────────────
//
// NOTHING here is stored anywhere in the system — there is no dual-run record, no control-total
// record and no signature record in the schema (see ACCEPTANCE_NO_DUAL_RUN_AR). Every field below is
// therefore a BLANK the signer fills in by hand on the printed copy. They are enumerated explicitly
// rather than left to a free-text "notes" box, because an acceptance that does not state the dual run,
// the source it was run against, the period, both control totals and the difference between them is
// not an acceptance — it is a signature on a summary.

export interface AcceptanceAssertionField {
  key: string;
  label: string;
  /** A one-line instruction: what the signer must write, and against what. */
  hint: string;
}

export const ACCEPTANCE_ASSERTION_FIELDS: AcceptanceAssertionField[] = [
  {
    key: "dual_run_completed",
    label: "التشغيل المزدوج: تم؟ (نعم / لا) وتاريخه",
    hint: "لا يُوقَّع هذا الإقرار إن لم يكن الجواب «نعم» بتاريخ محدَّد. النظام لا يسجّل هذه الواقعة.",
  },
  {
    key: "source_reference",
    label: "مرجع المصدر (اسم الدفتر/الملف ونسخته)",
    hint: "اكتب المرجع الذي جرت عليه المقارنة، وطابق بصمة الدفتر المصدر المطبوعة أعلاه.",
  },
  {
    key: "period",
    label: "الفترة المشمولة (من / إلى)",
    hint: "الفترة المحاسبية التي تغطيها المقارنة، لا تاريخ إصدار هذا التقرير.",
  },
  {
    key: "source_control_total",
    label: "إجمالي الرقابة من المصدر",
    hint: "الإجمالي المستخرج من الدفتر المصدر نفسه — لا يُنقل من هذه الورقة.",
  },
  {
    key: "system_control_total",
    label: "إجمالي الرقابة من النظام",
    hint: "الإجمالي المقابل من تقرير النظام بعد التشغيل المزدوج.",
  },
  {
    key: "difference",
    label: "الفرق بين الإجماليين",
    hint: "اكتب الفرق ولو كان صفرًا. فرق غير مفسَّر يمنع التوقيع.",
  },
  {
    key: "difference_explanation",
    label: "تفسير الفرق ومستنده",
    hint: "لكل فرق: سببه، ومستنده، ومن اعتمده. لا يُترك فارغًا ما لم يكن الفرق صفرًا.",
  },
  {
    key: "exception_outcome",
    label: "مآل الاستثناءات (عددها وما تقرَّر فيها)",
    hint: "كل صف بلا قرار أو بمؤشر جودة أعلاه يجب أن يُذكر مآله هنا صراحةً.",
  },
  {
    key: "accepted_outcome",
    label: "قرار القبول (مقبولة / مقبولة بتحفظات / غير مقبولة)",
    hint: "مع التحفظات إن وُجدت. «مقبولة بتحفظات» تتطلب ذكر كل تحفظ.",
  },
];

/** The two signatories, in order. Each signs name + signature + date on the printed copy. */
export const ACCEPTANCE_SIGNATORIES_AR = ["المحاسب", "المالك"];

/** The three hand-written lines every signatory fills. */
export const ACCEPTANCE_SIGNATURE_LINES_AR = ["الاسم", "التوقيع", "التاريخ"];

/** The prohibition printed above the blanks. Deliberately unconditional. */
export const ACCEPTANCE_ASSERTION_PROHIBITION_AR =
  "لا يُوقَّع هذا الإقرار قبل استيفاء كل خانة أدناه بخط اليد ومطابقة الأرقام: يجب أن يكون التشغيل " +
  "المزدوج قد تم فعلًا، وأن يُذكر مرجع المصدر والفترة، وأن يُكتب إجمالي الرقابة من المصدر وإجمالي " +
  "الرقابة من النظام والفرق بينهما مع تفسير كل فرق ومستنده، وأن يُذكر مآل كل استثناء. خانة فارغة " +
  "واحدة، أو فرق بلا تفسير، أو بصمة ملف CSV مخالفة للبصمة المطبوعة هنا — كلٌّ منها يمنع التوقيع. " +
  "لا يسجّل النظام أيًّا من هذه البيانات، فالنسخة الورقية الموقَّعة هي السجل الوحيد لها.";

/** The report route for a batch (the batch page links here; the page links back). */
export function acceptanceHref(batchId: string): string {
  return `/finance/reconciliation/${encodeURIComponent(batchId)}/acceptance`;
}

/** The CSV annex endpoint for a batch. */
export function acceptanceCsvHref(batchId: string): string {
  return `/api/finance/reconciliation/${encodeURIComponent(batchId)}/acceptance.csv`;
}
