import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { KpiCard, Alert, Card, Button, Progress } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { fmtDate } from "@/lib/dates";
import { egp, num, pct } from "@/lib/money";
import { PR_STATUS_AR } from "@/lib/labels";

// Plan-operation statuses that are still "live" (pending execution) — used for
// readiness, due-this-week, and unassigned counts. done/blocked/abandoned/skipped
// are terminal and excluded.
const LIVE_OP = new Set(["planned", "approved", "reserved", "ready", "in_progress"]);
const ACTIVE_PLAN = new Set(["active", "approved"]);
const PALM_ATTENTION = new Set(["watch", "sick", "dead"]);

export default async function OwnerDashboard() {
  // Role-gate: owner/accountant land here via the dashboard router; a wrong role
  // typing the URL is bounced back to the router (which routes to its own home).
  await requireRole(["owner", "accountant"]);
  const sb = await createClient();

  // Strategic aggregator: independent org-scoped reads (RLS narrows to the active
  // org) issued in parallel. Every dashboard figure below is derived from one of
  // these rows — non-negotiable #1: never a literal/placeholder.
  const [
    { data: prs, error: prsError },
    { data: lines, error: linesError },
    { data: items, error: itemsError },
    { data: plans, error: plansError },
    { data: ops, error: opsError },
    { data: checks, error: checksError },
    { data: assets, error: assetsError },
  ] = await Promise.all([
    sb.from("purchase_requests").select("id, code, status, reason, needed_by").order("code", { ascending: false }),
    sb.from("budget_lines").select("category, approved, committed, actual"),
    sb.from("inventory_items").select("id, reorder_point, min_stock, inventory_bin(on_hand, reserved)"),
    sb.from("plans").select("id, status"),
    sb.from("plan_operations").select("status, planned_at, responsible_person_id, plan_id"),
    sb.from("plan_checks").select("result, plan_id"),
    sb.from("assets").select("status"),
  ]);
  for (const e of [prsError, linesError, itemsError, plansError, opsError, checksError, assetsError]) {
    if (e) throw e;
  }

  const today = new Date();
  const weekAhead = new Date(today);
  weekAhead.setDate(today.getDate() + 7);
  const isoToday = today.toISOString().slice(0, 10);
  const isoWeek = weekAhead.toISOString().slice(0, 10);

  // ── Derived counts (every one query-backed) ───────────────────────────────
  const purchaseRequests = prs ?? [];
  const budgetLines = lines ?? [];
  const pending = purchaseRequests.filter((p) => p.status === "submitted");
  const overduePOs = purchaseRequests.filter(
    (p) => p.status === "approved" && p.needed_by != null && p.needed_by < isoToday,
  );
  const overLines = budgetLines.filter(
    (b) => Number(b.committed) + Number(b.actual) > Number(b.approved),
  );

  // inventory_bin is a one-to-many embed (an array of bins per item); mirror the
  // inventory dashboard EXACTLY so this count matches /inventory/dashboard?filter=reorder:
  // take the primary bin, available = on_hand − reserved, needs reorder when below threshold.
  const reorderItems = (items ?? []).filter((it) => {
    const bin = (Array.isArray(it.inventory_bin) ? it.inventory_bin[0] : it.inventory_bin) as
      | { on_hand?: number; reserved?: number }
      | null
      | undefined;
    const available = Number(bin?.on_hand ?? 0) - Number(bin?.reserved ?? 0);
    const threshold = Number(it.reorder_point ?? it.min_stock ?? 0);
    return threshold > 0 && available < threshold;
  });

  const activePlanIds = new Set((plans ?? []).filter((p) => ACTIVE_PLAN.has(p.status)).map((p) => p.id));
  const activeOps = (ops ?? []).filter((o) => activePlanIds.has(o.plan_id));
  const doneOps = activeOps.filter((o) => o.status === "done").length;
  const readiness = activeOps.length > 0 ? Math.round((doneOps / activeOps.length) * 100) : 0;
  const dueThisWeek = activeOps.filter(
    (o) => LIVE_OP.has(o.status) && o.planned_at != null && o.planned_at <= isoWeek,
  );
  const unassignedOps = activeOps.filter((o) => LIVE_OP.has(o.status) && o.responsible_person_id == null);
  const blockedChecks = (checks ?? []).filter((c) => c.result === "block" && activePlanIds.has(c.plan_id));
  const palmAttention = (assets ?? []).filter((a) => PALM_ATTENTION.has(a.status));

  const totalApproved = budgetLines.reduce((s, b) => s + Number(b.approved ?? 0), 0);
  const totalUsed = budgetLines.reduce((s, b) => s + Number(b.committed ?? 0) + Number(b.actual ?? 0), 0);
  const available = totalApproved - totalUsed;

  // ── Alert rail: only non-empty alerts, most-severe first, each deep-links ──
  type Att = { key: string; tone: "danger" | "warning"; prio: number; title: string; desc: string; href: string };
  const alerts: Att[] = [
    overLines.length && { key: "budget", tone: "danger", prio: 0, title: `${num(overLines.length)} بند موازنة متجاوز`, desc: "الملتزم + الفعلي تجاوز المعتمد.", href: "/budgets" },
    overduePOs.length && { key: "overdue", tone: "danger", prio: 1, title: `${num(overduePOs.length)} طلب شراء متأخر`, desc: "معتمد ولم يُستلم بحلول تاريخ الحاجة.", href: "/purchase-requests" },
    reorderItems.length && { key: "reorder", tone: "warning", prio: 2, title: `${num(reorderItems.length)} صنف تحت حد إعادة الطلب`, desc: "المخزون عند أو دون نقطة إعادة الطلب.", href: "/inventory/dashboard?filter=reorder" },
    pending.length && { key: "pending", tone: "warning", prio: 3, title: `${num(pending.length)} طلب شراء بانتظار اعتمادك`, desc: "فصل الواجبات: لا يعتمد مقدّم الطلب طلبه.", href: "/purchase-requests" },
    blockedChecks.length && { key: "checks", tone: "warning", prio: 4, title: `${num(blockedChecks.length)} فحص خطة محظور`, desc: "فحوص تمنع تنفيذ الخطة حتى تُعالَج.", href: "/plans/dashboard" },
    palmAttention.length && { key: "palm", tone: "warning", prio: 5, title: `${num(palmAttention.length)} نخلة تحتاج عناية`, desc: "أصول بحالة مراقبة / مريضة / متضررة.", href: "/farm/dashboard" },
    unassignedOps.length && { key: "unassigned", tone: "warning", prio: 6, title: `${num(unassignedOps.length)} عملية بلا مسؤول`, desc: "عمليات نشطة دون شخص مسؤول مُسنَد.", href: "/plans" },
  ].filter(Boolean) as Att[];
  alerts.sort((a, b) => a.prio - b.prio);

  // ── PR directory ──────────────────────────────────────────────────────────
  const columns: SimpleColumn[] = [
    { id: "code", header: "الطلب" },
    { id: "reason", header: "السبب" },
    { id: "needed_by", header: "مطلوب بحلول" },
    { id: "status", header: "الحالة", kind: "status" },
  ];
  const rows = purchaseRequests.map((p) => ({
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
            نظرة استراتيجية على المزرعة — التنبيهات والموازنة والمخزون والخطط، محدّثة من السجلات الفعلية.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/budgets"><Button variant="ghost" size="sm">الموازنات</Button></Link>
          <Link href="/purchase-requests"><Button variant="primary" size="sm">طلبات الشراء</Button></Link>
        </div>
      </header>

      {/* Alert rail — most-severe first; only shows what actually needs attention */}
      {alerts.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">أهم التنبيهات</h2>
          <div className="grid gap-2 lg:grid-cols-2">
            {alerts.map((a) => (
              <Link key={a.key} href={a.href} className="block transition-opacity hover:opacity-90">
                <Alert tone={a.tone} title={a.title} description={a.desc} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Cross-module KPI strip — 6 query-derived metrics (responsive 2 → 3 → 6) */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="المتاح من الموازنة" value={egp(available)} deltaDirection={available < 0 ? "down" : "none"} />
        <KpiCard label="أصناف تحت حد الطلب" value={num(reorderItems.length)} deltaDirection={reorderItems.length ? "down" : "none"} />
        <KpiCard label="موافقات معلّقة" value={num(pending.length)} deltaDirection={pending.length ? "up" : "none"} />
        <KpiCard label="جاهزية الخطط" value={pct(readiness)} />
        <KpiCard label="نخيل يحتاج عناية" value={num(palmAttention.length)} deltaDirection={palmAttention.length ? "down" : "none"} />
        <KpiCard label="عمليات هذا الأسبوع" value={num(dueThisWeek.length)} />
      </section>

      {/* Budget-line health: detail cards with utilisation bars */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">حالة بنود الموازنة</h2>
          <Link href="/budgets"><Button variant="ghost" size="sm">كل الموازنات</Button></Link>
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
          <Link href="/purchase-requests"><Button variant="ghost" size="sm">عرض الكل</Button></Link>
        </div>
        <SimpleTable columns={columns} rows={rows} empty="لا توجد طلبات شراء بعد." />
      </section>
    </div>
  );
}
