import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, KpiCard } from "@/components/ui";
import { type SimpleColumn } from "@/components/SimpleTable";
import { FilterableTable } from "@/components/FilterableTable";
import { PrintButton } from "@/components/print-button";
import { egp, num } from "@/lib/money";
import { parseBudgetVsActual } from "@/lib/budget-vs-actual";

// Read-only budgets overview: planned vs approved/committed/actual, with derived available.
export default async function BudgetsPage() {
  const m = await requireRole(["owner", "accountant", "farm_manager"]);
  const sb = await createClient();

  const { data: budgets, error } = await sb
    .from("budgets")
    .select("id, name, period, category, planned, approved, committed, actual, status")
    .order("period", { ascending: false });
  if (error) throw error;

  const columns: SimpleColumn[] = [
    { id: "name", header: "الموازنة" },
    { id: "period", header: "الفترة" },
    { id: "category", header: "الفئة" },
    { id: "planned", header: "المخطط", numeric: true, kind: "money" },
    { id: "approved", header: "المعتمد", numeric: true, kind: "money" },
    { id: "committed", header: "الملتزم", numeric: true, kind: "money" },
    { id: "actual", header: "الفعلي", numeric: true, kind: "money" },
    { id: "available", header: "المتاح", numeric: true, kind: "money" },
  ];

  const rows = (budgets ?? []).map((b) => {
    const approved = Number(b.approved ?? 0);
    const committed = Number(b.committed ?? 0);
    const actual = Number(b.actual ?? 0);
    return {
      id: b.id,
      href: `/budgets/${b.id}`,
      name: b.name ?? "—",
      period: b.period ?? "—",
      category: b.category ?? "—",
      planned: Number(b.planned ?? 0),
      approved,
      committed,
      actual,
      available: approved - committed - actual,
    };
  });

  const totalPlanned = rows.reduce((s, r) => s + r.planned, 0);
  const totalApproved = rows.reduce((s, r) => s + r.approved, 0);

  // Live over-budget signal (year-to-date), computed from the posted GL — the seed columns below are frozen
  // (#157). Only owner/accountant hold finance.read (the fn_budget_vs_actual gate); skip for farm_manager.
  const now = new Date();
  const overBudget: { category: string; over: number; planned: number; actual: number }[] = [];
  if (m.role === "owner" || m.role === "accountant") {
    const bva = await sb.rpc("fn_budget_vs_actual", {
      p_org: m.orgId,
      p_from: `${now.getFullYear()}-01-01`,
      p_to: now.toISOString().slice(0, 10),
    });
    if (!bva.error) {
      for (const l of parseBudgetVsActual(bva.data).lines) {
        if (l.overBudget) overBudget.push({ category: l.category, over: l.actual - l.planned, planned: l.planned, actual: l.actual });
      }
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">الموازنات</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            المخطط مقابل المعتمد والملتزم والفعلي، والمتاح المتبقّي
          </p>
        </div>
        <PrintButton label="طباعة الموازنات" />
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="عدد الموازنات" value={num(rows.length)} />
        <KpiCard label="إجمالي المخطط" value={egp(totalPlanned)} />
        <KpiCard label="إجمالي المعتمد" value={egp(totalApproved)} />
      </div>

      {overBudget.length > 0 && (
        <Alert tone="warning" title={`تنبيه مباشر: ${num(overBudget.length)} فئة تجاوزت الموازنة (للسنة الحالية حتى اليوم)`}>
          <div className="flex flex-col gap-1 text-sm">
            {overBudget.map((o) => (
              <div key={o.category}>
                <span className="font-bold">{o.category}</span>: الفعلي {egp(o.actual)} مقابل مخطط {egp(o.planned)} — تجاوز {egp(o.over)}
              </div>
            ))}
            <Link href="/finance/budget-vs-actual" className="font-bold underline underline-offset-4" style={{ color: "var(--brand)" }}>
              التقرير الكامل ←
            </Link>
          </div>
        </Alert>
      )}

      {/* Honesty note (#157): committed/actual are foundation-era figures no code updates yet —
          approval doesn't read budget_lines and expenses don't roll up here. Say so instead of
          letting «المتاح» read as a live control. The real budget gate is an owner-gated decision. */}
      <Alert tone="warning" title="أرقام تأسيسية — ليست رقابة حية">
        «الملتزم» و«الفعلي» في هذا الجدول أرقام تأسيسية غير محدّثة تلقائيًا بعد — بوابة الموازنة الفعلية (ربط
        الاعتماد والمصروفات بالموازنة كرقابة صارمة) قرار قيد الدراسة (#157). لا تعتمد على «المتاح» كرقابة حية حتى
        إشعار آخر.{" "}
        للإنفاق الفعلي الحيّ محسوبًا من القيود المُرحّلة، راجع{" "}
        <Link href="/finance/budget-vs-actual" style={{ textDecoration: "underline", fontWeight: 600 }}>
          تقرير «الموازنة مقابل الفعلي»
        </Link>
        .
      </Alert>

      <FilterableTable
        ariaLabel="الموازنات"
        columns={columns}
        rows={rows}
        empty="لا توجد موازنات"
        searchColumns={["name", "category", "period"]}
        placeholder="ابحث في الموازنات…"
        exportFilename="budgets"
      />
    </div>
  );
}
