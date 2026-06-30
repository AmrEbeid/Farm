import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, DescriptionList, EmptyState, KpiCard } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { fmtDate } from "@/lib/dates";
import { egp, num } from "@/lib/money";
import { EXPENSE_STATUS_AR, OP_STATUS_AR, PAYMENT_METHOD_AR, PLAN_TYPE_AR, SUBTYPE_AR } from "@/lib/labels";

type SupplierEmbed = { id?: string; name?: string | null };
type PlanEmbed = { id?: string; type?: string | null; period_start?: string | null; period_end?: string | null };
type FarmEmbed = { id?: string; name?: string | null };
type SectorEmbed = { id?: string; name?: string | null };
type HawshaEmbed = { id?: string; name?: string | null };

export default async function Expense360Page({
  params,
}: {
  params: Promise<{ expenseId: string }>;
}) {
  const { expenseId } = await params;
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
  if (!expense) return <div className="p-6">المصروف غير موجود.</div>;

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

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">ملف المصروف — {expense.category ?? expense.description ?? expense.id}</h1>
          <p style={{ color: "var(--ink-muted)" }}>{expense.description ?? "مصروف مسجل من السجلات الفعلية."}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <HeaderLink href="/finance/dashboard">لوحة المالية</HeaderLink>
          <HeaderLink href="/expenses">المصروفات</HeaderLink>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="الإجمالي" value={expense.total != null ? egp(Number(expense.total)) : "—"} />
        <KpiCard label="الكمية" value={expense.qty != null ? num(Number(expense.qty)) : "—"} unit={expense.unit ?? undefined} />
        <KpiCard label="سعر الوحدة" value={expense.unit_price != null ? egp(Number(expense.unit_price)) : "—"} />
        <KpiCard label="روابط مرتبطة" value={num(linkedScopeCount)} />
      </section>

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
            { id: "status", term: "الحالة", description: EXPENSE_STATUS_AR[expense.status ?? ""] ?? "غير معروف" },
          ]}
        />
      </Card>

      <Card title="الروابط">
        {linkRows.length === 0 ? (
          <EmptyState title="لا توجد روابط مرتبطة بهذا المصروف" />
        ) : (
          <SimpleTable columns={linkColumns} rows={linkRows} empty="—" />
        )}
      </Card>

      <Card title="النشاط المرتبط">
        {eventRows.length === 0 ? (
          <EmptyState title="لا يوجد نشاط مرتبط" />
        ) : (
          <SimpleTable columns={eventColumns} rows={eventRows} empty="—" />
        )}
      </Card>
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
