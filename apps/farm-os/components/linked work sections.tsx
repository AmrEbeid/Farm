import Link from "next/link";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { PrintButton } from "@/components/print button";
import type { LinkedOperation, LinkedWorkContext } from "@/lib/linked work context";
import { fmtDate } from "@/lib/dates";
import { egp, egpValue, num } from "@/lib/money";
import { OP_STATUS_AR, PLAN_STATUS_AR, PLAN_TYPE_AR, SUBTYPE_AR } from "@/lib/labels";

const SCOPE_AR: Record<string, string> = {
  farm: "المزرعة",
  sector: "قطاع / مزرعة فرعية",
  hawsha: "حوشة",
  line: "خط",
  palm: "نخلة",
};

const PAYMENT_STATUS_AR: Record<string, string> = {
  paid_from_custody: "مدفوع من العهدة",
  post_paid_unpaid: "آجل غير مدفوع",
  paid_by_owner: "مدفوع من المالك",
  cancelled: "ملغى",
};

const EXPENSE_KIND_AR: Record<string, string> = {
  operating: "تشغيلي",
  drawing: "مسحوبات مالك",
  capex: "رأسمالي",
};

const REQUEST_STATUS_AR: Record<string, string> = {
  draft: "مسودة",
  submitted: "مُرسل",
  approved_operational: "اعتماد تشغيلي",
  approved_final: "اعتماد نهائي",
  paid: "مدفوع",
  closed: "مُقفل",
};

export function LinkedWorkKpis({
  context,
  canSeeFinance,
}: {
  context: LinkedWorkContext;
  canSeeFinance: boolean;
}) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard label="خطط مرتبطة" value={num(context.plans.length)} />
      <KpiCard label="عمليات مفتوحة" value={num(context.openOperations.length)} />
      <KpiCard
        label="مهام غير مسندة"
        value={num(context.unassignedOperations.length)}
        deltaDirection={context.unassignedOperations.length ? "down" : "none"}
      />
      {canSeeFinance ? (
        <KpiCard label="مصروفات مرتبطة" value={egp(context.financeTotals.expenseTotal)} />
      ) : (
        <KpiCard label="أنشطة مسجلة" value={num(context.events.length)} />
      )}
    </section>
  );
}

export function LinkedPlansCard({ context }: { context: LinkedWorkContext }) {
  const columns: SimpleColumn[] = [
    { id: "type", header: "نوع الخطة" },
    { id: "period", header: "الفترة" },
    { id: "scope", header: "النطاق" },
    { id: "status", header: "الحالة", kind: "status" },
  ];
  const rows = context.plans.map((plan) => ({
    id: plan.id,
    href: `/plans/${plan.id}`,
    type: PLAN_TYPE_AR[plan.type ?? ""] ?? "خطة",
    period: `${fmtDate(plan.period_start)} → ${fmtDate(plan.period_end)}`,
    scope: SCOPE_AR[plan.scope_type ?? ""] ?? "غير معروف",
    status: PLAN_STATUS_AR[plan.status ?? ""] ?? plan.status ?? "—",
  }));

  return (
    <Card title="الخطط المرتبطة">
      {rows.length === 0 ? (
        <EmptyState title="لا توجد خطط مرتبطة بهذا النطاق بعد" />
      ) : (
        <SimpleTable columns={columns} rows={rows} ariaLabel="الخطط المرتبطة" empty="—" />
      )}
    </Card>
  );
}

export function LinkedTasksCard({ context }: { context: LinkedWorkContext }) {
  const columns: SimpleColumn[] = [
    { id: "operation", header: "العملية" },
    { id: "date", header: "الميعاد" },
    { id: "assignees", header: "المكلّفون" },
    { id: "cost", header: "التكلفة", numeric: true },
    { id: "status", header: "الحالة", kind: "status" },
  ];
  const rows = context.operations.slice(0, 30).map((op) => ({
    id: op.id,
    href: `/plans/${op.plan_id}`,
    operation: SUBTYPE_AR[op.subtype ?? ""] ?? "عملية",
    date: op.ends_on ? `${fmtDate(op.planned_at)} → ${fmtDate(op.ends_on)}` : fmtDate(op.planned_at),
    assignees: assigneeLabel(context, op),
    cost: egpValue(op.est_cost),
    status: OP_STATUS_AR[op.status ?? "planned"] ?? "غير معروف",
  }));

  return (
    <Card title="العمليات والمهام">
      {rows.length === 0 ? (
        <EmptyState title="لا توجد عمليات مرتبطة بهذا النطاق بعد" />
      ) : (
        <SimpleTable columns={columns} rows={rows} ariaLabel="العمليات والمهام" empty="—" />
      )}
      {context.unassignedOperations.length > 0 && (
        <p className="mt-3 text-sm" style={{ color: "var(--danger,#b91c1c)" }}>
          يوجد {num(context.unassignedOperations.length)} عملية مفتوحة بلا تكليف واضح.
        </p>
      )}
    </Card>
  );
}

export function LinkedFinanceCard({ context }: { context: LinkedWorkContext }) {
  const expenseColumns: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "kind", header: "النوع", kind: "status" },
    { id: "category", header: "الفئة" },
    { id: "description", header: "البيان" },
    { id: "payment", header: "الدفع", kind: "status" },
    { id: "total", header: "المبلغ", numeric: true },
  ];
  const expenseRows = context.expenses.slice(0, 12).map((expense) => ({
    id: expense.id,
    href: `/expenses/${expense.id}`,
    date: fmtDate(expense.date),
    kind: EXPENSE_KIND_AR[expense.kind ?? "operating"] ?? "—",
    category: expense.category ?? "—",
    description: expense.description ?? "—",
    payment: PAYMENT_STATUS_AR[expense.payment_status ?? ""] ?? expense.payment_status ?? "—",
    total: egpValue(expense.total),
  }));

  const requestColumns: SimpleColumn[] = [
    { id: "no", header: "طلب الصرف", numeric: true },
    { id: "period", header: "الفترة" },
    { id: "status", header: "الحالة", kind: "status" },
    { id: "amount", header: "المعتمد", numeric: true },
  ];
  const requestRows = context.paymentRequests.slice(0, 8).map((request) => ({
    id: request.id,
    href: `/custody/request/${request.id}`,
    no: num(request.request_no),
    period: `${fmtDate(request.period_start)} → ${fmtDate(request.period_end)}`,
    status: REQUEST_STATUS_AR[request.status] ?? request.status,
    amount: egpValue(request.approved_net_request),
  }));

  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <Card title="المصروفات المرتبطة">
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <KpiCard label="إجمالي المصروفات" value={egp(context.financeTotals.expenseTotal)} />
          <KpiCard label="آجل غير مدفوع" value={egp(context.financeTotals.unpaidTotal)} />
          <KpiCard label="صرف عهدة" value={egp(context.financeTotals.custodyOut)} />
        </div>
        {expenseRows.length === 0 ? (
          <EmptyState title="لا توجد مصروفات مرتبطة بهذا النطاق" />
        ) : (
          <SimpleTable columns={expenseColumns} rows={expenseRows} ariaLabel="المصروفات المرتبطة" empty="—" />
        )}
      </Card>

      <Card title="طلبات الصرف والقيود">
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <KpiCard label="طلبات صرف" value={num(context.paymentRequests.length)} />
          <KpiCard label="قيود مدينة" value={egp(context.financeTotals.journalDebit)} />
          <KpiCard label="قيود دائنة" value={egp(context.financeTotals.journalCredit)} />
        </div>
        {requestRows.length === 0 ? (
          <EmptyState title="لا توجد طلبات صرف مرتبطة" />
        ) : (
          <SimpleTable columns={requestColumns} rows={requestRows} ariaLabel="طلبات الصرف المرتبطة" empty="—" />
        )}
      </Card>
    </section>
  );
}

export function LinkedReportCard({
  context,
  title,
  canSeeFinance,
}: {
  context: LinkedWorkContext;
  title: string;
  canSeeFinance: boolean;
}) {
  return (
    <Card title={`تقرير ${title}`}>
      <div className="mb-4 flex justify-end no-print">
        <PrintButton />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="خطط" value={num(context.plans.length)} />
        <KpiCard label="عمليات" value={num(context.operations.length)} />
        <KpiCard label="متأخر / مستحق" value={num(context.dueOperations.length)} />
        <KpiCard label="أنشطة" value={num(context.events.length)} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <ReportList
          title="أقرب مهام مفتوحة"
          empty="لا توجد مهام مفتوحة"
          items={context.openOperations.slice(0, 8).map((op) => ({
            id: op.id,
            href: `/plans/${op.plan_id}`,
            text: `${SUBTYPE_AR[op.subtype ?? ""] ?? "عملية"} · ${fmtDate(op.planned_at)} · ${assigneeLabel(context, op)}`,
          }))}
        />
        <ReportList
          title="آخر أنشطة مسجلة"
          empty="لا توجد أنشطة مسجلة"
          items={context.events.slice(0, 8).map((event) => ({
            id: event.id,
            text: `${SUBTYPE_AR[event.subtype ?? ""] ?? "نشاط"} · ${fmtDate(event.occurred_at)} · ${
              OP_STATUS_AR[event.status ?? ""] ?? event.status ?? "—"
            }`,
          }))}
        />
      </div>

      {canSeeFinance && (
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <KpiCard label="إجمالي مصروفات مرتبطة" value={egp(context.financeTotals.expenseTotal)} />
          <KpiCard label="آجل غير مدفوع" value={egp(context.financeTotals.unpaidTotal)} />
          <KpiCard label="طلبات صرف مرتبطة" value={num(context.paymentRequests.length)} />
        </div>
      )}
    </Card>
  );
}

function ReportList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: { id: string; text: string; href?: string }[];
}) {
  return (
    <div>
      <h3 className="mb-2 text-base font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="text-sm">
              {item.href ? (
                <Link href={item.href} style={{ color: "var(--brand)" }}>
                  {item.text}
                </Link>
              ) : (
                item.text
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function assigneeLabel(context: LinkedWorkContext, op: LinkedOperation) {
  const assignees = context.assigneesByOperation.get(op.id) ?? [];
  if (assignees.length > 0) {
    return assignees
      .map((assignee) => {
        const name = assignee.person?.name ?? "عضو فريق";
        return assignee.is_lead ? `${name} (مسؤول)` : name;
      })
      .join("، ");
  }
  return op.responsible_person_id ? "مسؤول قديم" : "غير مسند";
}
