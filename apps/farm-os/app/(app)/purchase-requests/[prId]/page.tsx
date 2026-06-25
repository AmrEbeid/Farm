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
};

function pillStatus(s: string): "draft" | "scheduled" | "active" | "done" | "blocked" {
  if (s === "approved" || s === "received") return "done";
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

  const { data: pr } = await sb
    .from("purchase_requests")
    .select("id, code, status, version, reason, needed_by, requested_by, approved_by")
    .eq("id", prId)
    .maybeSingle();

  if (!pr) {
    return <div className="p-6">طلب الشراء غير موجود.</div>;
  }

  const { data: items } = await sb
    .from("purchase_request_items")
    .select("id, qty, unit, est_cost, inventory_items(name)")
    .eq("pr_id", prId);

  const columns: SimpleColumn[] = [
    { id: "name", header: "الصنف" },
    { id: "qty", header: "الكمية", numeric: true },
    { id: "cost", header: "التكلفة التقديرية", numeric: true },
  ];
  const rows = (items ?? []).map((it) => ({
    id: it.id,
    name: (it.inventory_items as { name?: string } | null)?.name ?? "—",
    qty: `${num(Number(it.qty))} ${it.unit ?? ""}`,
    cost: egp(Number(it.est_cost ?? 0)),
  }));

  // AP-1/AP-2 are enforced by RLS; the UI mirrors them for affordance only.
  const canApprove = m.role === "owner" && pr.requested_by !== m.userId;
  const canReceive = ["storekeeper", "owner", "farm_manager"].includes(m.role);

  const approvalSteps: ApprovalStep[] = [
    { id: "req", state: "approved", actor: "مقدّم الطلب", note: "أُنشئ الطلب" },
    {
      id: "owner",
      state:
        pr.status === "approved" || pr.status === "received"
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
        />
      </Card>
    </div>
  );
}
