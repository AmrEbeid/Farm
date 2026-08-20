import { requireMembership } from "@/lib/auth";
import { EmptyState } from "@/components/ui";
import { MarketingRecordTable } from "@/components/marketing/MarketingRecordTable";
import { canAccessMarketing, loadMarketingRecords } from "@/lib/marketing/queries";
import { QUALITY_BATCH_FIELDS, WEEKLY_AVAILABILITY_FIELDS } from "@/lib/marketing/fields";

/** SPEC-0032 — Product view: quality batches and weekly availability (legacy: farm/offshoots/quality/materials). */
export default async function MarketingProductPage() {
  const m = await requireMembership();
  if (!canAccessMarketing(m.role)) {
    return (
      <div className="p-6">
        <EmptyState title="هذه الصفحة لمالك المزرعة أو المحاسب أو مدير المزرعة فقط." icon="🔒" />
      </div>
    );
  }

  const records = await loadMarketingRecords(m.orgId, ["quality_batch", "weekly_availability"]);
  const qualityBatches = records.filter((r) => r.recordType === "quality_batch");
  const availability = records.filter((r) => r.recordType === "weekly_availability");

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-bold">المنتج</h1>
        <p style={{ color: "var(--ink-muted)" }}>جودة الدفعات والكميات الأسبوعية المتاحة للتصدير.</p>
      </header>
      <MarketingRecordTable
        recordType="quality_batch"
        orgId={m.orgId}
        title="دفعات الجودة"
        description="نتائج فحص الجودة لكل دفعة تصدير."
        fields={QUALITY_BATCH_FIELDS}
        hasStatus
        statusOptions={[
          { value: "pending", label: "قيد الفحص" },
          { value: "passed", label: "مطابقة" },
          { value: "rejected", label: "مرفوضة" },
        ]}
        rows={qualityBatches}
        canWrite
      />
      <MarketingRecordTable
        recordType="weekly_availability"
        orgId={m.orgId}
        title="الكمية الأسبوعية المتاحة"
        description="ما هو متاح للتصدير أسبوعيًا حسب الصنف."
        fields={WEEKLY_AVAILABILITY_FIELDS}
        rows={availability}
        canWrite
      />
    </div>
  );
}
