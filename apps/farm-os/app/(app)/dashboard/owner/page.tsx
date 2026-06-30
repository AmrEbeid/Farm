import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { KpiCard, Alert, Card, Button, Progress } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { fmtDate } from "@/lib/dates";
import { egp, num, pct } from "@/lib/money";
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
        .select("id, code, status, reason, needed_by")
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

  const budgetLines = lines ?? [];
  const pending = (prs ?? []).filter((p) => p.status === "submitted");
  const overLines = budgetLines.filter(
    (b) => Number(b.committed) + Number(b.actual) > Number(b.approved),
  );

  // KPI strip — every tile is QUERY-DERIVED from the rows above (non-negotiable #1:
  // never a literal). Approved/used/available/utilisation are roll-ups of the
  // org's budget_lines; pending/over-budget are counts. (Area + stock-risk tiles
  // still await their own real reads — farm registry + coverage engine — as a
  // separate slice; nothing here is fabricated.)
  const totalApproved = budgetLines.reduce((s, b) => s + Number(b.approved ?? 0), 0);
  const totalUsed = budgetLines.reduce(
    (s, b) => s + Number(b.committed ?? 0) + Number(b.actual ?? 0),
    0,
  );
  const available = totalApproved - totalUsed;
  const utilisation = totalApproved > 0 ? (totalUsed / totalApproved) * 100 : 0;

  const columns: SimpleColumn[] = [
    { id: "code", header: "الطلب" },
    { id: "reason", header: "السبب" },
    { id: "needed_by", header: "مطلوب بحلول" },
    { id: "status", header: "الحالة", kind: "status" },
  ];
  const rows = (prs ?? []).map((p) => ({
    id: p.id,
    href: `/purchase-requests/${p.id}`,
    code: p.code,
    reason: p.reason ?? "—",
    needed_by: p.needed_by ? fmtDate(p.needed_by) : "—",
    status: PR_STATUS_AR[p.status] ?? "غير معروف",
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page header: title + context + quick actions */}
      <header className="flex flex-wrap items-end justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--line)" }}>
        <div>
          <h1 className="text-2xl font-bold">لوحة معلومات المالك</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>
            نظرة شاملة على الاعتمادات والموازنة والمشتريات — محدّثة من السجلات الفعلية.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/budgets">
            <Button variant="ghost" size="sm">الموازنات</Button>
          </Link>
          <Link href="/purchase-requests">
            <Button variant="primary" size="sm">طلبات الشراء</Button>
          </Link>
        </div>
      </header>

      {/* KPI strip — 6 query-derived metrics (responsive 2 → 3 → 6) */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="موافقات معلّقة" value={num(pending.length)} deltaDirection={pending.length ? "up" : "none"} />
        <KpiCard label="بنود متجاوزة" value={num(overLines.length)} deltaDirection={overLines.length ? "down" : "none"} />
        <KpiCard label="الموازنة المعتمدة" value={egp(totalApproved)} />
        <KpiCard label="المستخدم" value={egp(totalUsed)} />
        <KpiCard label="نسبة الاستخدام" value={pct(utilisation)} />
        <KpiCard label="المتاح" value={egp(available)} deltaDirection={available < 0 ? "down" : "none"} />
      </section>

      {pending.length > 0 && (
        <Alert
          tone="warning"
          title={`${num(pending.length)} طلب شراء بانتظار اعتمادك`}
          description="فصل الواجبات: لا يعتمد مقدّم الطلب طلبه."
        />
      )}

      {/* Budget-line health: detail cards with utilisation bars */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">حالة بنود الموازنة</h2>
          <Link href="/budgets">
            <Button variant="ghost" size="sm">كل الموازنات</Button>
          </Link>
        </div>
        {budgetLines.length === 0 ? (
          <Card><p style={{ color: "var(--ink-muted)" }}>لا توجد بنود موازنة بعد.</p></Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {budgetLines.map((b) => {
              const approved = Number(b.approved);
              const used = Number(b.committed) + Number(b.actual);
              const over = used > approved;
              const ratio = approved > 0 ? used / approved : 0;
              const tone = over ? "danger" : ratio >= 0.85 ? "warning" : "default";
              return (
                <Card key={b.category} title={`بند ${b.category}`}>
                  <p style={{ color: over ? "var(--danger,#b91c1c)" : "var(--ink)" }}>
                    المستخدم {egp(used)} من {egp(approved)}
                    {over && " (متجاوز)"}
                  </p>
                  <div className="mt-3">
                    <Progress value={ratio * 100} tone={tone} label={`نسبة استخدام بند ${b.category}`} />
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Purchase-request directory */}
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
