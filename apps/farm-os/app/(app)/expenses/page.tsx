import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { fmtDate } from "@/lib/dates";
import { egp, num } from "@/lib/money";
import { KpiCard } from "@/components/ui";
import { type SimpleColumn } from "@/components/SimpleTable";
import { FilterableTable } from "@/components/FilterableTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
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

type ExpenseFilter = "all" | "month" | "operating" | "drawing" | "unrouted";

function parseExpenseFilter(raw: string | undefined): ExpenseFilter {
  return raw === "month" || raw === "operating" || raw === "drawing" || raw === "unrouted" ? raw : "all";
}

export default async function ExpensesListPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const m = await requireRole(["owner", "accountant", "farm_manager"]);
  const sb = await createClient();
  const filter = parseExpenseFilter((await searchParams).filter);

  const [{ data: expenses, error }, { data: suppliers }] = await Promise.all([
    sb
      .from("expenses")
      .select("id, date, category, description, total, kind, supplier_id, payment_status")
      .order("date", { ascending: false }),
    sb.from("suppliers").select("id, name").order("name"),
  ]);
  if (error) throw error;

  const all = expenses ?? [];
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = monthStart.toISOString().slice(0, 10);
  const isThisMonth = (e: (typeof all)[number]) => (e.date ?? "") >= monthStartStr;
  // «غير موجّهة للسداد»: payment_status is NULL — recorded but routed nowhere in the custody/
  // payment pipeline (FINANCE-ACCOUNTANT-360 gap #1: the routing control has no UI yet). Surfacing
  // the backlog honestly instead of letting it hide.
  const isUnrouted = (e: (typeof all)[number]) => e.payment_status == null;

  const chips: { key: ExpenseFilter; label: string; value: number; danger?: boolean }[] = [
    { key: "all", label: "كل المصروفات", value: all.length },
    { key: "month", label: "هذا الشهر", value: all.filter(isThisMonth).length },
    { key: "operating", label: "تشغيلي", value: all.filter((e) => (e.kind ?? "operating") === "operating").length },
    { key: "drawing", label: "مسحوبات", value: all.filter((e) => e.kind === "drawing").length },
    { key: "unrouted", label: "غير موجّهة للسداد", value: all.filter(isUnrouted).length, danger: true },
  ];
  // Real SUMs over the full ledger (not a row-capped sample): this month, split per non-negotiable #6.
  const monthOperating = all
    .filter((e) => isThisMonth(e) && (e.kind ?? "operating") !== "drawing")
    .reduce((s, e) => s + Number(e.total ?? 0), 0);
  const monthDrawings = all
    .filter((e) => isThisMonth(e) && e.kind === "drawing")
    .reduce((s, e) => s + Number(e.total ?? 0), 0);

  const supMap = new Map((suppliers ?? []).map((s) => [s.id, s.name]));

  const columns: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "category", header: "الفئة" },
    { id: "kind", header: "النوع" },
    { id: "description", header: "البيان" },
    { id: "supplier", header: "المورّد" },
    { id: "total", header: "المبلغ", numeric: true, kind: "money" },
  ];

  const rows = all
    .filter((e) =>
      filter === "month"
        ? isThisMonth(e)
        : filter === "operating"
          ? (e.kind ?? "operating") === "operating"
          : filter === "drawing"
            ? e.kind === "drawing"
            : filter === "unrouted"
              ? isUnrouted(e)
              : true,
    )
    .map((e) => ({
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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
        {chips.map((chip) => (
          <DashboardKpiLink
            key={chip.key}
            href={chip.key === "all" ? "/expenses" : `/expenses?filter=${chip.key}`}
            active={filter === chip.key}
          >
            <KpiCard
              label={chip.label}
              value={num(chip.value)}
              deltaDirection={chip.danger && chip.value > 0 ? "down" : "none"}
            />
          </DashboardKpiLink>
        ))}
        {/* Display-only real SUMs (full ledger, not a sample); drawings stay separate (#6). */}
        <KpiCard label="مصروفات هذا الشهر (بدون مسحوبات)" value={egp(monthOperating)} />
        <KpiCard label="مسحوبات هذا الشهر" value={egp(monthDrawings)} />
      </div>

      {WRITE_ROLES.includes(m.role) && (
        <AddExpense suppliers={(suppliers ?? []).map((s) => ({ id: s.id, name: s.name }))} />
      )}
      <FilterableTable
        ariaLabel="المصروفات"
        columns={columns}
        rows={rows}
        empty={filter === "all" ? "لا توجد مصروفات مسجّلة" : "لا مصروفات مطابقة لهذا الفلتر"}
        searchColumns={["category", "kind", "description", "supplier"]}
        placeholder="ابحث في المصروفات…"
        exportFilename="expenses"
      />
    </div>
  );
}
