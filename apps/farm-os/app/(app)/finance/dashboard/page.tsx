import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { CurrentFilterCard } from "@/components/CurrentFilterCard";
import { BudgetDoughnut, VarianceChart } from "@/components/charts";
import { fmtDate } from "@/lib/dates";
import { egp, num } from "@/lib/money";
import { PR_STATUS_AR, EXPENSE_KIND_AR, REQUEST_STATUS_AR } from "@/lib/labels";

type SupplierEmbed = { name?: string | null };
type CustodyLedgerHolder = {
  custody_account_id: string;
  closing_balance: number;
};

const FILTER_LABEL_AR: Record<string, string> = {
  all: "كل الجداول",
  budgets: "ضغط الموازنة",
  expenses: "آخر المصروفات",
  operating: "مصروفات تشغيلية",
  drawings: "مسحوبات المالك",
  prs: "طلبات الشراء للمتابعة",
  custody: "العهدة",
  payments: "طلبات الصرف",
  accounting: "القيود المحاسبية",
  unclassified: "مصروفات بدون حساب",
};

// Authoritative expense classification is the `expenses.kind` column (operating/drawing/capex), written
// only via fn_set_expense_kind — NOT free-text. Owner drawings must be separated from operating expenses
// (CLAUDE.md #6), and capex is neither. Arabic labels match docs/page-help ("تشغيلي/مسحوبات/رأسمالي").
type ExpenseKind = "operating" | "drawing" | "capex";
// EXPENSE_KIND_AR now hoisted to lib/labels.ts (A5).

// REQUEST_STATUS_AR now hoisted to lib/labels.ts (A5 follow-up).

export default async function FinanceDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter: requestedFilter = "all" } = await searchParams;
  const m = await requireRole(["owner", "accountant", "farm_manager"]);
  const sb = await createClient();
  const canSeeAccounting = m.role === "owner" || m.role === "accountant";
  const filter = !canSeeAccounting && requestedFilter === "drawings" ? "all" : requestedFilter;

  const [
    { data: budgets, error: budgetsError },
    { data: expenses, error: expensesError },
    { data: prs, error: prsError },
  ] = await Promise.all([
    sb
      .from("budgets")
      .select("id, name, period, category, planned, approved, committed, actual, status")
      .order("period", { ascending: false }),
    sb
      .from("expenses")
      .select("id, date, category, description, total, kind, account_id, suppliers(name)")
      .order("date", { ascending: false })
      .limit(12),
    sb
      .from("purchase_requests")
      .select("id, code, status, reason, needed_by")
      .in("status", ["submitted", "approved", "partially_received"])
      .order("needed_by", { ascending: true })
      .limit(12),
  ]);
  if (budgetsError) throw budgetsError;
  if (expensesError) throw expensesError;
  if (prsError) throw prsError;

  const [
    custodyAccountsRes,
    custodyLedgerRes,
    paymentRequestsRes,
    unpaidExpensesRes,
    journalEntriesRes,
    unclassifiedExpensesRes,
  ] = canSeeAccounting
    ? await Promise.all([
        sb.from("custody_accounts").select("id, holder_label, holder_user_id, target_float, active").order("holder_label"),
        sb.rpc("fn_custody_ledger_report", { p_org: m.orgId, p_period_start: null, p_period_end: null }),
        sb
          .from("payment_requests")
          .select("id, request_no, status, period_start, period_end, approved_net_request, created_at")
          .in("status", ["submitted", "approved_operational", "approved_final", "paid"])
          .order("created_at", { ascending: false })
          .limit(12),
        sb
          .from("expenses")
          .select("id, date, category, description, total, kind")
          .eq("payment_status", "post_paid_unpaid")
          .order("date", { ascending: true })
          .limit(12),
        sb
          .from("journal_entries")
          .select("id, entry_date, source_type, description, status, posted_at")
          .order("entry_date", { ascending: false })
          .order("posted_at", { ascending: false })
          .limit(8),
        sb.from("expenses").select("id", { count: "exact", head: true }).is("account_id", null),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null, count: 0 },
      ];
  if (custodyAccountsRes.error) throw custodyAccountsRes.error;
  if (custodyLedgerRes.error) throw custodyLedgerRes.error;
  if (paymentRequestsRes.error) throw paymentRequestsRes.error;
  if (unpaidExpensesRes.error) throw unpaidExpensesRes.error;
  if (journalEntriesRes.error) throw journalEntriesRes.error;
  if (unclassifiedExpensesRes.error) throw unclassifiedExpensesRes.error;

  const custodyAccounts = custodyAccountsRes.data ?? [];
  const custodyBalanceByAccount = parseCustodyLedgerHolders(custodyLedgerRes.data).reduce((map, holder) => {
    map.set(holder.custody_account_id, holder.closing_balance);
    return map;
  }, new Map<string, number>());
  const custodyWithBalance = custodyAccounts.map((account) => ({
    ...account,
    balance: custodyBalanceByAccount.get(account.id) ?? 0,
  }));
  const accountantCustody = custodyWithBalance.filter(
    (account) =>
      account.holder_user_id === m.userId ||
      /محاسب|accountant/i.test(account.holder_label ?? ""),
  );

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

  // Variance per budget category (planned = approved, actual = committed + actual).
  const varianceByCategory = Object.values(
    (budgets ?? []).reduce<Record<string, { category: string; planned: number; actual: number }>>((acc, b) => {
      const key = b.category ?? "—";
      acc[key] ??= { category: key, planned: 0, actual: 0 };
      acc[key].planned += Number(b.approved ?? 0);
      acc[key].actual += Number(b.committed ?? 0) + Number(b.actual ?? 0);
      return acc;
    }, {}),
  );
  const submittedPrs = (prs ?? []).filter((p) => p.status === "submitted").length;
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const inSevenDays = new Date(today);
  inSevenDays.setDate(today.getDate() + 7);
  const inSevenDaysKey = inSevenDays.toISOString().slice(0, 10);
  const nearDuePrs = (prs ?? []).filter((p) => {
    if (!p.needed_by) return false;
    const neededKey = String(p.needed_by).slice(0, 10);
    return neededKey >= todayKey && neededKey <= inSevenDaysKey;
  }).length;
  const expenseKindRows = (expenses ?? []).map((expense) => ({
    expense,
    kind: (expense.kind ?? "operating") as ExpenseKind,
  })).filter((row) => canSeeAccounting || row.kind !== "drawing");
  // Operating and drawings are each their own kind; capex is neither, so it is excluded from both totals.
  const ownerDrawingsTotal = expenseKindRows
    .filter((row) => row.kind === "drawing")
    .reduce((sum, row) => sum + Number(row.expense.total ?? 0), 0);
  const operatingTotal = expenseKindRows
    .filter((row) => row.kind === "operating")
    .reduce((sum, row) => sum + Number(row.expense.total ?? 0), 0);
  const unclassifiedCount = unclassifiedExpensesRes.count ?? 0;

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
    .filter((row) =>
      filter === "drawings"
        ? row.kind === "drawing"
        : filter === "operating"
          ? row.kind === "operating"
          : filter === "unclassified"
            ? row.expense.account_id == null
            : true,
    )
    .map(({ expense, kind }) => {
    const supplier = normalizeSupplier(expense.suppliers);
    return {
      id: expense.id,
      href: `/expenses/${expense.id}`,
      date: expense.date ? fmtDate(expense.date) : "—",
      kind: EXPENSE_KIND_AR[kind],
      category: expense.category ?? "—",
      description: expense.description ?? "—",
      supplier: supplier?.name ?? "—",
      total: expense.total != null ? egp(Number(expense.total)) : "—",
    };
  });

  const expenseCardTitle =
    filter === "drawings"
      ? "مسحوبات المالك"
      : filter === "operating"
        ? "مصروفات تشغيلية"
        : filter === "unclassified"
          ? "مصروفات بدون حساب"
          : "آخر المصروفات";

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

  const custodyColumns: SimpleColumn[] = [
    { id: "holder", header: "العهدة لدى" },
    { id: "balance", header: "الرصيد", numeric: true },
    { id: "target", header: "المستهدف", numeric: true },
    { id: "topup", header: "التغذية المطلوبة", numeric: true },
  ];
  const custodyRows = custodyWithBalance.map((account) => {
    const target = Number(account.target_float ?? 0);
    return {
      id: account.id,
      holder: account.holder_label,
      balance: egp(account.balance),
      target: egp(target),
      topup: egp(Math.max(0, target - account.balance)),
    };
  });

  const paymentColumns: SimpleColumn[] = [
    { id: "no", header: "طلب الصرف", numeric: true },
    { id: "period", header: "الفترة" },
    { id: "status", header: "الحالة", kind: "status" },
    { id: "amount", header: "المعتمد", numeric: true },
  ];
  const openPaymentRequests = (paymentRequestsRes.data ?? []).filter((request) =>
    ["submitted", "approved_operational", "approved_final"].includes(request.status),
  );
  const readyForPayment = openPaymentRequests.filter((request) => request.status === "approved_final");
  const paymentRows = openPaymentRequests.map((request) => ({
    id: request.id,
    href: `/custody/request/${request.id}`,
    no: num(request.request_no),
    period: `${fmtDate(request.period_start)} → ${fmtDate(request.period_end)}`,
    status: REQUEST_STATUS_AR[request.status] ?? request.status,
    amount: request.approved_net_request != null ? egp(Number(request.approved_net_request)) : "—",
  }));

  const unpaidColumns: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "kind", header: "النوع", kind: "status" },
    { id: "category", header: "الفئة" },
    { id: "description", header: "البيان" },
    { id: "total", header: "المبلغ", numeric: true },
  ];
  const unpaidRows = (unpaidExpensesRes.data ?? []).map((expense) => ({
    id: expense.id,
    href: `/expenses/${expense.id}`,
    date: fmtDate(expense.date),
    kind: EXPENSE_KIND_AR[(expense.kind ?? "operating") as ExpenseKind],
    category: expense.category ?? "—",
    description: expense.description ?? "—",
    total: expense.total != null ? egp(Number(expense.total)) : "—",
  }));
  const unpaidTotal = (unpaidExpensesRes.data ?? []).reduce((sum, expense) => sum + Number(expense.total ?? 0), 0);
  const accountantCustodyRows = accountantCustody.map((account) => {
    const target = Number(account.target_float ?? 0);
    return {
      id: account.id,
      holder: account.holder_label,
      balance: egp(account.balance),
      target: egp(target),
      topup: egp(Math.max(0, target - account.balance)),
    };
  });

  const journalColumns: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "source", header: "المصدر" },
    { id: "description", header: "البيان" },
    { id: "status", header: "الحالة" },
  ];
  const journalRows = (journalEntriesRes.data ?? []).map((entry) => ({
    id: entry.id,
    date: fmtDate(entry.entry_date),
    source: entry.source_type,
    description: entry.description ?? "—",
    status: entry.status === "posted" ? "مرحل" : entry.status,
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">لوحة المالية</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            متابعة الموازنة والمصروفات وطلبات الشراء من السجلات الفعلية.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <HeaderLink href="/budgets">الموازنات</HeaderLink>
          <HeaderLink href="/expenses">المصروفات</HeaderLink>
          <HeaderLink href="/purchase-requests">طلبات الشراء</HeaderLink>
          {canSeeAccounting && <HeaderLink href="/finance/accounts">شجرة الحسابات</HeaderLink>}
          {canSeeAccounting && <HeaderLink href="/finance/reports">تقارير التكلفة</HeaderLink>}
          {canSeeAccounting && <HeaderLink href="/finance/revenue-reports">تقارير الإيرادات</HeaderLink>}
          {canSeeAccounting && <HeaderLink href="/farm/offshoots">بنك الفسائل</HeaderLink>}
          {canSeeAccounting && <HeaderLink href="/custody">العهدة</HeaderLink>}
          {canSeeAccounting && <HeaderLink href="/accounting">المحاسبة</HeaderLink>}
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
        {canSeeAccounting && (
          <DashboardKpiLink href="/finance/dashboard?filter=drawings" active={filter === "drawings"}>
            <KpiCard label="مسحوبات مالك معروضة" value={egp(ownerDrawingsTotal)} />
          </DashboardKpiLink>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardKpiLink href="/finance/dashboard?filter=operating" active={filter === "operating"}>
          <KpiCard label="تشغيلي معروض" value={egp(operatingTotal)} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/finance/dashboard?filter=expenses" active={filter === "expenses"}>
          <KpiCard label="مصروفات معروضة" value={num(expenseRows.length)} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/finance/dashboard?filter=prs" active={filter === "prs"}>
          <KpiCard label="طلبات مرسلة" value={num(submittedPrs)} />
        </DashboardKpiLink>
        <KpiCard label="قريبة الاستحقاق" value={num(nearDuePrs)} />
      </section>

      {canSeeAccounting && (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <DashboardKpiLink href="/finance/dashboard?filter=custody" active={filter === "custody"}>
            <KpiCard
              label={m.role === "accountant" ? "عهدتي" : "عهدة المحاسب"}
              value={egp(accountantCustody.reduce((sum, account) => sum + account.balance, 0))}
            />
          </DashboardKpiLink>
          <DashboardKpiLink href="/finance/dashboard?filter=custody" active={filter === "custody"}>
            <KpiCard
              label="رصيد كل العهد"
              value={egp(custodyWithBalance.reduce((sum, account) => sum + account.balance, 0))}
            />
          </DashboardKpiLink>
          <DashboardKpiLink href="/finance/dashboard?filter=payments" active={filter === "payments"}>
            <KpiCard label="طلبات صرف مفتوحة" value={num(openPaymentRequests.length)} />
          </DashboardKpiLink>
          <DashboardKpiLink href="/finance/dashboard?filter=payments" active={filter === "payments"}>
            <KpiCard
              label="جاهزة للدفع"
              value={num(readyForPayment.length)}
              deltaDirection={readyForPayment.length ? "down" : "none"}
            />
          </DashboardKpiLink>
          <DashboardKpiLink href="/finance/dashboard?filter=payments" active={filter === "payments"}>
            <KpiCard
              label="آجل غير مدفوع"
              value={egp(unpaidTotal)}
              deltaDirection={unpaidTotal > 0 ? "down" : "none"}
            />
          </DashboardKpiLink>
          <DashboardKpiLink href="/finance/dashboard?filter=accounting" active={filter === "accounting"}>
            <KpiCard label="قيود حديثة" value={num(journalRows.length)} />
          </DashboardKpiLink>
          <DashboardKpiLink href="/expenses?filter=unclassified" active={false}>
            <KpiCard
              label="مصروفات بدون حساب"
              value={num(unclassifiedCount)}
              deltaDirection={unclassifiedCount > 0 ? "down" : "none"}
            />
          </DashboardKpiLink>
        </section>
      )}

      {(filter === "all" || filter === "budgets") && budgetTotals.approved > 0 && (
        <section className="grid gap-4 lg:grid-cols-2">
          <Card title="استخدام الموازنة">
            <BudgetDoughnut used={spentOrCommitted} available={Math.max(0, available)} />
          </Card>
          {varianceByCategory.length > 0 && (
            <Card title="المعتمد مقابل الفعلي حسب الفئة">
              <VarianceChart data={varianceByCategory} />
            </Card>
          )}
        </section>
      )}

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
            <SimpleTable columns={budgetColumns} rows={budgetRows} ariaLabel="ضغط الموازنة" empty="—" />
          )}
        </Card>
      )}

      {(filter === "all" ||
        filter === "expenses" ||
        filter === "operating" ||
        filter === "drawings" ||
        filter === "unclassified" ||
        filter === "prs") && (
        <section className="grid gap-4 xl:grid-cols-2">
          {(filter === "all" ||
            filter === "expenses" ||
            filter === "operating" ||
            filter === "drawings" ||
            filter === "unclassified") && (
        <Card title={expenseCardTitle}>
          {expenseRows.length === 0 ? (
            <EmptyState title="لا توجد مصروفات مسجّلة" />
          ) : (
            <SimpleTable columns={expenseColumns} rows={expenseRows} ariaLabel={expenseCardTitle} empty="—" />
          )}
        </Card>
          )}
          {(filter === "all" || filter === "prs") && (
        <Card title="طلبات شراء للمتابعة">
          {prRows.length === 0 ? (
            <EmptyState title="لا توجد طلبات شراء للمتابعة" />
          ) : (
            <SimpleTable columns={prColumns} rows={prRows} ariaLabel="طلبات شراء للمتابعة" empty="—" />
          )}
        </Card>
          )}
        </section>
      )}

      {canSeeAccounting && (filter === "all" || filter === "custody" || filter === "payments" || filter === "accounting") && (
        <section className="grid gap-4 xl:grid-cols-2">
          {(filter === "all" || filter === "custody") && (
            <Card title="العهدة حسب الشخص">
              <div className="flex flex-col gap-4">
                {m.role === "accountant" && (
                  <div>
                    <h3 className="mb-2 text-base font-semibold">عهدتي</h3>
                    {accountantCustodyRows.length === 0 ? (
                      <EmptyState title="لا توجد عهدة مربوطة بهذا الحساب" />
                    ) : (
                      <SimpleTable columns={custodyColumns} rows={accountantCustodyRows} ariaLabel="عهدتي" empty="—" />
                    )}
                  </div>
                )}
                <div>
                  <h3 className="mb-2 text-base font-semibold">كل العهد</h3>
                  {custodyRows.length === 0 ? (
                    <EmptyState title="لا توجد عهد مسجلة" />
                  ) : (
                    <SimpleTable columns={custodyColumns} rows={custodyRows} ariaLabel="العهدة حسب الشخص" empty="—" />
                  )}
                </div>
              </div>
            </Card>
          )}
          {(filter === "all" || filter === "payments") && (
            <Card title="طلبات صرف تحتاج متابعة">
              {paymentRows.length === 0 ? (
                <EmptyState title="لا توجد طلبات صرف مفتوحة" />
              ) : (
                <SimpleTable columns={paymentColumns} rows={paymentRows} ariaLabel="طلبات صرف تحتاج متابعة" empty="—" />
              )}
            </Card>
          )}
          {(filter === "all" || filter === "payments") && (
            <Card title="مصروفات آجلة غير مدفوعة">
              {unpaidRows.length === 0 ? (
                <EmptyState title="لا توجد مصروفات آجلة غير مدفوعة" />
              ) : (
                <SimpleTable columns={unpaidColumns} rows={unpaidRows} ariaLabel="مصروفات آجلة غير مدفوعة" empty="—" />
              )}
            </Card>
          )}
          {(filter === "all" || filter === "accounting") && (
            <Card title="آخر القيود المحاسبية">
              {journalRows.length === 0 ? (
                <EmptyState title="لا توجد قيود محاسبية بعد" />
              ) : (
                <SimpleTable columns={journalColumns} rows={journalRows} ariaLabel="آخر القيود المحاسبية" empty="—" />
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

function parseCustodyLedgerHolders(value: unknown): CustodyLedgerHolder[] {
  if (!value || typeof value !== "object") return [];
  const holders = (value as { holders?: unknown }).holders;
  if (!Array.isArray(holders)) return [];
  return holders.flatMap((holder) => {
    if (!holder || typeof holder !== "object") return [];
    const row = holder as Record<string, unknown>;
    if (typeof row.custody_account_id !== "string") return [];
    return [{
      custody_account_id: row.custody_account_id,
      closing_balance: Number(row.closing_balance ?? 0),
    }];
  });
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
