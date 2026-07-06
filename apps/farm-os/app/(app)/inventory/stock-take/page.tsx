// الجرد (stock-take) — reconcile the SYSTEM on-hand to a PHYSICAL count (SPEC-0030 Phase 4, #778). Field/store
// roles count each item and record the actual quantity; the gated fn_record_stock_take posts the reconciling
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
    .select("id, name, unit, inventory_bin(on_hand)")
    .order("name", { ascending: true });

  const rows: StockTakeItem[] = (items ?? []).map((it) => {
    const bin = (Array.isArray(it.inventory_bin) ? it.inventory_bin[0] : it.inventory_bin) as
      | { on_hand?: number }
      | null
      | undefined;
    return { id: it.id, name: it.name, unit: it.unit ?? "", onHand: Number(bin?.on_hand ?? 0) };
  });

  const lead =
    rows.length === 0
      ? "لا أصناف في المخزون بعد — أضِف أصنافًا أو استلم بضاعة أولًا."
      : `${num(rows.length)} صنف في المخزون. عُدّ الموجود فعليًا وسجّل الكمية؛ النظام يضبط رصيده على ما عددته.`;

  return (
    <div className="flex flex-col gap-4 p-6">
      <header>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>الجرد — عدّ المخزون الفعلي</h1>
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          سجّل الكمية الفعلية لكل صنف بعد عدّها؛ يضبط النظام رصيده على ما عددته (يُسجّل الفرق كبونص أو عجز). عدّ ما
          تريد فقط — الأصناف التي تتركها فارغة لا تُمَسّ.
        </p>
      </header>

      <StoryLine lead={lead} />

      <StockTakeSheet items={rows} />
    </div>
  );
}
