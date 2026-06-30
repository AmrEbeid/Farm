import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { Card, DescriptionList, EmptyState, KpiCard } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { fmtDate } from "@/lib/dates";
import { egp, num } from "@/lib/money";
import { MOVEMENT_TYPE_AR, PR_STATUS_AR } from "@/lib/labels";

type InventoryItemEmbed = { id?: string; name?: string | null; unit?: string | null };
type PurchaseRequestEmbed = { id?: string; code?: string | null; status?: string | null; needed_by?: string | null };

export default async function Supplier360Page({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  const { supplierId } = await params;
  const m = await requireMembership();
  // Expenses are private finance data: RLS leaves expense READS org-only (only
  // WRITES carry budget.write), so this app-layer role gate is the real boundary.
  // The supplier 360 stays open to all members for inventory/PR data; only the
  // finance sub-section (expense query, KPI, table) is owner/accountant-only.
  const canReadPrivateFinance = m.role === "owner" || m.role === "accountant";
  const sb = await createClient();

  const [
    { data: supplier, error: supplierError },
    { data: items, error: itemsError },
    { data: prLines, error: prLinesError, count: prLineCount },
    { data: expenses, error: expensesError },
    { data: movements, error: movementsError },
  ] = await Promise.all([
    sb
      .from("suppliers")
      .select("id, name, phone, terms, lead_time_days")
      .eq("id", supplierId)
      .maybeSingle(),
    sb
      .from("inventory_items")
      .select("id, name, category, unit, lead_time_days, criticality")
      .eq("preferred_supplier_id", supplierId)
      .order("name"),
    sb
      .from("purchase_request_items")
      .select(
        "id, pr_id, qty, unit, est_cost, received_qty, inventory_items(id, name, unit), purchase_requests(id, code, status, needed_by)",
        { count: "exact" },
      )
      .eq("supplier_id", supplierId)
      .limit(20),
    canReadPrivateFinance
      ? sb
          .from("expenses")
          .select("id, date, category, description, total")
          .eq("supplier_id", supplierId)
          .order("date", { ascending: false })
          .limit(12)
      : Promise.resolve({ data: [], error: null }),
    sb
      .from("inventory_movements")
      .select("id, item_id, type, qty, occurred_at, inventory_items(id, name, unit)")
      .eq("supplier_id", supplierId)
      .order("occurred_at", { ascending: false })
      .limit(12),
  ]);
  if (supplierError) throw supplierError;
  if (itemsError) throw itemsError;
  if (prLinesError) throw prLinesError;
  if (expensesError) throw expensesError;
  if (movementsError) throw movementsError;

  if (!supplier) return <div className="p-6">المورّد غير موجود.</div>;

  const expensesTotal = (expenses ?? []).reduce((sum, expense) => sum + Number(expense.total ?? 0), 0);

  const itemColumns: SimpleColumn[] = [
    { id: "name", header: "الصنف" },
    { id: "category", header: "الفئة" },
    { id: "unit", header: "الوحدة" },
    { id: "lead_time", header: "مدة التوريد", numeric: true },
  ];
  const itemRows = (items ?? []).map((item) => ({
    id: item.id,
    href: `/inventory/${item.id}`,
    name: item.name,
    category: item.category ?? "—",
    unit: item.unit ?? "—",
    lead_time: item.lead_time_days != null ? num(item.lead_time_days) : "—",
  }));

  const prColumns: SimpleColumn[] = [
    { id: "code", header: "طلب الشراء" },
    { id: "item", header: "الصنف" },
    { id: "qty", header: "الكمية", numeric: true },
    { id: "received", header: "المستلم", numeric: true },
    { id: "cost", header: "التكلفة", numeric: true },
    { id: "status", header: "الحالة", kind: "status" },
  ];
  const prRows = (prLines ?? []).map((line) => {
    const item = normalizeItem(line.inventory_items);
    const pr = normalizePurchaseRequest(line.purchase_requests);
    const unit = line.unit ?? item?.unit ?? "";
    return {
      id: line.id,
      href: pr?.id ? `/purchase-requests/${pr.id}` : undefined,
      code: pr?.code ?? line.pr_id,
      item: item?.name ?? "—",
      qty: `${num(Number(line.qty ?? 0))} ${unit}`.trim(),
      received: `${num(Number(line.received_qty ?? 0))} ${unit}`.trim(),
      cost: line.est_cost != null ? egp(Number(line.est_cost)) : "—",
      status: PR_STATUS_AR[pr?.status ?? ""] ?? "غير معروف",
    };
  });

  const expenseColumns: SimpleColumn[] = [
    { id: "date", header: "التاريخ" },
    { id: "category", header: "الفئة" },
    { id: "description", header: "البيان" },
    { id: "total", header: "المبلغ", numeric: true },
  ];
  const expenseRows = (expenses ?? []).map((expense) => ({
    id: expense.id,
    href: `/expenses/${expense.id}`,
    date: expense.date ? fmtDate(expense.date) : "—",
    category: expense.category ?? "—",
    description: expense.description ?? "—",
    total: expense.total != null ? egp(Number(expense.total)) : "—",
  }));

  const movementColumns: SimpleColumn[] = [
    { id: "item", header: "الصنف" },
    { id: "type", header: "الحركة" },
    { id: "qty", header: "الكمية", numeric: true },
    { id: "occurred_at", header: "التاريخ" },
  ];
  const movementRows = (movements ?? []).map((movement) => {
    const item = normalizeItem(movement.inventory_items);
    return {
      id: movement.id,
      href: item?.id ? `/inventory/${item.id}` : undefined,
      item: item?.name ?? "—",
      type: MOVEMENT_TYPE_AR[movement.type] ?? "غير معروف",
      qty: `${num(Number(movement.qty ?? 0))} ${item?.unit ?? ""}`.trim(),
      occurred_at: movement.occurred_at ? fmtDate(movement.occurred_at) : "—",
    };
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">ملف المورّد — {supplier.name}</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            {canReadPrivateFinance
              ? "نظرة 360 على الأصناف والطلبات والمصروفات المرتبطة."
              : "نظرة 360 على الأصناف والطلبات وحركات المخزون المرتبطة."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <HeaderLink href="/suppliers">الموردون</HeaderLink>
          <HeaderLink href="/inventory/dashboard">لوحة المخزون</HeaderLink>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="أصناف مفضلة" value={num((items ?? []).length)} />
        <KpiCard
          label="بنود شراء"
          value={num(prLineCount ?? (prLines ?? []).length)}
          delta={prLineCount && prLineCount > (prLines ?? []).length ? "يعرض الجدول أحدث ٢٠" : undefined}
        />
        {canReadPrivateFinance && <KpiCard label="مصروفات حديثة" value={egp(expensesTotal)} />}
        <KpiCard label="حركات مخزون" value={num((movements ?? []).length)} />
      </section>

      <Card title="بيانات المورّد">
        <DescriptionList
          layout="inline"
          items={[
            { id: "phone", term: "الهاتف", description: supplier.phone ?? "—" },
            { id: "terms", term: "الشروط", description: supplier.terms ?? "—" },
            {
              id: "lead",
              term: "مدة التوريد",
              description: supplier.lead_time_days != null ? `${num(supplier.lead_time_days)} يوم` : "—",
            },
          ]}
        />
      </Card>

      <Card title="الأصناف المرتبطة">
        {itemRows.length === 0 ? (
          <EmptyState title="لا توجد أصناف مرتبطة كمورد مفضل" />
        ) : (
          <SimpleTable columns={itemColumns} rows={itemRows} empty="—" />
        )}
      </Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card title="بنود طلبات الشراء">
          {prRows.length === 0 ? (
            <EmptyState title="لا توجد بنود شراء مرتبطة" />
          ) : (
            <SimpleTable columns={prColumns} rows={prRows} empty="—" />
          )}
        </Card>
        {canReadPrivateFinance && (
          <Card title="آخر المصروفات">
            {expenseRows.length === 0 ? (
              <EmptyState title="لا توجد مصروفات مرتبطة" />
            ) : (
              <SimpleTable columns={expenseColumns} rows={expenseRows} empty="—" />
            )}
          </Card>
        )}
      </section>

      <Card title="آخر حركات المخزون">
        {movementRows.length === 0 ? (
          <EmptyState title="لا توجد حركات مخزون مرتبطة" />
        ) : (
          <SimpleTable columns={movementColumns} rows={movementRows} empty="—" />
        )}
      </Card>
    </div>
  );
}

function normalizeItem(item: InventoryItemEmbed | InventoryItemEmbed[] | null): InventoryItemEmbed | null {
  if (Array.isArray(item)) return item[0] ?? null;
  return item;
}

function normalizePurchaseRequest(
  pr: PurchaseRequestEmbed | PurchaseRequestEmbed[] | null,
): PurchaseRequestEmbed | null {
  if (Array.isArray(pr)) return pr[0] ?? null;
  return pr;
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
