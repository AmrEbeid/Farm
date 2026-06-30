import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Card, Stat, EmptyState } from "@/components/ui";
import { Entity360Header } from "@/components/Entity360Header";
import { VarianceChart } from "@/components/charts";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { egp, egpSummary, egpValue, moneyNumber, num, sumMoney } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { SUBTYPE_AR } from "@/lib/labels";

export default async function PlannedVsActualPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  await requireMembership();
  const sb = await createClient();

  // The ops list and the done farm_events both filter by plan_id only; the
  // op_id matching happens in memory below, so the reads are independent.
  const [
    { data: ops, error: opsError },
    { data: events, error: eventsError },
    { data: plan },
  ] = await Promise.all([
      sb
        .from("plan_operations")
        .select("id, subtype, est_cost, status, plan_material_requirements(qty, unit)")
        .eq("plan_id", planId)
        .order("priority"),
      // actuals from done farm_events for this plan
      sb
        .from("farm_event")
        .select("subtype, status, data")
        .eq("plan_id", planId)
        .eq("status", "done"),
      // plan header for the real period (the title must not hardcode a sector/date)
      sb.from("plans").select("period_start, period_end").eq("id", planId).maybeSingle(),
    ]);
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (opsError) throw opsError;
  if (eventsError) throw eventsError;

  const actualByOp = new Map<string, { qty: number; cost: number }>();
  for (const ev of events ?? []) {
    const d = (ev.data ?? {}) as { op_id?: string; actual_qty?: number; actual_cost?: number };
    if (d.op_id) actualByOp.set(d.op_id, { qty: Number(d.actual_qty ?? 0), cost: Number(d.actual_cost ?? 0) });
  }

  const executed = (ops ?? []).filter((o) => o.status === "done" && actualByOp.has(o.id));

  const rows = executed.map((o) => {
    const req = (o.plan_material_requirements ?? [])[0] as { qty?: number; unit?: string } | undefined;
    const plannedQty = Number(req?.qty ?? 0);
    const plannedCost = moneyNumber(o.est_cost);
    const act = actualByOp.get(o.id)!;
    const varQty = act.qty - plannedQty;
    const varCost = plannedCost == null ? null : act.cost - plannedCost;
    const varPct =
      plannedCost != null && plannedCost > 0
        ? Math.round(((varCost ?? 0) / plannedCost) * 1000) / 10
        : null;
    return {
      id: o.id,
      op: SUBTYPE_AR[o.subtype ?? ""] ?? "عملية",
      planned_qty: `${num(plannedQty)} ${req?.unit ?? ""}`,
      actual_qty: `${num(act.qty)} ${req?.unit ?? ""}`,
      planned_cost: egpValue(o.est_cost),
      actual_cost: egp(act.cost),
      var_qty: num(varQty),
      var_cost: egp(varCost),
      var_pct: varPct == null ? "—" : `${num(varPct, 1)}٪`,
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

  const totalPlannedCost = sumMoney(executed.map((o) => o.est_cost));
  const totalActualCost = executed.reduce((s, o) => s + (actualByOp.get(o.id)?.cost ?? 0), 0);
  const totalVar = totalPlannedCost.hasUnknown ? null : totalActualCost - totalPlannedCost.total;
  const totalVarPct =
    totalVar != null && totalPlannedCost.total > 0
      ? Math.round((totalVar / totalPlannedCost.total) * 1000) / 10
      : null;

  const chartData = executed.map((o) => ({
    category: SUBTYPE_AR[o.subtype ?? ""] ?? "عملية",
    planned: moneyNumber(o.est_cost) ?? 0,
    actual: actualByOp.get(o.id)?.cost ?? 0,
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <Entity360Header
        title="المخطط مقابل الفعلي"
        subtitle={
          plan?.period_start && plan?.period_end
            ? `${fmtDate(plan.period_start)} إلى ${fmtDate(plan.period_end)}`
            : undefined
        }
        pills={
          executed.length === 0
            ? []
            : [
                totalPlannedCost.hasUnknown
                  ? { status: "warning", label: "تكلفة مخططة غير معروفة" }
                  : totalVar != null && totalVar > 0
                    ? { status: "warning", label: "تجاوز التكلفة" }
                    : { status: "active", label: "ضمن المخطط" },
              ]
        }
        actions={
          <Link
            href={`/plans/${planId}`}
            className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold"
            style={{ color: "var(--brand)", background: "var(--surface)", border: "1px solid var(--line)" }}
          >
            ملف الخطة
          </Link>
        }
      />

      {executed.length === 0 ? (
        <EmptyState
          title="لا توجد عمليات منفّذة بعد"
          description="نفّذ عملية من شاشة الميدان لرؤية الانحراف."
        />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <Stat label="إجمالي المخطط" value={egpSummary(totalPlannedCost)} />
            <Stat label="إجمالي الفعلي" value={egp(totalActualCost)} />
            <Stat
              label="الانحراف"
              value={egp(totalVar)}
              change={totalVarPct == null ? "—" : `${num(totalVarPct, 1)}٪`}
              trend={totalVar == null || totalVar === 0 ? "flat" : totalVar < 0 ? "down" : "up"}
            />
          </section>

          {totalPlannedCost.hasUnknown ? (
            <Card title="المخطط مقابل الفعلي (تكلفة)">
              <p style={{ color: "var(--ink-muted)" }}>
                لا يمكن رسم انحراف تكلفة دقيق لأن تكلفة مخططة واحدة أو أكثر غير معروفة.
              </p>
            </Card>
          ) : (
            <Card title="المخطط مقابل الفعلي (تكلفة)">
              <VarianceChart data={chartData} />
            </Card>
          )}

          <section>
            <h2 className="mb-3 text-lg font-semibold">التفاصيل</h2>
            <SimpleTable columns={columns} rows={rows} />
          </section>
        </>
      )}
    </div>
  );
}
