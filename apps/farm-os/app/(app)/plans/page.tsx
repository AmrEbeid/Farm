import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Card, EmptyState } from "@/components/ui";
import { type SimpleColumn } from "@/components/SimpleTable";
import { FilterableTable } from "@/components/FilterableTable";
import { PlanCreateForm } from "@/components/PlanCreateForm";
import { fmtDate } from "@/lib/dates";

const PLAN_TYPE_AR: Record<string, string> = {
  weekly: "أسبوعية",
  monthly: "شهرية",
  quarterly: "ربع سنوية",
  annual: "سنوية",
};

const PLAN_STATUS_AR: Record<string, string> = {
  draft: "مسودة",
  active: "نشطة",
  closed: "مغلقة",
  abandoned: "ملغاة",
};

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
    type: PLAN_TYPE_AR[p.type ?? ""] ?? p.type ?? "—",
    period:
      p.period_start || p.period_end
        ? `${p.period_start ? fmtDate(p.period_start) : "—"} ← ${p.period_end ? fmtDate(p.period_end) : "—"}`
        : "—",
    scope: SCOPE_AR[p.scope_type ?? ""] ?? p.scope_type ?? "—",
    status: PLAN_STATUS_AR[p.status ?? ""] ?? p.status ?? "—",
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">الخطط</h1>

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
            exportFilename="plans"
          />
        )}
      </Card>
    </div>
  );
}
