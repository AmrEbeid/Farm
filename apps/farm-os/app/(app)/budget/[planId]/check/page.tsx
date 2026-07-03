import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import type { PillStatus } from "@amrebeid/ui";
import { VerdictBanner, KpiCard, Progress, Card } from "@/components/ui";
import { Entity360Header } from "@/components/Entity360Header";
import {
  buildCategoryBudgetView,
  budgetRoutingTextAr,
  budgetVerdictTextAr,
  GENERAL_OPS_BUDGET_CATEGORY,
  summarizePlannedCostByCategory,
  type CategoryBudgetView,
} from "@/lib/budget-check";
import { egp, pct } from "@/lib/money";

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

  // Scope to the caller's org; categories is a short, known list (one row expected per category).
  const { data: lines, error: linesError } = await sb
    .from("budget_lines")
    .select("category, planned, approved, committed, actual")
    .eq("org_id", m.orgId)
    .in("category", categories);
  // Surface DB read failures to the segment error boundary instead of rendering a misleading page.
  if (linesError) throw linesError;
  const lineByCategory = new Map((lines ?? []).map((l) => [l.category, l]));

  const views: CategoryBudgetView[] = categories.map((category) =>
    buildCategoryBudgetView(
      category,
      lineByCategory.get(category),
      plannedByCategory.get(category) ?? { knownCost: 0, unknownCostCount: 0, hasUnknownCost: false },
    ),
  );

  const overallVerdict: CategoryBudgetView["verdict"] = views.some((v) => v.verdict === "block")
    ? "block"
    : views.some((v) => v.verdict === "approval-needed")
      ? "approval-needed"
      : "ok";
  const needsOwner = overallVerdict !== "ok";
  const blockingOrWarningView = views.find((v) => v.verdict === overallVerdict) ?? views[0];

  return (
    <div className="flex flex-col gap-6 p-6">
      <Entity360Header
        title="فحص الموازنة"
        subtitle="فحص كفاية الموازنة قبل تنفيذ عمليات الخطة، لكل بند على حدة"
        pills={[
          overallVerdict === "block"
            ? { status: "blocked" as PillStatus, label: "تجاوز" }
            : overallVerdict === "approval-needed"
              ? { status: "warning" as PillStatus, label: "يتطلب اعتماد" }
              : { status: "active" as PillStatus, label: "كافية" },
        ]}
      />

      {views.map((v) => (
        <Card key={v.category} title={`بند ${v.category}`}>
          <VerdictBanner tone={v.verdict === "block" ? "danger" : v.verdict === "approval-needed" ? "warning" : "ok"}>
            {budgetVerdictTextAr(v)}
          </VerdictBanner>

          <section className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="المعتمد" value={egp(v.approved)} />
            <KpiCard label="المنصرف الفعلي" value={egp(v.actual)} />
            <KpiCard label="المرتبط (ملتزم)" value={egp(v.committed)} />
            <KpiCard
              label="المتاح"
              value={egp(v.available)}
              delta={`عمليات هذا البند ${egp(v.thisOp)}${v.hasUnknownCost ? " + تكلفة غير معروفة" : ""}`}
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
              {pct(v.utilization)} من المعتمد ({egp(v.approved)}) مستخدم. المخطط {egp(v.planned)}.
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
