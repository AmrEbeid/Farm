import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { fmtDate } from "@/lib/dates";
import { type SimpleColumn } from "@/components/SimpleTable";
import { FilterableTable } from "@/components/FilterableTable";
import { AddExpense } from "@/components/AddExpense";

// Roles that pass authorize('budget.write') — the gate the expenses RLS WITH CHECK enforces.
const WRITE_ROLES = ["owner", "accountant"];

// Expense classification (expenses.kind). Owner drawings (مسحوبات) must be visible as distinct from operating
// expenses in the ledger (non-negotiable #6), not hidden in an undifferentiated list.
const KIND_LABELS: Record<string, string> = {
  operating: "تشغيلي",
  drawing: "مسحوبات",
  capex: "رأسمالي",
};

export default async function ExpensesListPage() {
  const m = await requireRole(["owner", "accountant", "farm_manager"]);
  // Owner drawings (مسحوبات) are confidential (#6) — RLS already blocks a non-finance role from reading
  // kind='drawing' rows (20260701220000), this is the belt-and-suspenders app-layer mirror so farm_manager
  // never even requests them.
  const canReadDrawings = m.role === "owner" || m.role === "accountant";
  const sb = await createClient();

  const expensesQuery = sb
    .from("expenses")
    .select("id, date, category, description, total, kind, supplier_id")
    .order("date", { ascending: false });

  const [{ data: expenses, error }, { data: suppliers }] = await Promise.all([
    canReadDrawings ? expensesQuery : expensesQuery.neq("kind", "drawing"),
    sb.from("suppliers").select("id, name").order("name"),
  ]);
  if (error) throw error;

  const supMap = new Map((suppliers ?? []).map((s) => [s.id, s.name]));

  const columns: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "category", header: "الفئة" },
    { id: "kind", header: "النوع" },
    { id: "description", header: "البيان" },
    { id: "supplier", header: "المورّد" },
    { id: "total", header: "المبلغ", numeric: true, kind: "money" },
  ];

  const rows = (expenses ?? []).map((e) => ({
    id: e.id,
    href: `/expenses/${e.id}`,
    date: e.date ? fmtDate(e.date) : "—",
    category: e.category ?? "—",
    kind: KIND_LABELS[e.kind ?? "operating"] ?? "—",
    description: e.description ?? "—",
    supplier: e.supplier_id ? supMap.get(e.supplier_id) ?? "—" : "—",
    total: e.total != null ? Number(e.total) : undefined,
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
        ariaLabel="المصروفات"
        columns={columns}
        rows={rows}
        empty="لا توجد مصروفات مسجّلة"
        searchColumns={["category", "kind", "description", "supplier"]}
        placeholder="ابحث في المصروفات…"
        exportFilename="expenses"
      />
    </div>
  );
}
