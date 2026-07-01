import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { KpiCard, Card, Progress, EmptyState } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { egpValue, num, pct } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { OP_STATUS_AR, PLAN_TYPE_AR, SUBTYPE_AR } from "@/lib/labels";

function planLabel(plan: { type?: string | null; period_start?: string | null } | undefined): string {
  if (!plan) return "—";
  const type = PLAN_TYPE_AR[plan.type ?? ""] ?? "خطة";
  return plan.period_start ? `${type} · ${fmtDate(plan.period_start)}` : type;
}

export default async function ManagerDashboard() {
  // Role-gate: farm_manager/agri_engineer land here via the dashboard router; a
  // wrong role typing the URL is bounced back to the router.
  await requireRole(["farm_manager", "agri_engineer"]);
  const sb = await createClient();

  // The manager's *active* plans for their org (RLS narrows to the active org)
  // — never a single hard-coded demo plan. Operations/checks below are
  // aggregated across every active plan.
  const { data: plans, error: plansError } = await sb
    .from("plans")
    .select("id, type, period_start")
    .eq("status", "active")
    .order("period_start", { ascending: false });
  if (plansError) throw plansError;

  const activePlans = plans ?? [];
  const activePlanIds = activePlans.map((p) => p.id);

  if (activePlanIds.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <h1 className="text-2xl font-bold">لوحة معلومات المدير</h1>
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
        .select("id, subtype, planned_at, est_cost, status, plan_id")
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

  const total = (ops ?? []).length;
  const done = (ops ?? []).filter((o) => o.status === "done").length;
  const blocked = (checks ?? []).filter((c) => c.result === "block").length;
  const readiness = total > 0 ? Math.round((done / total) * 100) : 0;

  const columns: SimpleColumn[] = [
    { id: "subtype", header: "العملية" },
    { id: "plan", header: "الخطة" },
    { id: "planned_at", header: "التاريخ" },
    { id: "cost", header: "التكلفة", numeric: true },
    { id: "status", header: "الحالة", kind: "status" },
  ];
  const rows = (ops ?? []).map((o) => ({
    id: o.id,
    subtype: SUBTYPE_AR[o.subtype ?? ""] ?? "عملية",
    plan: planLabel(planById.get(o.plan_id)),
    planned_at: fmtDate(o.planned_at),
    cost: egpValue(o.est_cost),
    status: OP_STATUS_AR[o.status ?? "planned"] ?? "غير معروف",
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">لوحة معلومات المدير</h1>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="عمليات الخطط النشطة" value={num(total)} />
        <KpiCard label="منفّذة" value={num(done)} />
        <KpiCard label="فحوصات محظورة" value={num(blocked)} deltaDirection={blocked ? "down" : "none"} />
        <KpiCard label="جاهزية الخطط" value={pct(readiness)} />
      </section>

      <Card title="جاهزية تنفيذ الخطط النشطة">
        <Progress value={readiness} label="نسبة العمليات المنفّذة" />
      </Card>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">عمليات الخطط النشطة</h2>
          <Link
            href={activePlans.length === 1 ? `/plans/${activePlans[0].id}` : "/plans"}
            className="inline-flex min-h-8 items-center justify-center rounded-md px-3 text-sm font-semibold"
            style={{
              color: "var(--brand)",
              background: "transparent",
              border: "1px solid var(--line)",
            }}
          >
            {activePlans.length === 1 ? "فتح الخطة" : "كل الخطط النشطة"}
          </Link>
        </div>
        <SimpleTable columns={columns} rows={rows} ariaLabel="عمليات الخطط النشطة" empty="لا توجد عمليات مجدولة." />
      </section>
    </div>
  );
}
