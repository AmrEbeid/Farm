import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Alert, Button, Card, LoopStepper, type LoopStep } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { OperationBuilder } from "@/components/OperationBuilder";
import { PlanChecksRunner } from "@/components/PlanChecksRunner";
import { POTASSIUM_ID } from "@/lib/nav";
import { egp } from "@/lib/money";

const SUBTYPE_AR: Record<string, string> = {
  fertilization: "تسميد",
  irrigation: "ري",
  spraying: "رش",
  pollination: "تلقيح",
  inspection: "تفتيش",
};

const CHECK_AR: Record<string, string> = {
  stock: "المخزون",
  budget: "الموازنة",
  weather: "الطقس",
  labor: "العمالة",
  responsibility: "المسؤولية",
};

export default async function MonthlyPlanPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  await requireMembership();
  const sb = await createClient();

  // These four reads are independent, so issue them in parallel.
  const [{ data: plan }, { data: ops }, { data: checks }, { data: items }] =
    await Promise.all([
      sb
        .from("plans")
        .select("id, type, period_start, period_end, scope_type, status")
        .eq("id", planId)
        .maybeSingle(),
      sb
        .from("plan_operations")
        .select("id, subtype, planned_at, est_cost, status, approval_needed")
        .eq("plan_id", planId)
        .order("planned_at"),
      sb
        .from("plan_checks")
        .select("kind, result, detail")
        .eq("plan_id", planId),
      sb.from("inventory_items").select("id, name, unit").order("name"),
    ]);

  const opColumns: SimpleColumn[] = [
    { id: "subtype", header: "العملية" },
    { id: "planned_at", header: "التاريخ" },
    { id: "cost", header: "التكلفة", numeric: true },
    { id: "approval", header: "موافقة؟" },
    { id: "status", header: "الحالة", kind: "status" },
  ];
  const opRows = (ops ?? []).map((o) => ({
    id: o.id,
    subtype: SUBTYPE_AR[o.subtype ?? ""] ?? o.subtype ?? "—",
    planned_at: o.planned_at ?? "—",
    cost: egp(Number(o.est_cost ?? 0)),
    approval: o.approval_needed ? "نعم" : "لا",
    status: o.status ?? "planned",
  }));

  const stockCheck = (checks ?? []).find((c) => c.kind === "stock");
  const budgetCheck = (checks ?? []).find((c) => c.kind === "budget");
  const blocked = (checks ?? []).some((c) => c.result === "block");

  const steps: LoopStep[] = [
    { id: "plan", label: "الخطة", state: "active" },
    { id: "check", label: "الفحوصات", state: blocked ? "blocked" : "done" },
    { id: "coverage", label: "تغطية المخزون", state: stockCheck?.result === "block" ? "active" : "pending" },
    { id: "pr", label: "طلب الشراء", state: "pending" },
    { id: "approve", label: "الاعتماد", state: "pending" },
    { id: "execute", label: "التنفيذ", state: "pending" },
    { id: "report", label: "المخطط مقابل الفعلي", state: "pending" },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">الخطة الشهرية — الحصوة</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            {plan?.period_start} إلى {plan?.period_end}
          </p>
        </div>
        <div className="flex gap-2">
          <PlanChecksRunner planId={planId} />
          <OperationBuilder planId={planId} items={items ?? []} />
        </div>
      </header>

      <LoopStepper steps={steps} ariaLabel="خطوات الدورة" />

      {blocked && (
        <Alert
          tone="danger"
          title="الخطة محظورة بفحص المخزون"
          description={
            (stockCheck?.detail as Record<string, { message_ar?: string }> | null)
              ? Object.values(
                  stockCheck!.detail as Record<string, { message_ar?: string }>,
                )
                  .map((d) => d.message_ar)
                  .filter(Boolean)
                  .join(" · ")
              : "يوجد نقص متوقع في أحد الأصناف المطلوبة."
          }
        />
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <Card title="فحوصات الخطة">
          <ul className="flex flex-col gap-2">
            {(checks ?? []).map((c) => (
              <li key={c.kind} className="flex items-center justify-between">
                <span>{CHECK_AR[c.kind] ?? c.kind}</span>
                <span
                  style={{
                    color:
                      c.result === "block"
                        ? "var(--danger,#b91c1c)"
                        : c.result === "warn"
                          ? "var(--warning,#b45309)"
                          : "var(--ok,#15803d)",
                  }}
                >
                  {c.result === "block" ? "محظور" : c.result === "warn" ? "منخفض" : "سليم"}
                </span>
              </li>
            ))}
            {(checks ?? []).length === 0 && (
              <li style={{ color: "var(--ink-muted)" }}>لم تُشغّل الفحوصات بعد.</li>
            )}
          </ul>
        </Card>

        <Card title="إجراءات سريعة">
          <div className="flex flex-col gap-3">
            <Link href={`/inventory/${POTASSIUM_ID}/coverage`}>
              <Button variant="primary">عرض تغطية سلفات البوتاسيوم</Button>
            </Link>
            <Link href={`/budget/${planId}/check`}>
              <Button variant="ghost">فحص الموازنة</Button>
            </Link>
            <Link href={`/reports/${planId}/pva`}>
              <Button variant="ghost">تقرير المخطط مقابل الفعلي</Button>
            </Link>
          </div>
          {budgetCheck && (
            <p className="mt-3 text-sm" style={{ color: "var(--ink-muted)" }}>
              الموازنة: {budgetCheck.result === "block" ? "تتطلب اعتماد المالك" : budgetCheck.result === "warn" ? "منخفضة" : "كافية"}
            </p>
          )}
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">العمليات المخطّطة</h2>
        <SimpleTable columns={opColumns} rows={opRows} empty="لا توجد عمليات بعد" />
      </section>
    </div>
  );
}
