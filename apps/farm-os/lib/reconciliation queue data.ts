import { isUuid } from "./reconciliation review";

export const RECONCILIATION_QUEUE_PAGE_VERSION = "farm-os.reconciliation-queue-page.v2";

export interface ReconciliationQueuePage {
  total: number;
  page: number;
  pageSize: number;
  counts: ReconciliationQueueCounts;
  rows: ReconciliationQueueRow[];
}

export interface ReconciliationQueueCounts {
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

type Label = { name: string };
type CodeLabel = { code: string; name_ar: string };
type HawshaLabel = { code: string; name: string };

export interface ReconciliationQueueRow {
  id: string;
  evidence_item_id: string;
  review_state: string;
  review_version: number;
  disposition: string;
  review_reason: string | null;
  target_table: string | null;
  frozen: boolean;
  execution_result: string;
  expense_category: string | null;
  expense_description: string | null;
  expense_kind: string | null;
  expense_account_id: string | null;
  expense_cost_center_id: string | null;
  expense_supplier_id: string | null;
  expense_payment_decision: string | null;
  sale_crop: string | null;
  sale_quantity: number | null;
  sale_unit: string | null;
  sale_unit_price: number | null;
  sale_recorded_total: number | null;
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
  corrects_expense_id: string | null;
  corrects_sale_id: string | null;
  expense_account: CodeLabel | null;
  expense_cost_center: CodeLabel | null;
  expense_supplier: Label | null;
  sale_buyer: Label | null;
  sale_cost_center: CodeLabel | null;
  sale_farm: Label | null;
  sale_sector: Label | null;
  sale_hawsha: HawshaLabel | null;
  correction_expense: { id: string; date: string | null; category: string; description: string | null; total: number | null } | null;
  correction_sale: { id: string; sale_date: string | null; crop: string; notes: string | null; total: number | null } | null;
  evidence: {
    id: string;
    origin_kind: string;
    sheet_name: string | null;
    row_locator: string | null;
    snapshot_target_table: string | null;
    snapshot_target_id: string | null;
    source_amount: number | null;
    source_date_text: string | null;
    source_date_parsed: string | null;
    classification: string;
    invalid_calendar_quality_flag: boolean;
    evidence_label: string | null;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, minimum: number): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= minimum;
}

const nullableString = (value: unknown): value is string | null => value === null || typeof value === "string";
const nullableNumber = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value));
const uuidOrNull = (value: unknown): value is string | null => value === null || isUuid(value);

function label(value: unknown): value is Label | null {
  return value === null || (isRecord(value) && typeof value.name === "string");
}

function codeLabel(value: unknown): value is CodeLabel | null {
  return value === null ||
    (isRecord(value) && typeof value.code === "string" && typeof value.name_ar === "string");
}

function validQueueRow(value: unknown): value is ReconciliationQueueRow {
  if (!isRecord(value)) return false;
  const row = value;
  const nullableStringKeys = [
    "review_reason", "target_table", "expense_category", "expense_description", "expense_kind",
    "expense_payment_decision", "sale_crop", "sale_unit", "sale_season", "sale_delivery_date",
    "sale_notes", "sale_historical_date_decision", "sale_effective_date",
  ];
  const nullableUuidKeys = [
    "expense_account_id", "expense_cost_center_id", "expense_supplier_id", "sale_buyer_id",
    "sale_cost_center_id", "sale_farm_id", "sale_sector_id", "sale_hawsha_id",
    "corrects_expense_id", "corrects_sale_id",
  ];
  const evidence = row.evidence;
  const reviewStates = ["unreviewed", "reviewed", "rejected", "frozen", "executed"];
  const dispositions = ["include", "hold"];
  const executionResults = ["pending", "posted", "skipped", "failed", "reversed"];
  const classifications = [
    "source_addition_candidate", "amount_correction_candidate", "production_orphan_candidate",
    "zero_value_source_placeholder", "ambiguous_identity_group",
  ];
  if (
    !isUuid(row.id) || !isUuid(row.evidence_item_id) ||
    typeof row.review_state !== "string" || !reviewStates.includes(row.review_state) ||
    !integer(row.review_version, 0) || typeof row.disposition !== "string" ||
    !dispositions.includes(row.disposition) || typeof row.frozen !== "boolean" ||
    typeof row.execution_result !== "string" || !executionResults.includes(row.execution_result) ||
    nullableStringKeys.some((key) => !nullableString(row[key])) ||
    nullableUuidKeys.some((key) => !uuidOrNull(row[key])) ||
    !nullableNumber(row.sale_quantity) || !nullableNumber(row.sale_unit_price) ||
    !nullableNumber(row.sale_recorded_total) || !codeLabel(row.expense_account) ||
    !codeLabel(row.expense_cost_center) || !label(row.expense_supplier) || !label(row.sale_buyer) ||
    !codeLabel(row.sale_cost_center) || !label(row.sale_farm) || !label(row.sale_sector) ||
    !(row.sale_hawsha === null || (isRecord(row.sale_hawsha) &&
      typeof row.sale_hawsha.code === "string" && typeof row.sale_hawsha.name === "string")) ||
    !isRecord(evidence) || !isUuid(evidence.id) || typeof evidence.origin_kind !== "string" ||
    !nullableString(evidence.sheet_name) || !nullableString(evidence.row_locator) ||
    !nullableString(evidence.snapshot_target_table) || !uuidOrNull(evidence.snapshot_target_id) ||
    !nullableNumber(evidence.source_amount) || !nullableString(evidence.source_date_text) ||
    !nullableString(evidence.source_date_parsed) || typeof evidence.classification !== "string" ||
    !classifications.includes(evidence.classification) ||
    typeof evidence.invalid_calendar_quality_flag !== "boolean" || !nullableString(evidence.evidence_label)
  ) return false;

  if (
    evidence.id !== row.evidence_item_id ||
    !(row.target_table === null || row.target_table === "expenses" || row.target_table === "sales") ||
    !["source_workbook_row", "production_snapshot_row"].includes(evidence.origin_kind)
  ) return false;

  const correctionExpense = row.correction_expense;
  if (!(correctionExpense === null || (isRecord(correctionExpense) && isUuid(correctionExpense.id) &&
    nullableString(correctionExpense.date) && typeof correctionExpense.category === "string" &&
    nullableString(correctionExpense.description) && nullableNumber(correctionExpense.total)))) return false;
  if ((correctionExpense?.id ?? null) !== row.corrects_expense_id) return false;
  const correctionSale = row.correction_sale;
  if (!(correctionSale === null || (isRecord(correctionSale) && isUuid(correctionSale.id) &&
    nullableString(correctionSale.sale_date) && typeof correctionSale.crop === "string" &&
    nullableString(correctionSale.notes) && nullableNumber(correctionSale.total)))) return false;
  return (correctionSale?.id ?? null) === row.corrects_sale_id;
}

/** Runtime boundary for the database page contract. Any drift refuses the review screen. */
export function parseReconciliationQueuePage(
  value: unknown,
  requestedPage: number,
  expectedPageSize: number,
): ReconciliationQueuePage {
  if (!isRecord(value) || value.version !== RECONCILIATION_QUEUE_PAGE_VERSION) {
    throw new Error("تعذّر التحقق من نسخة ترتيب صفوف التسوية. أوقف المراجعة وأعد تحميل الصفحة.");
  }
  if (value.status === "not_found") {
    throw new Error("دفعة التسوية غير موجودة أو لم تعد متاحة لهذه المؤسسة.");
  }
  if (value.status === "incomplete") {
    throw new Error("دفعة التسوية غير مكتملة الأدلة. أوقف المراجعة ولا تعتمد هذه الدفعة.");
  }
  if (value.status !== "ok") {
    throw new Error("تعذّر تحميل صفوف التسوية بترتيب موثوق.");
  }
  const rawCounts = value.counts;
  if (
    !integer(value.total, 0) ||
    !integer(value.page, 1) ||
    !integer(value.page_size, 1) ||
    value.page_size > 50 ||
    value.page_size !== expectedPageSize ||
    !isRecord(rawCounts) ||
    !Array.isArray(value.rows)
  ) {
    throw new Error("استجابة صفوف التسوية غير صالحة. أوقف المراجعة وأعد تحميل الصفحة.");
  }

  const total = value.total;
  const pageSize = value.page_size;
  const countKeys = ["total", "unreviewed", "included", "held", "rejected", "frozen", "executed"];
  if (countKeys.some((key) => !integer(rawCounts[key], 0))) {
    throw new Error("ملخص دفعة التسوية غير صالح. أوقف المراجعة وأعد تحميل الصفحة.");
  }
  const wholeTotal = rawCounts.total as number;
  const unreviewed = rawCounts.unreviewed as number;
  const included = rawCounts.included as number;
  const held = rawCounts.held as number;
  const rejected = rawCounts.rejected as number;
  const frozen = rawCounts.frozen as number;
  const executed = rawCounts.executed as number;
  if (
    unreviewed > wholeTotal || included > wholeTotal || held > wholeTotal ||
    rejected > wholeTotal || frozen > wholeTotal || executed > wholeTotal
  ) {
    throw new Error("ملخص دفعة التسوية لا يطابق العدد الكلي.");
  }
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const expectedPage = Math.min(Math.max(1, Math.floor(requestedPage)), pageCount);
  const expectedRows = Math.min(pageSize, Math.max(0, total - (value.page - 1) * pageSize));
  if (value.page !== expectedPage || value.rows.length !== expectedRows) {
    throw new Error("صفحة التسوية لا تطابق العدد الدقيق المخزّن. أوقف المراجعة وأعد تحميل الصفحة.");
  }

  const rows: ReconciliationQueueRow[] = [];
  const seen = new Set<string>();
  for (const rawRow of value.rows) {
    if (!validQueueRow(rawRow) || seen.has(rawRow.id)) {
      throw new Error("معرّفات صفحة التسوية غير صالحة أو مكررة.");
    }
    seen.add(rawRow.id);
    rows.push(rawRow);
  }
  const counts: ReconciliationQueueCounts = {
    total: wholeTotal,
    unreviewed,
    reviewed: wholeTotal - unreviewed,
    rejected,
    frozen,
    executed,
    included,
    held,
    decided: wholeTotal - unreviewed,
    allDecided: wholeTotal > 0 && unreviewed === 0,
  };
  return { total, page: value.page, pageSize, counts, rows };
}
