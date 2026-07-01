import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { num } from "@/lib/money";
import { type SimpleColumn } from "@/components/SimpleTable";
import { FilterableTable } from "@/components/FilterableTable";

export default async function InventoryListPage() {
  await requireMembership();
  const sb = await createClient();

  const { data: items, error } = await sb
    .from("inventory_items")
    .select("id, name, category, unit, min_stock, reorder_point, inventory_bin(on_hand, reserved)")
    .order("name");
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (error) throw error;

  const columns: SimpleColumn[] = [
    { id: "name", header: "الصنف" },
    { id: "category", header: "الفئة" },
    { id: "on_hand", header: "الموجود", numeric: true },
    { id: "reserved", header: "المحجوز", numeric: true },
    { id: "available", header: "المتاح", numeric: true },
    { id: "flag", header: "حد إعادة الطلب", kind: "status" },
    { id: "coverage", header: "تغطية المخزون", kind: "link" },
  ];

  const rows = (items ?? []).map((it) => {
    const bin = (Array.isArray(it.inventory_bin) ? it.inventory_bin[0] : it.inventory_bin) as
      | { on_hand?: number; reserved?: number }
      | null;
    const onHand = Number(bin?.on_hand ?? 0);
    const reserved = Number(bin?.reserved ?? 0);
    const available = onHand - reserved;
    const threshold = Number(it.reorder_point ?? it.min_stock ?? 0);
    // This is a STATIC level check against today's `available` — NOT the engine's forward-looking
    // projection (fn_stock_coverage can flag shortage=true for plenty-today-but-spikes-next-week
    // items that this check would call "above reorder point"). Label it honestly as a point-in-time
    // reading of the reorder threshold, never as a coverage verdict, and always offer a link to the
    // authoritative per-item coverage page below. Deferred follow-up: batching fn_stock_coverage
    // across the whole list is a separate, performance-sensitive change (N+1 RPC calls) — not done here.
    const needsReorder = threshold > 0 && available < threshold;
    return {
      id: it.id,
      href: `/inventory/${it.id}`,
      name: it.name,
      category: it.category ?? "—",
      on_hand: `${num(onHand)} ${it.unit ?? ""}`,
      reserved: `${num(reserved)} ${it.unit ?? ""}`,
      available: `${num(available)} ${it.unit ?? ""}`,
      flag: needsReorder ? "تحت حد إعادة الطلب" : "فوق حد إعادة الطلب",
      coverage: "عرض تغطية المخزون",
      coverage_href: `/inventory/${it.id}/coverage`,
    };
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">المخزون</h1>
            <p style={{ color: "var(--ink-muted)" }}>دليل الأصناف؛ ابدأ من لوحة المخزون للمخاطر وطلبات الشراء.</p>
          </div>
          <Link
            href="/inventory/dashboard"
            className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold"
            style={{
              color: "var(--brand)",
              background: "var(--surface)",
              border: "1px solid var(--line)",
            }}
          >
            لوحة المخزون
          </Link>
        </div>
      </header>
      <FilterableTable
        ariaLabel="المخزون"
        columns={columns}
        rows={rows}
        empty="لا توجد أصناف"
        searchColumns={["name", "category"]}
        placeholder="ابحث عن صنف…"
        exportFilename="inventory"
      />
    </div>
  );
}
