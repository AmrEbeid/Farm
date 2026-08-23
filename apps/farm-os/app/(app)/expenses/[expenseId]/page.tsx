import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import type { TabItem } from "@amrebeid/ui";
import { Alert, Breadcrumbs, Button, Card, DescriptionList, EmptyState, KpiCard } from "@/components/ui";
import { tabId, tabPanelId } from "@/lib/tab-ids";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { Entity360Header } from "@/components/Entity360Header";
import { EntityTabs } from "@/components/EntityTabs";
import { fmtDate } from "@/lib/dates";
import { selectExpensePaymentState } from "@/lib/expense-payment-reversal";
import { num } from "@/lib/money";
import { formatDecimalArabic, type DecimalString } from "@/lib/decimal";
import { parseExpenseDetailSnapshot } from "@/lib/expense-detail-snapshot";
import { expenseNotice, parseExpenseReturnTo, parseExpenseTab } from "@/lib/expense-list-context";
import { PaymentReversalControl } from "./payment-reversal-control";
import { ExpenseCorrectionControl } from "./expense-correction-control";
import {
  EXPENSE_KIND_AR,
  EXPENSE_STATUS_AR,
  MOVEMENT_TYPE_AR,
  OP_STATUS_AR,
  PAYMENT_METHOD_AR,
  PAYMENT_STATUS_AR,
  PLAN_TYPE_AR,
  SUBTYPE_AR,
} from "@/lib/labels";
import { setMissingExpenseDate } from "../actions";

type PlanEmbed = { id?: string; type?: string | null; period_start?: string | null; period_end?: string | null };

type PillStatus = "draft" | "scheduled" | "active" | "done" | "warning" | "blocked";

// status → pill: paid = settled (done); draft = unposted (draft);
// posted/approved = recorded but not yet paid (warning); void/cancelled = blocked.
const STATUS_PILL: Record<string, PillStatus> = {
  draft: "draft",
  posted: "warning",
  approved: "warning",
  paid: "done",
  void: "blocked",
  cancelled: "blocked",
};

export default async function Expense360Page({
  params,
  searchParams,
}: {
  params: Promise<{ expenseId: string }>;
  searchParams: Promise<{ tab?: string; from?: string; ok?: string; error?: string }>;
}) {
  const { expenseId } = await params;
  const { tab: rawTab, from: rawFrom, ok, error: actionError } = await searchParams;
  const tab = parseExpenseTab(rawTab);
  const from = parseExpenseReturnTo(rawFrom);
  const okNotice = expenseNotice(ok);
  const errorNotice = expenseNotice(actionError);
  const m = await requireRole(["owner", "accountant", "farm_manager"]);
  const sb = await createClient();
  const canCorrectPayment = m.role === "owner" || m.role === "accountant";

  const snapshotRes = await sb.rpc("fn_expense_detail_snapshot", {
    p_org: m.orgId,
    p_expense: expenseId,
  });
  if (snapshotRes.error) throw snapshotRes.error;
  const snapshot = parseExpenseDetailSnapshot(snapshotRes.data);
  if (snapshot.orgId !== m.orgId || snapshot.expenseId !== expenseId) {
    throw new Error("expense detail snapshot: response scope does not match the request");
  }
  const expense = snapshot.expense;
  if (!expense)
    return (
      <div className="p-6">
        <EmptyState title="المصروف غير موجود." description="قد يكون محذوفًا أو الرابط غير صحيح." icon="🔍" />
      </div>
    );

  const supplier = expense.supplier;
  const plan = expense.plan;
  const farm = expense.farm;
  const sector = expense.sector;
  const hawsha = expense.hawsha;
  const event = snapshot.event;
  const account = snapshot.account;
  const custodyMovements = snapshot.movements;
  const { activePayment, latestReversal: paymentReversal } = selectExpensePaymentState(custodyMovements);
  const requestLinked = Boolean(activePayment?.payment_request_id || snapshot.requestLinked);
  const canCompleteCorrection =
    canCorrectPayment &&
    expense.payment_status === null &&
    !activePayment &&
    paymentReversal?.expense_reversal_outcome === "unrouted";

  const [correctionSuppliers, correctionAccounts, correctionCenters, correctionCustody] = canCompleteCorrection
    ? await Promise.all([
        sb.from("suppliers").select("id, name").eq("org_id", m.orgId).order("name"),
        sb.from("accounts").select("id, code, name_ar, kind, parent_id, active").eq("org_id", m.orgId).order("code"),
        sb.from("cost_centers").select("id, code, name_ar, parent_id, active").eq("org_id", m.orgId).order("code"),
        sb.from("custody_accounts").select("id, holder_label, active").eq("org_id", m.orgId).order("holder_label"),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (correctionSuppliers.error) throw correctionSuppliers.error;
  if (correctionAccounts.error) throw correctionAccounts.error;
  if (correctionCenters.error) throw correctionCenters.error;
  if (correctionCustody.error) throw correctionCustody.error;

  const accountRows = correctionAccounts.data ?? [];
  const activeAccountParents = new Set(accountRows.filter((row) => row.active && row.parent_id).map((row) => row.parent_id));
  const correctionAccountOptions = accountRows
    .filter((row) => row.active && (row.kind == null || row.kind === expense.kind) && !activeAccountParents.has(row.id))
    .map((row) => ({ id: row.id, label: `${row.code} — ${row.name_ar}` }));
  const centerRows = correctionCenters.data ?? [];
  const activeCenterParents = new Set(centerRows.filter((row) => row.active && row.parent_id).map((row) => row.parent_id));
  const correctionCenterOptions = centerRows
    .filter((row) => row.active && !activeCenterParents.has(row.id))
    .map((row) => ({ id: row.id, label: `${row.code} — ${row.name_ar}` }));

  const linkedScopeCount = [expense.supplier_id, expense.plan_id, expense.event_id, expense.farm_id, expense.sector_id, expense.hawsha_id].filter(Boolean).length;

  const isCancelled = expense.payment_status === "cancelled";
  const statusLabel = isCancelled ? "ملغي" : EXPENSE_STATUS_AR[expense.status ?? ""] ?? "غير معروف";
  const pillStatus: PillStatus | null = isCancelled
    ? "blocked"
    : expense.status
      ? STATUS_PILL[expense.status] ?? null
      : null;
  // Recorded but not settled, or booked on credit (آجل) — flag for attention.
  const isCredit = !isCancelled && expense.payment_method === "credit";
  const isUnpaid = !isCancelled && (expense.status === "posted" || expense.status === "approved" || isCredit);
  const canCorrectDate = m.role === "owner" || m.role === "accountant";

  const linkColumns: SimpleColumn[] = [
    { id: "target", header: "الرابط" },
    { id: "detail", header: "التفصيل" },
  ];
  const linkRows = [
    supplier?.id
      ? { id: "supplier", href: `/suppliers/${supplier.id}`, target: "المورّد", detail: supplier.name ?? supplier.id }
      : null,
    plan?.id
      ? { id: "plan", href: `/plans/${plan.id}`, target: "الخطة", detail: planLabel(plan) }
      : null,
    farm?.id ? { id: "farm", href: "/farm", target: "المزرعة", detail: farm.name ?? farm.id } : null,
    sector?.id
      ? { id: "sector", href: `/farm/sector/${sector.id}`, target: "القطاع", detail: sector.name ?? sector.id }
      : null,
    hawsha?.id
      ? { id: "hawsha", href: `/farm/hawsha/${hawsha.id}`, target: "الحوشة", detail: hawsha.name ?? hawsha.id }
      : null,
  ].filter((row): row is { id: string; href: string; target: string; detail: string } => row !== null);

  const eventColumns: SimpleColumn[] = [
    { id: "subtype", header: "النشاط" },
    { id: "status", header: "الحالة", kind: "status" },
    { id: "occurred_at", header: "التاريخ" },
    { id: "notes", header: "ملاحظات" },
  ];
  const eventRows = event
    ? [
        {
          id: event.id,
          subtype: SUBTYPE_AR[event.subtype ?? ""] ?? "نشاط",
          status: OP_STATUS_AR[event.status ?? ""] ?? "غير معروف",
          occurred_at: event.occurred_at ? fmtDate(event.occurred_at) : "—",
          notes: event.notes ?? "—",
        },
      ]
    : [];

  const movementColumns: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "movement", header: "الحركة" },
    { id: "amount", header: "المبلغ", kind: "money-preserve-exact", numeric: true, decimal: true },
    { id: "link", header: "الربط" },
  ];
  const movementRows = custodyMovements.map((movement) => ({
    id: movement.id,
    date: fmtDate(movement.occurred_at),
    movement: `${movement.amount_in !== "0" ? "وارد" : "صادر"} — ${MOVEMENT_TYPE_AR[movement.movement_type] ?? movement.movement_type}`,
    amount: movement.amount_in !== "0" ? movement.amount_in : movement.amount_out,
    link: movement.reversal_of
      ? "عكسٌ لحركة السداد الأصلية"
      : movement.reversed_by
        ? "حركة السداد الأصلية — عُكست"
        : "حركة السداد الأصلية — فعّالة",
  }));

  const headerTitle = `${expense.category ?? expense.description ?? "مصروف"}${
    expense.total != null ? ` · ${exactMoney(expense.total)}` : ""
  }`;
  const headerSubtitle = `${expense.date ? fmtDate(expense.date) : "بدون تاريخ"} · ${supplier?.name ?? "بدون مورّد"}`;
  const returnedFromTransactions = from === "/transactions" || from.startsWith("/transactions?");
  const returnLabel = returnedFromTransactions ? "المعاملات" : "المصروفات";

  const tabItems: TabItem[] = [
    { id: "overview", label: "نظرة عامة" },
    { id: "links", label: `الروابط (${num(linkRows.length)})` },
    { id: "activity", label: `النشاط المرتبط (${num(eventRows.length)})` },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumbs
        ariaLabel="المسار"
        items={[
          { id: "expenses", label: returnLabel, href: from },
          { id: "expense", label: headerTitle },
        ]}
      />

      <Entity360Header
        title={headerTitle}
        subtitle={headerSubtitle}
        pills={pillStatus ? [{ status: pillStatus, label: statusLabel }] : undefined}
        actions={
          <>
            <HeaderLink href="/finance/dashboard">لوحة المالية</HeaderLink>
            <HeaderLink href={from}>العودة إلى {returnLabel}</HeaderLink>
          </>
        }
      />

      {isUnpaid && (
        <Alert
          tone="warning"
          title={isCredit ? "مصروف آجل غير مسدّد" : "مصروف مرحّل غير مدفوع"}
          description="هذا المصروف مسجّل ولم تُسجَّل تسويته بعد."
        />
      )}

      {paymentReversal && (
        <Alert
          tone="ok"
          title="تم تصحيح سداد هذا المصروف"
          description={`${
            paymentReversal.expense_reversal_outcome === "cancelled"
              ? "أُلغي المصروف بالكامل"
              : "عاد المصروف بلا مسار سداد للتعديل أو التوجيه من جديد"
          } · ${fmtDate(paymentReversal.occurred_at)} · السبب: ${paymentReversal.reversal_reason ?? "غير مسجل"}`}
        />
      )}

      {canCompleteCorrection && (
        <ExpenseCorrectionControl
          expense={{
            id: expense.id,
            date: expense.date,
            category: expense.category,
            description: expense.description,
            total: expense.total,
            supplierId: expense.supplier_id,
            accountId: expense.account_id,
            costCenterId: expense.cost_center_id,
          }}
          suppliers={(correctionSuppliers.data ?? []).map((row) => ({ id: row.id, label: row.name }))}
          accounts={correctionAccountOptions}
          costCenters={correctionCenterOptions}
          custodyAccounts={(correctionCustody.data ?? [])
            .filter((row) => row.active)
            .map((row) => ({ id: row.id, label: row.holder_label }))}
        />
      )}

      {canCorrectPayment && expense.payment_status === "paid_from_custody" && requestLinked && (
        <Alert
          tone="warning"
          title="السداد مرتبط بإذن صرف"
          description="يجب تصحيح هذا السداد من مسار إذن الصرف حتى تبقى حالة الطلب وبنوده متطابقة."
        />
      )}

      {canCorrectPayment &&
        expense.payment_status === "paid_from_custody" &&
        !requestLinked &&
        (activePayment ? (
          <PaymentReversalControl
            expenseId={expense.id}
            movementId={activePayment.id}
            amount={exactMoney(activePayment.amount_out)}
            custodyAccountLabel={activePayment.custody_account_label}
            today={todayInCairo()}
          />
        ) : (
          <Alert
            tone="danger"
            title="حركة سداد العهدة غير مكتملة"
            description="المصروف معلّم كمسدد من العهدة لكن حركة الخروج الأصلية غير موجودة؛ لا تُجرِ تصحيحًا يدويًا."
          />
        ))}

      {okNotice ? <Alert tone="ok" title="تم" description={okNotice} /> : null}
      {errorNotice ? <Alert tone="danger" title="تعذّر التنفيذ" description={errorNotice} /> : null}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="الإجمالي" value={expense.total != null ? exactMoney(expense.total) : "—"} />
        <KpiCard label="الكمية" value={expense.qty != null ? exactDecimal(expense.qty) : "—"} unit={expense.unit ?? undefined} />
        <KpiCard label="سعر الوحدة" value={expense.unit_price != null ? exactMoney(expense.unit_price) : "—"} />
        <KpiCard label="روابط مرتبطة" value={num(linkedScopeCount)} />
      </section>

      <EntityTabs items={tabItems} value={tab} />

      {tab === "overview" && (
        <div role="tabpanel" id={tabPanelId("overview")} aria-labelledby={tabId("overview")} tabIndex={0}>
          <Card title="بيانات المصروف">
            {!expense.date && canCorrectDate ? (
              <form action={setMissingExpenseDate} className="mb-4 flex flex-wrap items-end gap-3">
                <input type="hidden" name="expense_id" value={expense.id} />
                <input type="hidden" name="return_to" value={from} />
                <label className="flex min-w-52 flex-col gap-1 text-sm font-semibold">
                  تاريخ المصروف
                  <input
                    type="date"
                    name="date"
                    required
                    className="rounded-md border px-3 py-2"
                    style={{ borderColor: "var(--line)", background: "var(--surface)", color: "var(--ink)" }}
                  />
                </label>
                <Button type="submit">حفظ التاريخ</Button>
              </form>
            ) : null}
            <DescriptionList
              layout="inline"
              items={[
                { id: "date", term: "التاريخ", description: expense.date ? fmtDate(expense.date) : "—" },
                { id: "category", term: "الفئة", description: expense.category ?? "—" },
                {
                  id: "kind",
                  term: "نوع المصروف",
                  description: EXPENSE_KIND_AR[expense.kind ?? "operating"] ?? "—",
                },
                {
                  id: "account",
                  term: "الحساب المحاسبي",
                  description: account ? `${account.code} — ${account.name_ar}` : "بدون حساب",
                },
                {
                  id: "payment",
                  term: "طريقة الدفع",
                  description: PAYMENT_METHOD_AR[expense.payment_method ?? ""] ?? "غير معروف",
                },
                {
                  id: "payment-status",
                  term: "حالة السداد",
                  description: PAYMENT_STATUS_AR[expense.payment_status ?? ""] ?? "غير محدد",
                },
                { id: "status", term: "الحالة", description: statusLabel },
              ]}
            />
          </Card>
          {movementRows.length > 0 && (
            <div className="mt-4">
              <Card title="حركة السداد والعكس">
                <SimpleTable
                  columns={movementColumns}
                  rows={movementRows}
                  ariaLabel="حركة سداد المصروف والعكس المرتبط"
                  empty="—"
                />
              </Card>
            </div>
          )}
        </div>
      )}

      {tab === "links" && (
        <div role="tabpanel" id={tabPanelId("links")} aria-labelledby={tabId("links")} tabIndex={0}>
          <Card title="الروابط">
            {linkRows.length === 0 ? (
              <EmptyState title="لا توجد روابط مرتبطة بهذا المصروف" />
            ) : (
              <SimpleTable columns={linkColumns} rows={linkRows} ariaLabel="الروابط" empty="—" />
            )}
          </Card>
        </div>
      )}

      {tab === "activity" && (
        <div role="tabpanel" id={tabPanelId("activity")} aria-labelledby={tabId("activity")} tabIndex={0}>
          <Card title="النشاط المرتبط">
            {eventRows.length === 0 ? (
              <EmptyState title="لا يوجد نشاط مرتبط" />
            ) : (
              <SimpleTable columns={eventColumns} rows={eventRows} ariaLabel="النشاط المرتبط" empty="—" />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function todayInCairo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function exactDecimal(value: DecimalString): string {
  const scale = value.includes(".") ? value.length - value.indexOf(".") - 1 : 0;
  return formatDecimalArabic(value, scale);
}

function exactMoney(value: DecimalString): string {
  const scale = value.includes(".") ? value.length - value.indexOf(".") - 1 : 0;
  return `${formatDecimalArabic(value, Math.max(2, scale))} ج.م`;
}

function planLabel(plan: PlanEmbed): string {
  const type = PLAN_TYPE_AR[plan.type ?? ""] ?? "خطة";
  const period =
    plan.period_start || plan.period_end
      ? `${plan.period_start ? fmtDate(plan.period_start) : "—"} ← ${plan.period_end ? fmtDate(plan.period_end) : "—"}`
      : "—";
  return `${type} · ${period}`;
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
