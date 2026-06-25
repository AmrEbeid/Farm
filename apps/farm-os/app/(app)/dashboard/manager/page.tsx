import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { KpiCard, Card, Progress, Button } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { SEED_PLAN_ID } from "@/lib/nav";
import { egp } from "@/lib/money";

const SUBTYPE_AR: Record<string, string> = {
  fertilization: "تسميد",
  irrigation: "ري",
  spraying: "رش",
  inspection: "تفتيش",
};

export default async function ManagerDashboard() {
  await requireMembership();
  const sb = await createClient();

  // Independent reads, issued in parallel.
  const [{ data: ops }, { data: checks }] = await Promise.all([
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
    subtype: SUBTYPE_AR[o.subtype ?? ""] ?? o.subtype ?? "—",
    planned_at: o.planned_at ?? "—",
    cost: egp(Number(o.est_cost ?? 0)),
    status: o.status ?? "planned",
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">لوحة تحكم المدير</h1>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="عمليات هذا الشهر" value={String(total)} />
        <KpiCard label="منفّذة" value={String(done)} />
        <KpiCard label="فحوصات محظورة" value={String(blocked)} deltaDirection={blocked ? "down" : "none"} />
        <KpiCard label="جاهزية الخطة" value={`${readiness}٪`} />
      </section>

      <Card title="جاهزية تنفيذ الخطة">
        <Progress value={readiness} label="نسبة العمليات المنفّذة" />
      </Card>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">خطة الحصوة — يوليو</h2>
          <Link href={`/plans/${SEED_PLAN_ID}`}>
            <Button variant="ghost" size="sm">فتح الخطة</Button>
          </Link>
        </div>
        <SimpleTable columns={columns} rows={rows} empty="لا توجد عمليات مجدولة." />
      </section>
    </div>
  );
}
