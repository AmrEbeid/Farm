import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Card, EmptyState } from "@/components/ui";
import { type SimpleColumn } from "@/components/SimpleTable";
import { FilterableTable } from "@/components/FilterableTable";
import { PlanCreateForm } from "@/components/PlanCreateForm";
import { fmtDate } from "@/lib/dates";
import { PLAN_STATUS_AR, PLAN_TYPE_AR } from "@/lib/labels";

const SCOPE_AR: Record<string, string> = {
  farm: "المزرعة",
  sector: "قطاع",
  hawsha: "حوشة",
};

export default async function PlansListPage() {
  const m = await requireMembership();
  const sb = await createClient();
  // plan.write = owner/farm_manager (migration 0055) — the plan-authoring authority.
  const canCreate = ["owner", "farm_manager"].includes(m.role);

  const { data: plans, error } = await sb
    .from("plans")
    .select("id, type, period_start, period_end, scope_type, status")
    .order("period_start", { ascending: false });
  if (error) throw error;

  const columns: SimpleColumn[] = [
    { id: "type", header: "النوع" },
    { id: "period", header: "الفترة" },
    { id: "scope", header: "النطاق" },
    { id: "status", header: "الحالة" },
  ];
  const rows = (plans ?? []).map((p) => ({
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

      {canCreate && <PlanCreateForm />}

      <Card title="كل الخطط">
        {rows.length === 0 ? (
          <EmptyState
            title="لا توجد خطط بعد"
            description={canCreate ? "أنشئ خطة جديدة للبدء." : undefined}
          />
        ) : (
          <FilterableTable
            columns={columns}
            rows={rows}
            empty="لا توجد خطط"
            searchColumns={["type", "period", "scope", "status"]}
            placeholder="ابحث في الخطط…"
          />
        )}
      </Card>
    </div>
  );
}
