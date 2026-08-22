import { requireMembership } from "@/lib/auth";
import { EmptyState } from "@/components/ui";
import { MarketingRecordTable } from "@/components/marketing/MarketingRecordTable";
import { canAccessMarketing, loadMarketingRecords, loadMarketingContactsByCategory, contactOptions } from "@/lib/marketing/queries";
import { MarketingAreaNav } from "@/components/marketing/MarketingAreaNav";
import {
  PRICE_OBSERVATION_FIELDS,
  COMPETITOR_FIELDS,
  TASK_STATUS_OPTIONS,
  FREIGHT_REFERENCE_FIELDS,
  MARKET_REFERENCE_FIELDS,
} from "@/lib/marketing/fields";

/**
 * SPEC-0032 — Markets view (legacy: prices/markets/local/shipping/logistics/kuwait/china/competitors/
 * socialprices). Price intelligence + competitor tracking + a Kuwait-distributor contact-status task
 * list (`task` records linked to a `kuwait_distributor` contact) — deliberately reuses the generic
 * `task` type rather than adding a one-off table for a single legacy area.
 */
export default async function MarketingMarketsPage() {
  const m = await requireMembership();
  if (!canAccessMarketing(m.role)) {
    return (
      <div className="p-6">
        <EmptyState title="هذه الصفحة لمالك المزرعة أو المحاسب أو مدير المزرعة فقط." icon="🔒" />
      </div>
    );
  }

  const [records, contacts] = await Promise.all([
    loadMarketingRecords(m.orgId, ["price_observation", "competitor", "task", "freight_reference", "market_reference"]),
    loadMarketingContactsByCategory(m.orgId, "kuwait_distributor"),
  ]);
  const prices = records.filter((r) => r.recordType === "price_observation");
  const competitors = records.filter((r) => r.recordType === "competitor");
  const kuwaitContacts = contacts;
  const kuwaitTasks = records.filter(
    (r) => r.recordType === "task" && kuwaitContacts.some((c) => c.id === r.contactId),
  );

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-bold">الأسواق</h1>
        <p style={{ color: "var(--ink-muted)" }}>رصد الأسعار، المنافسون، وحالة التواصل مع موزّعي الكويت.</p>
      </header>
      <MarketingAreaNav />
      <MarketingRecordTable
        sectionId="daily-prices"
        recordType="price_observation"
        orgId={m.orgId}
        title="رصد الأسعار"
        description="أسعار مرصودة من السوق المحلي أو الكويت أو الصين أو المنصات الاجتماعية."
        fields={PRICE_OBSERVATION_FIELDS}
        hasAmount
        amountLabel="متوسط السعر (جنيه/كجم)"
        rows={prices}
        canWrite
      />
      <MarketingRecordTable
        sectionId="competitors"
        recordType="competitor"
        orgId={m.orgId}
        title="المنافسون"
        description="نقاط قوة وضعف المنافسين في التصدير."
        fields={COMPETITOR_FIELDS}
        rows={competitors}
        canWrite
      />
      <MarketingRecordTable
        sectionId="kuwait"
        recordType="task"
        orgId={m.orgId}
        title="متابعة موزّعي الكويت"
        description="حالة التواصل مع كل موزّع كويتي، مرتبطة بجهة الاتصال."
        fields={[]}
        hasStatus
        statusOptions={TASK_STATUS_OPTIONS}
        contacts={contactOptions(contacts).filter((c) => kuwaitContacts.some((k) => k.id === c.id))}
        rows={kuwaitTasks}
        canWrite
        addLabel="+ إضافة متابعة موزّع"
        empty="لا توجد متابعات لموزّعي الكويت بعد"
      />
      <MarketingRecordTable
        sectionId="shipping"
        recordType="freight_reference"
        orgId={m.orgId}
        title="مراجع الشحن"
        description="تكلفة مرجعية تحتاج تاريخ مراجعة قبل استخدامها في عرض جديد."
        fields={FREIGHT_REFERENCE_FIELDS}
        rows={records.filter((record) => record.recordType === "freight_reference")}
        canWrite
      />
      <MarketingRecordTable
        sectionId="export-markets"
        recordType="market_reference"
        orgId={m.orgId}
        title="مراجع الأسواق والتصدير"
        description="أنواع الأسعار وحقائق المزرعة المستخدمة في التخطيط التسويقي."
        fields={MARKET_REFERENCE_FIELDS}
        rows={records.filter(
          (record) => record.recordType === "market_reference" && record.payload.kind === "price_type",
        )}
        canWrite
      />
    </div>
  );
}
