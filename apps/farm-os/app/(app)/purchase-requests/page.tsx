import { createClient } from "@/lib/supabase/server";
import { requireMembership } from "@/lib/auth";
import { EmptyState } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";

const PR_STATUS_AR: Record<string, string> = {
  draft: "مسودة",
  submitted: "مرسل",
  approved: "معتمد",
  rejected: "مرفوض",
  received: "مُستلم",
};

export default async function PurchaseRequestsPage() {
  await requireMembership();
  const sb = await createClient();

  const { data: prs, error } = await sb
    .from("purchase_requests")
    .select("id, code, status, reason, needed_by")
    .order("code", { ascending: false });
  // Surface DB read failures to the segment error boundary instead of rendering
  // a misleading empty page.
  if (error) throw error;

  const columns: SimpleColumn[] = [
    { id: "code", header: "الرمز" },
    { id: "reason", header: "السبب" },
    { id: "needed_by", header: "مطلوب بحلول" },
    { id: "status", header: "الحالة", kind: "status" },
  ];
  const rows = (prs ?? []).map((p) => ({
    id: p.id,
    href: `/purchase-requests/${p.id}`,
    code: p.code,
    reason: p.reason ?? "—",
    needed_by: p.needed_by ?? "—",
    status: PR_STATUS_AR[p.status] ?? p.status,
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">طلبات الشراء</h1>
      {rows.length === 0 ? (
        <EmptyState
          title="لا توجد طلبات شراء"
          description="تُنشأ الطلبات تلقائيًا من شاشة تغطية المخزون عند وجود نقص."
        />
      ) : (
        <SimpleTable columns={columns} rows={rows} />
      )}
    </div>
  );
}
