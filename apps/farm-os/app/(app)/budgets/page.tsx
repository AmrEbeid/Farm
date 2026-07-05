import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, KpiCard } from "@/components/ui";
import { type SimpleColumn } from "@/components/SimpleTable";
import { FilterableTable } from "@/components/FilterableTable";
import { egp, num } from "@/lib/money";

// Read-only budgets overview: planned vs approved/committed/actual, with derived available.
export default async function BudgetsPage() {
  await requireRole(["owner", "accountant", "farm_manager"]);
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

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">الموازنات</h1>
        <p style={{ color: "var(--ink-muted)" }}>
          المخطط مقابل المعتمد والملتزم والفعلي، والمتاح المتبقّي
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="عدد الموازنات" value={num(rows.length)} />
        <KpiCard label="إجمالي المخطط" value={egp(totalPlanned)} />
        <KpiCard label="إجمالي المعتمد" value={egp(totalApproved)} />
      </div>

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
