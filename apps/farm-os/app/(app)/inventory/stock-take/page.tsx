// الجرد (stock-take) — reconcile the SYSTEM on-hand to a PHYSICAL count (SPEC-0030 Phase 4, #778). Field/store
// roles count each item/location and record the actual quantity; the gated fn_record_stock_take posts the reconciling
// movement (adjustment/loss) so on-hand drift can finally be corrected. Honest-null: only items the user
// actually counted are reconciled; a blank is "not counted", never assumed zero (#1). Server Component.

import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { StoryLine } from "@/components/StoryLine";
import { StockTakeSheet, type StockTakeItem } from "@/components/StockTakeSheet";
import { num } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function StockTakePage() {
  await requireRole(["owner", "farm_manager", "storekeeper"]);
  const sb = await createClient();

  const { data: items } = await sb
    .from("inventory_items")
    .select("id, name, unit, inventory_bin(location, on_hand)")
    .order("name", { ascending: true });

  const rows: StockTakeItem[] = (items ?? []).flatMap((it) => {
    const bins = (Array.isArray(it.inventory_bin) ? it.inventory_bin : [it.inventory_bin])
      .filter((bin): bin is { location: string; on_hand: number } => Boolean(bin?.location));
    const locations = bins.length > 0 ? bins : [{ location: "main", on_hand: 0 }];
    return locations
      .sort((a, b) => a.location.localeCompare(b.location, "ar"))
      .map((bin) => ({
        id: it.id,
        name: it.name,
        unit: it.unit ?? "",
        location: bin.location,
        onHand: Number(bin.on_hand ?? 0),
      }));
  });

  const lead =
    rows.length === 0
      ? "لا أصناف في المخزون بعد — أضِف أصنافًا أو استلم بضاعة أولًا."
      : `${num(rows.length)} صف صنف وموقع. عُدّ كل موقع منفصلًا؛ النظام يضبط رصيد هذا الموقع فقط على ما عددته.`;

  return (
    <div className="flex flex-col gap-4 p-6">
      <header>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>الجرد — عدّ المخزون الفعلي</h1>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          سجّل الكمية الفعلية لكل صنف في كل موقع بعد عدّها؛ يضبط النظام رصيد الموقع المحدد فقط على ما عددته. عدّ ما
          تريد فقط — الأصناف التي تتركها فارغة لا تُمَسّ.
        </p>
      </header>

      <StoryLine lead={lead} />

      <StockTakeSheet items={rows} />
    </div>
  );
}
