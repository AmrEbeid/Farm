import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { KpiCard, Alert, Card, Button } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { egp } from "@/lib/money";

const PR_STATUS_AR: Record<string, string> = {
  draft: "مسودة",
  submitted: "مرسل",
  approved: "معتمد",
  received: "مُستلم",
  rejected: "مرفوض",
};

export default async function OwnerDashboard() {
  const m = await requireMembership();
  const sb = await createClient();

  const { data: prs } = await sb
    .from("purchase_requests")
    .select("id, code, status, reason")
    .order("code", { ascending: false });
  // Scope budget_lines to the caller's org so this stays correct once a 2nd org exists.
  const { data: lines } = await sb
    .from("budget_lines")
    .select("category, approved, committed, actual")
    .eq("org_id", m.orgId);

  const pending = (prs ?? []).filter((p) => p.status === "submitted");
  const overLines = (lines ?? []).filter(
    (b) => Number(b.committed) + Number(b.actual) > Number(b.approved),
  );

  const columns: SimpleColumn[] = [
    { id: "code", header: "الطلب" },
    { id: "reason", header: "السبب" },
    { id: "status", header: "الحالة", kind: "status" },
  ];
  const rows = (prs ?? []).map((p) => ({
    id: p.id,
    href: `/purchase-requests/${p.id}`,
    code: p.code,
    reason: p.reason ?? "—",
    status: PR_STATUS_AR[p.status] ?? p.status,
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">لوحة تحكم المالك</h1>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="المساحة" value="٦٠" unit="فدان" />
        <KpiCard label="موافقات معلّقة" value={String(pending.length)} deltaDirection={pending.length ? "up" : "none"} />
        <KpiCard label="مخاطر المخزون" value="١" delta="سلفات بوتاسيوم" deltaDirection="down" />
        <KpiCard label="بنود متجاوزة" value={String(overLines.length)} />
      </section>

      {pending.length > 0 && (
        <Alert
          tone="warning"
          title={`${pending.length} طلب شراء بانتظار اعتمادك`}
          description="فصل الواجبات: لا يعتمد مقدّم الطلب طلبه."
        />
      )}

      <section className="grid gap-4 lg:grid-cols-3">
        {(lines ?? []).map((b) => {
          const used = Number(b.committed) + Number(b.actual);
          const over = used > Number(b.approved);
          return (
            <Card key={b.category} title={`بند ${b.category}`}>
              <p style={{ color: over ? "var(--danger,#b91c1c)" : "var(--ink)" }}>
                المستخدم {egp(used)} من {egp(Number(b.approved))}
              </p>
            </Card>
          );
        })}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">طلبات الشراء</h2>
          <Link href="/purchase-requests">
            <Button variant="ghost" size="sm">عرض الكل</Button>
          </Link>
        </div>
        <SimpleTable columns={columns} rows={rows} empty="لا توجد طلبات" />
      </section>
    </div>
  );
}
