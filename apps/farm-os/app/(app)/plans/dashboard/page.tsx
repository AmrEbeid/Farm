import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { CurrentFilterCard } from "@/components/CurrentFilterCard";
import { CategoryDoughnut, CategoryBarChart } from "@/components/charts";
import { fmtDate } from "@/lib/dates";
import { egpSummary, egpValue, moneyNumber, num, sumMoney } from "@/lib/money";
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
  await requireMembership();
  const sb = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [
    { data: plans, error: plansError },
    { data: operations, error: operationsError },
    { data: checks, error: checksError },
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
  ]);
  if (plansError) throw plansError;
  if (operationsError) throw operationsError;
  if (checksError) throw checksError;

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

  const planColumns: SimpleColumn[] = [
    { id: "type", header: "الخطة" },
    { id: "period", header: "الفترة" },
    { id: "scope", header: "النطاق" },
    { id: "status", header: "الحالة", kind: "status" },
    { id: "openOps", header: "عمليات مفتوحة", numeric: true },
    { id: "blockedChecks", header: "فحوص محظورة", numeric: true },
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
      openOps: num(openOpsByPlan.get(p.id) ?? 0),
      blockedChecks: num(blockedByPlan.get(p.id) ?? 0),
    }));

  const operationColumns: SimpleColumn[] = [
    { id: "subtype", header: "العملية" },
    { id: "plan", header: "الخطة" },
    { id: "planned_at", header: "التاريخ" },
    { id: "status", header: "الحالة", kind: "status" },
    { id: "cost", header: "التكلفة", numeric: true },
  ];
  const opsForTable = filter === "due" ? dueOps : executableOps;
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
      cost: egpValue(op.est_cost),
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
        <div className="flex flex-wrap gap-2">
          <HeaderLink href="/plans">كل الخطط</HeaderLink>
          <HeaderLink href="/m">الميدان</HeaderLink>
        </div>
      </header>

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

      <CurrentFilterCard
        label={FILTER_LABEL_AR[filter] ?? "فلتر غير معروف"}
        clearHref="/plans/dashboard"
        showClear={filter !== "all"}
      />

      {(filter === "all" || filter === "plans") && (
        <Card title="خطط تحتاج متابعة">
          {planAttentionRows.length === 0 ? (
            <EmptyState title="لا توجد خطط نشطة تحتاج متابعة" />
          ) : (
            <SimpleTable columns={planColumns} rows={planAttentionRows} ariaLabel="خطط تحتاج متابعة" empty="—" />
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
            <SimpleTable columns={operationColumns} rows={operationRows} ariaLabel={operationCardTitle} empty="—" />
          )}
        </Card>
          )}
          {(filter === "all" || filter === "checks") && (
        <Card title="الفحوص المحظورة">
          {checkRows.length === 0 ? (
            <EmptyState title="لا توجد فحوص محظورة" />
          ) : (
            <SimpleTable columns={checkColumns} rows={checkRows} ariaLabel="الفحوص المحظورة" empty="—" />
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
