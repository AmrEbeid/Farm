import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import type { PillStatus } from "@amrebeid/ui";
import { Alert, VerdictBanner, KpiCard, Progress, Card } from "@/components/ui";
import { Entity360Header } from "@/components/Entity360Header";
import { ExportButton } from "@/components/ExportButton";
import { PrintButton } from "@/components/print-button";
import {
  aggregateBudgetLinesByCategory,
  buildCategoryBudgetView,
  budgetRoutingTextAr,
  budgetVerdictTextAr,
  GENERAL_OPS_BUDGET_CATEGORY,
  summarizePlannedCostByCategory,
  type CategoryBudgetView,
} from "@/lib/budget-check";
import type { CsvColumn, CsvRow } from "@/lib/export-csv";
import { egp, pct } from "@/lib/money";

const BUDGET_CHECK_EXPORT_COLUMNS: CsvColumn[] = [
  { id: "plan_id", header: "معرف الخطة" },
  { id: "purchase_request_id", header: "معرف طلب الشراء" },
  { id: "category", header: "البند" },
  { id: "verdict", header: "الحكم" },
  { id: "verdict_reason", header: "سبب الحكم" },
  { id: "approved", header: "المعتمد" },
  { id: "this_plan_cost", header: "تكلفة هذه الخطة" },
  { id: "after_plan", header: "بعد هذه الخطة" },
  { id: "review_ceiling", header: "السقف للمراجعة" },
  { id: "current_utilization_pct", header: "الاستخدام الحالي %" },
  { id: "after_plan_utilization_pct", header: "الاستخدام بعد الخطة %" },
  { id: "planned_budget", header: "المخطط" },
  { id: "budget_line_count", header: "عدد بنود الموازنة" },
  { id: "budget_scope_count", header: "عدد نطاقات الموازنة" },
  { id: "multiple_budget_scopes", header: "أكثر من نطاق موازنة" },
  { id: "unknown_cost", header: "تكلفة غير معروفة" },
  { id: "unknown_cost_count", header: "عدد التكاليف غير المعروفة" },
  { id: "finance_review", header: "يحتاج مراجعة مالية" },
  { id: "committed_source", header: "مصدر الالتزامات" },
  { id: "actual_source", header: "مصدر الفعلي" },
];

function yesNoAr(condition: boolean): string {
  return condition ? "نعم" : "لا";
}

function budgetVerdictLabelAr(verdict: CategoryBudgetView["verdict"]): string {
  if (verdict === "block") return "تجاوز";
  if (verdict === "approval-needed") return "يتطلب اعتماد";
  return "كافية";
}

function budgetSourceLabelAr(source: string): string {
  if (source === "live") return "حي";
  if (source === "static") return "مسجل";
  return "غير متاح";
}

export default async function BudgetCheckPage({
  params,
  searchParams,
}: {
  params: Promise<{ planId: string }>;
  searchParams: Promise<{ pr?: string }>;
}) {
  const { planId } = await params;
  const { pr } = await searchParams;
  const m = await requireMembership();
  const sb = await createClient();

  // The plan's pending spend, GROUPED by whichever budget_lines category each operation's subtype
  // maps to (generalized from a hardcoded "أسمدة"-only / fertilization-only check — every
  // operation type now contributes to a real budget signal instead of silently being free).
  const { data: ops, error: opsError } = await sb
    .from("plan_operations")
    .select("est_cost, subtype, status")
    .eq("plan_id", planId)
    .eq("status", "planned");
  if (opsError) throw opsError;

  const plannedByCategory = summarizePlannedCostByCategory(ops ?? []);
  // A plan with no planned ops yet still gets a (zeroed) general-category card, matching the old
  // page's behaviour of always rendering something even before any fertilization op existed.
  const categories = plannedByCategory.size > 0 ? [...plannedByCategory.keys()] : [GENERAL_OPS_BUDGET_CATEGORY];

  // Scope to the caller's org; without a canonical plan→budget link yet, repeated category lines
  // are summed by category rather than letting whichever row PostgREST returns last win.
  const { data: lines, error: linesError } = await sb
    .from("budget_lines")
    .select("budget_id, category, planned, approved, committed, actual")
    .eq("org_id", m.orgId)
    .in("category", categories);
  // Surface DB read failures to the segment error boundary instead of rendering a misleading page.
  if (linesError) throw linesError;
  const lineByCategory = aggregateBudgetLinesByCategory(lines ?? []);

  const views: CategoryBudgetView[] = categories.map((category) =>
    buildCategoryBudgetView(
      category,
      lineByCategory.get(category),
      plannedByCategory.get(category) ?? { knownCost: 0, unknownCostCount: 0, hasUnknownCost: false },
      {
        actualSource: "unavailable",
        committedSource: "static",
      },
    ),
  );

  const overallVerdict: CategoryBudgetView["verdict"] = views.some((v) => v.verdict === "block")
    ? "block"
    : views.some((v) => v.verdict === "approval-needed")
      ? "approval-needed"
      : "ok";
  const needsOwner = overallVerdict !== "ok";
  const blockingOrWarningView = views.find((v) => v.verdict === overallVerdict) ?? views[0];
  const needsFinanceReview = views.some((v) => v.needsFinanceReview);
  const budgetCheckRows: CsvRow[] = views.map((v) => ({
    plan_id: planId,
    purchase_request_id: pr ?? "",
    category: v.category,
    verdict: budgetVerdictLabelAr(v.verdict),
    verdict_reason: budgetVerdictTextAr(v),
    approved: v.approved,
    this_plan_cost: v.thisOp,
    after_plan: v.after,
    review_ceiling: v.available,
    current_utilization_pct: v.utilization,
    after_plan_utilization_pct: v.utilizationAfter,
    planned_budget: v.planned,
    budget_line_count: v.budgetLineCount,
    budget_scope_count: v.budgetScopeCount,
    multiple_budget_scopes: yesNoAr(v.hasMultipleBudgetScopes),
    unknown_cost: yesNoAr(v.hasUnknownCost),
    unknown_cost_count: v.unknownCostCount,
    finance_review: yesNoAr(v.needsFinanceReview),
    committed_source: budgetSourceLabelAr(v.committedSource),
    actual_source: budgetSourceLabelAr(v.actualSource),
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <Entity360Header
        title="فحص الموازنة"
        subtitle="فحص كفاية الموازنة قبل تنفيذ عمليات الخطة، لكل بند على حدة"
        actions={
          <div className="flex flex-wrap gap-2">
            <PrintButton label="طباعة الفحص" />
            <span className="no-print">
              <ExportButton
                rows={budgetCheckRows}
                columns={BUDGET_CHECK_EXPORT_COLUMNS}
                filename={`plan-${planId}-budget-check`}
              />
            </span>
          </div>
        }
        pills={[
          overallVerdict === "block"
            ? { status: "blocked" as PillStatus, label: "تجاوز" }
            : overallVerdict === "approval-needed"
              ? { status: "warning" as PillStatus, label: "يتطلب اعتماد" }
              : { status: "active" as PillStatus, label: "كافية" },
        ]}
      />

      {needsFinanceReview && (
        <Alert
          tone="warning"
          title="فحص الموازنة يحتاج مراجعة مالية"
          description="لا توجد بعد وصلة موثوقة بين الخطة والموازنة النشطة والالتزامات/الفعلي الحي؛ لذلك يعرض هذا الفحص السقف المعتمد مقابل تكلفة هذه الخطة فقط، ولا يعطي تمريرًا أخضر تلقائيًا للعمليات المكلفة."
        />
      )}

      {views.map((v) => (
        <Card key={v.category} title={`بند ${v.category}`}>
          <VerdictBanner tone={v.verdict === "block" ? "danger" : v.verdict === "approval-needed" ? "warning" : "ok"}>
            {budgetVerdictTextAr(v)}
          </VerdictBanner>

          <section className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="المعتمد" value={egp(v.approved)} />
            <KpiCard label="تكلفة هذه الخطة" value={egp(v.thisOp)} />
            <KpiCard label="بعد هذه الخطة" value={egp(v.after)} />
            <KpiCard
              label="السقف للمراجعة"
              value={egp(v.available)}
              delta={v.hasUnknownCost ? "يوجد تكلفة غير معروفة" : "دون الالتزامات/الفعلي الحي"}
              // Attention only when the category isn't within budget (mirrors the VerdictBanner tone
              // above) — was unconditionally "down", so it flagged even a comfortably-ok budget.
              deltaDirection={v.verdict === "ok" ? "none" : "down"}
            />
          </section>

          <div className="mt-4">
            <Progress
              value={v.utilization}
              tone={v.utilization > 90 ? "danger" : v.utilization > 75 ? "warning" : "default"}
              label={`استخدام بند ${v.category}`}
            />
            <p className="mt-2 text-sm" style={{ color: "var(--ink-muted)" }}>
              {pct(v.utilizationAfter)} من المعتمد بعد تكلفة هذه الخطة فقط. المخطط {egp(v.planned)}.
              {v.hasMultipleBudgetScopes ? " توجد أكثر من موازنة محتملة لهذا البند؛ استُخدم أعلى سقف منفرد للمراجعة." : ""}
            </p>
          </div>
        </Card>
      ))}

      {needsOwner && pr && blockingOrWarningView && (
        <Card title="التوجيه">
          <p className="mb-3">{budgetRoutingTextAr(blockingOrWarningView)}</p>
          <Link
            href={`/purchase-requests/${pr}`}
            className="inline-flex min-h-10 items-center justify-center rounded-md px-4 text-sm font-semibold"
            style={{ color: "var(--on-brand)", background: "var(--brand)" }}
          >
            الذهاب إلى طلب الشراء للاعتماد
          </Link>
        </Card>
      )}
    </div>
  );
}
