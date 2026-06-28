import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { egp } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { type SimpleColumn } from "@/components/SimpleTable";
import { FilterableTable } from "@/components/FilterableTable";
import { AddExpense } from "@/components/AddExpense";

// Roles that pass authorize('budget.write') — the gate the expenses RLS WITH CHECK enforces.
const WRITE_ROLES = ["owner", "accountant"];

export default async function ExpensesListPage() {
  const m = await requireMembership();
  const sb = await createClient();

  const [{ data: expenses, error }, { data: suppliers }] = await Promise.all([
    sb
      .from("expenses")
      .select("id, date, category, description, total, supplier_id")
      .order("date", { ascending: false }),
    sb.from("suppliers").select("id, name").order("name"),
  ]);
  if (error) throw error;

  const supMap = new Map((suppliers ?? []).map((s) => [s.id, s.name]));

  const columns: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "category", header: "الفئة" },
    { id: "description", header: "البيان" },
    { id: "supplier", header: "المورّد" },
    { id: "total", header: "المبلغ", numeric: true },
  ];

  const rows = (expenses ?? []).map((e) => ({
    id: e.id,
    date: e.date ? fmtDate(e.date) : "—",
    category: e.category ?? "—",
    description: e.description ?? "—",
    supplier: e.supplier_id ? supMap.get(e.supplier_id) ?? "—" : "—",
    total: e.total != null ? egp(Number(e.total)) : "—",
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">المصروفات</h1>
        <p style={{ color: "var(--ink-muted)" }}>سجل مصروفات التشغيل</p>
      </header>
      {WRITE_ROLES.includes(m.role) && (
        <AddExpense
          suppliers={(suppliers ?? []).map((s) => ({ id: s.id, name: s.name }))}
        />
      )}
      <FilterableTable
        columns={columns}
        rows={rows}
        empty="لا توجد مصروفات مسجّلة"
        searchColumns={["category", "description", "supplier"]}
        placeholder="ابحث في المصروفات…"
        exportFilename="expenses"
      />
    </div>
  );
}
