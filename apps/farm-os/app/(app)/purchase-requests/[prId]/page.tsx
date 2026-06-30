import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import type { PillStatus, TabItem } from "@amrebeid/ui";
import {
  Alert,
  Card,
  KpiCard,
  ApprovalChain,
  DescriptionList,
  tabId,
  tabPanelId,
  type ApprovalStep,
} from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { Entity360Header } from "@/components/Entity360Header";
import { EntityTabs } from "@/components/EntityTabs";
import { PrActions } from "@/components/PrActions";
import { egp, num } from "@/lib/money";
import { fmtDate } from "@/lib/dates";
import { PR_STATUS_AR } from "@/lib/labels";

function pillStatus(s: string): PillStatus {
  if (s === "received" || s === "closed") return "done";
  if (s === "approved") return "active";
  // partially_received is in-progress — supply still on order; flag it for attention.
  if (s === "partially_received") return "warning";
  if (s === "submitted") return "scheduled";
  if (s === "rejected" || s === "cancelled") return "blocked";
  return "draft";
}

const TAB_IDS = ["overview", "items"] as const;
type PrTab = (typeof TAB_IDS)[number];

export default async function PurchaseRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ prId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { prId } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: PrTab = (TAB_IDS as readonly string[]).includes(rawTab ?? "")
    ? (rawTab as PrTab)
    : "overview";
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
      href: `/inventory/${it.item_id}`,
      name: (it.inventory_items as { name?: string } | null)?.name ?? "—",
      qty: `${num(qty)} ${unit}`.trim(),
      received: `${num(received)} ${unit}`.trim(),
      remaining: `${num(qty - received)} ${unit}`.trim(),
      // #89-B: a null est_cost means the unit price is unknown (no fabricated cost) — show "—",
      // not "0 ج.م" (which would falsely imply a zero cost).
      cost: it.est_cost != null ? egp(Number(it.est_cost)) : "—",
    };
  });
  const estimatedCost = (items ?? []).reduce((sum, it) => sum + Number(it.est_cost ?? 0), 0);
  const totalQty = (items ?? []).reduce((sum, it) => sum + Number(it.qty ?? 0), 0);
  const totalReceived = (items ?? []).reduce((sum, it) => sum + Number(it.received_qty ?? 0), 0);
  const totalRemaining = totalQty - totalReceived;
  const units = Array.from(new Set((items ?? []).map((it) => it.unit ?? "").filter(Boolean)));
  const singleUnit = units.length === 1 ? units[0] : null;
  const openLineCount = (items ?? []).filter((it) => Number(it.qty ?? 0) > Number(it.received_qty ?? 0)).length;

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

  // Attention surfacing: awaiting owner approval, or a needed-by date that has passed
  // while the order is not yet fully received.
  const awaitingApproval = pr.status === "submitted";
  const isOpen = !["received", "closed", "rejected", "cancelled"].includes(pr.status);
  const isOverdue =
    isOpen &&
    pr.needed_by != null &&
    new Date(pr.needed_by) < new Date(new Date().toISOString().slice(0, 10));

  const tabItems: TabItem[] = [
    { id: "overview", label: "نظرة عامة" },
    { id: "items", label: `البنود (${num((items ?? []).length)})` },
  ];

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
      <Entity360Header
        title={`طلب شراء ${pr.code}`}
        subtitle={`${pr.reason ?? "بدون سبب"} · مطلوب بحلول ${pr.needed_by ? fmtDate(pr.needed_by) : "—"}`}
        pills={[{ status: pillStatus(pr.status), label: PR_STATUS_AR[pr.status] ?? "غير معروف" }]}
      />

      {awaitingApproval && (
        <Alert
          tone="warning"
          title="بانتظار اعتماد المالك"
          description="لم يُعتمد طلب الشراء بعد. الاعتماد متاح من تبويب نظرة عامة."
        />
      )}
      {isOverdue && (
        <Alert
          tone="warning"
          title="تجاوز موعد الاستلام المطلوب"
          description={`كان مطلوبًا بحلول ${pr.needed_by ? fmtDate(pr.needed_by) : "—"} ولم يكتمل الاستلام.`}
        />
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="عدد البنود" value={num((items ?? []).length)} />
        <KpiCard label="التكلفة التقديرية" value={egp(estimatedCost)} />
        <KpiCard
          label="المستلم"
          value={singleUnit ? num(totalReceived) : "وحدات متعددة"}
          unit={singleUnit ?? undefined}
        />
        <KpiCard
          label="المتبقي"
          value={singleUnit ? num(totalRemaining) : num(openLineCount)}
          unit={singleUnit ?? "بنود"}
          deltaDirection={(singleUnit ? totalRemaining > 0 : openLineCount > 0) ? "down" : "none"}
        />
      </section>

      <EntityTabs items={tabItems} value={tab} ariaLabel="أقسام طلب الشراء" />

      {tab === "overview" && (
        <div
          role="tabpanel"
          id={tabPanelId("overview")}
          aria-labelledby={tabId("overview")}
          tabIndex={0}
          className="flex flex-col gap-6"
        >
          <section className="grid gap-4 md:grid-cols-2">
            <Card title="التفاصيل">
              <DescriptionList
                layout="inline"
                items={[
                  { id: "code", term: "الرمز", description: pr.code },
                  { id: "needed", term: "مطلوب بحلول", description: pr.needed_by ? fmtDate(pr.needed_by) : "—" },
                  { id: "status", term: "الحالة", description: PR_STATUS_AR[pr.status] ?? "غير معروف" },
                ]}
              />
            </Card>
            <Card title="سلسلة الاعتماد">
              <ApprovalChain steps={approvalSteps} ariaLabel="سلسلة اعتماد طلب الشراء" />
            </Card>
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
      )}

      {tab === "items" && (
        <div role="tabpanel" id={tabPanelId("items")} aria-labelledby={tabId("items")} tabIndex={0}>
          <Card title="الأصناف">
            <SimpleTable columns={columns} rows={rows} empty="لا توجد أصناف في هذا الطلب." />
          </Card>
        </div>
      )}
    </div>
  );
}
