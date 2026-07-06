import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn } from "@/components/SimpleTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { CurrentFilterCard } from "@/components/CurrentFilterCard";
import { CategoryDoughnut, CategoryBarChart } from "@/components/charts";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { PrintButton } from "@/components/print-button";
import { fmtDate } from "@/lib/dates";
import { egp, egpSummary, moneyNumber, num, sumMoney } from "@/lib/money";
import { OP_STATUS_AR, PLAN_STATUS_AR, PLAN_TYPE_AR, SUBTYPE_AR, isExecutableOpStatus } from "@/lib/labels";

const SCOPE_AR: Record<string, string> = {
  farm: "المزرعة",
  sector: "قطاع",
  hawsha: "حوشة",
};

const CHECK_AR: Record<string, string> = {
  stock: "المخزون",
  budget: "الموازنة",
  weather: "الطقس",
  labor: "العمالة",
  responsibility: "المسؤولية",
};

type EmbeddedPlan = {
  id?: string;
  type?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  scope_type?: string | null;
  status?: string | null;
};

const FILTER_LABEL_AR: Record<string, string> = {
  all: "كل الجداول",
  plans: "خطط تحتاج متابعة",
  operations: "العمليات القادمة",
  due: "عمليات مستحقة",
  checks: "الفحوص المحظورة",
};

export default async function PlanningDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter = "all" } = await searchParams;
  const m = await requireMembership();
  const sb = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const canOpenFieldDashboard =
    m.role === "owner" || m.role === "farm_manager" || m.role === "agri_engineer" || m.role === "supervisor";

  const [
    { data: plans, error: plansError },
    { data: operations, error: operationsError },
    { data: checks, error: checksError },
    { data: executedOps, error: executedOpsError },
    { data: sectors, error: sectorsError },
    { data: hawshat, error: hawshatError },
    { data: doneEvents, error: doneEventsError },
  ] = await Promise.all([
    sb
      .from("plans")
      .select("id, type, period_start, period_end, scope_type, status")
      .order("period_start", { ascending: false })
      .limit(20),
    sb
      .from("plan_operations")
      .select("id, plan_id, subtype, planned_at, est_cost, status, approval_needed, plans(id, type, period_start, period_end, status)")
      .order("planned_at", { ascending: true })
      .limit(50),
    sb
      .from("plan_checks")
      .select("id, kind, result, plan_id, plans(id, type, period_start, period_end, status)")
      .order("kind")
      .limit(50),
    // Cost-per-operation / cost-per-scope KPIs (SPEC-operational-kpis): only DONE
    // operations carry a real, incurred cost — planned/reserved ops are estimates
    // for the OTHER KPI cards above, not "spend". target_type/target_id is set by
    // fn_add_plan_operation(_multi) from the parent plan's own scope (farm/sector/
    // hawsha), so it is always populated — a real, query-backed dimension, not a
    // free-form field the UI lets users set independently.
    sb
      .from("plan_operations")
      .select("id, subtype, est_cost, target_type, target_id")
      .eq("status", "done"),
    sb.from("sectors").select("id, name").eq("archived", false),
    sb.from("hawshat").select("id, name, palm_count_barhi, palm_count_male").eq("archived", false),
    // Actual cost per executed operation, same source + shape as the per-plan
    // "المخطط مقابل الفعلي" report (reports/[planId]/pva): fn_execute_operation
    // embeds { op_id, actual_cost } in the done farm_event's data jsonb — read
    // here farm-wide and matched to plan_operations.id in memory (mirrors the
    // PVA report's own in-memory join; no DB-side jsonb filter needed).
    sb.from("farm_event").select("status, data").eq("status", "done"),
  ]);
  if (plansError) throw plansError;
  if (operationsError) throw operationsError;
  if (checksError) throw checksError;
  if (executedOpsError) throw executedOpsError;
  if (sectorsError) throw sectorsError;
  if (hawshatError) throw hawshatError;
  if (doneEventsError) throw doneEventsError;

  const planRowsById = new Map((plans ?? []).map((p) => [p.id, p]));
  const activePlans = (plans ?? []).filter((p) => p.status === "active");
  const executableOps = (operations ?? []).filter((o) => isExecutableOpStatus(o.status));
  const dueOps = executableOps.filter((o) => (o.planned_at ?? "") <= today);
  const blockedChecks = (checks ?? []).filter((c) => c.result === "block");
  const estimatedCost = sumMoney(executableOps.map((o) => o.est_cost));

  const blockedByPlan = new Map<string, number>();
  for (const check of blockedChecks) {
    blockedByPlan.set(check.plan_id, (blockedByPlan.get(check.plan_id) ?? 0) + 1);
  }
  const openOpsByPlan = new Map<string, number>();
  for (const op of executableOps) {
    openOpsByPlan.set(op.plan_id, (openOpsByPlan.get(op.plan_id) ?? 0) + 1);
  }

  // Chart data — derived from the operations already fetched (no new queries).
  const opsByStatus = Object.entries(
    executableOps.reduce<Record<string, number>>((acc, o) => {
      const key = o.status ?? "planned";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  ).map(([status, value]) => ({ name: OP_STATUS_AR[status] ?? "غير معروف", value }));
  const costByPlanType = Object.entries(
    executableOps.reduce<Record<string, number>>((acc, o) => {
      const embedded = normalizePlan(o.plans);
      const plan = embedded?.id ? embedded : planRowsById.get(o.plan_id);
      const label = PLAN_TYPE_AR[plan?.type ?? ""] ?? "خطة";
      const cost = moneyNumber(o.est_cost);
      if (cost != null) acc[label] = (acc[label] ?? 0) + cost;
      return acc;
    }, {}),
  )
    .filter(([, cost]) => cost > 0)
    .map(([name, cost]) => ({ plan: name, "التكلفة": cost }));

  // ── Operational cost KPIs (real data only — done operations, real est_cost) ──
  // "Cost" here is the operation's own planned/estimated cost realized at
  // execution (fn_execute_operation flips status to 'done'; it does not touch
  // est_cost, so this is the same figure booked when the operation was
  // authored — not a separate actuals ledger). No fabricated numbers: an
  // operation with a null est_cost is excluded from the average/sum, exactly
  // like sumMoney/egpSummary do elsewhere on this page.
  const doneOpsWithCost = (executedOps ?? []).filter((o) => moneyNumber(o.est_cost) != null);
  const doneCostSummary = sumMoney((executedOps ?? []).map((o) => o.est_cost));
  const avgCostPerOperation =
    doneOpsWithCost.length > 0 ? doneCostSummary.total / doneOpsWithCost.length : null;

  // Planned vs. actual cost, farm-wide — same op_id → actual_cost join the PVA
  // report does per-plan (reports/[planId]/pva/page.tsx:47-51), applied across
  // all executed operations rather than one plan.
  const actualCostByOp = new Map<string, number>();
  for (const ev of doneEvents ?? []) {
    const d = (ev.data ?? {}) as { op_id?: string; actual_cost?: number };
    if (d.op_id) actualCostByOp.set(d.op_id, Number(d.actual_cost ?? 0));
  }
  const opsWithActuals = doneOpsWithCost.filter((o) => actualCostByOp.has(o.id));
  const totalActualCost = opsWithActuals.reduce((s, o) => s + (actualCostByOp.get(o.id) ?? 0), 0);
  const totalPlannedForActuals = sumMoney(opsWithActuals.map((o) => o.est_cost));
  const costVariance =
    opsWithActuals.length > 0 && !totalPlannedForActuals.hasUnknown
      ? totalActualCost - totalPlannedForActuals.total
      : null;

  const sectorNameById = new Map((sectors ?? []).map((s) => [s.id, s.name]));
  const hawshaById = new Map((hawshat ?? []).map((h) => [h.id, h]));

  // Cost by scope (sector/hawsha) — only operations whose target resolves to a
  // known, non-archived sector/hawsha are counted, so an archived/deleted scope
  // silently drops out rather than showing under a fake "غير معروف" bucket with
  // real money attached to it.
  const costByScope = new Map<string, number>();
  for (const op of executedOps ?? []) {
    const cost = moneyNumber(op.est_cost);
    if (cost == null || cost <= 0 || !op.target_id) continue;
    const label =
      op.target_type === "hawsha"
        ? hawshaById.get(op.target_id)?.name
        : op.target_type === "sector"
          ? sectorNameById.get(op.target_id)
          : op.target_type === "farm"
            ? "المزرعة (عام)"
            : null;
    if (!label) continue;
    costByScope.set(label, (costByScope.get(label) ?? 0) + cost);
  }
  const costByScopeChart = Array.from(costByScope.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, cost]) => ({ scope: name, "التكلفة": cost }));

  // Cost per palm — only for hawsha-scoped spend, divided by that hawsha's own
  // registered palm count (palm_count_barhi + palm_count_male, from the Nov-2025
  // canonical registry). A hawsha with zero registered palms is excluded rather
  // than divided-by-zero or shown as an estimate.
  const hawshaCost = new Map<string, number>();
  for (const op of executedOps ?? []) {
    if (op.target_type !== "hawsha" || !op.target_id) continue;
    const cost = moneyNumber(op.est_cost);
    if (cost == null || cost <= 0) continue;
    hawshaCost.set(op.target_id, (hawshaCost.get(op.target_id) ?? 0) + cost);
  }
  let totalHawshaCost = 0;
  let totalPalmsWithCost = 0;
  for (const [hawshaId, cost] of hawshaCost) {
    const h = hawshaById.get(hawshaId);
    const palms = Number(h?.palm_count_barhi ?? 0) + Number(h?.palm_count_male ?? 0);
    if (palms <= 0) continue;
    totalHawshaCost += cost;
    totalPalmsWithCost += palms;
  }
  const costPerPalm = totalPalmsWithCost > 0 ? totalHawshaCost / totalPalmsWithCost : null;

  const planColumns: SimpleColumn[] = [
    { id: "type", header: "الخطة" },
    { id: "period", header: "الفترة" },
    { id: "scope", header: "النطاق" },
    { id: "status", header: "الحالة", kind: "status" },
    { id: "openOps", header: "عمليات مفتوحة", kind: "num", numeric: true },
    { id: "blockedChecks", header: "فحوص محظورة", kind: "num", numeric: true },
  ];
  const planAttentionRows = activePlans
    .filter((p) => (openOpsByPlan.get(p.id) ?? 0) > 0 || (blockedByPlan.get(p.id) ?? 0) > 0)
    .map((p) => ({
      id: p.id,
      href: `/plans/${p.id}`,
      type: PLAN_TYPE_AR[p.type ?? ""] ?? "خطة",
      period: formatPeriod(p.period_start, p.period_end),
      scope: SCOPE_AR[p.scope_type ?? ""] ?? "غير معروف",
      status: PLAN_STATUS_AR[p.status ?? ""] ?? "غير معروف",
      openOps: openOpsByPlan.get(p.id) ?? 0,
      blockedChecks: blockedByPlan.get(p.id) ?? 0,
    }));

  const operationColumns: SimpleColumn[] = [
    { id: "subtype", header: "العملية" },
    { id: "plan", header: "الخطة" },
    { id: "planned_at", header: "التاريخ" },
    { id: "status", header: "الحالة", kind: "status" },
    { id: "cost", header: "التكلفة", kind: "money", numeric: true },
  ];
  const opsForTable = filter === "due" ? dueOps : executableOps;
  const operationExportFilename =
    filter === "due" ? "plans-dashboard-due-operations" : "plans-dashboard-upcoming-operations";
  const operationRows = opsForTable.slice(0, 12).map((op) => {
    const embedded = normalizePlan(op.plans);
    const plan = embedded?.id ? embedded : planRowsById.get(op.plan_id);
    return {
      id: op.id,
      href: `/plans/${op.plan_id}`,
      subtype: SUBTYPE_AR[op.subtype ?? ""] ?? "عملية",
      plan: planLabel(plan),
      planned_at: op.planned_at ? fmtDate(op.planned_at) : "—",
      status: OP_STATUS_AR[op.status ?? "planned"] ?? "غير معروف",
      cost: moneyNumber(op.est_cost) ?? undefined,
    };
  });

  const operationCardTitle = filter === "due" ? "عمليات مستحقة" : "العمليات القادمة";

  const checkColumns: SimpleColumn[] = [
    { id: "kind", header: "الفحص" },
    { id: "plan", header: "الخطة" },
    { id: "result", header: "النتيجة", kind: "status" },
  ];
  const checkRows = blockedChecks.map((check) => {
    const embedded = normalizePlan(check.plans);
    const plan = embedded?.id ? embedded : planRowsById.get(check.plan_id);
    return {
      id: check.id,
      href: `/plans/${check.plan_id}`,
      kind: CHECK_AR[check.kind] ?? "غير معروف",
      plan: planLabel(plan),
      result: "محظور",
    };
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">لوحة التخطيط والعمليات</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            متابعة الخطط النشطة والعمليات القادمة والفحوص المحظورة من السجلات الفعلية.
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <PrintButton label="طباعة لوحة التخطيط" />
          <HeaderLink href="/plans">كل الخطط</HeaderLink>
          {canOpenFieldDashboard && <HeaderLink href="/m">الميدان</HeaderLink>}
        </div>
      </header>

      {/* First-run guidance: no plans exist yet (already-fetched `plans`, no new
          query) — disappears once the org has a real plan. */}
      {(plans ?? []).length === 0 && (
        <div className="no-print">
          <OnboardingChecklist role={m.role} />
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardKpiLink href="/plans/dashboard?filter=plans" active={filter === "plans"}>
          <KpiCard label="خطط نشطة معروضة" value={num(activePlans.length)} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/plans/dashboard?filter=due" active={filter === "due"}>
          <KpiCard
            label="عمليات مستحقة معروضة"
            value={num(dueOps.length)}
            delta={dueOps.length ? "اليوم أو متأخرة" : "لا توجد"}
            deltaDirection={dueOps.length ? "down" : "none"}
          />
        </DashboardKpiLink>
        <DashboardKpiLink href="/plans/dashboard?filter=checks" active={filter === "checks"}>
          <KpiCard
            label="فحوص محظورة معروضة"
            value={num(blockedChecks.length)}
            deltaDirection={blockedChecks.length ? "down" : "none"}
          />
        </DashboardKpiLink>
        <DashboardKpiLink href="/plans/dashboard?filter=operations" active={filter === "operations"}>
          <KpiCard label="تكلفة مفتوحة معروضة" value={egpSummary(estimatedCost)} />
        </DashboardKpiLink>
      </section>

      {(filter === "all" || filter === "operations" || filter === "due") && opsByStatus.length > 0 && (
        <section className="grid gap-4 lg:grid-cols-2">
          <Card title="العمليات المفتوحة حسب الحالة">
            <CategoryDoughnut
              data={opsByStatus}
              ariaLabel="توزيع العمليات المفتوحة حسب الحالة"
              caption="العمليات حسب الحالة"
              labelHeader="الحالة"
            />
          </Card>
          {costByPlanType.length > 0 && (
            <Card title="التكلفة المفتوحة حسب نوع الخطة">
              <CategoryBarChart
                data={costByPlanType}
                categoryKey="plan"
                series={[{ dataKey: "التكلفة", name: "التكلفة المقدرة (ج.م)" }]}
                ariaLabel="التكلفة المفتوحة حسب نوع الخطة"
                caption="التكلفة المفتوحة حسب نوع الخطة"
                columnHeader="نوع الخطة"
              />
            </Card>
          )}
        </section>
      )}

      {filter === "all" && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-bold">كفاءة التشغيل (من العمليات المنفذة فعليًا)</h2>
          {doneOpsWithCost.length === 0 ? (
            <Card title="تكلفة التشغيل">
              <EmptyState
                title="بيانات غير متوفرة بعد"
                description="لا توجد عمليات مُنفَّذة (منفذ) بتكلفة مسجّلة حتى الآن — ستظهر هذه المؤشرات بعد تنفيذ عمليات ميدانية فعلية."
              />
            </Card>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                  label="متوسط تكلفة العملية المنفذة"
                  value={egp(avgCostPerOperation)}
                  delta={`من ${num(doneOpsWithCost.length)} عملية منفذة`}
                />
                <KpiCard
                  label="متوسط التكلفة لكل نخلة"
                  value={costPerPalm != null ? egp(costPerPalm) : "بيانات غير متوفرة بعد"}
                  delta={costPerPalm != null ? `عبر ${num(totalPalmsWithCost)} نخلة مسجّلة` : "يحتاج حوشات بها نخيل مسجَّل"}
                />
                <KpiCard label="إجمالي تكلفة العمليات المنفذة" value={egp(doneCostSummary.total)} />
                <KpiCard
                  label="انحراف التكلفة (فعلي − مخطط)"
                  value={costVariance != null ? egp(costVariance) : "بيانات غير متوفرة بعد"}
                  delta={costVariance != null ? `عبر ${num(opsWithActuals.length)} عملية` : "يحتاج تكلفة فعلية مسجّلة"}
                  deltaDirection={costVariance != null ? (costVariance > 0 ? "down" : "none") : "none"}
                />
              </div>
              {costByScopeChart.length > 0 && (
                <Card title="تكلفة العمليات المنفذة حسب القطاع/الحوشة">
                  <CategoryBarChart
                    data={costByScopeChart}
                    categoryKey="scope"
                    series={[{ dataKey: "التكلفة", name: "التكلفة (ج.م)" }]}
                    ariaLabel="تكلفة العمليات المنفذة حسب القطاع أو الحوشة"
                    caption="تكلفة العمليات المنفذة حسب القطاع/الحوشة"
                    columnHeader="القطاع/الحوشة"
                  />
                </Card>
              )}
            </>
          )}
        </section>
      )}

      <div className="no-print">
        <CurrentFilterCard
          label={FILTER_LABEL_AR[filter] ?? "فلتر غير معروف"}
          clearHref="/plans/dashboard"
          showClear={filter !== "all"}
        />
      </div>

      {(filter === "all" || filter === "plans") && (
        <Card title="خطط تحتاج متابعة">
          {planAttentionRows.length === 0 ? (
            <EmptyState title="لا توجد خطط نشطة تحتاج متابعة" />
          ) : (
            <FilterableTable
              columns={planColumns}
              rows={planAttentionRows}
              ariaLabel="خطط تحتاج متابعة"
              empty="—"
              exportFilename="plans-dashboard-attention-plans"
            />
          )}
        </Card>
      )}

      {(filter === "all" || filter === "operations" || filter === "due" || filter === "checks") && (
        <section className="grid gap-4 md:grid-cols-2">
          {(filter === "all" || filter === "operations" || filter === "due") && (
            <Card title={operationCardTitle}>
              {operationRows.length === 0 ? (
                <EmptyState title="لا توجد عمليات مفتوحة" />
              ) : (
                <FilterableTable
                  columns={operationColumns}
                  rows={operationRows}
                  ariaLabel={operationCardTitle}
                  empty="—"
                  exportFilename={operationExportFilename}
                />
              )}
            </Card>
          )}
          {(filter === "all" || filter === "checks") && (
            <Card title="الفحوص المحظورة">
              {checkRows.length === 0 ? (
                <EmptyState title="لا توجد فحوص محظورة" />
              ) : (
                <FilterableTable
                  columns={checkColumns}
                  rows={checkRows}
                  ariaLabel="الفحوص المحظورة"
                  empty="—"
                  exportFilename="plans-dashboard-blocked-checks"
                />
              )}
            </Card>
          )}
        </section>
      )}
    </div>
  );
}

function normalizePlan(plan: EmbeddedPlan | EmbeddedPlan[] | null): EmbeddedPlan | null {
  if (Array.isArray(plan)) return plan[0] ?? null;
  return plan;
}

function planLabel(plan: EmbeddedPlan | null | undefined): string {
  if (!plan) return "—";
  const type = PLAN_TYPE_AR[plan.type ?? ""] ?? "خطة";
  return `${type} · ${formatPeriod(plan.period_start, plan.period_end)}`;
}

function formatPeriod(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "—";
  return `${start ? fmtDate(start) : "—"} ← ${end ? fmtDate(end) : "—"}`;
}

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold"
      style={{
        color: "var(--brand)",
        background: "var(--surface)",
        border: "1px solid var(--line)",
      }}
    >
      {children}
    </Link>
  );
}
