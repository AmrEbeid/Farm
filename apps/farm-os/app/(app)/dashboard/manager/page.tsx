import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { QuickNav, AttentionInbox, type AttentionItem } from "@/components/DashboardHub";
import { FirstRunTour } from "@/components/FirstRunTour";
import { KpiCard, Card, Progress, EmptyState } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { PrintButton } from "@/components/print-button";
import { type SimpleColumn } from "@/components/SimpleTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { moneyNumber, num, pct } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { OP_STATUS_AR, PLAN_TYPE_AR, SUBTYPE_AR, isExecutableOpStatus } from "@/lib/labels";

function planLabel(plan: { type?: string | null; period_start?: string | null } | undefined): string {
  if (!plan) return "—";
  const type = PLAN_TYPE_AR[plan.type ?? ""] ?? "خطة";
  return plan.period_start ? `${type} · ${fmtDate(plan.period_start)}` : type;
}

export default async function ManagerDashboard() {
  // Role-gate: farm_manager/agri_engineer land here via the dashboard router; a
  // wrong role typing the URL is bounced back to the router.
  const m = await requireRole(["farm_manager", "agri_engineer"]);
  const sb = await createClient();
  const canSeeOffshoots = m.role === "farm_manager";

  // The manager's *active* plans for their org (RLS narrows to the active org)
  // — never a single hard-coded demo plan. Operations/checks below are
  // aggregated across every active plan.
  const [{ data: plans, error: plansError }, { data: offshootMovements, error: offshootError }] = await Promise.all([
    sb
      .from("plans")
      .select("id, type, period_start")
      .eq("status", "active")
      .order("period_start", { ascending: false }),
    sb.from("offshoot_movements").select("movement_type, qty").eq("org_id", m.orgId),
  ]);
  if (plansError) throw plansError;
  if (offshootError) throw offshootError;

  const activePlans = plans ?? [];
  const activePlanIds = activePlans.map((p) => p.id);
  const offshootProduced = (offshootMovements ?? [])
    .filter((movement) => movement.movement_type === "produce")
    .reduce((sum, movement) => sum + Number(movement.qty ?? 0), 0);
  const offshootUsed = (offshootMovements ?? [])
    .filter((movement) => movement.movement_type === "plant" || movement.movement_type === "replant" || movement.movement_type === "sell")
    .reduce((sum, movement) => sum + Number(movement.qty ?? 0), 0);
  const offshootAvailable = offshootProduced - offshootUsed;

  if (activePlanIds.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--line)" }}>
          <h1 className="text-2xl font-bold">لوحة معلومات المدير</h1>
          <PrintButton label="طباعة لوحة المدير" />
        </header>
        {canSeeOffshoots && (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DashboardKpiLink href="/farm/offshoots" active={false}>
              <KpiCard
                label="فسائل متاحة"
                value={num(offshootAvailable)}
                delta={`${num(offshootProduced)} منتج`}
                deltaDirection={offshootAvailable < 0 ? "down" : "none"}
              />
            </DashboardKpiLink>
          </section>
        )}
        <Card>
          <EmptyState
            title="لا توجد خطط نشطة"
            description="لا توجد خطط بحالة نشطة حاليًا لعرض عملياتها وفحوصها."
          />
        </Card>
      </div>
    );
  }

  const planById = new Map(activePlans.map((p) => [p.id, p]));

  // Independent reads, issued in parallel, scoped to every active plan.
  const [{ data: ops, error: opsError }, { data: checks, error: checksError }] =
    await Promise.all([
      sb
        .from("plan_operations")
        .select("id, subtype, planned_at, est_cost, status, plan_id, responsible_person_id")
        .in("plan_id", activePlanIds)
        .order("planned_at"),
      sb
        .from("plan_checks")
        .select("kind, result, plan_id")
        .in("plan_id", activePlanIds),
    ]);
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (opsError) throw opsError;
  if (checksError) throw checksError;

  const opIds = (ops ?? []).map((op) => op.id);
  const { data: assignees, error: assigneesError } = opIds.length
    ? await sb
        .from("plan_operation_assignees")
        .select("plan_op_id, person_id")
        .in("plan_op_id", opIds)
    : { data: [], error: null };
  if (assigneesError) throw assigneesError;

  const assigneesByOperation = new Map<string, Set<string>>();
  for (const assignee of assignees ?? []) {
    const current = assigneesByOperation.get(assignee.plan_op_id) ?? new Set<string>();
    current.add(assignee.person_id);
    assigneesByOperation.set(assignee.plan_op_id, current);
  }

  const total = (ops ?? []).length;
  const done = (ops ?? []).filter((o) => o.status === "done").length;
  const blocked = (checks ?? []).filter((c) => c.result === "block").length;
  const readiness = total > 0 ? Math.round((done / total) * 100) : 0;
  const linkedPersonId = m.personId;
  const myOps = linkedPersonId
    ? (ops ?? []).filter(
        (op) =>
          op.responsible_person_id === linkedPersonId ||
          (assigneesByOperation.get(op.id)?.has(linkedPersonId) ?? false),
      )
    : [];
  const myOpenOps = myOps.filter((op) => isExecutableOpStatus(op.status));
  const todayKey = new Date().toISOString().slice(0, 10);
  const myDueOps = myOpenOps.filter((op) => op.planned_at != null && String(op.planned_at).slice(0, 10) <= todayKey);
  const unassignedOps = (ops ?? []).filter(
    (op) =>
      isExecutableOpStatus(op.status) &&
      op.responsible_person_id == null &&
      (assigneesByOperation.get(op.id)?.size ?? 0) === 0,
  );

  const columns: SimpleColumn[] = [
    { id: "subtype", header: "العملية" },
    { id: "plan", header: "الخطة" },
    { id: "planned_at", header: "التاريخ" },
    { id: "cost", header: "التكلفة", numeric: true, kind: "money" },
    { id: "status", header: "الحالة", kind: "status" },
  ];
  const rows = (ops ?? []).map((o) => ({
    id: o.id,
    subtype: SUBTYPE_AR[o.subtype ?? ""] ?? "عملية",
    plan: planLabel(planById.get(o.plan_id)),
    planned_at: fmtDate(o.planned_at),
    cost: moneyNumber(o.est_cost) ?? undefined,
    status: OP_STATUS_AR[o.status ?? "planned"] ?? "غير معروف",
  }));

  const myRows = myOpenOps.map((o) => ({
    id: o.id,
    href: `/plans/${o.plan_id}`,
    subtype: SUBTYPE_AR[o.subtype ?? ""] ?? "عملية",
    plan: planLabel(planById.get(o.plan_id)),
    planned_at: fmtDate(o.planned_at),
    cost: moneyNumber(o.est_cost) ?? undefined,
    status: OP_STATUS_AR[o.status ?? "planned"] ?? "غير معروف",
  }));

  // ── U-10 (§2c): the FM hub — operational quick-nav + attention inbox (NO absolute money, decision 8) ──
  const fmAttention: AttentionItem[] = [];
  if (blocked > 0)
    fmAttention.push({ href: "/plans", tone: "act", text: `${num(blocked)} فحص محظور يوقف التنفيذ` });
  if (myDueOps.length > 0)
    fmAttention.push({ href: "/m", tone: "act", text: `${num(myDueOps.length)} مهمة مستحقة عليك اليوم` });
  if (total > 0 && readiness < 50)
    fmAttention.push({ href: "/plans", tone: "watch", text: `جاهزية الخطط ${pct(readiness)} — راجع العمليات المتأخرة` });

  // This dashboard serves farm_manager AND agri_engineer, but /record/plan (owner|farm_manager) and
  // /farm/offshoots (owner|accountant|farm_manager) both exclude agri_engineer — showing those quick-nav
  // tiles unconditionally bounced agri_engineer to /dashboard on tap (SPEC-0030 §5 no-dead-ends).
  // canSeeOffshoots (above) already encodes the offshoots gate; guard the plan tile the same way.
  const canPlan = m.role === "farm_manager";
  const fmQuickNav = [
    { href: "/record", icon: "➕", label: "سجّل" },
    ...(canPlan ? [{ href: "/record/plan", icon: "🗓️", label: "خطة جديدة" }] : []),
    { href: "/m", icon: "📱", label: "الميدان", badge: myDueOps.length },
    { href: "/inventory/dashboard", icon: "📦", label: "المخزون" },
    ...(canSeeOffshoots ? [{ href: "/farm/offshoots", icon: "🌱", label: "الفسائل" }] : []),
    { href: "/reports", icon: "📈", label: "التقارير" },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--line)" }}>
        <h1 className="text-2xl font-bold">لوحة معلومات المدير</h1>
        <PrintButton label="طباعة لوحة المدير" />
      </header>

      <div className="no-print contents">
        <FirstRunTour role={m.role} />
        <QuickNav items={fmQuickNav} />
        <AttentionInbox items={fmAttention} />
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <KpiCard label="عمليات الخطط النشطة" value={num(total)} />
        <KpiCard label="منفّذة" value={num(done)} />
        <KpiCard label="فحوصات محظورة" value={num(blocked)} deltaDirection={blocked ? "down" : "none"} />
        <KpiCard label="جاهزية الخطط" value={pct(readiness)} />
        <DashboardKpiLink href="/m" active={false}>
          <KpiCard
            label="مهامي المفتوحة"
            value={num(myOpenOps.length)}
            delta={myDueOps.length ? `${num(myDueOps.length)} مستحقة` : "لا توجد مستحقة"}
            deltaDirection={myDueOps.length ? "down" : "none"}
          />
        </DashboardKpiLink>
        <DashboardKpiLink href="/people/dashboard?filter=unassigned" active={false}>
          <KpiCard
            label="بلا مسؤول"
            value={num(unassignedOps.length)}
            deltaDirection={unassignedOps.length ? "down" : "none"}
          />
        </DashboardKpiLink>
        {canSeeOffshoots && (
          <DashboardKpiLink href="/farm/offshoots" active={false}>
            <KpiCard
              label="فسائل متاحة"
              value={num(offshootAvailable)}
              delta={`${num(offshootProduced)} منتج`}
              deltaDirection={offshootAvailable < 0 ? "down" : "none"}
            />
          </DashboardKpiLink>
        )}
      </section>

      <Card title="جاهزية تنفيذ الخطط النشطة">
        <Progress value={readiness} label="نسبة العمليات المنفّذة" />
      </Card>

      <Card title="مهامي المسندة">
        {!m.personId ? (
          <EmptyState title="هذا الحساب غير مربوط بعضو فريق" />
        ) : myRows.length === 0 ? (
          <EmptyState title="لا توجد مهام مفتوحة مسندة لك" />
        ) : (
          <FilterableTable
            columns={columns}
            rows={myRows}
            ariaLabel="مهامي المسندة"
            exportFilename="manager-assigned-tasks"
            minRowsForSearch={20}
            empty="—"
          />
        )}
      </Card>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">عمليات الخطط النشطة</h2>
          <Link
            href={activePlans.length === 1 ? `/plans/${activePlans[0].id}` : "/plans"}
            className="no-print inline-flex min-h-8 items-center justify-center rounded-md px-3 text-sm font-semibold"
            style={{
              color: "var(--brand)",
              background: "transparent",
              border: "1px solid var(--line)",
            }}
          >
            {activePlans.length === 1 ? "فتح الخطة" : "كل الخطط النشطة"}
          </Link>
        </div>
        <FilterableTable
          columns={columns}
          rows={rows}
          ariaLabel="عمليات الخطط النشطة"
          searchColumns={["subtype", "plan", "planned_at", "status"]}
          placeholder="ابحث في عمليات الخطط…"
          exportFilename="manager-active-plan-operations"
          minRowsForSearch={8}
          empty="لا توجد عمليات مجدولة."
        />
      </section>
    </div>
  );
}
