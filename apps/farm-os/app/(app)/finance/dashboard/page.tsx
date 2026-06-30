import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { CurrentFilterCard } from "@/components/CurrentFilterCard";
import { fmtDate } from "@/lib/dates";
import { egp, num } from "@/lib/money";
import { PR_STATUS_AR } from "@/lib/labels";

type SupplierEmbed = { name?: string | null };
type ExpenseRow = {
  id: string;
  date: string | null;
  category: string | null;
  description: string | null;
  total: number | null;
  suppliers: SupplierEmbed | SupplierEmbed[] | null;
};

const FILTER_LABEL_AR: Record<string, string> = {
  all: "كل الجداول",
  budgets: "ضغط الموازنة",
  expenses: "آخر المصروفات",
  operating: "مصروفات تشغيلية",
  drawings: "مسحوبات المالك",
  prs: "طلبات الشراء للمتابعة",
};

const OWNER_DRAWING_TERMS = ["مسحوبات", "مسحوب", "سحب مالك", "المالك", "owner drawing", "drawings"];
const PRIVATE_FINANCE_FILTERS = new Set(["expenses", "operating", "drawings"]);

export default async function FinanceDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter: requestedFilter = "all" } = await searchParams;
  const m = await requireRole(["owner", "accountant", "farm_manager"]);
  const canReadPrivateFinance = m.role === "owner" || m.role === "accountant";
  const filter =
    canReadPrivateFinance || !PRIVATE_FINANCE_FILTERS.has(requestedFilter)
      ? requestedFilter
      : "all";
  const sb = await createClient();

  const [
    { data: budgets, error: budgetsError },
    { data: prs, error: prsError },
  ] = await Promise.all([
    sb
      .from("budgets")
      .select("id, name, period, category, planned, approved, committed, actual, status")
      .order("period", { ascending: false }),
    sb
      .from("purchase_requests")
      .select("id, code, status, reason, needed_by")
      .in("status", ["submitted", "approved", "partially_received"])
      .order("needed_by", { ascending: true })
      .limit(12),
  ]);
  if (budgetsError) throw budgetsError;
  if (prsError) throw prsError;

  let expenses: ExpenseRow[] = [];
  if (canReadPrivateFinance) {
    const { data, error } = await sb
      .from("expenses")
      .select("id, date, category, description, total, suppliers(name)")
      .order("date", { ascending: false })
      .limit(12);
    if (error) throw error;
    expenses = (data ?? []) as ExpenseRow[];
  }

  const budgetTotals = (budgets ?? []).reduce(
    (acc, b) => {
      acc.approved += Number(b.approved ?? 0);
      acc.committed += Number(b.committed ?? 0);
      acc.actual += Number(b.actual ?? 0);
      return acc;
    },
    { approved: 0, committed: 0, actual: 0 },
  );
  const spentOrCommitted = budgetTotals.committed + budgetTotals.actual;
  const available = budgetTotals.approved - spentOrCommitted;
  const submittedPrs = (prs ?? []).filter((p) => p.status === "submitted").length;
  const expenseKindRows = expenses.map((expense) => ({
    expense,
    drawing: isOwnerDrawingExpense(expense.category, expense.description),
  }));
  const ownerDrawingsTotal = expenseKindRows
    .filter((row) => row.drawing)
    .reduce((sum, row) => sum + Number(row.expense.total ?? 0), 0);
  const operatingTotal = expenseKindRows
    .filter((row) => !row.drawing)
    .reduce((sum, row) => sum + Number(row.expense.total ?? 0), 0);

  const budgetColumns: SimpleColumn[] = [
    { id: "name", header: "الموازنة" },
    { id: "category", header: "الفئة" },
    { id: "approved", header: "المعتمد", numeric: true },
    { id: "committed", header: "الملتزم", numeric: true },
    { id: "actual", header: "الفعلي", numeric: true },
    { id: "available", header: "المتاح", numeric: true },
    { id: "signal", header: "الإشارة", kind: "status" },
  ];
  const budgetRows = [...(budgets ?? [])]
    .map((b) => {
      const approved = Number(b.approved ?? 0);
      const committed = Number(b.committed ?? 0);
      const actual = Number(b.actual ?? 0);
      const remaining = approved - committed - actual;
      const signal = approved === 0 ? "لا اعتماد" : remaining < 0 ? "متجاوز" : remaining <= approved * 0.1 ? "منخفض" : "متاح";
      return {
        id: b.id,
        href: `/budgets/${b.id}`,
        sortAvailable: remaining,
        name: b.name ?? "—",
        category: b.category ?? "—",
        approved: egp(approved),
        committed: egp(committed),
        actual: egp(actual),
        available: egp(remaining),
        signal,
      };
    })
    .sort((a, b) => a.sortAvailable - b.sortAvailable)
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      href: row.href,
      name: row.name,
      category: row.category,
      approved: row.approved,
      committed: row.committed,
      actual: row.actual,
      available: row.available,
      signal: row.signal,
    }));

  const expenseColumns: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "kind", header: "النوع", kind: "status" },
    { id: "category", header: "الفئة" },
    { id: "description", header: "البيان" },
    { id: "supplier", header: "المورّد" },
    { id: "total", header: "المبلغ", numeric: true },
  ];
  const expenseRows = expenseKindRows
    .filter((row) => (filter === "drawings" ? row.drawing : filter === "operating" ? !row.drawing : true))
    .map(({ expense, drawing }) => {
    const supplier = normalizeSupplier(expense.suppliers);
    return {
      id: expense.id,
      href: `/expenses/${expense.id}`,
      date: expense.date ? fmtDate(expense.date) : "—",
      kind: drawing ? "مسحوبات مالك" : "تشغيلي",
      category: expense.category ?? "—",
      description: expense.description ?? "—",
      supplier: supplier?.name ?? "—",
      total: expense.total != null ? egp(Number(expense.total)) : "—",
    };
  });

  const prColumns: SimpleColumn[] = [
    { id: "code", header: "طلب الشراء" },
    { id: "reason", header: "السبب" },
    { id: "needed_by", header: "مطلوب بحلول" },
    { id: "status", header: "الحالة", kind: "status" },
  ];
  const prRows = (prs ?? []).map((pr) => ({
    id: pr.id,
    href: `/purchase-requests/${pr.id}`,
    code: pr.code,
    reason: pr.reason ?? "—",
    needed_by: pr.needed_by ? fmtDate(pr.needed_by) : "—",
    status: PR_STATUS_AR[pr.status] ?? "غير معروف",
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">لوحة المالية</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            {canReadPrivateFinance
              ? "متابعة الموازنة والمصروفات وطلبات الشراء من السجلات الفعلية."
              : "متابعة الموازنة وطلبات الشراء من السجلات الفعلية."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <HeaderLink href="/budgets">الموازنات</HeaderLink>
          {canReadPrivateFinance && <HeaderLink href="/expenses">المصروفات</HeaderLink>}
          <HeaderLink href="/purchase-requests">طلبات الشراء</HeaderLink>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardKpiLink href="/finance/dashboard?filter=budgets" active={filter === "budgets"}>
          <KpiCard label="المعتمد" value={egp(budgetTotals.approved)} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/finance/dashboard?filter=budgets" active={filter === "budgets"}>
          <KpiCard label="ملتزم + فعلي" value={egp(spentOrCommitted)} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/finance/dashboard?filter=budgets" active={filter === "budgets"}>
          <KpiCard label="المتاح" value={egp(available)} deltaDirection={available < 0 ? "down" : "none"} />
        </DashboardKpiLink>
        {canReadPrivateFinance && (
          <DashboardKpiLink href="/finance/dashboard?filter=drawings" active={filter === "drawings"}>
            <KpiCard label="مسحوبات مالك معروضة" value={egp(ownerDrawingsTotal)} />
          </DashboardKpiLink>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {canReadPrivateFinance && (
          <DashboardKpiLink href="/finance/dashboard?filter=operating" active={filter === "operating"}>
            <KpiCard label="تشغيلي معروض" value={egp(operatingTotal)} />
          </DashboardKpiLink>
        )}
        {canReadPrivateFinance && (
          <DashboardKpiLink href="/finance/dashboard?filter=expenses" active={filter === "expenses"}>
            <KpiCard label="مصروفات معروضة" value={num(expenseRows.length)} />
          </DashboardKpiLink>
        )}
        <DashboardKpiLink href="/finance/dashboard?filter=prs" active={filter === "prs"}>
          <KpiCard label="طلبات مرسلة" value={num(submittedPrs)} />
        </DashboardKpiLink>
        {canReadPrivateFinance && <KpiCard label="تصنيف المسحوبات" value="من البيان" />}
      </section>

      <CurrentFilterCard
        label={FILTER_LABEL_AR[filter] ?? "فلتر غير معروف"}
        clearHref="/finance/dashboard"
        showClear={filter !== "all"}
      />

      {(filter === "all" || filter === "budgets") && (
        <Card title="ضغط الموازنة">
          {budgetRows.length === 0 ? (
            <EmptyState title="لا توجد موازنات" />
          ) : (
            <SimpleTable columns={budgetColumns} rows={budgetRows} empty="—" />
          )}
        </Card>
      )}

      {(filter === "all" || filter === "expenses" || filter === "operating" || filter === "drawings" || filter === "prs") && (
        <section className="grid gap-4 xl:grid-cols-2">
          {canReadPrivateFinance && (filter === "all" || filter === "expenses" || filter === "operating" || filter === "drawings") && (
        <Card title={filter === "drawings" ? "مسحوبات المالك" : filter === "operating" ? "مصروفات تشغيلية" : "آخر المصروفات"}>
          {expenseRows.length === 0 ? (
            <EmptyState title="لا توجد مصروفات مسجّلة" />
          ) : (
            <SimpleTable columns={expenseColumns} rows={expenseRows} empty="—" />
          )}
        </Card>
          )}
          {(filter === "all" || filter === "prs") && (
        <Card title="طلبات شراء للمتابعة">
          {prRows.length === 0 ? (
            <EmptyState title="لا توجد طلبات شراء للمتابعة" />
          ) : (
            <SimpleTable columns={prColumns} rows={prRows} empty="—" />
          )}
        </Card>
          )}
        </section>
      )}
    </div>
  );
}

function normalizeSupplier(supplier: SupplierEmbed | SupplierEmbed[] | null): SupplierEmbed | null {
  if (Array.isArray(supplier)) return supplier[0] ?? null;
  return supplier;
}

function isOwnerDrawingExpense(category: string | null | undefined, description: string | null | undefined): boolean {
  const text = `${category ?? ""} ${description ?? ""}`.toLowerCase();
  return OWNER_DRAWING_TERMS.some((term) => text.includes(term.toLowerCase()));
}

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold"
      style={{
        color: "var(--brand)",
        background: "var(--surface)",
        border: "1px solid var(--line)",
      }}
    >
      {children}
    </Link>
  );
}
