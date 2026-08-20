import { requireMembership } from "@/lib/auth";
import { EmptyState } from "@/components/ui";
import { MarketingRecordTable } from "@/components/marketing/MarketingRecordTable";
import { canAccessMarketing, loadMarketingRecords, loadMarketingContacts, contactOptions } from "@/lib/marketing/queries";
import { LEAD_FIELDS, LEAD_STATUS_OPTIONS, EXW_BID_FIELDS, BROKER_STATE_FIELDS, BROKER_STATUS_OPTIONS } from "@/lib/marketing/fields";
import type { MarketingRecordType } from "@/lib/database.types.ext";

const LEAD_TYPES: { type: MarketingRecordType; title: string; description: string }[] = [
  { type: "lead_local", title: "عملاء محتملون — محليون", description: "عملاء تصدير محتملون داخل السوق المحلي." },
  { type: "lead_offshoot", title: "عملاء محتملون — فسائل", description: "عملاء محتملون لبيع الفسائل." },
  { type: "lead_social", title: "عملاء محتملون — منصّات اجتماعية", description: "استفسارات من منصّات التواصل." },
  { type: "lead_linkedin", title: "عملاء محتملون — LinkedIn", description: "تواصل عبر LinkedIn." },
  { type: "hot_lead", title: "عملاء محتملون — أولوية عالية", description: "عملاء محتملون بأولوية متابعة عالية." },
];

/** SPEC-0032 — Pipeline view (legacy: crm/exw/linkedin/brokers): every lead type + EXW bids + brokers. */
export default async function MarketingPipelinePage() {
  const m = await requireMembership();
  if (!canAccessMarketing(m.role)) {
    return (
      <div className="p-6">
        <EmptyState title="هذه الصفحة لمالك المزرعة أو المحاسب أو مدير المزرعة فقط." icon="🔒" />
      </div>
    );
  }

  const [records, contacts] = await Promise.all([
    loadMarketingRecords(m.orgId, [
      "lead_local",
      "lead_offshoot",
      "lead_social",
      "lead_linkedin",
      "hot_lead",
      "exw_bid",
      "broker_state",
    ]),
    loadMarketingContacts(m.orgId),
  ]);
  const options = contactOptions(contacts);

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-bold">خط المبيعات</h1>
        <p style={{ color: "var(--ink-muted)" }}>كل أنواع العملاء المحتملين، وعروض EXW، وحالة الوسطاء.</p>
      </header>
      {LEAD_TYPES.map((lt) => (
        <MarketingRecordTable
          key={lt.type}
          recordType={lt.type}
          orgId={m.orgId}
          title={lt.title}
          description={lt.description}
          fields={LEAD_FIELDS}
          hasAmount
          amountLabel="القيمة المتوقعة (دولار)"
          hasStatus
          statusOptions={LEAD_STATUS_OPTIONS}
          contacts={options}
          rows={records.filter((r) => r.recordType === lt.type)}
          canWrite
        />
      ))}
      <MarketingRecordTable
        recordType="exw_bid"
        orgId={m.orgId}
        title="عروض EXW"
        description="عروض أسعار تسليم المزرعة (Ex Works)."
        fields={EXW_BID_FIELDS}
        hasAmount
        amountLabel="السعر (دولار/طن)"
        contacts={options}
        rows={records.filter((r) => r.recordType === "exw_bid")}
        canWrite
      />
      <MarketingRecordTable
        recordType="broker_state"
        orgId={m.orgId}
        title="الوسطاء"
        description="حالة كل وسيط تصدير ونسبة عمولته."
        fields={BROKER_STATE_FIELDS}
        hasStatus
        statusOptions={BROKER_STATUS_OPTIONS}
        contacts={options}
        rows={records.filter((r) => r.recordType === "broker_state")}
        canWrite
      />
    </div>
  );
}
