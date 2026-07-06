import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Breadcrumbs, Card, Stat, EmptyState } from "@/components/ui";
import { Entity360Header } from "@/components/Entity360Header";
import { VarianceChart } from "@/components/charts";
import { PrintButton } from "@/components/print-button";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { OperationAssignees, type AssigneeInfo } from "@/components/OperationAssignees";
import { egp, egpSummary, egpValue, moneyNumber, num, sumMoney } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { SUBTYPE_AR } from "@/lib/labels";
import { computeLaborCostRollup, type LaborRequirementCostInput } from "@/lib/payroll";
import { materialActualQtyForRequirement, type MaterialActual } from "@/lib/pva-materials";

export default async function PlannedVsActualPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  const m = await requireMembership();
  const sb = await createClient();

  // The ops list and the done farm_events both filter by plan_id only; the
  // op_id matching happens in memory below, so the reads are independent.
  const [
    { data: ops, error: opsError },
    { data: events, error: eventsError },
    { data: plan },
    { data: canSeeLaborCost },
  ] = await Promise.all([
      sb
        .from("plan_operations")
        .select(
          "id, subtype, est_cost, status, plan_material_requirements(id, item_id, qty, unit), plan_labor_requirements(id, count, days, person_id)",
        )
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
      // Labor cost is wage-derived (SPEC-0006 confidentiality): only owner/accountant (payroll.read)
      // ever see it. Everyone else gets the page exactly as before — no labor-cost column at all,
      // never an ambiguous "hidden"/"unpriced" state that could be confused with a real unknown cost.
      sb.rpc("authorize", { perm: "payroll.read", p_org: m.orgId }),
    ]);
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (opsError) throw opsError;
  if (eventsError) throw eventsError;

  // ── Planned labor cost rollup (payroll.read only) ───────────────────────────────────────────────
  // people_compensation is itself RLS-gated to payroll.read (migration 0046/0072/0079), so this read
  // naturally returns nothing for an unauthorized caller — the `canSeeLaborCost` check above is
  // defense-in-depth, not the only gate, and the UI simply never renders the section otherwise.
  const laborByOp = new Map<string, ReturnType<typeof computeLaborCostRollup>>();
  if (canSeeLaborCost) {
    const personIds = new Set<string>();
    for (const o of ops ?? []) {
      for (const l of (o.plan_labor_requirements ?? []) as { person_id: string | null }[]) {
        if (l.person_id) personIds.add(l.person_id);
      }
    }
    const rates = new Map<string, number>();
    if (personIds.size > 0) {
      const { data: comp, error: compErr } = await sb
        .from("people_compensation")
        .select("person_id, rate")
        .in("person_id", [...personIds]);
      // A failed read must not silently render every labor line as "unpriced" as if genuinely
      // unknown — surface it like the other read errors on this page.
      if (compErr) throw compErr;
      for (const row of comp ?? []) {
        if (typeof row.rate === "number" && Number.isFinite(row.rate) && row.rate > 0) {
          rates.set(row.person_id, row.rate);
        }
      }
    }
    for (const o of ops ?? []) {
      const lines: LaborRequirementCostInput[] = (
        (o.plan_labor_requirements ?? []) as {
          id: string;
          count: number | null;
          days: number | null;
          person_id: string | null;
        }[]
      ).map((l) => ({ id: l.id, count: l.count, days: l.days, personId: l.person_id }));
      laborByOp.set(o.id, computeLaborCostRollup(lines, rates));
    }
  }

  // #520: a done farm_event now carries `material_actuals` (one entry per material on the op) —
  // `actual_qty`/(the legacy scalar) stays meaningful only for a 0/1-material op (null for >1, where
  // no single quantity/unit is coherent across different materials). Older events (recorded before
  // this migration) never had material_actuals at all — the per-op fallback below covers them.
  const actualByOp = new Map<string, { qty: number; cost: number; materialActuals: MaterialActual[] | null }>();
  for (const ev of events ?? []) {
    const d = (ev.data ?? {}) as {
      op_id?: string;
      actual_qty?: number | null;
      actual_cost?: number;
      material_actuals?: MaterialActual[];
    };
    if (d.op_id) {
      actualByOp.set(d.op_id, {
        qty: Number(d.actual_qty ?? 0),
        cost: Number(d.actual_cost ?? 0),
        materialActuals: Array.isArray(d.material_actuals) ? d.material_actuals : null,
      });
    }
  }

  const executed = (ops ?? []).filter((o) => o.status === "done" && actualByOp.has(o.id));

  // Who was actually assigned to each executed operation (#398 follow-up — accountability: the PvA
  // report is exactly where "who did this" matters). Two flat, non-embedded reads, mirroring the plans
  // page (see lib/database.types.ext.ts for why this table isn't embed-typed).
  const executedOpIds = executed.map((o) => o.id);
  const { data: assigneeRows, error: assigneesError } = executedOpIds.length
    ? await sb
        .from("plan_operation_assignees")
        .select("id, plan_op_id, person_id, is_lead")
        .in("plan_op_id", executedOpIds)
    : { data: [], error: null };
  if (assigneesError) throw assigneesError;

  const assigneePersonIds = [...new Set((assigneeRows ?? []).map((a) => a.person_id))];
  const { data: assigneePeople, error: assigneePeopleError } = assigneePersonIds.length
    ? await sb.from("people").select("id, name").in("id", assigneePersonIds)
    : { data: [], error: null };
  if (assigneePeopleError) throw assigneePeopleError;
  const assigneeNameById = new Map((assigneePeople ?? []).map((p) => [p.id, p.name]));

  const assigneesByOp = new Map<string, AssigneeInfo[]>();
  for (const row of assigneeRows ?? []) {
    const list = assigneesByOp.get(row.plan_op_id) ?? [];
    list.push({
      id: row.id,
      personId: row.person_id,
      name: assigneeNameById.get(row.person_id) ?? "غير معروف",
      isLead: row.is_lead,
    });
    assigneesByOp.set(row.plan_op_id, list);
  }

  const rows = executed.map((o) => {
    const reqs = (o.plan_material_requirements ?? []) as Array<{
      id?: string;
      item_id?: string;
      qty?: number;
      unit?: string;
    }>;
    const act = actualByOp.get(o.id)!;
    const plannedCost = moneyNumber(o.est_cost);
    const varCost = plannedCost == null ? null : act.cost - plannedCost;
    const varPct =
      plannedCost != null && plannedCost > 0
        ? Math.round(((varCost ?? 0) / plannedCost) * 1000) / 10
        : null;

    // Quantity display: the common (0/1-material) case renders one "qty unit" value exactly as
    // before #520. A >1-material op renders one "qty unit" per material, joined — a single scalar
    // has no coherent meaning once units/quantities differ across materials, so var_qty is left as
    // "—" for that case rather than showing a misleading combined number.
    let plannedQtyStr: string;
    let actualQtyStr: string;
    let varQtyStr: string;
    if (reqs.length === 0) {
      plannedQtyStr = "—";
      actualQtyStr = "—";
      varQtyStr = "—";
    } else if (reqs.length === 1) {
      const req = reqs[0];
      const plannedQty = Number(req.qty ?? 0);
      // Legacy events (recorded before #520) have no material_actuals; fall back to the scalar.
      const actualQty = materialActualQtyForRequirement(req, act.materialActuals, act.qty);
      plannedQtyStr = `${num(plannedQty)} ${req.unit ?? ""}`;
      actualQtyStr = actualQty == null ? "—" : `${num(actualQty)} ${req.unit ?? ""}`;
      varQtyStr = actualQty == null ? "—" : num(actualQty - plannedQty);
    } else {
      plannedQtyStr = reqs.map((r) => `${num(Number(r.qty ?? 0))} ${r.unit ?? ""}`).join("، ");
      actualQtyStr = reqs
        .map((r) => {
          const a = materialActualQtyForRequirement(r, act.materialActuals);
          return `${a == null ? "—" : num(Number(a))} ${r.unit ?? ""}`;
        })
        .join("، ");
      varQtyStr = "—";
    }

    // cost_per_operation = material cost (est_cost — this codebase has no per-unit material-price
    // model to derive a true bottom-up material cost, so est_cost is the closest existing proxy;
    // machinery is out of scope entirely — no machinery data model exists yet) + planned labor cost
    // (this PR). payroll.read only; the section is entirely absent otherwise (see canSeeLaborCost).
    const labor = laborByOp.get(o.id);
    const laborCostLabel = labor
      ? labor.hasUnpriced
        ? labor.total > 0
          ? `${egp(labor.total)} + غير مسعّر`
          : "غير مسعّر"
        : egp(labor.total)
      : undefined;
    const totalCostLabel =
      labor && plannedCost != null
        ? labor.hasUnpriced
          ? `${egp(plannedCost + labor.total)} + غير مسعّر`
          : egp(plannedCost + labor.total)
        : undefined;

    return {
      id: o.id,
      op: SUBTYPE_AR[o.subtype ?? ""] ?? "عملية",
      planned_qty: plannedQtyStr,
      actual_qty: actualQtyStr,
      planned_cost: egpValue(o.est_cost),
      actual_cost: egp(act.cost),
      var_qty: varQtyStr,
      var_cost: egp(varCost),
      var_pct: varPct == null ? "—" : `${num(varPct, 1)}٪`,
      ...(laborCostLabel != null ? { labor_cost: laborCostLabel } : {}),
      ...(totalCostLabel != null ? { total_cost: totalCostLabel } : {}),
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
    {
      id: "assignees",
      header: "المكلّفون",
      // Read-only here (canRemove=false): un-assigning a person from an operation that has already
      // executed makes no sense — this is the accountability record of who did it, not a live roster.
      render: (row) => (
        <OperationAssignees
          planId={planId}
          opId={row.id}
          assignees={assigneesByOp.get(row.id) ?? []}
          canRemove={false}
        />
      ),
    },
    // Wage-derived — owner/accountant (payroll.read) only; absent from the table for every other
    // role (SPEC-0006 confidentiality: never a new leak of who-earns-what).
    ...(canSeeLaborCost
      ? ([
          { id: "labor_cost", header: "تكلفة العمالة المخططة", numeric: true },
          { id: "total_cost", header: "إجمالي التكلفة (خامات + عمالة)", numeric: true },
        ] as SimpleColumn[])
      : []),
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
      <Breadcrumbs
        ariaLabel="المسار"
        items={[
          { id: "plans", label: "كل الخطط", href: "/plans" },
          {
            id: "plan",
            label: plan?.period_start
              ? `${fmtDate(plan.period_start)} إلى ${fmtDate(plan.period_end)}`
              : "الخطة",
            href: `/plans/${planId}`,
          },
          { id: "pva", label: "المخطط مقابل الفعلي" },
        ]}
      />

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
          <div className="flex flex-wrap gap-2">
            <PrintButton label="طباعة المخطط مقابل الفعلي" />
            <Link
              href={`/plans/${planId}`}
              className="no-print inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold"
              style={{ color: "var(--brand)", background: "var(--surface)", border: "1px solid var(--line)" }}
            >
              ملف الخطة
            </Link>
          </div>
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
            <SimpleTable columns={columns} rows={rows} ariaLabel="التفاصيل" />
          </section>
        </>
      )}
    </div>
  );
}
