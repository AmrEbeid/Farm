import { requireMembership } from "@/lib/auth";
import { EmptyState } from "@/components/ui";
import { MarketingRecordTable } from "@/components/marketing/MarketingRecordTable";
import { MarketingAreaNav } from "@/components/marketing/MarketingAreaNav";
import { canAccessMarketing, loadMarketingRecords } from "@/lib/marketing/queries";
import {
  QUALITY_BATCH_FIELDS,
  WEEKLY_AVAILABILITY_FIELDS,
  FARM_MARKETING_FACT_FIELDS,
} from "@/lib/marketing/fields";

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

  const records = await loadMarketingRecords(m.orgId, ["quality_batch", "weekly_availability", "market_reference"]);
  const qualityBatches = records.filter((r) => r.recordType === "quality_batch");
  const availability = records.filter((r) => r.recordType === "weekly_availability");
  const farmFacts = records.filter(
    (record) => record.recordType === "market_reference" && record.payload.farmAreaFeddan != null,
  );

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-bold">المنتج</h1>
        <p style={{ color: "var(--ink-muted)" }}>جودة الدفعات والكميات الأسبوعية المتاحة للتصدير.</p>
      </header>
      <MarketingAreaNav />
      <MarketingRecordTable
        sectionId="quality"
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
        sectionId="farm-product"
        recordType="market_reference"
        orgId={m.orgId}
        title="حقائق المزرعة التسويقية"
        description="الحقائق المستخدمة في ملفات البيع والتصدير، منفصلة عن السجلات التشغيلية الرسمية."
        fields={FARM_MARKETING_FACT_FIELDS}
        rows={farmFacts}
        canWrite
      />
      <MarketingRecordTable
        sectionId="weekly-availability"
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
