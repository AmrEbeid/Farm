import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, DescriptionList, EmptyState, KpiCard } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { fmtDate } from "@/lib/dates";
import { egp } from "@/lib/money";
import { BUDGET_STATUS_AR, PR_STATUS_AR } from "@/lib/labels";

export default async function Budget360Page({
  params,
}: {
  params: Promise<{ budgetId: string }>;
}) {
  const { budgetId } = await params;
  await requireRole(["owner", "accountant", "farm_manager"]);
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
    budget.category
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

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">ملف الموازنة — {budget.name ?? budget.category ?? budget.period ?? budget.id}</h1>
          <p style={{ color: "var(--ink-muted)" }}>نظرة 360 على المخطط والمعتمد والملتزم والفعلي.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <HeaderLink href="/finance/dashboard">لوحة المالية</HeaderLink>
          <HeaderLink href="/budgets">الموازنات</HeaderLink>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="المخطط" value={egp(Number(budget.planned ?? 0))} />
        <KpiCard label="المعتمد" value={egp(approved)} />
        <KpiCard label="ملتزم + فعلي" value={egp(committed + actual)} />
        <KpiCard label="المتاح" value={egp(available)} deltaDirection={available < 0 ? "down" : "none"} />
      </section>

      <Card title="بيانات الموازنة">
        <DescriptionList
          layout="inline"
          items={[
            { id: "period", term: "الفترة", description: budget.period ?? "—" },
            { id: "category", term: "الفئة", description: budget.category ?? "—" },
            { id: "status", term: "الحالة", description: BUDGET_STATUS_AR[budget.status ?? ""] ?? "غير معروف" },
          ]}
        />
      </Card>

      <Card title="بنود الموازنة">
        {lineRows.length === 0 ? (
          <EmptyState title="لا توجد بنود موازنة" />
        ) : (
          <SimpleTable columns={lineColumns} rows={lineRows} empty="—" />
        )}
      </Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card title="مصروفات من نفس الفئة">
          {expenseRows.length === 0 ? (
            <EmptyState title="لا توجد مصروفات مرتبطة بالفئة" />
          ) : (
            <SimpleTable columns={expenseColumns} rows={expenseRows} empty="—" />
          )}
        </Card>
        <Card title="طلبات شراء مرتبطة">
          {prRows.length === 0 ? (
            <EmptyState title="لا توجد طلبات شراء مرتبطة" />
          ) : (
            <SimpleTable columns={prColumns} rows={prRows} empty="—" />
          )}
        </Card>
      </section>
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
