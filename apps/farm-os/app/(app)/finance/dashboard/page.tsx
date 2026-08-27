import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, Card, EmptyState, KpiCard } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn } from "@/components/SimpleTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { CurrentFilterCard } from "@/components/CurrentFilterCard";
import { PageHeader } from "@/components/PageHeader";
import { PrintButton } from "@/components/print-button";
import { LazyFinanceDashboardBudgetCharts } from "@/components/LazyFinanceDashboardBudgetCharts";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import {
  compareDecimals,
  decimalToSafeNumber,
  egpExact,
  maxDecimal,
  multiplyDecimals,
  subtractDecimals,
  sumDecimals,
} from "@/lib/decimal";
import { PR_STATUS_AR, EXPENSE_KIND_AR, REQUEST_STATUS_AR } from "@/lib/labels";
import { DATA_NOT_VERIFIED_AR, isAuthoritative } from "@/lib/data-authority";
import {
  assertFinanceUnpaidSummary,
  currentMonthBounds,
  unpaidExpenseCount,
  unpaidKnownTotal,
  unpaidUnknownCount,
} from "@/lib/expense-register-summary";
import {
  FINANCE_DASHBOARD_JOURNAL_LIMIT,
  FINANCE_DASHBOARD_ROW_LIMIT,
  parseFinanceDashboardSnapshot,
} from "@/lib/finance-dashboard-reads";
import { cairoTodayIso } from "@/lib/payroll-close";
import { AccountantHome } from "./accountant-home";
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
  if (m.role === "accountant") return <AccountantHome orgId={m.orgId} />;
  const sb = await createClient();
  const now = new Date();
  const monthBounds = currentMonthBounds(now);
  const asOf = cairoTodayIso(now);
  const { data, error } = await sb.rpc("fn_finance_dashboard_snapshot", {
    p_org: m.orgId,
    p_month_start: monthBounds.start,
    p_month_end: monthBounds.end,
    p_as_of: asOf,
    p_row_limit: FINANCE_DASHBOARD_ROW_LIMIT,
    p_journal_limit: FINANCE_DASHBOARD_JOURNAL_LIMIT,
  });
  if (error) throw error;
  const snapshot = parseFinanceDashboardSnapshot(
    data,
    m.orgId,
    m.role,
    monthBounds.start,
    monthBounds.end,
    asOf
  );
  const canSeeAccounting = snapshot.canSeeAccounting;
  const finance = snapshot.private;
  const filter =
    !canSeeAccounting && requestedFilter === "drawings"
      ? "all"
      : requestedFilter;
  const budgetsVerified = isAuthoritative(snapshot.budgetAuthority);
  const expenseSummary = finance?.expenseSummary ?? null;
  if (expenseSummary) assertFinanceUnpaidSummary(expenseSummary);

  const custodyWithBalance = finance?.custody ?? [];
  const budgetTotals = snapshot.budgetSummary;
  const spentOrCommitted = budgetTotals.spentOrCommitted;
  const available = budgetTotals.available;

  // Variance per budget category (planned = approved, actual = committed + actual).
  const varianceByCategory = snapshot.budgetCategories.flatMap((category) => {
    const actualExact = sumDecimals([category.committed, category.actual]).total;
    const planned = decimalToSafeNumber(category.approved);
    const actual = decimalToSafeNumber(actualExact);
    return planned === null || actual === null
      ? []
      : [{
          category: category.category,
          planned,
          actual,
          plannedLabel: egpExact(category.approved),
          actualLabel: egpExact(actualExact),
        }];
  });
  const completeVarianceChart =
    varianceByCategory.length === snapshot.budgetCategories.length;
  const chartUsed = decimalToSafeNumber(spentOrCommitted);
  const chartAvailable = decimalToSafeNumber(maxDecimal(available, "0"));
  const submittedPrs = snapshot.purchaseRequestSample.submittedCount;
  const nearDuePrs = snapshot.purchaseRequestSample.nearDueCount;
  const expenseKindRows = snapshot.expenses.map((expense) => ({
    expense,
    kind: expense.kind,
  }));
  const ownerDrawingsTotal = snapshot.expenseSample.drawingTotal;
  const operatingTotal = snapshot.expenseSample.operatingTotal;
  const ownerDrawingsLabel =
    ownerDrawingsTotal === null
      ? "—"
      : `${egpExact(ownerDrawingsTotal)}${
          snapshot.expenseSample.drawingUnknownCount ? " + غير معروف" : ""
        }`;
  const operatingLabel = `${egpExact(operatingTotal)}${
    snapshot.expenseSample.operatingUnknownCount ? " + غير معروف" : ""
  }`;
  const unclassifiedCount = finance?.unclassifiedExpenseCount ?? 0;

  const budgetColumns: SimpleColumn[] = [
    { id: "name", header: "الموازنة" },
    { id: "category", header: "الفئة" },
    {
      id: "approved",
      header: "المعتمد",
      kind: "money-exact",
      numeric: true,
      decimal: true,
    },
    {
      id: "committed",
      header: "الملتزم",
      kind: "money-exact",
      numeric: true,
      decimal: true,
    },
    {
      id: "actual",
      header: "الفعلي",
      kind: "money-exact",
      numeric: true,
      decimal: true,
    },
    {
      id: "available",
      header: "المتاح",
      kind: "money-exact",
      numeric: true,
      decimal: true,
    },
    { id: "signal", header: "الإشارة", kind: "status" },
  ];
  const budgetRows = snapshot.budgets
    .map((b) => {
      const remaining = b.available;
      const signal =
        compareDecimals(b.approved, "0") === 0
          ? "لا اعتماد"
          : compareDecimals(remaining, "0") < 0
          ? "متجاوز"
          : compareDecimals(remaining, multiplyDecimals(b.approved, "0.1")) <= 0
          ? "منخفض"
          : "متاح";
      return {
        id: b.id,
        href: `/budgets/${b.id}`,
        name: b.name,
        category: b.category,
        approved: b.approved,
        committed: b.committed,
        actual: b.actual,
        available: remaining,
        signal,
      };
    })
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
  const budgetRowsTruncated =
    snapshot.budgetSummary.budgetCount > budgetRows.length;

  const expenseColumns: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "kind", header: "النوع", kind: "status" },
    { id: "category", header: "الفئة" },
    { id: "description", header: "البيان" },
    { id: "supplier", header: "المورّد" },
    {
      id: "total",
      header: "المبلغ",
      kind: "money-exact",
      numeric: true,
      decimal: true,
    },
  ];
  const expenseRows = expenseKindRows
    .filter((row) =>
      filter === "drawings"
        ? row.kind === "drawing"
        : filter === "operating"
        ? row.kind === "operating"
        : filter === "unclassified"
        ? row.expense.accountId == null
        : true
    )
    .map(({ expense, kind }) => {
      return {
        id: expense.id,
        href: `/expenses/${expense.id}`,
        date: expense.date ? fmtDate(expense.date) : "—",
        kind: EXPENSE_KIND_AR[kind],
        category: expense.category ?? "—",
        description: expense.description ?? "—",
        supplier: expense.supplierName ?? "—",
        total: expense.total ?? undefined,
      };
    });

  const expenseCardTitle =
    filter === "drawings"
      ? "مسحوبات المالك المعروضة"
      : filter === "operating"
      ? "مصروفات تشغيلية معروضة"
      : filter === "unclassified"
      ? "مصروفات بدون حساب معروضة"
      : "آخر المصروفات المعروضة";

  const prColumns: SimpleColumn[] = [
    { id: "code", header: "طلب الشراء" },
    { id: "reason", header: "السبب" },
    { id: "needed_by", header: "مطلوب بحلول" },
    { id: "status", header: "الحالة", kind: "status" },
  ];
  const prRows = snapshot.purchaseRequests.map((pr) => ({
    id: pr.id,
    href: `/purchase-requests/${pr.id}`,
    code: pr.code,
    reason: pr.reason ?? "—",
    needed_by: pr.neededBy ? fmtDate(pr.neededBy) : "—",
    status: PR_STATUS_AR[pr.status] ?? "غير معروف",
  }));

  const custodyColumns: SimpleColumn[] = [
    { id: "holder", header: "العهدة لدى" },
    {
      id: "balance",
      header: "الرصيد",
      kind: "money-exact",
      numeric: true,
      decimal: true,
    },
    {
      id: "target",
      header: "المستهدف",
      kind: "money-exact",
      numeric: true,
      decimal: true,
    },
    {
      id: "topup",
      header: "التغذية المطلوبة",
      kind: "money-exact",
      numeric: true,
      decimal: true,
    },
  ];
  const custodyRows = custodyWithBalance.map((account) => {
    return {
      id: account.id,
      holder: account.holder_label,
      balance: account.balance,
      target: account.target_float,
      topup: maxDecimal(
        subtractDecimals(account.target_float, account.balance),
        "0"
      ),
    };
  });

  const paymentColumns: SimpleColumn[] = [
    { id: "no", header: "طلب الصرف", kind: "num", numeric: true },
    { id: "period", header: "الفترة" },
    { id: "status", header: "الحالة", kind: "status" },
    {
      id: "amount",
      header: "المعتمد",
      kind: "money-exact",
      numeric: true,
      decimal: true,
    },
  ];
  const openPaymentRequests = finance?.paymentRequests ?? [];
  const openPaymentRequestCount = finance?.openPaymentCount ?? 0;
  const readyPaymentCount = finance?.readyPaymentCount ?? 0;
  const paymentRowsTruncated =
    openPaymentRequestCount > openPaymentRequests.length;
  const paymentRows = openPaymentRequests.map((request) => ({
    id: request.id,
    href: `/custody/request/${request.id}`,
    no: request.requestNo,
    period: `${request.periodStart ? fmtDate(request.periodStart) : "—"} → ${
      request.periodEnd ? fmtDate(request.periodEnd) : "—"
    }`,
    status: REQUEST_STATUS_AR[request.status] ?? request.status,
    amount: request.approvedNetRequest ?? undefined,
  }));

  const unpaidColumns: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "kind", header: "النوع", kind: "status" },
    { id: "category", header: "الفئة" },
    { id: "description", header: "البيان" },
    {
      id: "total",
      header: "المبلغ",
      kind: "money-exact",
      numeric: true,
      decimal: true,
    },
  ];
  const unpaidRows = (finance?.unpaidExpenses ?? []).map((expense) => ({
    id: expense.id,
    href: `/expenses/${expense.id}`,
    date: fmtDate(expense.date),
    kind: EXPENSE_KIND_AR[(expense.kind ?? "operating") as ExpenseKind],
    category: expense.category ?? "—",
    description: expense.description ?? "—",
    total: expense.total ?? undefined,
  }));
  const unpaidTotal = expenseSummary ? unpaidKnownTotal(expenseSummary) : "0";
  const unpaidCount = expenseSummary ? unpaidExpenseCount(expenseSummary) : 0;
  const unpaidUnknown = expenseSummary ? unpaidUnknownCount(expenseSummary) : 0;
  const unpaidRowsTruncated = unpaidCount > unpaidRows.length;
  const journalColumns: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "source", header: "المصدر" },
    { id: "description", header: "البيان" },
    { id: "status", header: "الحالة" },
  ];
  const journalRows = (finance?.journalEntries ?? []).map((entry) => ({
    id: entry.id,
    date: fmtDate(entry.entryDate),
    source: entry.sourceType,
    description: entry.description ?? "—",
    status: entry.status === "posted" ? "مرحل" : entry.status,
  }));
  const journalCount = finance?.journalCount ?? 0;
  const journalRowsTruncated = journalCount > journalRows.length;
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="لوحة المالية"
        subtitle="متابعة الموازنة والمصروفات وطلبات الشراء من السجلات الفعلية."
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <PrintButton label="طباعة لوحة المالية" />
            <HeaderLink href="/expenses">المصروفات</HeaderLink>
            {canSeeAccounting && <HeaderLink href="/custody">العهدة</HeaderLink>}
            {canSeeAccounting && <HeaderLink href="/accounting">المحاسبة</HeaderLink>}
          </div>
        }
      />

      {budgetsVerified && (
        <p className="flex items-start gap-2 text-sm" style={{ color: "var(--ink-muted)" }}>
          <AlertTriangle
            size={16}
            className="mt-0.5 shrink-0"
            style={{ color: "var(--warning-fg)" }}
            aria-hidden
          />
          <span>
            <strong className="font-semibold" style={{ color: "var(--ink)" }}>
              أرقام الموازنة لقطة — ليست رقابة حية.
            </strong>{" "}
            «الملتزم» و«الفعلي» و«المتاح» أدناه أرقام موازنة موثقة المصدر، لكنها
            لا تتحدّث تلقائيًا من الاعتمادات والمصروفات. لا تعتمد عليها كرقابة صرف
            حية. راجع{" "}
            <Link
              href="/finance/budget-vs-actual"
              className="font-semibold underline underline-offset-4"
            >
              الموازنة مقابل الفعلي من القيود المُرحّلة
            </Link>
            .
          </span>
        </p>
      )}

      {(budgetsVerified || canSeeAccounting) && (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {budgetsVerified && (
            <>
              <DashboardKpiLink
                href="/finance/dashboard?filter=budgets"
                active={filter === "budgets"}
              >
                <KpiCard
                  label="المعتمد (لقطة)"
                  value={egpExact(budgetTotals.approved)}
                />
              </DashboardKpiLink>
              <DashboardKpiLink
                href="/finance/dashboard?filter=budgets"
                active={filter === "budgets"}
              >
                <KpiCard
                  label="ملتزم + فعلي (لقطة)"
                  value={egpExact(spentOrCommitted)}
                />
              </DashboardKpiLink>
              <DashboardKpiLink
                href="/finance/dashboard?filter=budgets"
                active={filter === "budgets"}
              >
                <KpiCard
                  label="المتاح (لقطة)"
                  value={egpExact(available)}
                  deltaDirection={
                    compareDecimals(available, "0") < 0 ? "down" : "none"
                  }
                />
              </DashboardKpiLink>
            </>
          )}
          {canSeeAccounting && (
            <DashboardKpiLink
              href="/finance/dashboard?filter=drawings"
              active={filter === "drawings"}
            >
              <KpiCard label="مسحوبات مالك معروضة" value={ownerDrawingsLabel} />
            </DashboardKpiLink>
          )}
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardKpiLink
          href="/finance/dashboard?filter=operating"
          active={filter === "operating"}
        >
          <KpiCard label="تشغيلي معروض" value={operatingLabel} />
        </DashboardKpiLink>
        <DashboardKpiLink
          href="/finance/dashboard?filter=expenses"
          active={filter === "expenses"}
        >
          <KpiCard label="مصروفات معروضة" value={num(expenseRows.length)} />
        </DashboardKpiLink>
        <DashboardKpiLink
          href="/finance/dashboard?filter=prs"
          active={filter === "prs"}
        >
          <KpiCard label="طلبات مرسلة ضمن المعروض" value={num(submittedPrs)} />
        </DashboardKpiLink>
        <KpiCard label="قريبة الاستحقاق ضمن المعروض" value={num(nearDuePrs)} />
      </section>

      {canSeeAccounting && (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <DashboardKpiLink
            href="/finance/dashboard?filter=custody"
            active={filter === "custody"}
          >
            <KpiCard
              label="رصيد كل العهد"
              value={egpExact(
                sumDecimals(
                  custodyWithBalance.map((account) => account.balance)
                ).total
              )}
            />
          </DashboardKpiLink>
          <DashboardKpiLink
            href="/finance/dashboard?filter=payments"
            active={filter === "payments"}
          >
            <KpiCard
              label="طلبات صرف مفتوحة"
              value={num(openPaymentRequestCount)}
            />
          </DashboardKpiLink>
          <DashboardKpiLink
            href="/finance/dashboard?filter=payments"
            active={filter === "payments"}
          >
            <KpiCard
              label="جاهزة للدفع"
              value={num(readyPaymentCount)}
              deltaDirection={readyPaymentCount ? "down" : "none"}
            />
          </DashboardKpiLink>
          <DashboardKpiLink
            href="/finance/dashboard?filter=payments"
            active={filter === "payments"}
          >
            <KpiCard
              label={
                unpaidUnknown > 0 ? "آجل معروف غير مدفوع" : "آجل غير مدفوع"
              }
              value={egpExact(unpaidTotal)}
              deltaDirection={
                compareDecimals(unpaidTotal, "0") > 0 ? "down" : "none"
              }
            />
          </DashboardKpiLink>
          <DashboardKpiLink
            href="/finance/dashboard?filter=accounting"
            active={filter === "accounting"}
          >
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

      {budgetsVerified &&
        (filter === "all" || filter === "budgets") &&
        compareDecimals(budgetTotals.approved, "0") > 0 &&
        chartUsed !== null &&
        chartAvailable !== null && (
          <LazyFinanceDashboardBudgetCharts
            used={chartUsed}
            available={chartAvailable}
            usedLabel={egpExact(spentOrCommitted)}
            availableLabel={egpExact(maxDecimal(available, "0"))}
            variance={completeVarianceChart ? varianceByCategory : []}
          />
        )}

      <div className="no-print">
        <CurrentFilterCard
          label={FILTER_LABEL_AR[filter] ?? "فلتر غير معروف"}
          clearHref="/finance/dashboard"
          showClear={filter !== "all"}
        />
      </div>

      {(filter === "all" || filter === "budgets") && (
        <>
          {!budgetsVerified && (
            <Alert
              tone="warning"
              title="لا توجد موازنة موثقة"
              description={DATA_NOT_VERIFIED_AR}
            />
          )}
          {budgetsVerified && (
            <Card title="ضغط الموازنة (لقطة)">
              <div className="flex flex-col gap-3">
                {budgetRowsTruncated && (
                  <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
                    الجدول يعرض أكثر {num(budgetRows.length)} موازنات ضغطًا من
                    أصل {num(snapshot.budgetSummary.budgetCount)}. البحث داخل
                    المعروض، والتصدير متوقف حتى لا ينتج ملف ناقص.
                  </p>
                )}
                {budgetRows.length === 0 ? (
                  <EmptyState title="لا توجد موازنات" />
                ) : (
                  <FilterableTable
                    columns={budgetColumns}
                    rows={budgetRows}
                    ariaLabel="ضغط الموازنة"
                    exportFilename={
                      budgetRowsTruncated
                        ? undefined
                        : "finance-dashboard-budget-pressure"
                    }
                    empty="—"
                  />
                )}
              </div>
            </Card>
          )}
        </>
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
                <FilterableTable
                  columns={expenseColumns}
                  rows={expenseRows}
                  ariaLabel={expenseCardTitle}
                  empty="—"
                />
              )}
            </Card>
          )}
          {(filter === "all" || filter === "prs") && (
            <Card title="طلبات شراء للمتابعة معروضة">
              {prRows.length === 0 ? (
                <EmptyState title="لا توجد طلبات شراء للمتابعة" />
              ) : (
                <FilterableTable
                  columns={prColumns}
                  rows={prRows}
                  ariaLabel="طلبات شراء للمتابعة معروضة"
                  empty="—"
                />
              )}
            </Card>
          )}
        </section>
      )}

      {canSeeAccounting &&
        (filter === "all" ||
          filter === "custody" ||
          filter === "payments" ||
          filter === "accounting") && (
          <section className="grid gap-4 xl:grid-cols-2">
            {(filter === "all" || filter === "custody") && (
              <Card title="العهدة حسب الشخص">
                <div className="flex flex-col gap-4">
                  <div>
                    <h3 className="mb-2 text-base font-semibold">كل العهد</h3>
                    {custodyRows.length === 0 ? (
                      <EmptyState title="لا توجد عهد مسجلة" />
                    ) : (
                      <FilterableTable
                        columns={custodyColumns}
                        rows={custodyRows}
                        ariaLabel="العهدة حسب الشخص"
                        exportFilename="finance-dashboard-custody"
                        empty="—"
                      />
                    )}
                  </div>
                </div>
              </Card>
            )}
            {(filter === "all" || filter === "payments") && (
              <Card
                title={`طلبات صرف تحتاج متابعة (${num(
                  openPaymentRequestCount
                )})`}
              >
                <div className="flex flex-col gap-3">
                  {paymentRowsTruncated && (
                    <p
                      className="text-sm"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      القائمة تعرض أحدث {num(paymentRows.length)} من أصل{" "}
                      {num(openPaymentRequestCount)} طلبًا مفتوحًا. البحث داخل
                      المعروض، والتصدير متوقف حتى لا ينتج ملف ناقص.
                    </p>
                  )}
                  {paymentRows.length === 0 ? (
                    <EmptyState title="لا توجد طلبات صرف مفتوحة" />
                  ) : (
                    <FilterableTable
                      columns={paymentColumns}
                      rows={paymentRows}
                      ariaLabel="طلبات صرف تحتاج متابعة"
                      exportFilename={
                        paymentRowsTruncated
                          ? undefined
                          : "finance-dashboard-payment-requests"
                      }
                      empty="—"
                    />
                  )}
                </div>
              </Card>
            )}
            {(filter === "all" || filter === "payments") && (
              <Card title={`مصروفات آجلة غير مدفوعة (${num(unpaidCount)})`}>
                <div className="flex flex-col gap-3">
                  {unpaidUnknown > 0 && (
                    <Alert
                      tone="warning"
                      title="مبالغ آجلة غير مكتملة"
                      description={`يوجد ${num(
                        unpaidUnknown
                      )} مصروف آجل بدون مبلغ. الإجمالي يعرض المبالغ المعروفة فقط.`}
                    />
                  )}
                  {unpaidRowsTruncated && (
                    <p
                      className="text-sm"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      الجدول يعرض أقدم {num(unpaidRows.length)} سجلًا فقط
                      للمتابعة. البحث داخل المعروض، والتصدير متوقف حتى لا ينتج
                      ملف ناقص.
                    </p>
                  )}
                  {unpaidRows.length === 0 ? (
                    <EmptyState title="لا توجد مصروفات آجلة غير مدفوعة" />
                  ) : (
                    <FilterableTable
                      columns={unpaidColumns}
                      rows={unpaidRows}
                      ariaLabel="مصروفات آجلة غير مدفوعة"
                      exportFilename={
                        unpaidRowsTruncated
                          ? undefined
                          : "finance-dashboard-unpaid-obligations"
                      }
                      empty="—"
                    />
                  )}
                </div>
              </Card>
            )}
            {(filter === "all" || filter === "accounting") && (
              <Card title="آخر القيود المحاسبية">
                <div className="flex flex-col gap-3">
                  {journalRowsTruncated && (
                    <p
                      className="text-sm"
                      style={{ color: "var(--ink-muted)" }}
                    >
                      الجدول يعرض أحدث {num(journalRows.length)} قيدًا من أصل{" "}
                      {num(journalCount)}. البحث داخل المعروض، والتصدير متوقف
                      حتى لا ينتج ملف ناقص.
                    </p>
                  )}
                  {journalRows.length === 0 ? (
                    <EmptyState title="لا توجد قيود محاسبية بعد" />
                  ) : (
                    <FilterableTable
                      columns={journalColumns}
                      rows={journalRows}
                      ariaLabel="آخر القيود المحاسبية"
                      exportFilename={
                        journalRowsTruncated
                          ? undefined
                          : "finance-dashboard-journal-entries"
                      }
                      empty="—"
                    />
                  )}
                </div>
              </Card>
            )}
          </section>
        )}
    </div>
  );
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
