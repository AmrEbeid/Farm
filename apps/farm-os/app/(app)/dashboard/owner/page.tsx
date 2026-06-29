import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { KpiCard, Alert, Card, Button } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { egp, num } from "@/lib/money";
import { PR_STATUS_AR } from "@/lib/labels";

export default async function OwnerDashboard() {
  // Role-gate: owner/accountant land here via the dashboard router; a wrong role
  // typing the URL is bounced back to the router (which routes to its own home).
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();

  // Independent reads, issued in parallel.
  const [{ data: prs, error: prsError }, { data: lines, error: linesError }] =
    await Promise.all([
      sb
        .from("purchase_requests")
        .select("id, code, status, reason")
        .order("code", { ascending: false }),
      // Scope budget_lines to the caller's org so this stays correct once a 2nd org exists.
      sb
        .from("budget_lines")
        .select("category, approved, committed, actual")
        .eq("org_id", m.orgId),
    ]);
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (prsError) throw prsError;
  if (linesError) throw linesError;

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
    status: PR_STATUS_AR[p.status] ?? "غير معروف",
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">لوحة تحكم المالك</h1>

      {/*
        KPI tiles must be query-derived, never literals (non-negotiable #1). The
        previous "المساحة ٦٠ فدان" and "مخاطر المخزون ١" tiles were hardcoded and went
        stale (the risk tile stayed "١" even after the shortage was resolved), so they
        were removed. Re-add them only when backed by real reads (area from the farm
        registry; stock-risk count from the coverage engine) — that derivation is a
        separate, reviewed slice. The two tiles below are derived from real rows.
      */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
        <KpiCard label="موافقات معلّقة" value={num(pending.length)} deltaDirection={pending.length ? "up" : "none"} />
        <KpiCard label="بنود متجاوزة" value={num(overLines.length)} deltaDirection={overLines.length ? "down" : "none"} />
      </section>

      {pending.length > 0 && (
        <Alert
          tone="warning"
          title={`${num(pending.length)} طلب شراء بانتظار اعتمادك`}
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
                {over && " (متجاوز)"}
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
        <SimpleTable columns={columns} rows={rows} empty="لا توجد طلبات شراء بعد." />
      </section>
    </div>
  );
}
