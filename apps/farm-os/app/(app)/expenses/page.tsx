import { createClient } from "@/lib/supabase/server";
import { ImportPanel } from "@/components/import/ImportPanel";
import { requireRole } from "@/lib/auth";
import { fmtDate } from "@/lib/dates";
import { egp, num } from "@/lib/money";
import { KpiCard } from "@/components/ui";
import { type SimpleColumn } from "@/components/SimpleTable";
import { FilterableTable } from "@/components/FilterableTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { PrintButton } from "@/components/print-button";
import { AddExpense } from "@/components/AddExpense";
import { accountOptionLabel, leafPostingAccounts } from "@/components/AccountPicker";

// Roles that pass authorize('budget.write') — the gate the expenses RLS WITH CHECK enforces.
const WRITE_ROLES = ["owner", "accountant"];

// Expense classification (expenses.kind). Owner drawings (مسحوبات) must be visible as distinct from operating
// expenses in the ledger (non-negotiable #6), not hidden in an undifferentiated list.
const KIND_LABELS: Record<string, string> = {
  operating: "تشغيلي",
  drawing: "مسحوبات",
  capex: "رأسمالي",
};

type ExpenseFilter = "all" | "month" | "operating" | "drawing" | "unrouted" | "unclassified" | "uncentered";

function parseExpenseFilter(raw: string | undefined): ExpenseFilter {
  return raw === "month" ||
    raw === "operating" ||
    raw === "drawing" ||
    raw === "unrouted" ||
    raw === "unclassified" ||
    raw === "uncentered"
    ? raw
    : "all";
}

export default async function ExpensesListPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const m = await requireRole(["owner", "accountant", "farm_manager"]);
  const sb = await createClient();
  const filter = parseExpenseFilter((await searchParams).filter);
  const canSeeOwnerDrawings = m.role === "owner" || m.role === "accountant";
  const effectiveFilter = !canSeeOwnerDrawings && filter === "drawing" ? "all" : filter;

  const [{ data: expenses, error }, { data: suppliers }, { data: accounts }] = await Promise.all([
    sb
      .from("expenses")
      .select("id, date, category, description, total, kind, supplier_id, payment_status, account_id, cost_center_id")
      .order("date", { ascending: false }),
    sb.from("suppliers").select("id, name").order("name"),
    sb
      .from("accounts")
      .select("id, code, name_ar, account_type, kind, parent_id, active")
      .order("code", { ascending: true }),
  ]);
  if (error) throw error;

  const all = (expenses ?? []).filter((e) => canSeeOwnerDrawings || e.kind !== "drawing");
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = monthStart.toISOString().slice(0, 10);
  const isThisMonth = (e: (typeof all)[number]) => (e.date ?? "") >= monthStartStr;
  // «غير موجّهة للسداد»: payment_status is NULL — recorded but routed nowhere in the custody/
  // payment pipeline (FINANCE-ACCOUNTANT-360 gap #1: the routing control has no UI yet). Surfacing
  // the backlog honestly instead of letting it hide.
  const isUnrouted = (e: (typeof all)[number]) => e.payment_status == null;
  const isUnclassified = (e: (typeof all)[number]) => e.account_id == null;
  // «بلا مركز تكلفة»: cost_center_id is NULL — recorded but not allocated to a cost center, so it can't be
  // attributed in per-center P&L. This is the third «مصروفات بلا…» month-close item's fixing surface.
  const isUncentered = (e: (typeof all)[number]) => e.cost_center_id == null;

  const chips: { key: ExpenseFilter; label: string; value: number; danger?: boolean }[] = [
    { key: "all", label: "كل المصروفات", value: all.length },
    { key: "month", label: "هذا الشهر", value: all.filter(isThisMonth).length },
    { key: "operating", label: "تشغيلي", value: all.filter((e) => (e.kind ?? "operating") === "operating").length },
    ...(canSeeOwnerDrawings
      ? [{ key: "drawing" as ExpenseFilter, label: "مسحوبات", value: all.filter((e) => e.kind === "drawing").length }]
      : []),
    { key: "unrouted", label: "غير موجّهة للسداد", value: all.filter(isUnrouted).length, danger: true },
    { key: "unclassified", label: "بدون حساب", value: all.filter(isUnclassified).length, danger: true },
    { key: "uncentered", label: "بدون مركز تكلفة", value: all.filter(isUncentered).length, danger: true },
  ];
  // Real SUMs over the full ledger (not a row-capped sample): this month, split per non-negotiable #6.
  const monthOperating = all
    .filter((e) => isThisMonth(e) && (e.kind ?? "operating") !== "drawing")
    .reduce((s, e) => s + Number(e.total ?? 0), 0);
  const monthDrawings = all
    .filter((e) => isThisMonth(e) && e.kind === "drawing")
    .reduce((s, e) => s + Number(e.total ?? 0), 0);

  const supMap = new Map((suppliers ?? []).map((s) => [s.id, s.name]));
  const postingAccounts = leafPostingAccounts(accounts ?? []);
  const accountMap = new Map(postingAccounts.map((account) => [account.id, accountOptionLabel(account)]));

  const columns: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "category", header: "الفئة" },
    { id: "kind", header: "النوع" },
    { id: "account", header: "الحساب" },
    { id: "description", header: "البيان" },
    { id: "supplier", header: "المورّد" },
    { id: "total", header: "المبلغ", numeric: true, kind: "money" },
  ];

  const rows = all
    .filter((e) =>
      effectiveFilter === "month"
        ? isThisMonth(e)
        : effectiveFilter === "operating"
          ? (e.kind ?? "operating") === "operating"
          : effectiveFilter === "drawing"
            ? e.kind === "drawing"
            : effectiveFilter === "unrouted"
              ? isUnrouted(e)
              : effectiveFilter === "unclassified"
                ? isUnclassified(e)
                : effectiveFilter === "uncentered"
                  ? isUncentered(e)
              : true,
    )
    .map((e) => ({
      id: e.id,
      href: `/expenses/${e.id}`,
      date: e.date ? fmtDate(e.date) : "—",
      category: e.category ?? "—",
      kind: KIND_LABELS[e.kind ?? "operating"] ?? "—",
      account: e.account_id ? accountMap.get(e.account_id) ?? "—" : "بدون حساب",
      description: e.description ?? "—",
      supplier: e.supplier_id ? supMap.get(e.supplier_id) ?? "—" : "—",
      total: e.total != null ? Number(e.total) : undefined,
    }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">المصروفات</h1>
          <p style={{ color: "var(--ink-muted)" }}>سجل مصروفات التشغيل</p>
        </div>
        <PrintButton label="طباعة المصروفات" />
      </header>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
        {chips.map((chip) => (
          <DashboardKpiLink
            key={chip.key}
            href={chip.key === "all" ? "/expenses" : `/expenses?filter=${chip.key}`}
            active={effectiveFilter === chip.key}
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
        {canSeeOwnerDrawings && <KpiCard label="مسحوبات هذا الشهر" value={egp(monthDrawings)} />}
      </div>

      {WRITE_ROLES.includes(m.role) && (
        <div className="no-print">
          <AddExpense
            suppliers={(suppliers ?? []).map((s) => ({ id: s.id, name: s.name }))}
            accounts={postingAccounts}
          />
        </div>
      )}
      <FilterableTable
        ariaLabel="المصروفات"
        columns={columns}
        rows={rows}
        empty={effectiveFilter === "all" ? "لا توجد مصروفات مسجّلة" : "لا مصروفات مطابقة لهذا الفلتر"}
        searchColumns={["category", "kind", "account", "description", "supplier"]}
        placeholder="ابحث في المصروفات…"
        exportFilename="expenses"
      />

      {/* SPEC-0024 S-9 (D.1): template download + Excel/CSV import for this entry. Imported expenses arrive unrouted — cash never moves in bulk (#1). */}
      <div className="no-print">
        <ImportPanel descriptorKey="expenses" titleAr="المصروفات" />
      </div>
    </div>
  );
}
