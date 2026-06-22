import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { num } from "@/lib/money";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";

export default async function InventoryListPage() {
  await requireMembership();
  const sb = await createClient();

  const { data: items } = await sb
    .from("inventory_items")
    .select("id, name, category, unit, min_stock, reorder_point, inventory_bin(on_hand, reserved)")
    .order("name");

  const columns: SimpleColumn[] = [
    { id: "name", header: "الصنف" },
    { id: "category", header: "الفئة" },
    { id: "on_hand", header: "الموجود", numeric: true },
    { id: "reserved", header: "المحجوز", numeric: true },
    { id: "available", header: "المتاح", numeric: true },
    { id: "flag", header: "إعادة الطلب", kind: "tag-danger" },
  ];

  const rows = (items ?? []).map((it) => {
    const bin = (Array.isArray(it.inventory_bin) ? it.inventory_bin[0] : it.inventory_bin) as
      | { on_hand?: number; reserved?: number }
      | null;
    const onHand = Number(bin?.on_hand ?? 0);
    const reserved = Number(bin?.reserved ?? 0);
    const available = onHand - reserved;
    const threshold = Number(it.reorder_point ?? it.min_stock ?? 0);
    const needsReorder = threshold > 0 && available < threshold;
    return {
      id: it.id,
      href: `/inventory/${it.id}/coverage`,
      name: it.name,
      category: it.category ?? "—",
      on_hand: `${num(onHand)} ${it.unit ?? ""}`,
      reserved: num(reserved),
      available: num(available),
      flag: needsReorder ? "إعادة الطلب" : "",
    };
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">المخزون</h1>
        <p style={{ color: "var(--ink-muted)" }}>اضغط على الصنف لعرض تغطيته</p>
      </header>
      <SimpleTable columns={columns} rows={rows} empty="لا توجد أصناف" />
    </div>
  );
}
