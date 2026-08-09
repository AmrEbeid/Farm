import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { PriceWizard } from "@/components/PriceWizard";
import { fmtDate } from "@/lib/dates";
import { parsePendingSalePricing, receivableQuantity } from "@/lib/receivable workflow money";

// R-3 — «حدّدت سعرًا» loader: pending-price deliveries with their بون/qty/buyer context.

export const dynamic = "force-dynamic";

export default async function RecordPricePage() {
  const membership = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const result = await sb.rpc("fn_pending_sale_pricing", {
    p_org: membership.orgId,
    p_limit: 200,
  });
  if (result.error) throw result.error;
  const pending = parsePendingSalePricing(result.data).map((sale) => ({
    id: sale.id,
    label: `${sale.deliveryNoteNo ? `بون ${sale.deliveryNoteNo} — ` : ""}${sale.crop} — ${receivableQuantity(sale.qty)} ${sale.unit} — ${sale.buyerName} — ${sale.saleDate ? fmtDate(sale.saleDate) : ""}`,
    qty: sale.qty,
    unit: sale.unit,
  }));
  return (
    <div className="p-6">
      <PriceWizard pending={pending} />
    </div>
  );
}
