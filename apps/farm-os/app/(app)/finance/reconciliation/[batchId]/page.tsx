import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, Button, EmptyState, Field, KpiCard, Select, Tag } from "@/components/ui";
import { fmtDate } from "@/lib/dates";
import { egp, num } from "@/lib/money";
import {
  approveGate,
  BATCH_STATUS_AR,
  CLASSIFICATION_AR,
  correctionTargetLabel,
  evidenceTargetLabel,
  executeGate,
  freezeGate,
  isUuid,
  paginate,
  parsePageParam,
  parseReconciliationQueueFilters,
  reconciliationQueueHref,
  reconciliationQueueStatePredicates,
  rollbackGate,
  summarizeResultSummary,
  RECONCILIATION_PAGE_SIZE,
  EXPENSE_KIND_AR,
  PAYMENT_DECISION_AR,
  HISTORICAL_DATE_DECISION_AR,
  type BatchStatus,
  type Classification,
  type RowStateCounts,
  type Tone,
} from "@/lib/reconciliation review";
import { ReconciliationControls, type RowVM } from "./controls";

export const dynamic = "force-dynamic";

type EvidenceRow = {
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

type BatchRowRecord = {
  id: string;
  evidence_item_id: string;
  review_state: string;
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
  expense_account: { code: string; name_ar: string } | null;
  expense_cost_center: { code: string; name_ar: string } | null;
  expense_supplier: { name: string } | null;
  sale_buyer: { name: string } | null;
  sale_cost_center: { code: string; name_ar: string } | null;
  sale_farm: { name: string } | null;
  sale_sector: { name: string } | null;
  sale_hawsha: { code: string; name: string } | null;
  evidence: EvidenceRow | null;
};

type CorrectionExpense = {
  id: string;
  date: string | null;
  category: string;
  description: string | null;
  total: number;
};

type CorrectionSale = {
  id: string;
  sale_date: string | null;
  crop: string;
  notes: string | null;
  total: number;
};

async function headCount(
  sb: Awaited<ReturnType<typeof createClient>>,
  batchId: string,
  orgId: string,
  filters: { column: "review_state" | "disposition" | "frozen"; value: string | boolean }[] = [],
): Promise<number> {
  let q = sb
    .from("reconciliation_batch_rows")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .eq("org_id", orgId);
  for (const filter of filters) q = q.eq(filter.column, filter.value);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/**
 * Truthful "how many rows actually executed", as a bounded head count against the executor's own
 * bookkeeping column — never a hardcoded number, and never derived from the batch status.
 *
 * `posted` and `reversed` are the only two `execution_result` values that represent a real money
 * action: `posted` is a created expense/sale with its journal, `reversed` is a correction that
 * reversed a production journal (and, after a rollback, a created posting that was itself reversed).
 * `pending` never ran, `skipped` deliberately did nothing (a zero-value no-op, or an evidence item
 * another batch had already claimed), and `failed` did not complete — none of those executed.
 */
async function executedRowCount(
  sb: Awaited<ReturnType<typeof createClient>>,
  batchId: string,
  orgId: string,
): Promise<number> {
  const { count, error } = await sb
    .from("reconciliation_batch_rows")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .eq("org_id", orgId)
    .in("execution_result", ["posted", "reversed"]);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Keep an already-in-flight read alive across an intervening `await` that may throw first.
 *
 * These reads are STARTED eagerly and AWAITED later, so a rejection can land while the render is
 * still awaiting something else. The no-op handler only stops Node reporting it as an *unhandled*
 * rejection — the promise still rejects at its `await` below, so a failed read never renders as an
 * empty or partial page. Fail-closed is unchanged; only the reporting noise is.
 */
function started<T>(read: Promise<T>): Promise<T> {
  read.catch(() => {});
  return read;
}

/**
 * The whole-batch KPI strip: seven bounded head counts over the ENTIRE batch, deliberately
 * independent of the queue filters (a filter narrows the visible page, never the batch KPIs).
 * Depends only on the batch identity, so it can run alongside the filtered count and the row page.
 */
async function loadWholeBatchCounts(
  sb: Awaited<ReturnType<typeof createClient>>,
  batchId: string,
  orgId: string,
): Promise<RowStateCounts> {
  // Whole-batch state summary via bounded head counts (no unbounded row read; no N+1 over data).
  const [total, unreviewed, included, held, rejected, frozen, executed] = await Promise.all([
    headCount(sb, batchId, orgId),
    headCount(sb, batchId, orgId, [{ column: "review_state", value: "unreviewed" }]),
    headCount(sb, batchId, orgId, [{ column: "disposition", value: "include" }]),
    headCount(sb, batchId, orgId, [
      { column: "review_state", value: "reviewed" },
      { column: "disposition", value: "hold" },
    ]),
    headCount(sb, batchId, orgId, [{ column: "review_state", value: "rejected" }]),
    // Frozen counts the actual frozen flag across ALL dispositions (included rows move to
    // review_state='frozen', but held/rejected rows keep their state with frozen=true).
    headCount(sb, batchId, orgId, [{ column: "frozen", value: true }]),
    executedRowCount(sb, batchId, orgId),
  ]);
  return {
    total,
    unreviewed,
    reviewed: total - unreviewed,
    rejected,
    frozen,
    executed,
    included,
    held,
    decided: total - unreviewed,
    allDecided: total > 0 && unreviewed === 0,
  };
}

/**
 * Correction targets for the CURRENT bounded page of rows — resolved on every render because these
 * summaries are displayed outside the editable picker, so the approver can verify the exact target
 * after reload and freeze. Depends on the row page, so it starts only once those rows are known.
 */
async function loadCorrectionTargets(
  sb: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  batchRows: BatchRowRecord[],
): Promise<{ expenses: Map<string, CorrectionExpense>; sales: Map<string, CorrectionSale> }> {
  const correctionExpenseIds = Array.from(
    new Set(batchRows.map((row) => row.corrects_expense_id).filter((id): id is string => id !== null)),
  );
  const correctionSaleIds = Array.from(
    new Set(batchRows.map((row) => row.corrects_sale_id).filter((id): id is string => id !== null)),
  );
  const [correctionExpenseResult, correctionSaleResult] = await Promise.all([
    correctionExpenseIds.length === 0
      ? Promise.resolve({ data: [] as CorrectionExpense[], error: null })
      : sb
          .from("expenses")
          .select("id, date, category, description, total")
          .eq("org_id", orgId)
          .in("id", correctionExpenseIds),
    correctionSaleIds.length === 0
      ? Promise.resolve({ data: [] as CorrectionSale[], error: null })
      : sb
          .from("sales")
          .select("id, sale_date, crop, notes, total")
          .eq("org_id", orgId)
          .in("id", correctionSaleIds),
  ]);
  if (correctionExpenseResult.error) throw correctionExpenseResult.error;
  if (correctionSaleResult.error) throw correctionSaleResult.error;
  const expenses = new Map(
    (correctionExpenseResult.data as CorrectionExpense[]).map((row) => [row.id, row]),
  );
  const sales = new Map((correctionSaleResult.data as CorrectionSale[]).map((row) => [row.id, row]));
  if (expenses.size !== correctionExpenseIds.length || sales.size !== correctionSaleIds.length) {
    throw new Error("تعذّر تحميل سجل مالي مرتبط بقرار تصحيح. أوقف الاعتماد وراجع صلاحيات السجل.");
  }
  return { expenses, sales };
}

export default async function ReconciliationBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{
    page?: string | string[];
    classification?: string | string[];
    state?: string | string[];
  }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const { batchId } = await params;
  const rawSearchParams = await searchParams;
  const pageParam = rawSearchParams.page;
  const filters = parseReconciliationQueueFilters(rawSearchParams);

  // Fail closed on a malformed id — never send it to PostgREST.
  if (!isUuid(batchId)) notFound();

  const { data: batch, error: batchError } = await sb
    .from("reconciliation_batches")
    .select("id, org_id, source_label, source_workbook_sha256, status, created_at, result_summary")
    .eq("id", batchId)
    .eq("org_id", m.orgId)
    .maybeSingle();
  if (batchError) throw batchError;
  if (!batch) notFound(); // missing or cross-org (RLS) → fail closed.

  const editable = batch.status === "staged";

  // Everything below depends only on the batch identity, never on the filters or on the page of
  // rows — so START it here and await it at the end. The filtered count is the only
  // read the render must block on next, because pagination and the row range derive from it.
  const wholeBatchCountsRead = started(loadWholeBatchCounts(sb, batchId, m.orgId));

  const statePredicates = reconciliationQueueStatePredicates(filters.state);
  let filteredCountQuery = sb
    .from("reconciliation_batch_rows")
    .select(
      "id, evidence:reconciliation_evidence_items!reconciliation_batch_rows_evidence_tenant_fk!inner(id)",
      { count: "exact", head: true },
    )
    .eq("batch_id", batchId)
    .eq("org_id", m.orgId)
    .eq("evidence.org_id", m.orgId);
  if (filters.classification) {
    filteredCountQuery = filteredCountQuery.eq(
      "evidence.classification",
      filters.classification,
    );
  }
  for (const predicate of statePredicates) {
    filteredCountQuery = filteredCountQuery.eq(predicate.column, predicate.value);
  }
  const { count: filteredCount, error: filteredCountError } = await filteredCountQuery;
  if (filteredCountError) throw filteredCountError;
  const pagination = paginate(
    filteredCount ?? 0,
    parsePageParam(pageParam),
    RECONCILIATION_PAGE_SIZE,
  );

  // The page of rows (bounded to 50 via range()).
  let rowQuery = sb
    .from("reconciliation_batch_rows")
    .select(
      [
        "id",
        "evidence_item_id",
        "review_state",
        "disposition",
        "review_reason",
        "target_table",
        "frozen",
        "execution_result",
        "expense_category",
        "expense_description",
        "expense_kind",
        "expense_account_id",
        "expense_cost_center_id",
        "expense_supplier_id",
        "expense_payment_decision",
        "sale_crop",
        "sale_quantity",
        "sale_unit",
        "sale_unit_price",
        "sale_recorded_total",
        "sale_buyer_id",
        "sale_cost_center_id",
        "sale_farm_id",
        "sale_sector_id",
        "sale_hawsha_id",
        "sale_season",
        "sale_delivery_date",
        "sale_notes",
        "sale_historical_date_decision",
        "sale_effective_date",
        "corrects_expense_id",
        "corrects_sale_id",
        "expense_account:accounts!reconciliation_batch_rows_expense_account_id_fkey(code, name_ar)",
        "expense_cost_center:cost_centers!reconciliation_batch_rows_expense_cost_center_id_fkey(code, name_ar)",
        "expense_supplier:suppliers!reconciliation_batch_rows_expense_supplier_id_fkey(name)",
        "sale_buyer:buyers!reconciliation_batch_rows_sale_buyer_id_fkey(name)",
        "sale_cost_center:cost_centers!reconciliation_batch_rows_sale_cost_center_id_fkey(code, name_ar)",
        "sale_farm:farms!reconciliation_batch_rows_sale_farm_id_fkey(name)",
        "sale_sector:sectors!reconciliation_batch_rows_sale_sector_id_fkey(name)",
        "sale_hawsha:hawshat!reconciliation_batch_rows_sale_hawsha_id_fkey(code, name)",
        "evidence:reconciliation_evidence_items!reconciliation_batch_rows_evidence_tenant_fk!inner(id, origin_kind, sheet_name, row_locator, snapshot_target_table, snapshot_target_id, source_amount, source_date_text, source_date_parsed, classification, invalid_calendar_quality_flag, evidence_label)",
      ].join(", "),
    )
    .eq("batch_id", batchId)
    .eq("org_id", m.orgId)
    .eq("evidence.org_id", m.orgId);
  if (filters.classification) {
    rowQuery = rowQuery.eq("evidence.classification", filters.classification);
  }
  for (const predicate of statePredicates) {
    rowQuery = rowQuery.eq(predicate.column, predicate.value);
  }
  const { data: rowData, error: rowError } = await rowQuery
    .order("evidence_item_id", { ascending: true })
    .range(pagination.offset, pagination.offset + pagination.pageSize - 1);
  if (rowError) throw rowError;
  const batchRows = (rowData ?? []) as unknown as BatchRowRecord[];

  // Resolve correction targets for this bounded page on every render. These summaries are displayed
  // outside the editable picker, so the approver can verify the exact target after reload and freeze.
  // Started here (it needs the row page) while the batch-wide reads above are still in flight.
  const correctionTargetsRead = started(loadCorrectionTargets(sb, m.orgId, batchRows));

  // Nothing renders until every read has settled — no partial page, no stale or missing count.
  const [counts, correctionTargets] = await Promise.all([
    wholeBatchCountsRead,
    correctionTargetsRead,
  ]);
  const { expenses: correctionExpenses, sales: correctionSales } = correctionTargets;

  const rowVms: RowVM[] = batchRows.map((r) => {
    const ev = r.evidence;
    const classification = (ev?.classification ?? "") as Classification;
    const sourceDateText = ev?.source_date_text ?? null;
    const parsed = ev?.source_date_parsed ?? null;
    const sourceDateLabel = sourceDateText
      ? `${sourceDateText}${parsed ? ` (${fmtDate(parsed)})` : ""}`
      : parsed
        ? fmtDate(parsed)
        : "—";
    const correctedExpense = r.corrects_expense_id
      ? correctionExpenses.get(r.corrects_expense_id)
      : undefined;
    const correctedSale = r.corrects_sale_id ? correctionSales.get(r.corrects_sale_id) : undefined;
    const correctionDetail = correctedExpense
      ? correctionTargetLabel({
          targetTable: "expenses",
          referenceLabel: `مرجع ${correctedExpense.id}`,
          dateLabel: correctedExpense.date ? fmtDate(correctedExpense.date) : "بدون تاريخ",
          amountLabel: egp(correctedExpense.total),
          primaryLabel: correctedExpense.category,
          secondaryLabel: correctedExpense.description,
        })
      : correctedSale
        ? correctionTargetLabel({
            targetTable: "sales",
            referenceLabel: `مرجع ${correctedSale.id}`,
            dateLabel: correctedSale.sale_date ? fmtDate(correctedSale.sale_date) : "بدون تاريخ",
            amountLabel: egp(correctedSale.total),
            primaryLabel: correctedSale.crop,
            secondaryLabel: correctedSale.notes,
          })
        : null;
    const targetDetails =
      r.target_table === "expenses"
        ? [
            `الوجهة: مصروف`,
            r.expense_category ? `البند: ${r.expense_category}` : null,
            r.expense_kind
              ? `النوع: ${EXPENSE_KIND_AR[r.expense_kind as keyof typeof EXPENSE_KIND_AR] ?? r.expense_kind}`
              : null,
            r.expense_description ? `الوصف: ${r.expense_description}` : null,
            r.expense_account
              ? `الحساب: ${r.expense_account.code} · ${r.expense_account.name_ar}`
              : null,
            r.expense_cost_center
              ? `مركز التكلفة: ${r.expense_cost_center.code} · ${r.expense_cost_center.name_ar}`
              : null,
            r.expense_supplier ? `المورد: ${r.expense_supplier.name}` : null,
            r.expense_payment_decision
              ? `الدفع: ${PAYMENT_DECISION_AR[r.expense_payment_decision as keyof typeof PAYMENT_DECISION_AR] ?? r.expense_payment_decision}`
              : null,
            correctionDetail,
          ].filter((detail): detail is string => detail !== null)
        : r.target_table === "sales"
          ? [
              `الوجهة: بيع`,
              r.sale_crop ? `المحصول: ${r.sale_crop}` : null,
              r.sale_quantity != null ? `الكمية: ${num(r.sale_quantity)}${r.sale_unit ? ` ${r.sale_unit}` : ""}` : null,
              r.sale_unit_price != null ? `سعر الوحدة: ${egp(r.sale_unit_price)}` : null,
              r.sale_recorded_total != null ? `الإجمالي: ${egp(r.sale_recorded_total)}` : null,
              r.sale_buyer ? `المشتري: ${r.sale_buyer.name}` : null,
              r.sale_cost_center
                ? `مركز التكلفة: ${r.sale_cost_center.code} · ${r.sale_cost_center.name_ar}`
                : null,
              r.sale_farm ? `المزرعة: ${r.sale_farm.name}` : null,
              r.sale_sector ? `القطاع: ${r.sale_sector.name}` : null,
              r.sale_hawsha ? `الحوشة: ${r.sale_hawsha.code} · ${r.sale_hawsha.name}` : null,
              r.sale_season ? `الموسم: ${r.sale_season}` : null,
              r.sale_delivery_date ? `التسليم: ${fmtDate(r.sale_delivery_date)}` : null,
              r.sale_effective_date ? `التاريخ الفعلي: ${fmtDate(r.sale_effective_date)}` : null,
              r.sale_historical_date_decision
                ? `قرار التاريخ: ${HISTORICAL_DATE_DECISION_AR[r.sale_historical_date_decision as keyof typeof HISTORICAL_DATE_DECISION_AR] ?? r.sale_historical_date_decision}`
                : null,
              r.sale_notes ? `ملاحظات: ${r.sale_notes}` : null,
              correctionDetail,
            ].filter((detail): detail is string => detail !== null)
          : [];
    return {
      id: r.id,
      classification,
      classificationLabel: CLASSIFICATION_AR[classification] ?? (classification || "—"),
      evidenceLabel: ev?.evidence_label ?? "—",
      provenanceLabel: ev ? evidenceTargetLabel(ev) : "—",
      sourceAmountLabel: egp(ev?.source_amount ?? null),
      sourceDateLabel,
      invalidDate: ev?.invalid_calendar_quality_flag ?? false,
      reviewState: r.review_state,
      disposition: r.disposition,
      reviewReason: r.review_reason,
      targetTable: r.target_table,
      frozen: r.frozen,
      executionResult: r.execution_result,
      targetDetails,
      expense: {
        category: r.expense_category ?? "",
        description: r.expense_description ?? "",
        kind: r.expense_kind ?? "",
        account_id: r.expense_account_id ?? "",
        cost_center_id: r.expense_cost_center_id ?? "",
        supplier_id: r.expense_supplier_id ?? "",
        payment_decision: r.expense_payment_decision ?? "",
      },
      sale: {
        crop: r.sale_crop ?? "",
        quantity: r.sale_quantity,
        unit: r.sale_unit ?? "",
        unit_price: r.sale_unit_price,
        recorded_total: r.sale_recorded_total,
        buyer_id: r.sale_buyer_id ?? "",
        cost_center_id: r.sale_cost_center_id ?? "",
        farm_id: r.sale_farm_id ?? "",
        sector_id: r.sale_sector_id ?? "",
        hawsha_id: r.sale_hawsha_id ?? "",
        season: r.sale_season ?? "",
        delivery_date: r.sale_delivery_date ?? "",
        notes: r.sale_notes ?? "",
        historical_date_decision: r.sale_historical_date_decision ?? "",
        effective_date: r.sale_effective_date ?? "",
      },
      correctsExpenseId: r.corrects_expense_id ?? "",
      correctsSaleId: r.corrects_sale_id ?? "",
    };
  });

  // Typed as Tone (the same union the design system's Tag accepts) so the tag needs no cast.
  const statusMeta: { label: string; tone: Tone } = BATCH_STATUS_AR[batch.status as BatchStatus] ?? {
    label: batch.status,
    tone: "neutral" as const,
  };
  const freeze = freezeGate(batch.status, counts);
  const approve = approveGate(batch.status, m.role);
  const execute = executeGate(batch.status, m.role);
  const rollback = rollbackGate(batch.status, m.role);
  // Counts and the owner's own rollback reason only — summarizeResultSummary drops every key it does
  // not recognise (including the row-level `safe_locator`) rather than rendering an unknown value.
  const summaryLines = summarizeResultSummary(batch.result_summary);
  const sourceLabel =
    batch.source_label?.trim() ||
    (batch.source_workbook_sha256 ? `دفتر ${batch.source_workbook_sha256.slice(0, 8)}` : "دفعة تسوية");

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      {/* One line, not a stacked block: the batch name, its status, the one-line purpose and the
          back link all share a single row so the controls below stay above the fold. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-lg font-bold">{sourceLabel}</h1>
        <Tag tone={statusMeta.tone}>{statusMeta.label}</Tag>
        <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
          قرار صريح لكل صف، ثم تجميد، ثم اعتماد المالك، ثم تنفيذ مالي يمكن التراجع عنه.
        </span>
        {/* Plain links only: the acceptance report is a SEPARATE route that does its own whole-batch
            read when opened, so this page adds no query and renders exactly as fast as before. */}
        <Link
          href={`/finance/reconciliation/${encodeURIComponent(batchId)}/acceptance`}
          className="ms-auto rounded-md px-3 py-1 text-sm"
          style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
        >
          تقرير القبول
        </Link>
        <Link
          href="/finance/reconciliation"
          className="rounded-md px-3 py-1 text-sm"
          style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
        >
          كل الدفعات
        </Link>
      </header>

      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="الصفوف" value={num(counts.total)} />
        <KpiCard label="بدون قرار" value={num(counts.unreviewed)} />
        <KpiCard label="تُضمَّن" value={num(counts.included)} />
        <KpiCard label="مُعلَّقة" value={num(counts.held)} />
        <KpiCard label="مرفوضة" value={num(counts.rejected)} />
        <KpiCard label="مُجمَّدة" value={num(counts.frozen)} />
      </section>

      {batch.status === "executing" && (
        <Alert
          tone="warning"
          title="الدفعة قيد التنفيذ الآن"
          description="جارٍ ترحيل هذه الدفعة في معاملة واحدة. لا يُتخذ أي إجراء من هنا حتى تنتهي."
        />
      )}
      {batch.status === "failed" && (
        <Alert
          tone="danger"
          title="فشل التنفيذ ولم يُرحَّل أي شيء"
          description="أُلغيت المعاملة بالكامل؛ لم تتغيّر أي مصروفات أو مبيعات أو قيود. راجع سبب الفشل بجوار الأزرار."
        />
      )}

      <form
        method="get"
        className="flex flex-wrap items-end gap-2 rounded-md p-3"
        style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
      >
        <Field label="نوع المطابقة" id="classification">
          <Select
            id="classification"
            name="classification"
            selectSize="sm"
            defaultValue={filters.classification ?? ""}
            options={[
              { value: "", label: "كل الأنواع" },
              ...Object.entries(CLASSIFICATION_AR).map(([value, label]) => ({ value, label })),
            ]}
          />
        </Field>
        <Field label="قرار المراجعة" id="state">
          <Select
            id="state"
            name="state"
            selectSize="sm"
            defaultValue={filters.state ?? ""}
            options={[
              { value: "", label: "كل القرارات" },
              { value: "unreviewed", label: "بدون قرار" },
              { value: "included", label: "تُضمَّن" },
              { value: "held", label: "مُعلَّقة" },
              { value: "rejected", label: "مرفوضة" },
              { value: "frozen", label: "مُجمَّدة" },
            ]}
          />
        </Field>
        <Button type="submit" size="sm" variant="primary">
          تطبيق
        </Button>
        {(filters.classification || filters.state) && (
          <Link
            href={`/finance/reconciliation/${batchId}`}
            className="rounded-md px-3 py-1.5 text-sm"
            style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
          >
            مسح
          </Link>
        )}
      </form>

      {counts.total === 0 ? (
        <EmptyState title="لا توجد صفوف في هذه الدفعة" />
      ) : (
        <ReconciliationControls
          key={`${batchId}:${batch.status}:${m.role}`}
          batchId={batchId}
          status={batch.status}
          role={m.role}
          rows={rowVms}
          editable={editable}
          canFreeze={freeze.canFreeze}
          freezeReason={freeze.reason}
          canApprove={approve.canApprove}
          approveReason={approve.reason}
          canExecute={execute.canExecute}
          executeReason={execute.reason}
          canRollback={rollback.canRollback}
          rollbackReason={rollback.reason}
          executedRows={counts.executed}
          summaryLines={summaryLines}
          page={pagination.page}
          pageCount={pagination.pageCount}
          from={pagination.from}
          to={pagination.to}
          total={pagination.total}
          hasActiveFilters={Boolean(filters.classification || filters.state)}
          previousHref={reconciliationQueueHref(batchId, pagination.page - 1, filters)}
          nextHref={reconciliationQueueHref(batchId, pagination.page + 1, filters)}
        />
      )}
    </div>
  );
}
