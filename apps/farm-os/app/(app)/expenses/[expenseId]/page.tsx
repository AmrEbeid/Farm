import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import type { TabItem } from "@amrebeid/ui";
import { Alert, Card, DescriptionList, EmptyState, KpiCard } from "@/components/ui";
import { tabId, tabPanelId } from "@/lib/tab-ids";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { Entity360Header } from "@/components/Entity360Header";
import { EntityTabs } from "@/components/EntityTabs";
import { fmtDate } from "@/lib/dates";
import { egp, num } from "@/lib/money";
import { EXPENSE_STATUS_AR, OP_STATUS_AR, PAYMENT_METHOD_AR, PLAN_TYPE_AR, SUBTYPE_AR } from "@/lib/labels";

type SupplierEmbed = { id?: string; name?: string | null };
type PlanEmbed = { id?: string; type?: string | null; period_start?: string | null; period_end?: string | null };
type FarmEmbed = { id?: string; name?: string | null };
type SectorEmbed = { id?: string; name?: string | null };
type HawshaEmbed = { id?: string; name?: string | null };

type PillStatus = "draft" | "scheduled" | "active" | "done" | "warning" | "blocked";

const TAB_IDS = ["overview", "links", "activity"] as const;
type ExpenseTab = (typeof TAB_IDS)[number];

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
  searchParams: Promise<{ tab?: string }>;
}) {
  const { expenseId } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: ExpenseTab = (TAB_IDS as readonly string[]).includes(rawTab ?? "")
    ? (rawTab as ExpenseTab)
    : "overview";
  await requireRole(["owner", "accountant", "farm_manager"]);
  const sb = await createClient();

  const { data: expense, error } = await sb
    .from("expenses")
    .select(
      "id, date, category, description, total, qty, unit, unit_price, payment_method, status, supplier_id, plan_id, event_id, farm_id, sector_id, hawsha_id, suppliers(id, name), plans(id, type, period_start, period_end), farms(id, name), sectors(id, name), hawshat(id, name)",
    )
    .eq("id", expenseId)
    .maybeSingle();
  if (error) throw error;
  if (!expense)
    return (
      <div className="p-6">
        <EmptyState title="المصروف غير موجود." description="قد يكون محذوفًا أو الرابط غير صحيح." icon="🔍" />
      </div>
    );

  const supplier = normalizeOne<SupplierEmbed>(expense.suppliers);
  const plan = normalizeOne<PlanEmbed>(expense.plans);
  const farm = normalizeOne<FarmEmbed>(expense.farms);
  const sector = normalizeOne<SectorEmbed>(expense.sectors);
  const hawsha = normalizeOne<HawshaEmbed>(expense.hawshat);

  const { data: event, error: eventError } = expense.event_id
    ? await sb
        .from("farm_event")
        .select("id, subtype, status, occurred_at, notes")
        .eq("id", expense.event_id)
        .maybeSingle()
    : { data: null, error: null };
  if (eventError) throw eventError;

  const linkedScopeCount = [expense.supplier_id, expense.plan_id, expense.event_id, expense.farm_id, expense.sector_id, expense.hawsha_id].filter(Boolean).length;

  const statusLabel = EXPENSE_STATUS_AR[expense.status ?? ""] ?? "غير معروف";
  const pillStatus: PillStatus | null = expense.status ? STATUS_PILL[expense.status] ?? null : null;
  // Recorded but not settled, or booked on credit (آجل) — flag for attention.
  const isCredit = expense.payment_method === "credit";
  const isUnpaid = expense.status === "posted" || expense.status === "approved" || isCredit;

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

  const headerTitle = `${expense.category ?? expense.description ?? "مصروف"}${
    expense.total != null ? ` · ${egp(Number(expense.total))}` : ""
  }`;
  const headerSubtitle = `${expense.date ? fmtDate(expense.date) : "بدون تاريخ"} · ${supplier?.name ?? "بدون مورّد"}`;

  const tabItems: TabItem[] = [
    { id: "overview", label: "نظرة عامة" },
    { id: "links", label: `الروابط (${num(linkRows.length)})` },
    { id: "activity", label: `النشاط المرتبط (${num(eventRows.length)})` },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <Entity360Header
        title={headerTitle}
        subtitle={headerSubtitle}
        pills={pillStatus ? [{ status: pillStatus, label: statusLabel }] : undefined}
        actions={
          <>
            <HeaderLink href="/finance/dashboard">لوحة المالية</HeaderLink>
            <HeaderLink href="/expenses">المصروفات</HeaderLink>
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

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="الإجمالي" value={expense.total != null ? egp(Number(expense.total)) : "—"} />
        <KpiCard label="الكمية" value={expense.qty != null ? num(Number(expense.qty)) : "—"} unit={expense.unit ?? undefined} />
        <KpiCard label="سعر الوحدة" value={expense.unit_price != null ? egp(Number(expense.unit_price)) : "—"} />
        <KpiCard label="روابط مرتبطة" value={num(linkedScopeCount)} />
      </section>

      <EntityTabs items={tabItems} value={tab} />

      {tab === "overview" && (
        <div role="tabpanel" id={tabPanelId("overview")} aria-labelledby={tabId("overview")} tabIndex={0}>
          <Card title="بيانات المصروف">
            <DescriptionList
              layout="inline"
              items={[
                { id: "date", term: "التاريخ", description: expense.date ? fmtDate(expense.date) : "—" },
                { id: "category", term: "الفئة", description: expense.category ?? "—" },
                {
                  id: "payment",
                  term: "طريقة الدفع",
                  description: PAYMENT_METHOD_AR[expense.payment_method ?? ""] ?? "غير معروف",
                },
                { id: "status", term: "الحالة", description: statusLabel },
              ]}
            />
          </Card>
        </div>
      )}

      {tab === "links" && (
        <div role="tabpanel" id={tabPanelId("links")} aria-labelledby={tabId("links")} tabIndex={0}>
          <Card title="الروابط">
            {linkRows.length === 0 ? (
              <EmptyState title="لا توجد روابط مرتبطة بهذا المصروف" />
            ) : (
              <SimpleTable columns={linkColumns} rows={linkRows} empty="—" />
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
              <SimpleTable columns={eventColumns} rows={eventRows} empty="—" />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function normalizeOne<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
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
