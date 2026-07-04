import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { CollectWizard } from "@/components/CollectWizard";
import { fmtDate } from "@/lib/dates";

// SPEC-0025 U-2 part 2 — «حصّلت من عميل» loader: finalized sales with an outstanding balance
// (total − Σ collections > 0), labelled buyer/crop/date/remaining for the picker.

export const dynamic = "force-dynamic";

export default async function RecordCollectPage() {
  await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const [salesRes, collectionsRes, buyersRes] = await Promise.all([
    sb
      .from("sales")
      .select("id, sale_date, crop, total, buyer_id, price_status, payment_status")
      .eq("price_status", "finalized")
      .neq("payment_status", "collected")
      .order("sale_date", { ascending: false })
      .limit(200),
    sb.from("sale_collections").select("sale_id, amount"),
    sb.from("buyers").select("id, name"),
  ]);
  const buyerName = new Map((buyersRes.data ?? []).map((b) => [b.id, b.name]));
  const collected = new Map<string, number>();
  for (const c of collectionsRes.data ?? []) {
    collected.set(c.sale_id, (collected.get(c.sale_id) ?? 0) + Number(c.amount ?? 0));
  }
  const open = (salesRes.data ?? [])
    .map((s) => {
      const remaining = Number(s.total ?? 0) - (collected.get(s.id) ?? 0);
      return {
        id: s.id,
        label: `${(s.buyer_id && buyerName.get(s.buyer_id)) || "عميل نقدي"} — ${s.crop} — ${s.sale_date ? fmtDate(s.sale_date) : "بدون تاريخ"}`,
        remaining,
      };
    })
    .filter((s) => s.remaining > 0);

  return (
    <div className="p-6">
      <CollectWizard sales={open} />
    </div>
  );
}
