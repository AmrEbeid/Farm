import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { KpiCard, Card, Progress } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { SEED_PLAN_ID } from "@/lib/nav";
import { egpValue, num, pct } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { OP_STATUS_AR, SUBTYPE_AR } from "@/lib/labels";

export default async function ManagerDashboard() {
  // Role-gate: farm_manager/agri_engineer land here via the dashboard router; a
  // wrong role typing the URL is bounced back to the router.
  await requireRole(["farm_manager", "agri_engineer"]);
  const sb = await createClient();

  // Independent reads, issued in parallel.
  const [{ data: ops, error: opsError }, { data: checks, error: checksError }] =
    await Promise.all([
      sb
        .from("plan_operations")
        .select("id, subtype, planned_at, est_cost, status")
        .eq("plan_id", SEED_PLAN_ID)
        .order("planned_at"),
      sb
        .from("plan_checks")
        .select("kind, result")
        .eq("plan_id", SEED_PLAN_ID),
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
    { id: "planned_at", header: "التاريخ" },
    { id: "cost", header: "التكلفة", numeric: true },
    { id: "status", header: "الحالة", kind: "status" },
  ];
  const rows = (ops ?? []).map((o) => ({
    id: o.id,
    subtype: SUBTYPE_AR[o.subtype ?? ""] ?? "عملية",
    planned_at: fmtDate(o.planned_at),
    cost: egpValue(o.est_cost),
    status: OP_STATUS_AR[o.status ?? "planned"] ?? "غير معروف",
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">لوحة معلومات المدير</h1>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="عمليات الخطة" value={num(total)} />
        <KpiCard label="منفّذة" value={num(done)} />
        <KpiCard label="فحوصات محظورة" value={num(blocked)} deltaDirection={blocked ? "down" : "none"} />
        <KpiCard label="جاهزية الخطة" value={pct(readiness)} />
      </section>

      <Card title="جاهزية تنفيذ الخطة">
        <Progress value={readiness} label="نسبة العمليات المنفّذة" />
      </Card>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">خطة الحصوة — يوليو</h2>
          <Link
            href={`/plans/${SEED_PLAN_ID}`}
            className="inline-flex min-h-8 items-center justify-center rounded-md px-3 text-sm font-semibold"
            style={{
              color: "var(--brand)",
              background: "transparent",
              border: "1px solid var(--line)",
            }}
          >
            فتح الخطة
          </Link>
        </div>
        <SimpleTable columns={columns} rows={rows} empty="لا توجد عمليات مجدولة." />
      </section>
    </div>
  );
}
