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
  QUEUE_QUALITY_AR,
  reconciliationQueueHref,
  rollbackGate,
  summarizeResultSummary,
  RECONCILIATION_PAGE_SIZE,
  EXPENSE_KIND_AR,
  PAYMENT_DECISION_AR,
  HISTORICAL_DATE_DECISION_AR,
  type BatchStatus,
  type Classification,
  type ReconciliationQueueState,
  type Tone,
} from "@/lib/reconciliation review";
import { parseReconciliationQueuePage } from "@/lib/reconciliation queue data";
import { ReconciliationControls, type RowVM } from "./controls";
import { ReviewWorkspaceGuard } from "./review workspace guard";

export const dynamic = "force-dynamic";

function QueueKpiLink({
  batchId,
  label,
  value,
  state,
}: {
  batchId: string;
  label: string;
  value: string;
  state: ReconciliationQueueState | null;
}) {
  return (
    <Link
      href={reconciliationQueueHref(batchId, 1, {
        classification: null,
        state,
        quality: null,
      })}
      aria-label={`عرض ${label}: ${value}`}
      className="block rounded-md no-underline"
      style={{ color: "inherit" }}
    >
      <KpiCard label={label} value={value} className="h-full" />
    </Link>
  );
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
    quality?: string | string[];
  }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const { batchId } = await params;
  const rawSearchParams = await searchParams;
  const pageParam = rawSearchParams.page;
  const requestedPage = parsePageParam(pageParam);
  const filters = parseReconciliationQueueFilters(rawSearchParams);

  // Fail closed on a malformed id — never send it to PostgREST.
  if (!isUuid(batchId)) notFound();

  const { data: batch, error: batchError } = await sb
    .from("reconciliation_batches")
    .select("id, org_id, source_label, source_workbook_sha256, status, created_at, created_by, result_summary")
    .eq("id", batchId)
    .eq("org_id", m.orgId)
    .maybeSingle();
  if (batchError) throw batchError;
  if (!batch) notFound(); // missing or cross-org (RLS) → fail closed.

  let hasReviewedRow = false;
  if (m.role === "owner" && batch.status === "reviewed") {
    const { data: reviewedRows, error: reviewedRowsError } = await sb
      .from("reconciliation_batch_rows")
      .select("id")
      .eq("org_id", m.orgId)
      .eq("batch_id", batchId)
      .eq("reviewer_id", m.userId)
      .limit(1);
    if (reviewedRowsError) throw reviewedRowsError;
    hasReviewedRow = (reviewedRows?.length ?? 0) > 0;
  }

  const editable = batch.status === "staged";

  // One stable database snapshot produces the whole-batch KPIs, exact filtered total, and bounded
  // display rows in the acceptance packet's human evidence-locator order.
  const { data: queuePageData, error: queuePageError } = await sb.rpc(
    "fn_reconciliation_queue_page",
    {
      p_org: m.orgId,
      p_batch_id: batchId,
      p_classification: filters.classification,
      p_state: filters.state,
      p_quality: filters.quality,
      p_page: requestedPage,
      p_limit: RECONCILIATION_PAGE_SIZE,
    },
  );
  if (queuePageError) throw queuePageError;
  const queuePage = parseReconciliationQueuePage(
    queuePageData,
    requestedPage,
    RECONCILIATION_PAGE_SIZE,
  );
  const pagination = paginate(queuePage.total, queuePage.page, queuePage.pageSize);
  const counts = queuePage.counts;
  const orderedBatchRows = queuePage.rows;

  const rowVms: RowVM[] = orderedBatchRows.map((r) => {
    const ev = r.evidence;
    const classification = (ev?.classification ?? "") as Classification;
    const sourceDateText = ev?.source_date_text ?? null;
    const parsed = ev?.source_date_parsed ?? null;
    const sourceDateLabel = sourceDateText
      ? `${sourceDateText}${parsed ? ` (${fmtDate(parsed)})` : ""}`
      : parsed
        ? fmtDate(parsed)
        : "—";
    const correctedExpense = r.correction_expense;
    const correctedSale = r.correction_sale;
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
      reviewVersion: r.review_version,
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
  const approve = approveGate(batch.status, m.role, {
    isBatchCreator: batch.created_by === m.userId,
    hasReviewedRow,
  });
  const execute = executeGate(batch.status, m.role);
  const rollback = rollbackGate(batch.status, m.role);
  // Counts and the owner's own rollback reason only — summarizeResultSummary drops every key it does
  // not recognise (including the row-level `safe_locator`) rather than rendering an unknown value.
  const summaryLines = summarizeResultSummary(batch.result_summary);
  const sourceLabel =
    batch.source_label?.trim() ||
    (batch.source_workbook_sha256 ? `دفتر ${batch.source_workbook_sha256.slice(0, 8)}` : "دفعة تسوية");

  return (
    <ReviewWorkspaceGuard>
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
        <QueueKpiLink batchId={batchId} label="الصفوف" value={num(counts.total)} state={null} />
        <QueueKpiLink batchId={batchId} label="بدون قرار" value={num(counts.unreviewed)} state="unreviewed" />
        <QueueKpiLink batchId={batchId} label="تُضمَّن" value={num(counts.included)} state="included" />
        <QueueKpiLink batchId={batchId} label="مُعلَّقة" value={num(counts.held)} state="held" />
        <QueueKpiLink batchId={batchId} label="مرفوضة" value={num(counts.rejected)} state="rejected" />
        <QueueKpiLink batchId={batchId} label="مُجمَّدة" value={num(counts.frozen)} state="frozen" />
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
        {/* Direct routes to the acceptance report's named row-quality exceptions. */}
        <Field label="استثناءات الدليل" id="quality">
          <Select
            id="quality"
            name="quality"
            selectSize="sm"
            defaultValue={filters.quality ?? ""}
            options={[
              { value: "", label: "كل الصفوف" },
              ...Object.entries(QUEUE_QUALITY_AR).map(([value, label]) => ({ value, label })),
            ]}
          />
        </Field>
        <Button type="submit" size="sm" variant="primary">
          تطبيق
        </Button>
        {(filters.classification || filters.state || filters.quality) && (
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
          hasActiveFilters={Boolean(filters.classification || filters.state || filters.quality)}
          previousHref={reconciliationQueueHref(batchId, pagination.page - 1, filters)}
          nextHref={reconciliationQueueHref(batchId, pagination.page + 1, filters)}
        />
      )}
      </div>
    </ReviewWorkspaceGuard>
  );
}
