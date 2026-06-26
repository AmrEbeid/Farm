import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import {
  Card,
  StatusPill,
  ApprovalChain,
  DescriptionList,
  type ApprovalStep,
} from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { PrActions } from "@/components/PrActions";
import { egp, num } from "@/lib/money";

const PR_STATUS_AR: Record<string, string> = {
  draft: "مسودة",
  submitted: "مرسل",
  approved: "معتمد",
  rejected: "مرفوض",
  received: "مُستلم",
  partially_received: "مُستلم جزئيًا",
};

function pillStatus(s: string): "draft" | "scheduled" | "active" | "done" | "blocked" {
  if (s === "approved" || s === "received") return "done";
  // partially_received is in-progress — supply still on order. Treat like an active state.
  if (s === "partially_received") return "active";
  if (s === "submitted") return "scheduled";
  if (s === "rejected") return "blocked";
  return "draft";
}

export default async function PurchaseRequestPage({
  params,
}: {
  params: Promise<{ prId: string }>;
}) {
  const { prId } = await params;
  const m = await requireMembership();
  const sb = await createClient();

  const { data: pr, error: prError } = await sb
    .from("purchase_requests")
    .select("id, code, status, version, reason, needed_by, requested_by, approved_by")
    .eq("id", prId)
    .maybeSingle();
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (prError) throw prError;

  if (!pr) {
    return <div className="p-6">طلب الشراء غير موجود.</div>;
  }

  const { data: items, error: itemsError } = await sb
    .from("purchase_request_items")
    .select("id, item_id, qty, unit, est_cost, received_qty, inventory_items(name)")
    .eq("pr_id", prId);
  if (itemsError) throw itemsError;

  const columns: SimpleColumn[] = [
    { id: "name", header: "الصنف" },
    { id: "qty", header: "الكمية", numeric: true },
    // SPEC-0009 #155: received-to-date and the still-owed remainder, so the storekeeper can see
    // progress across partial deliveries.
    { id: "received", header: "المُستلم", numeric: true },
    { id: "remaining", header: "المتبقي", numeric: true },
    { id: "cost", header: "التكلفة التقديرية", numeric: true },
  ];
  const rows = (items ?? []).map((it) => {
    const qty = Number(it.qty ?? 0);
    const received = Number(it.received_qty ?? 0);
    const unit = it.unit ?? "";
    return {
      id: it.id,
      name: (it.inventory_items as { name?: string } | null)?.name ?? "—",
      qty: `${num(qty)} ${unit}`.trim(),
      received: `${num(received)} ${unit}`.trim(),
      remaining: `${num(qty - received)} ${unit}`.trim(),
      // #89-B: a null est_cost means the unit price is unknown (no fabricated cost) — show "—",
      // not "0 ج.م" (which would falsely imply a zero cost).
      cost: it.est_cost != null ? egp(Number(it.est_cost)) : "—",
    };
  });

  // Lines for the receive UI: keyed by inventory item_id (the RPC's p_lines key).
  const receiveLines = (items ?? []).map((it) => ({
    itemId: it.item_id,
    name: (it.inventory_items as { name?: string } | null)?.name ?? "—",
    unit: it.unit ?? "",
    qty: Number(it.qty ?? 0),
    receivedQty: Number(it.received_qty ?? 0),
  }));

  // AP-1/AP-2 are enforced by RLS; the UI mirrors them for affordance only.
  const canApprove = m.role === "owner" && pr.requested_by !== m.userId;
  const canReceive = ["storekeeper", "owner", "farm_manager"].includes(m.role);

  const approvalSteps: ApprovalStep[] = [
    { id: "req", state: "approved", actor: "مقدّم الطلب", note: "أُنشئ الطلب" },
    {
      id: "owner",
      state:
        pr.status === "approved" ||
        pr.status === "received" ||
        pr.status === "partially_received"
          ? "approved"
          : pr.status === "rejected"
            ? "rejected"
            : pr.status === "submitted"
              ? "pending"
              : "requested",
      actor: "المالك",
      note: pr.status === "submitted" ? "بانتظار الاعتماد" : undefined,
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">طلب شراء {pr.code}</h1>
          <p style={{ color: "var(--ink-muted)" }}>{pr.reason}</p>
        </div>
        <StatusPill status={pillStatus(pr.status)}>{PR_STATUS_AR[pr.status]}</StatusPill>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <Card title="التفاصيل">
          <DescriptionList
            layout="inline"
            items={[
              { id: "code", term: "الرمز", description: pr.code },
              { id: "needed", term: "مطلوب بحلول", description: pr.needed_by ?? "—" },
              { id: "status", term: "الحالة", description: PR_STATUS_AR[pr.status] },
            ]}
          />
        </Card>
        <Card title="سلسلة الاعتماد">
          <ApprovalChain steps={approvalSteps} ariaLabel="سلسلة اعتماد طلب الشراء" />
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">الأصناف</h2>
        <SimpleTable columns={columns} rows={rows} empty="لا توجد أصناف في هذا الطلب." />
      </section>

      <Card title="الإجراءات">
        <PrActions
          prId={prId}
          status={pr.status}
          version={pr.version ?? 1}
          canApprove={canApprove}
          canReceive={canReceive}
          lines={receiveLines}
        />
      </Card>
    </div>
  );
}
