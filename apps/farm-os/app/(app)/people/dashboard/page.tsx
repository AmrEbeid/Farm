import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { CurrentFilterCard } from "@/components/CurrentFilterCard";
import { CategoryBarChart, CategoryDoughnut } from "@/components/charts";
import { fmtDate } from "@/lib/dates";
import { egp, num } from "@/lib/money";
import { EMP_TYPE_AR, OP_STATUS_AR, PLAN_TYPE_AR, SUBTYPE_AR, isExecutableOpStatus } from "@/lib/labels";
import { computePayroll, type LaborEntry } from "@/lib/payroll";

type PlanEmbed = {
  type?: string | null;
  period_start?: string | null;
  period_end?: string | null;
};

const FILTER_LABEL_AR: Record<string, string> = {
  all: "كل الجداول",
  workload: "عبء العمل",
  unassigned: "عمليات بلا مسؤول",
  directory: "دليل الفريق",
};

export default async function PeopleDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter = "all" } = await searchParams;
  const m = await requireRole(["owner", "farm_manager", "agri_engineer", "accountant"]);
  const sb = await createClient();

  // Current calendar month, for the payroll ESTIMATE below (a rolling window, not a closed/idempotent
  // payroll run — see the PR description for that scope decision).
  const now = new Date();
  const periodStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const periodEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const periodEnd = periodEndDate.toISOString().slice(0, 10);

  const [
    { data: people, error: peopleError },
    { data: operations, error: operationsError },
    { data: canSeePayroll },
  ] = await Promise.all([
    sb
      .from("people")
      .select("id, name, position, employment_type, active, reports_to_person_id")
      .order("name"),
    sb
      .from("plan_operations")
      .select("id, plan_id, subtype, planned_at, status, responsible_person_id, plans(type, period_start, period_end)")
      .order("planned_at")
      .limit(80),
    // Payroll estimate is wage-derived (SPEC-0006 confidentiality): only owner/accountant
    // (payroll.read) ever see it — everyone else gets the dashboard exactly as before.
    sb.rpc("authorize", { perm: "payroll.read", p_org: m.orgId }),
  ]);
  if (peopleError) throw peopleError;
  if (operationsError) throw operationsError;

  // ── Payroll estimate (payroll.read only) — SPEC-0006 slice 3, ATTENDANCE-DERIVED, not a formal
  // closed/idempotent payroll run. `people_compensation` is itself RLS-gated to payroll.read
  // (migration 0046/0072/0079), so this read naturally returns nothing for an unauthorized caller —
  // `canSeePayroll` is defense-in-depth, not the only gate, and the section simply never renders
  // otherwise (mirrors the `reports/[planId]/pva` planned-labor-cost pattern).
  let payrollRun: ReturnType<typeof computePayroll> | null = null;
  if (canSeePayroll) {
    const { data: laborLogs, error: laborError } = await sb
      .from("labor_logs")
      .select("person_id, hours")
      .gte("work_date", periodStart)
      .lte("work_date", periodEnd)
      .not("person_id", "is", null);
    if (laborError) throw laborError;

    const personIds = [...new Set((laborLogs ?? []).map((l) => l.person_id as string))];
    const rates = new Map<string, number>();
    if (personIds.length > 0) {
      const { data: comp, error: compError } = await sb
        .from("people_compensation")
        .select("person_id, rate")
        .in("person_id", personIds);
      if (compError) throw compError;
      for (const row of comp ?? []) {
        if (typeof row.rate === "number" && Number.isFinite(row.rate) && row.rate > 0) {
          rates.set(row.person_id, row.rate);
        }
      }
    }
    const labor: LaborEntry[] = (laborLogs ?? [])
      .filter((l): l is { person_id: string; hours: number } => l.person_id != null)
      .map((l) => ({ personId: l.person_id, hours: Number(l.hours ?? 0) }));
    payrollRun = computePayroll(labor, rates);
  }

  const operationIds = (operations ?? []).map((op) => op.id);
  const { data: assignees, error: assigneesError } = operationIds.length
    ? await sb
        .from("plan_operation_assignees")
        .select("plan_op_id, person_id")
        .in("plan_op_id", operationIds)
    : { data: [], error: null };
  if (assigneesError) throw assigneesError;

  const activePeople = (people ?? []).filter((p) => p.active);
  const openOperations = (operations ?? []).filter((op) => isExecutableOpStatus(op.status));
  const assigneesByOperation = new Map<string, string[]>();
  for (const assignee of assignees ?? []) {
    const current = assigneesByOperation.get(assignee.plan_op_id) ?? [];
    current.push(assignee.person_id);
    assigneesByOperation.set(assignee.plan_op_id, current);
  }
  const assignedOps = openOperations.filter((op) => {
    const current = assigneesByOperation.get(op.id) ?? [];
    return current.length > 0 || Boolean(op.responsible_person_id);
  });
  const unassignedOps = openOperations.filter((op) => {
    const current = assigneesByOperation.get(op.id) ?? [];
    return current.length === 0 && !op.responsible_person_id;
  });
  const typeCounts = activePeople.reduce<Record<string, number>>((acc, person) => {
    const type = person.employment_type ?? "unknown";
    acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {});

  const opsByPerson = new Map<string, number>();
  for (const op of assignedOps) {
    const current = assigneesByOperation.get(op.id) ?? [];
    if (current.length > 0) {
      for (const personId of current) {
        opsByPerson.set(personId, (opsByPerson.get(personId) ?? 0) + 1);
      }
    } else if (op.responsible_person_id) {
      opsByPerson.set(op.responsible_person_id, (opsByPerson.get(op.responsible_person_id) ?? 0) + 1);
    }
  }

  // Chart data — derived from the people / operations already fetched (no new queries).
  // Recharts keys bars by the category value, so the person label must be unique and
  // non-empty: coalesce null names and disambiguate duplicates with a numeric suffix.
  const seenLabels = new Map<string, number>();
  const workloadChartData = activePeople
    .map((person) => ({ name: (person.name ?? "").trim() || "—", ops: opsByPerson.get(person.id) ?? 0 }))
    .filter((d) => d.ops > 0)
    .sort((a, b) => b.ops - a.ops)
    .slice(0, 8)
    .map((d) => {
      const seen = (seenLabels.get(d.name) ?? 0) + 1;
      seenLabels.set(d.name, seen);
      return { person: seen > 1 ? `${d.name} (${num(seen)})` : d.name, "عمليات": d.ops };
    });
  const employmentMix = Object.entries(typeCounts).map(([type, value]) => ({
    name: EMP_TYPE_AR[type] ?? "غير معروف",
    value,
  }));

  const workloadColumns: SimpleColumn[] = [
    { id: "name", header: "الشخص" },
    { id: "position", header: "الوظيفة" },
    { id: "type", header: "نوع التوظيف" },
    { id: "openOps", header: "عمليات مفتوحة", numeric: true },
  ];
  const workloadRows = activePeople
    .map((person) => ({
      id: person.id,
      href: `/people/${person.id}`,
      name: person.name,
      position: person.position ?? "—",
      type: person.employment_type ? EMP_TYPE_AR[person.employment_type] ?? "غير معروف" : "—",
      openOps: num(opsByPerson.get(person.id) ?? 0),
      sortOpenOps: opsByPerson.get(person.id) ?? 0,
    }))
    .sort((a, b) => b.sortOpenOps - a.sortOpenOps)
    .slice(0, 10)
    .map((row) => ({
      id: row.id,
      href: row.href,
      name: row.name,
      position: row.position,
      type: row.type,
      openOps: row.openOps,
    }));

  const operationColumns: SimpleColumn[] = [
    { id: "subtype", header: "العملية" },
    { id: "plan", header: "الخطة" },
    { id: "planned_at", header: "التاريخ" },
    { id: "status", header: "الحالة", kind: "status" },
  ];
  const unassignedRows = unassignedOps.slice(0, 10).map((op) => ({
    id: op.id,
    href: `/plans/${op.plan_id}`,
    subtype: SUBTYPE_AR[op.subtype ?? ""] ?? "عملية",
    plan: planLabel(normalizePlan(op.plans)),
    planned_at: op.planned_at ? fmtDate(op.planned_at) : "—",
    status: OP_STATUS_AR[op.status ?? "planned"] ?? "غير معروف",
  }));

  const directoryColumns: SimpleColumn[] = [
    { id: "name", header: "الاسم" },
    { id: "position", header: "الوظيفة" },
    { id: "type", header: "نوع التوظيف" },
    { id: "active", header: "نشط", kind: "tag-ok" },
  ];
  const directoryRows = activePeople.slice(0, 10).map((person) => ({
    id: person.id,
    href: `/people/${person.id}`,
    name: person.name,
    position: person.position ?? "—",
    type: person.employment_type ? EMP_TYPE_AR[person.employment_type] ?? "غير معروف" : "—",
    active: "نشط",
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">لوحة الفريق</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            متابعة الفريق والتكليفات المفتوحة دون عرض بيانات اتصال أو أجور.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <HeaderLink href="/people">دليل الفريق</HeaderLink>
          <HeaderLink href="/plans/dashboard">لوحة التخطيط</HeaderLink>
          <HeaderLink href="/m">الميدان</HeaderLink>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardKpiLink href="/people/dashboard?filter=directory" active={filter === "directory"}>
          <KpiCard label="أعضاء نشطون" value={num(activePeople.length)} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/people/dashboard?filter=directory" active={filter === "directory"}>
          <KpiCard label="دائمون" value={num(typeCounts.permanent ?? 0)} delta={`${num(typeCounts.seasonal ?? 0)} موسمي`} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/people/dashboard?filter=workload" active={filter === "workload"}>
          <KpiCard label="عمليات مسندة" value={num(assignedOps.length)} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/people/dashboard?filter=unassigned" active={filter === "unassigned"}>
          <KpiCard
            label="عمليات بلا مسؤول"
            value={num(unassignedOps.length)}
            deltaDirection={unassignedOps.length ? "down" : "none"}
          />
        </DashboardKpiLink>
      </section>

      {/* SPEC-0006: يومي/مقاول segmentation alongside دائم/موسمي — a display-layer fix, the labels
          already existed in EMP_TYPE_AR but had no dedicated breakdown here before. */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="دائم" value={num(typeCounts.permanent ?? 0)} />
        <KpiCard label="موسمي" value={num(typeCounts.seasonal ?? 0)} />
        <KpiCard label="يومي" value={num(typeCounts.daily ?? 0)} />
        <KpiCard label="مقاول" value={num(typeCounts.contractor ?? 0)} />
      </section>

      {payrollRun && (
        <Card title="تقدير الأجور (الشهر الحالي)">
          {payrollRun.lines.length === 0 ? (
            <EmptyState title="لا توجد ساعات مسجّلة هذا الشهر" description="سجّل الحضور من صفحة تسجيل الحضور." />
          ) : (
            <>
              <p className="mb-3" style={{ color: "var(--ink-muted)" }}>
                تقدير من سجلات الحضور الفعلية (ساعات × معدل)، وليس رواتب مغلقة رسميًا. الأعضاء بلا معدل
                مسجّل يظهرون بعلامة &quot;غير مسعّر&quot; ولا يُحسب لهم مبلغ.
              </p>
              <SimpleTable
                columns={[
                  { id: "person", header: "الشخص" },
                  { id: "hours", header: "الساعات", numeric: true },
                  { id: "gross", header: "التقدير", numeric: true },
                ]}
                rows={payrollRun.lines.map((line) => ({
                  id: line.personId,
                  href: `/people/${line.personId}`,
                  person: (people ?? []).find((p) => p.id === line.personId)?.name ?? "—",
                  hours: num(line.hours, 1),
                  gross: line.rateMissing ? "غير مسعّر" : egp(line.gross),
                }))}
                ariaLabel="تقدير الأجور"
                empty="—"
              />
              <p className="mt-3 font-semibold">الإجمالي: {egp(payrollRun.total)}</p>
            </>
          )}
        </Card>
      )}

      {(filter === "all" || filter === "workload" || filter === "directory") &&
        (workloadChartData.length > 0 || employmentMix.length > 0) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {workloadChartData.length > 0 && (
            <Card title="عبء العمل حسب الشخص">
              <CategoryBarChart
                data={workloadChartData}
                categoryKey="person"
                series={[{ dataKey: "عمليات", name: "عمليات مفتوحة" }]}
                ariaLabel="عبء العمل المفتوح حسب الشخص"
                caption="عبء العمل حسب الشخص"
                columnHeader="الشخص"
              />
            </Card>
          )}
          {employmentMix.length > 0 && (
            <Card title="الفريق حسب نوع التوظيف">
              <CategoryDoughnut
                data={employmentMix}
                ariaLabel="توزيع الفريق حسب نوع التوظيف"
                caption="الفريق حسب نوع التوظيف"
                labelHeader="نوع التوظيف"
                valueHeader="العدد"
              />
            </Card>
          )}
        </section>
      )}

      <CurrentFilterCard
        label={FILTER_LABEL_AR[filter] ?? "فلتر غير معروف"}
        clearHref="/people/dashboard"
        showClear={filter !== "all"}
      />

      {(filter === "all" || filter === "workload") && (
        <Card title="عبء العمل حسب الشخص">
          {workloadRows.length === 0 ? (
            <EmptyState title="لا يوجد أعضاء نشطون" />
          ) : (
            <SimpleTable columns={workloadColumns} rows={workloadRows} ariaLabel="عبء العمل حسب الشخص" empty="—" />
          )}
        </Card>
      )}

      {(filter === "all" || filter === "unassigned" || filter === "directory") && (
        <section className="grid gap-4 xl:grid-cols-2">
          {(filter === "all" || filter === "unassigned") && (
        <Card title="عمليات بلا مسؤول">
          {unassignedRows.length === 0 ? (
            <EmptyState title="لا توجد عمليات بلا مسؤول" />
          ) : (
            <SimpleTable columns={operationColumns} rows={unassignedRows} ariaLabel="عمليات بلا مسؤول" empty="—" />
          )}
        </Card>
          )}
          {(filter === "all" || filter === "directory") && (
        <Card title="دليل الفريق">
          {directoryRows.length === 0 ? (
            <EmptyState title="لا يوجد أعضاء نشطون" />
          ) : (
            <SimpleTable columns={directoryColumns} rows={directoryRows} ariaLabel="دليل الفريق" empty="—" />
          )}
        </Card>
          )}
        </section>
      )}
    </div>
  );
}

function normalizePlan(plan: PlanEmbed | PlanEmbed[] | null): PlanEmbed | null {
  if (Array.isArray(plan)) return plan[0] ?? null;
  return plan;
}

function planLabel(plan: PlanEmbed | null): string {
  if (!plan) return "—";
  const type = PLAN_TYPE_AR[plan.type ?? ""] ?? "خطة";
  const period =
    plan.period_start || plan.period_end
      ? `${plan.period_start ? fmtDate(plan.period_start) : "—"} ← ${plan.period_end ? fmtDate(plan.period_end) : "—"}`
      : "—";
  return `${type} · ${period}`;
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
