import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { EmptyState, KpiCard } from "@/components/ui";
import { type SimpleColumn } from "@/components/SimpleTable";
import { FilterableTable } from "@/components/FilterableTable";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { MOVEMENT_TYPE_AR } from "@/lib/labels";
import { parseMovementGroup, typesForGroup, type MovementGroup } from "@/lib/movements-console";

/**
 * Cross-item movements ledger (INVENTORY-360 gap #6): the owner-verifier's
 * audit view. KPI chips count the last 30 days by group (dedicated aggregate
 * query — not capped by the table window); the table shows the most recent
 * rows for the selected group, honestly labeled. Read-only; the append-only
 * ledger stays untouched. Actor («بواسطة») deliberately absent: movements
 * carry no created_by column yet (INVENTORY-360 gap #2, needs a migration) —
 * we don't fabricate one from heuristics.
 */
const TABLE_WINDOW = 200;
const KPI_DAYS = 30;

export default async function InventoryMovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  await requireMembership();
  const sb = await createClient();
  const group = parseMovementGroup((await searchParams).type);

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - KPI_DAYS);
  const since = sinceDate.toISOString();
  // KPI aggregate: last 30 days, grouped client-side from a slim projection.
  const { data: kpiRows, error: kpiError } = await sb
    .from("inventory_movements")
    .select("type")
    .gte("occurred_at", since);
  if (kpiError) throw kpiError;

  const countIn = (types: string[]) => (kpiRows ?? []).filter((r) => types.includes(r.type)).length;
  const kpis: { key: MovementGroup; label: string; value: number; danger?: boolean }[] = [
    { key: "all", label: `كل الحركات (${num(KPI_DAYS)} يومًا)`, value: (kpiRows ?? []).length },
    { key: "in", label: "وارد (استلام ومرتجع)", value: countIn(typesForGroup("in")!) },
    { key: "out", label: "منصرف", value: countIn(typesForGroup("out")!) },
    { key: "shrink", label: "فاقد وتسويات وانتهاء صلاحية", value: countIn(typesForGroup("shrink")!), danger: true },
    { key: "earmark", label: "حجز وإفراج", value: countIn(typesForGroup("earmark")!) },
  ];

  // Table window: most recent rows for the selected chip.
  let query = sb
    .from("inventory_movements")
    .select("id, type, qty, unit, location, occurred_at, expiry_date, batch_no, inventory_items(id, name), suppliers(name)")
    .order("occurred_at", { ascending: false })
    .limit(TABLE_WINDOW);
  const types = typesForGroup(group);
  if (types) query = query.in("type", types);
  const { data: movements, error } = await query;
  if (error) throw error;

  const columns: SimpleColumn[] = [
    { id: "occurred_at", header: "التاريخ" },
    { id: "item", header: "الصنف", kind: "link" },
    { id: "type", header: "النوع", kind: "status" },
    { id: "qty", header: "الكمية", numeric: true },
    { id: "location", header: "الموقع" },
    { id: "supplier", header: "المورّد" },
    { id: "batch", header: "التشغيلة/الصلاحية" },
  ];

  const rows = (movements ?? []).map((mv) => {
    const item = (Array.isArray(mv.inventory_items) ? mv.inventory_items[0] : mv.inventory_items) as
      | { id: string; name: string }
      | null;
    const supplier = (Array.isArray(mv.suppliers) ? mv.suppliers[0] : mv.suppliers) as { name: string } | null;
    return {
      id: mv.id,
      occurred_at: fmtDate(mv.occurred_at),
      item: item?.name ?? "—",
      item_href: item ? `/inventory/${item.id}` : "",
      type: MOVEMENT_TYPE_AR[mv.type] ?? mv.type,
      qty: `${num(Number(mv.qty))} ${mv.unit ?? ""}`,
      location: mv.location ?? "—",
      supplier: supplier?.name ?? "—",
      batch: mv.batch_no
        ? `${mv.batch_no}${mv.expiry_date ? ` — ${fmtDate(mv.expiry_date)}` : ""}`
        : mv.expiry_date
          ? fmtDate(mv.expiry_date)
          : "—",
    };
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">حركات المخزون</h1>
        <p style={{ color: "var(--ink-muted)" }}>
          سجل الحركات عبر كل الأصناف — للتدقيق والتصدير. يعرض الجدول أحدث {num(TABLE_WINDOW)} حركة للفلتر المحدد.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map((chip) => (
          <DashboardKpiLink
            key={chip.key}
            href={chip.key === "all" ? "/inventory/movements" : `/inventory/movements?type=${chip.key}`}
            active={group === chip.key}
          >
            <KpiCard
              label={chip.label}
              value={num(chip.value)}
              deltaDirection={chip.danger && chip.value > 0 ? "down" : "none"}
            />
          </DashboardKpiLink>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={group === "all" ? "لا توجد حركات مخزون" : "لا توجد حركات مطابقة لهذا الفلتر"}
          description="تنشأ الحركات تلقائيًا من الاستلام وتنفيذ العمليات — لا إدخال يدويًا هنا."
        />
      ) : (
        <FilterableTable
          ariaLabel="حركات المخزون"
          columns={columns}
          rows={rows}
          searchColumns={["item", "type", "location", "supplier", "batch"]}
          placeholder="ابحث عن صنف أو نوع حركة…"
          exportFilename="inventory-movements"
        />
      )}
    </div>
  );
}
