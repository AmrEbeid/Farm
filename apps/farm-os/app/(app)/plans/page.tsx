import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { type SimpleColumn } from "@/components/SimpleTable";
import { FilterableTable } from "@/components/FilterableTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { PlanCreateForm } from "@/components/PlanCreateForm";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { PLAN_STATUS_AR, PLAN_TYPE_AR } from "@/lib/labels";

const SCOPE_AR: Record<string, string> = {
  farm: "المزرعة",
  sector: "قطاع",
  hawsha: "حوشة",
};

type PlanFilter = "all" | "active" | "draft" | "closed";

function parsePlanFilter(raw: string | undefined): PlanFilter {
  return raw === "active" || raw === "draft" || raw === "closed" ? raw : "all";
}

export default async function PlansListPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const m = await requireMembership();
  const sb = await createClient();
  const filter = parsePlanFilter((await searchParams).filter);
  // plan.write = owner/farm_manager (migration 0055) — the plan-authoring authority.
  const canCreate = ["owner", "farm_manager"].includes(m.role);

  const todayStr = new Date().toISOString().slice(0, 10);
  const [{ data: plans, error }, { count: dueOps, error: dueError }] = await Promise.all([
    sb.from("plans").select("id, type, period_start, period_end, scope_type, status").order("period_start", {
      ascending: false,
    }),
    // Due/overdue queue size (same semantics as /m's actionable buckets: still planned, date reached).
    sb
      .from("plan_operations")
      .select("id", { count: "exact", head: true })
      .eq("status", "planned")
      .lte("planned_at", todayStr),
  ]);
  if (error) throw error;
  if (dueError) throw dueError;

  const all = plans ?? [];
  const countBy = (status: string) => all.filter((p) => p.status === status).length;
  const chips: { key: PlanFilter; label: string; value: number }[] = [
    { key: "all", label: "كل الخطط", value: all.length },
    { key: "active", label: "نشطة", value: countBy("active") },
    { key: "draft", label: "مسودات", value: countBy("draft") },
    { key: "closed", label: "مغلقة", value: countBy("closed") },
  ];

  const columns: SimpleColumn[] = [
    { id: "type", header: "النوع" },
    { id: "period", header: "الفترة" },
    { id: "scope", header: "النطاق" },
    { id: "status", header: "الحالة", kind: "status" },
  ];
  const rows = all
    .filter((p) => (filter === "all" ? true : p.status === filter))
    .map((p) => ({
      id: p.id,
      href: `/plans/${p.id}`,
      type: PLAN_TYPE_AR[p.type ?? ""] ?? "خطة",
      period:
        p.period_start || p.period_end
          ? `${p.period_start ? fmtDate(p.period_start) : "—"} ← ${p.period_end ? fmtDate(p.period_end) : "—"}`
          : "—",
      scope: SCOPE_AR[p.scope_type ?? ""] ?? "غير معروف",
      status: PLAN_STATUS_AR[p.status ?? ""] ?? "غير معروف",
    }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">الخطط</h1>
          <p style={{ color: "var(--ink-muted)" }}>دليل الخطط؛ ابدأ من لوحة التخطيط لمراجعة الجاهزية والعمليات.</p>
        </div>
        <Link
          href="/plans/dashboard"
          className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold"
          style={{
            color: "var(--brand)",
            background: "var(--surface)",
            border: "1px solid var(--line)",
          }}
        >
          لوحة التخطيط
        </Link>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {chips.map((chip) => (
          <DashboardKpiLink
            key={chip.key}
            href={chip.key === "all" ? "/plans" : `/plans?filter=${chip.key}`}
            active={filter === chip.key}
          >
            <KpiCard label={chip.label} value={num(chip.value)} deltaDirection="none" />
          </DashboardKpiLink>
        ))}
        {/* Different entity (operations, not plans) → deep-links to the dashboard's due queue instead of filtering this table. */}
        <DashboardKpiLink href="/plans/dashboard?filter=due" active={false}>
          <KpiCard
            label="عمليات مستحقة أو متأخرة"
            value={num(dueOps ?? 0)}
            deltaDirection={(dueOps ?? 0) > 0 ? "down" : "none"}
          />
        </DashboardKpiLink>
      </div>

      {canCreate && <PlanCreateForm />}

      <Card title="كل الخطط">
        {rows.length === 0 ? (
          <EmptyState
            title={filter === "all" ? "لا توجد خطط بعد" : "لا توجد خطط مطابقة لهذا الفلتر"}
            description={filter === "all" && canCreate ? "أنشئ خطة جديدة للبدء." : undefined}
          />
        ) : (
          <FilterableTable
            ariaLabel="الخطط"
            columns={columns}
            rows={rows}
            empty="لا توجد خطط"
            searchColumns={["type", "period", "scope", "status"]}
            placeholder="ابحث في الخطط…"
            exportFilename="plans"
          />
        )}
      </Card>
    </div>
  );
}
