import { createClient } from "@/lib/supabase/server";
import { ImportPanel } from "@/components/import/ImportPanel";
import { requireRole } from "@/lib/auth";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { egpDecimalSummary } from "@/lib/decimal";
import { KpiCard } from "@/components/ui";
import { type SimpleColumn } from "@/components/SimpleTable";
import { FilterableTable } from "@/components/FilterableTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { PrintButton } from "@/components/print-button";
import { AddExpense } from "@/components/AddExpense";
import { accountOptionLabel, leafPostingAccounts } from "@/components/AccountPicker";
import {
  EXPENSE_REGISTER_DISPLAY_CAP,
  currentMonthBounds,
  isExpenseRegisterTruncated,
  parseExpenseFilter,
  type ExpenseFilter,
} from "@/lib/expense-register-summary";
import { parseExpenseDailySnapshot } from "@/lib/expense-daily-snapshot";

export const dynamic = "force-dynamic";

// Roles that pass authorize('budget.write') — the gate the expenses RLS WITH CHECK enforces.
const WRITE_ROLES = ["owner", "accountant"];

// Expense classification (expenses.kind). Owner drawings (مسحوبات) must be visible as distinct from operating
// expenses in the ledger (non-negotiable #6), not hidden in an undifferentiated list.
const KIND_LABELS: Record<string, string> = {
  operating: "تشغيلي",
  drawing: "مسحوبات",
  capex: "رأسمالي",
};

export default async function ExpensesListPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const m = await requireRole(["owner", "accountant", "farm_manager"]);
  const sb = await createClient();
  const filter = parseExpenseFilter((await searchParams).filter);
  const canSeeOwnerDrawings = m.role === "owner" || m.role === "accountant";
  const effectiveFilter: ExpenseFilter =
    !canSeeOwnerDrawings && filter === "drawing" ? "all" : filter;
  const { start: monthStart, end: monthEnd } = currentMonthBounds();

  const snapshotRes = await sb.rpc("fn_expense_daily_snapshot", {
    p_org: m.orgId,
    p_filter: effectiveFilter,
    p_month_start: monthStart,
    p_month_end: monthEnd,
    p_row_limit: EXPENSE_REGISTER_DISPLAY_CAP,
  });
  if (snapshotRes.error) throw snapshotRes.error;
  const snapshot = parseExpenseDailySnapshot(snapshotRes.data);
  if (
    snapshot.orgId !== m.orgId ||
    snapshot.filter !== effectiveFilter ||
    snapshot.monthStart !== monthStart ||
    snapshot.monthEnd !== monthEnd ||
    snapshot.rowLimit !== EXPENSE_REGISTER_DISPLAY_CAP
  ) {
    throw new Error("expense daily snapshot: response scope does not match the request");
  }

  const summary = snapshot.summary;
  const expenses = snapshot.expenseRows;
  const suppliers = snapshot.supplierRows;
  const accounts = snapshot.accountRows;
  const matchingCount = snapshot.matchingCount;
  const isTruncated = isExpenseRegisterTruncated(matchingCount);

  const supMap = new Map((suppliers ?? []).map((s) => [s.id, s.name]));
  const postingAccounts = leafPostingAccounts(accounts ?? []);
  const accountMap = new Map(postingAccounts.map((account) => [account.id, accountOptionLabel(account)]));

  const chips: { key: ExpenseFilter; label: string; value: number; danger?: boolean }[] = [
    { key: "all", label: "كل المصروفات", value: summary.expenseCount },
    { key: "month", label: "هذا الشهر", value: summary.monthCount },
    { key: "operating", label: "تشغيلي", value: summary.operatingCount },
    ...(canSeeOwnerDrawings
      ? [{ key: "drawing" as ExpenseFilter, label: "مسحوبات", value: summary.drawingCount ?? 0 }]
      : []),
    ...(effectiveFilter === "undated"
      ? [{ key: "undated" as ExpenseFilter, label: "بدون تاريخ", value: matchingCount, danger: true }]
      : []),
    { key: "unrouted", label: "غير موجّهة للسداد", value: summary.unroutedCount, danger: true },
    { key: "unclassified", label: "بدون حساب", value: summary.unclassifiedCount, danger: true },
    { key: "uncentered", label: "بدون مركز تكلفة", value: summary.uncenteredCount, danger: true },
  ];
  // Exact SUMs over the full ledger (fn_expense_register_summary), not the bounded 200-row page:
  // this month, split per non-negotiable #6. "بدون مسحوبات" means every non-drawing row — operating
  // AND capex — never operating-only; a null-total row is disclosed as unknown, never coerced into
  // the sum as zero.
  const monthNonDrawingDisplay = egpDecimalSummary({
    total: summary.monthNonDrawingTotal,
    hasUnknown: summary.monthNonDrawingUnknownCount > 0,
  });
  const monthDrawingDisplay =
    summary.monthDrawingTotal == null
      ? null
      : egpDecimalSummary({
          total: summary.monthDrawingTotal,
          hasUnknown: (summary.monthDrawingUnknownCount ?? 0) > 0,
        });

  const columns: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "category", header: "الفئة" },
    { id: "kind", header: "النوع" },
    { id: "account", header: "الحساب" },
    { id: "description", header: "البيان" },
    { id: "supplier", header: "المورّد" },
    { id: "total", header: "المبلغ", numeric: true, decimal: true, kind: "money-preserve-exact" },
  ];

  const rows = expenses.map((e) => ({
    id: e.id,
    href: `/expenses/${e.id}`,
    date: e.date ? fmtDate(e.date) : "—",
    category: e.category ?? "—",
    kind: KIND_LABELS[e.kind ?? "operating"] ?? "—",
    account: e.accountId ? accountMap.get(e.accountId) ?? "—" : "بدون حساب",
    description: e.description ?? "—",
    supplier: e.supplierId ? supMap.get(e.supplierId) ?? "—" : "—",
    total: e.total ?? undefined,
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
        {/* Display-only exact SUMs (full ledger via the RPC, not the bounded page); drawings stay separate (#6). */}
        <KpiCard label="مصروفات هذا الشهر (بدون مسحوبات)" value={monthNonDrawingDisplay} />
        {canSeeOwnerDrawings && monthDrawingDisplay != null && (
          <KpiCard label="مسحوبات هذا الشهر" value={monthDrawingDisplay} />
        )}
      </div>

      {WRITE_ROLES.includes(m.role) && (
        <div className="no-print">
          <AddExpense
            suppliers={(suppliers ?? []).map((s) => ({ id: s.id, name: s.name }))}
            accounts={postingAccounts}
          />
        </div>
      )}

      {isTruncated && (
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          يظهر أحدث {num(EXPENSE_REGISTER_DISPLAY_CAP)} صف من إجمالي {num(matchingCount)} مطابق لهذا
          الفلتر — الجدول غير مكتمل. العدّادات والإجماليات أعلاه محسوبة على السجل الكامل. البحث
          أدناه يقتصر على الصفوف المعروضة فقط، وتصدير CSV غير متاح هنا لتفادي ملف يبدو كاملاً بينما
          هو جزء من السجل.
        </p>
      )}
      <FilterableTable
        ariaLabel="المصروفات"
        columns={columns}
        rows={rows}
        empty={effectiveFilter === "all" ? "لا توجد مصروفات مسجّلة" : "لا مصروفات مطابقة لهذا الفلتر"}
        searchColumns={["category", "kind", "account", "description", "supplier"]}
        placeholder={isTruncated ? "ابحث ضمن أحدث الصفوف المعروضة…" : "ابحث في المصروفات…"}
        exportFilename={isTruncated ? undefined : "expenses"}
      />

      {/* SPEC-0024 S-9 (D.1): template download + Excel/CSV import for this entry. Imported expenses arrive unrouted — cash never moves in bulk (#1). */}
      <div className="no-print">
        <ImportPanel descriptorKey="expenses" titleAr="المصروفات" />
      </div>
    </div>
  );
}
