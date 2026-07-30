import { createClient } from "@/lib/supabase/server";
import { ImportPanel } from "@/components/import/ImportPanel";
import { requireRole } from "@/lib/auth";
import { fmtDate } from "@/lib/dates";
import { egpSummary, num } from "@/lib/money";
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
  expenseFilterCount,
  isExpenseRegisterTruncated,
  parseExpenseFilter,
  parseExpenseRegisterSummary,
  type ExpenseFilter,
} from "@/lib/expense-register-summary";

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

  // Bounded to the latest 200 rows MATCHING THE SELECTED FILTER — PostgREST caps unbounded result
  // sets, so an unbounded fetch silently understates both the displayed count and any in-memory
  // sum once a register crosses that cap. The exact chip/KPI figures below come from
  // fn_expense_register_summary (over the FULL register), not from this bounded page.
  let listQuery = sb
    .from("expenses")
    .select("id, date, category, description, total, kind, supplier_id, payment_status, account_id, cost_center_id")
    .eq("org_id", m.orgId)
    .order("date", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(EXPENSE_REGISTER_DISPLAY_CAP);
  if (effectiveFilter === "month") {
    listQuery = listQuery.gte("date", monthStart).lt("date", monthEnd);
  } else if (effectiveFilter === "operating") {
    listQuery = listQuery.eq("kind", "operating");
  } else if (effectiveFilter === "drawing") {
    listQuery = listQuery.eq("kind", "drawing");
  } else if (effectiveFilter === "unrouted") {
    listQuery = listQuery.is("payment_status", null);
  } else if (effectiveFilter === "unclassified") {
    listQuery = listQuery.is("account_id", null);
  } else if (effectiveFilter === "uncentered") {
    listQuery = listQuery.is("cost_center_id", null);
  }

  const [summaryRes, listRes, { data: suppliers }, { data: accounts }] = await Promise.all([
    sb.rpc("fn_expense_register_summary", {
      p_org: m.orgId,
      p_month_start: monthStart,
      p_month_end: monthEnd,
    }),
    listQuery,
    sb.from("suppliers").select("id, name").eq("org_id", m.orgId).order("name"),
    sb
      .from("accounts")
      .select("id, code, name_ar, account_type, kind, parent_id, active")
      .eq("org_id", m.orgId)
      .order("code", { ascending: true }),
  ]);
  // Fail closed: an RPC/list error or a malformed summary payload must not render a page that
  // silently understates the register (CLAUDE.md #1) — surface the error instead.
  if (summaryRes.error) throw summaryRes.error;
  if (listRes.error) throw listRes.error;
  const summary = parseExpenseRegisterSummary(summaryRes.data);

  const expenses = listRes.data ?? [];
  const matchingCount = expenseFilterCount(effectiveFilter, summary);
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
    { key: "unrouted", label: "غير موجّهة للسداد", value: summary.unroutedCount, danger: true },
    { key: "unclassified", label: "بدون حساب", value: summary.unclassifiedCount, danger: true },
    { key: "uncentered", label: "بدون مركز تكلفة", value: summary.uncenteredCount, danger: true },
  ];
  // Exact SUMs over the full ledger (fn_expense_register_summary), not the bounded 200-row page:
  // this month, split per non-negotiable #6. "بدون مسحوبات" means every non-drawing row — operating
  // AND capex — never operating-only; a null-total row is disclosed as unknown, never coerced into
  // the sum as zero.
  const monthNonDrawingDisplay = egpSummary({
    total: summary.monthNonDrawingTotal,
    unknownCount: summary.monthNonDrawingUnknownCount,
    hasUnknown: summary.monthNonDrawingUnknownCount > 0,
  });
  const monthDrawingDisplay =
    summary.monthDrawingTotal == null
      ? null
      : egpSummary({
          total: summary.monthDrawingTotal,
          unknownCount: summary.monthDrawingUnknownCount ?? 0,
          hasUnknown: (summary.monthDrawingUnknownCount ?? 0) > 0,
        });

  const columns: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "category", header: "الفئة" },
    { id: "kind", header: "النوع" },
    { id: "account", header: "الحساب" },
    { id: "description", header: "البيان" },
    { id: "supplier", header: "المورّد" },
    { id: "total", header: "المبلغ", numeric: true, kind: "money" },
  ];

  const rows = expenses.map((e) => ({
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
