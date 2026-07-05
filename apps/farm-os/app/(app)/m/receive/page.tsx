import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, EmptyState } from "@/components/ui";
import { Code } from "@/components/Code";
import { ReceiveForm, type ReceiveLine } from "@/components/ReceiveForm";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";

/**
 * F6 — storekeeper mobile receive surface. Storekeepers were the one field role with NO phone view:
 * `/m` (الميدان) is gated away from them and their daily action — receiving stock against approved
 * purchase requests — was only reachable on the chart-heavy desktop PR detail. This is that action,
 * in the same single-column mobile shape as `/m`, reusing the exact `ReceiveForm` the desktop uses.
 *
 * Everything here mirrors the ALREADY-LIVE desktop receive path (purchase-requests/[prId]/page.tsx):
 * the same `canReceive` role set, the same `purchase_request_items` shape → `ReceiveLine`, and the
 * same `fn_post_receipt` RPC behind ReceiveForm. The only new thing is the filtered LIST: PRs the
 * RPC will actually accept a receipt for — status in ('approved','partially_received') (the claim
 * statuses fn_post_receipt / fn_stock_coverage use) with at least one still-open line.
 */
type PrItem = {
  item_id: string;
  qty: number | string | null;
  unit: string | null;
  received_qty: number | string | null;
  inventory_items: { name?: string } | null;
};
type PendingPr = {
  id: string;
  code: string;
  reason: string | null;
  needed_by: string | null;
  status: string;
  purchase_request_items: PrItem[] | null;
};

export default async function MobileReceivePage() {
  // Gate the whole route to the roles that may receive (same set as the desktop `canReceive` and the
  // fn_post_receipt authz). Reads are org-scoped by RLS; this just matches nav + affordance to the RPC.
  const m = await requireRole(["storekeeper", "owner", "farm_manager"]);
  const sb = await createClient();

  const { data: prs, error } = await sb
    .from("purchase_requests")
    .select(
      "id, code, reason, needed_by, status, purchase_request_items(item_id, qty, unit, received_qty, inventory_items(name))",
    )
    // Only PRs fn_post_receipt will actually claim — mirrors the engine's supply status set.
    .in("status", ["approved", "partially_received"])
    // Soonest-needed first: the storekeeper works the most time-critical deliveries at the top.
    .order("needed_by", { ascending: true, nullsFirst: false });
  // Surface DB read failures to the segment error boundary instead of a misleading empty page.
  if (error) throw error;

  // Keep only PRs with a still-open line, and build each one's ReceiveLine[] exactly as the desktop
  // detail page does. ReceiveForm re-filters to open lines internally, but excluding fully-received
  // PRs here means a spent PR never renders an empty card.
  const pending = (prs ?? [])
    .map((pr: PendingPr) => {
      const lines: ReceiveLine[] = (pr.purchase_request_items ?? []).map((it) => ({
        itemId: it.item_id,
        name: it.inventory_items?.name ?? "—",
        unit: it.unit ?? "",
        qty: Number(it.qty ?? 0),
        receivedQty: Number(it.received_qty ?? 0),
      }));
      const openCount = lines.filter((l) => l.qty - l.receivedQty > 0).length;
      return { pr, lines, openCount };
    })
    .filter(({ openCount }) => openCount > 0);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header>
        <h1 className="text-xl font-bold">استلام المخزون</h1>
        <p style={{ color: "var(--ink-muted)" }}>{m.name ?? "أمين المخزن"}</p>
      </header>

      {pending.length === 0 ? (
        <EmptyState
          title="لا توجد طلبات بانتظار الاستلام."
          description="ستظهر هنا طلبات الشراء المعتمدة التي لم يكتمل استلامها بعد."
        />
      ) : (
        pending.map(({ pr, lines, openCount }) => (
          <Card key={pr.id}>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">
                    طلب شراء <Code>{pr.code}</Code>
                  </div>
                  <div className="text-sm" style={{ color: "var(--ink-muted)" }}>
                    {pr.reason ?? "بدون سبب"} ·{" "}
                    {pr.needed_by ? `مطلوب بحلول ${fmtDate(pr.needed_by)}` : "بدون موعد"}
                  </div>
                </div>
                <span className="text-sm" style={{ color: "var(--ink-muted)" }}>
                  {num(openCount)} بند مفتوح
                </span>
              </div>
              <ReceiveForm prId={pr.id} lines={lines} />
            </div>
          </Card>
        ))
      )}

      <Link href="/m" className="font-bold underline underline-offset-4" style={{ color: "var(--brand)" }}>
        → رجوع إلى الميدان
      </Link>
    </div>
  );
}
