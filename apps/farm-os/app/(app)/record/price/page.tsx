import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { PriceWizard } from "@/components/PriceWizard";
import { fmtDate } from "@/lib/dates";

// R-3 — «حدّدت سعرًا» loader: pending-price deliveries with their بون/qty/buyer context.

export const dynamic = "force-dynamic";

export default async function RecordPricePage() {
  await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const [salesRes, buyersRes] = await Promise.all([
    sb
      .from("sales")
      .select("id, sale_date, crop, qty, unit, buyer_id, delivery_note_no")
      .eq("price_status", "pending")
      .order("sale_date", { ascending: false })
      .limit(200),
    sb.from("buyers").select("id, name"),
  ]);
  const buyerName = new Map((buyersRes.data ?? []).map((b) => [b.id, b.name]));
  const pending = (salesRes.data ?? []).map((s) => ({
    id: s.id,
    label: `${s.delivery_note_no ? `بون ${s.delivery_note_no} — ` : ""}${s.crop} — ${s.qty ?? "؟"} ${s.unit ?? ""} — ${(s.buyer_id && buyerName.get(s.buyer_id)) || "بدون اسم"} — ${s.sale_date ? fmtDate(s.sale_date) : ""}`,
    qty: Number(s.qty ?? 0),
    unit: s.unit ?? "",
  }));
  return (
    <div className="p-6">
      <PriceWizard pending={pending} />
    </div>
  );
}
