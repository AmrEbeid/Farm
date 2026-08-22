import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { CollectWizard } from "@/components/CollectWizard";
import { fmtDate } from "@/lib/dates";
import { parseOpenSaleReceivables } from "@/lib/receivable workflow money";

// SPEC-0025 U-2 part 2 — «حصّلت من عميل» loader: finalized sales with an outstanding balance
// (total − Σ collections > 0), labelled buyer/crop/date/remaining for the picker.

export const dynamic = "force-dynamic";

export default async function RecordCollectPage() {
  const membership = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const result = await sb.rpc("fn_open_sale_receivables", {
    p_org: membership.orgId,
    p_limit: 200,
  });
  if (result.error) throw result.error;
  const open = parseOpenSaleReceivables(result.data).map((sale) => ({
    id: sale.id,
    label: `${sale.buyerName} — ${sale.crop} — ${sale.saleDate ? fmtDate(sale.saleDate) : "بدون تاريخ"}`,
    remaining: sale.remaining,
  }));

  return (
    <div className="p-6">
      <CollectWizard sales={open} />
    </div>
  );
}
