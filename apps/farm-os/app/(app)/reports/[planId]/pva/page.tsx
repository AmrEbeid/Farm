import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Card, Stat, EmptyState } from "@/components/ui";
import { VarianceChart } from "@/components/charts";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { egp, num, pct } from "@/lib/money";

const SUBTYPE_AR: Record<string, string> = {
  fertilization: "تسميد",
  irrigation: "ري",
  spraying: "رش",
  inspection: "تفتيش",
};

export default async function PlannedVsActualPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  await requireMembership();
  const sb = await createClient();

  const { data: ops } = await sb
    .from("plan_operations")
    .select("id, subtype, est_cost, status, plan_material_requirements(qty, unit)")
    .eq("plan_id", planId)
    .order("priority");

  // actuals from done farm_events for this plan
  const { data: events } = await sb
    .from("farm_event")
    .select("subtype, status, data")
    .eq("plan_id", planId)
    .eq("status", "done");

  const actualByOp = new Map<string, { qty: number; cost: number }>();
  for (const ev of events ?? []) {
    const d = (ev.data ?? {}) as { op_id?: string; actual_qty?: number; actual_cost?: number };
    if (d.op_id) actualByOp.set(d.op_id, { qty: Number(d.actual_qty ?? 0), cost: Number(d.actual_cost ?? 0) });
  }

  const executed = (ops ?? []).filter((o) => o.status === "done" && actualByOp.has(o.id));

  const rows = executed.map((o) => {
    const req = (o.plan_material_requirements ?? [])[0] as { qty?: number; unit?: string } | undefined;
    const plannedQty = Number(req?.qty ?? 0);
    const plannedCost = Number(o.est_cost ?? 0);
    const act = actualByOp.get(o.id)!;
    const varQty = act.qty - plannedQty;
    const varCost = act.cost - plannedCost;
    const varPct = plannedCost > 0 ? Math.round((varCost / plannedCost) * 1000) / 10 : 0;
    return {
      id: o.id,
      op: SUBTYPE_AR[o.subtype ?? ""] ?? o.subtype ?? "—",
      planned_qty: `${num(plannedQty)} ${req?.unit ?? ""}`,
      actual_qty: `${num(act.qty)} ${req?.unit ?? ""}`,
      planned_cost: egp(plannedCost),
      actual_cost: egp(act.cost),
      var_qty: num(varQty),
      var_cost: egp(varCost),
      var_pct: `${varPct}٪`,
    };
  });

  const columns: SimpleColumn[] = [
    { id: "op", header: "العملية" },
    { id: "planned_qty", header: "كمية مخططة", numeric: true },
    { id: "actual_qty", header: "كمية فعلية", numeric: true },
    { id: "planned_cost", header: "تكلفة مخططة", numeric: true },
    { id: "actual_cost", header: "تكلفة فعلية", numeric: true },
    { id: "var_cost", header: "الانحراف", numeric: true },
    { id: "var_pct", header: "%", numeric: true },
  ];

  const totalPlannedCost = executed.reduce((s, o) => s + Number(o.est_cost ?? 0), 0);
  const totalActualCost = executed.reduce((s, o) => s + (actualByOp.get(o.id)?.cost ?? 0), 0);
  const totalVar = totalActualCost - totalPlannedCost;
  const totalVarPct =
    totalPlannedCost > 0 ? Math.round((totalVar / totalPlannedCost) * 1000) / 10 : 0;

  const chartData = executed.map((o) => ({
    category: SUBTYPE_AR[o.subtype ?? ""] ?? o.subtype ?? "—",
    planned: Number(o.est_cost ?? 0),
    actual: actualByOp.get(o.id)?.cost ?? 0,
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">المخطط مقابل الفعلي — الحصوة</h1>
        <p style={{ color: "var(--ink-muted)" }}>خطة يوليو 2025</p>
      </header>

      {executed.length === 0 ? (
        <EmptyState
          title="لا توجد عمليات منفّذة بعد"
          description="نفّذ عملية من شاشة الميدان لرؤية الانحراف."
        />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <Stat label="إجمالي المخطط" value={egp(totalPlannedCost)} />
            <Stat label="إجمالي الفعلي" value={egp(totalActualCost)} />
            <Stat
              label="الانحراف"
              value={egp(totalVar)}
              change={`${totalVarPct}٪`}
              trend={totalVar < 0 ? "down" : totalVar > 0 ? "up" : "flat"}
            />
          </section>

          <Card title="المخطط مقابل الفعلي (تكلفة)">
            <VarianceChart data={chartData} />
          </Card>

          <section>
            <h2 className="mb-3 text-lg font-semibold">التفاصيل</h2>
            <SimpleTable columns={columns} rows={rows} />
          </section>
        </>
      )}
    </div>
  );
}
