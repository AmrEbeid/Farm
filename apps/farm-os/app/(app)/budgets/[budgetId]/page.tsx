import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import type { PillStatus, TabItem } from "@amrebeid/ui";
import { Alert, Card, DescriptionList, EmptyState, KpiCard, tabId, tabPanelId } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { Entity360Header } from "@/components/Entity360Header";
import { EntityTabs } from "@/components/EntityTabs";
import { fmtDate } from "@/lib/dates";
import { egp, num } from "@/lib/money";
import { BUDGET_STATUS_AR, PR_STATUS_AR } from "@/lib/labels";

const BASE_TAB_IDS = ["overview", "lines", "purchases"] as const;
type BudgetTab = (typeof BASE_TAB_IDS)[number] | "finance";

const BUDGET_STATUS_PILL: Record<string, PillStatus> = {
  draft: "draft",
  active: "active",
  approved: "active",
  closed: "done",
  archived: "done",
};

export default async function Budget360Page({
  params,
  searchParams,
}: {
  params: Promise<{ budgetId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { budgetId } = await params;
  const { tab: rawTab } = await searchParams;
  // farm_manager may see the budget (lines, PRs, roll-ups) but NOT the raw expense
  // ledger — expenses are private finance data scoped to owner/accountant, matching
  // finance/dashboard and the supplier 360. RLS leaves expense READS org-only, so
  // this app-layer gate is the real boundary for the expense sub-section.
  const m = await requireRole(["owner", "accountant", "farm_manager"]);
  const canReadPrivateFinance = m.role === "owner" || m.role === "accountant";
  // The finance tab id is only valid for owner/accountant; everyone else falls back
  // to overview, matching the supplier 360.
  const validTabIds: readonly string[] = canReadPrivateFinance
    ? [...BASE_TAB_IDS, "finance"]
    : BASE_TAB_IDS;
  const tab: BudgetTab = validTabIds.includes(rawTab ?? "") ? (rawTab as BudgetTab) : "overview";
  const sb = await createClient();

  const { data: budget, error: budgetError } = await sb
    .from("budgets")
    .select("id, name, period, category, planned, approved, committed, actual, status")
    .eq("id", budgetId)
    .maybeSingle();
  if (budgetError) throw budgetError;
  if (!budget)
    return (
      <div className="p-6">
        <EmptyState title="الموازنة غير موجودة." description="قد تكون محذوفة أو الرابط غير صحيح." icon="🔍" />
      </div>
    );

  const [
    { data: lines, error: linesError },
    { data: expenses, error: expensesError },
    { data: prs, error: prsError },
  ] = await Promise.all([
    sb
      .from("budget_lines")
      .select("id, category, planned, approved, committed, actual")
      .eq("budget_id", budgetId)
      .order("category"),
    canReadPrivateFinance && budget.category
      ? sb
          .from("expenses")
          .select("id, date, category, description, total")
          .eq("category", budget.category)
          .order("date", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [], error: null }),
    sb
      .from("purchase_requests")
      .select("id, code, status, reason, needed_by")
      .eq("budget_category_id", budgetId)
      .order("needed_by", { ascending: true })
      .limit(12),
  ]);
  if (linesError) throw linesError;
  if (expensesError) throw expensesError;
  if (prsError) throw prsError;

  const approved = Number(budget.approved ?? 0);
  const committed = Number(budget.committed ?? 0);
  const actual = Number(budget.actual ?? 0);
  const available = approved - committed - actual;

  // Over-budget check, mirroring the finance dashboard: spentOrCommitted = committed +
  // actual; over the approved ceiling → danger; within 10% of it → warning.
  const spentOrCommitted = committed + actual;
  const overBudget = approved > 0 && spentOrCommitted > approved;
  const nearBudget = approved > 0 && !overBudget && spentOrCommitted >= approved * 0.9;

  const statusKey = budget.status ?? "";
  const statusLabel = BUDGET_STATUS_AR[statusKey] ?? "غير معروف";
  const statusPill: PillStatus = overBudget
    ? "blocked"
    : BUDGET_STATUS_PILL[statusKey] ?? "draft";

  const lineColumns: SimpleColumn[] = [
    { id: "category", header: "الفئة" },
    { id: "planned", header: "المخطط", numeric: true },
    { id: "approved", header: "المعتمد", numeric: true },
    { id: "committed", header: "الملتزم", numeric: true },
    { id: "actual", header: "الفعلي", numeric: true },
    { id: "available", header: "المتاح", numeric: true },
  ];
  const lineRows = (lines ?? []).map((line) => {
    const lineApproved = Number(line.approved ?? 0);
    const lineCommitted = Number(line.committed ?? 0);
    const lineActual = Number(line.actual ?? 0);
    return {
      id: line.id,
      category: line.category ?? "—",
      planned: egp(Number(line.planned ?? 0)),
      approved: egp(lineApproved),
      committed: egp(lineCommitted),
      actual: egp(lineActual),
      available: egp(lineApproved - lineCommitted - lineActual),
    };
  });

  const expenseColumns: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "description", header: "البيان" },
    { id: "total", header: "المبلغ", numeric: true },
  ];
  const expenseRows = (expenses ?? []).map((expense) => ({
    id: expense.id,
    href: `/expenses/${expense.id}`,
    date: expense.date ? fmtDate(expense.date) : "—",
    description: expense.description ?? "—",
    total: expense.total != null ? egp(Number(expense.total)) : "—",
  }));

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

  const subtitle = `${budget.period ?? "—"} · ${budget.category ?? "—"}`;
  const tabItems: TabItem[] = [
    { id: "overview", label: "نظرة عامة" },
    { id: "lines", label: `البنود (${num(lineRows.length)})` },
    { id: "purchases", label: `طلبات الشراء (${num(prRows.length)})` },
    ...(canReadPrivateFinance
      ? [{ id: "finance", label: `مصروفات الفئة (${num(expenseRows.length)})` } satisfies TabItem]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <Entity360Header
        title={budget.name ?? budget.category ?? budget.period ?? budget.id}
        subtitle={subtitle}
        pills={[{ status: statusPill, label: statusLabel }]}
        actions={
          <>
            <HeaderLink href="/finance/dashboard">لوحة المالية</HeaderLink>
            <HeaderLink href="/budgets">الموازنات</HeaderLink>
          </>
        }
      />

      {overBudget && (
        <Alert
          tone="danger"
          title="تجاوز الموازنة"
          description="تجاوز الملتزم والفعلي السقف المعتمد لهذه الموازنة."
        />
      )}
      {nearBudget && (
        <Alert
          tone="warning"
          title="اقتراب من سقف الموازنة"
          description="الملتزم والفعلي ضمن ١٠٪ من السقف المعتمد."
        />
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="المخطط" value={egp(Number(budget.planned ?? 0))} />
        <KpiCard label="المعتمد" value={egp(approved)} />
        <KpiCard label="ملتزم + فعلي" value={egp(spentOrCommitted)} />
        <KpiCard label="المتاح" value={egp(available)} deltaDirection={available < 0 ? "down" : "none"} />
      </section>

      <EntityTabs items={tabItems} value={tab} />

      {tab === "overview" && (
        <div role="tabpanel" id={tabPanelId("overview")} aria-labelledby={tabId("overview")} tabIndex={0}>
          <Card title="بيانات الموازنة">
            <DescriptionList
              layout="inline"
              items={[
                { id: "period", term: "الفترة", description: budget.period ?? "—" },
                { id: "category", term: "الفئة", description: budget.category ?? "—" },
                { id: "status", term: "الحالة", description: statusLabel },
              ]}
            />
          </Card>
        </div>
      )}

      {tab === "lines" && (
        <div role="tabpanel" id={tabPanelId("lines")} aria-labelledby={tabId("lines")} tabIndex={0}>
          <Card title="بنود الموازنة">
            {lineRows.length === 0 ? (
              <EmptyState title="لا توجد بنود موازنة" />
            ) : (
              <SimpleTable columns={lineColumns} rows={lineRows} empty="—" />
            )}
          </Card>
        </div>
      )}

      {tab === "purchases" && (
        <div role="tabpanel" id={tabPanelId("purchases")} aria-labelledby={tabId("purchases")} tabIndex={0}>
          <Card title="طلبات شراء مرتبطة">
            {prRows.length === 0 ? (
              <EmptyState title="لا توجد طلبات شراء مرتبطة" />
            ) : (
              <SimpleTable columns={prColumns} rows={prRows} empty="—" />
            )}
          </Card>
        </div>
      )}

      {canReadPrivateFinance && tab === "finance" && (
        <div role="tabpanel" id={tabPanelId("finance")} aria-labelledby={tabId("finance")} tabIndex={0}>
          <Card title="مصروفات من نفس الفئة">
            {expenseRows.length === 0 ? (
              <EmptyState title="لا توجد مصروفات مرتبطة بالفئة" />
            ) : (
              <SimpleTable columns={expenseColumns} rows={expenseRows} empty="—" />
            )}
          </Card>
        </div>
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
