import { requireMembership } from "@/lib/auth";
import { EmptyState } from "@/components/ui";
import { MarketingRecordTable } from "@/components/marketing/MarketingRecordTable";
import { MarketingContactTable } from "@/components/marketing/MarketingContactTable";
import { MarketingAreaNav } from "@/components/marketing/MarketingAreaNav";
import {
  canAccessMarketing,
  loadMarketingRecords,
  loadMarketingContactsPage,
  loadMarketingContactActivityForContacts,
  loadMarketingContactIdsByCategory,
  contactOptions,
} from "@/lib/marketing/queries";
import {
  TASK_FIELDS,
  TASK_STATUS_OPTIONS,
  PLATFORM_STATE_FIELDS,
  PLATFORM_STATUS_OPTIONS,
  CERTIFICATE_FIELDS,
  CERTIFICATE_STATUS_OPTIONS,
  CHANNEL_TARGET_FIELDS,
  MESSAGE_TEMPLATE_FIELDS,
  DAILY_SALES_REPORT_FIELDS,
} from "@/lib/marketing/fields";

/**
 * SPEC-0032 — Campaigns view (legacy: exportletter/gmail-drafts-only/campaign/platforms/contact).
 * The contact master + campaign tasks, platform listings, certificates, channel revenue targets, and
 * reusable message templates (drafts only — copy the text and open your own mail/WhatsApp client; this
 * module never sends anything itself, per the no-automated-email constraint).
 */
const CONTACT_CATEGORIES = new Set(["exporter", "buyer_lead", "kuwait_distributor", "platform", "freight", "other"]);

export default async function MarketingCampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; archived?: string; page?: string }>;
}) {
  const m = await requireMembership();
  if (!canAccessMarketing(m.role)) {
    return (
      <div className="p-6">
        <EmptyState title="هذه الصفحة لمالك المزرعة أو المحاسب أو مدير المزرعة فقط." icon="🔒" />
      </div>
    );
  }

  const params = await searchParams;
  const query = (params.q ?? "").trim().slice(0, 100);
  const category = CONTACT_CATEGORIES.has(params.category ?? "") ? params.category! : null;
  const includeArchived = params.archived === "1";
  const parsedPage = Number(params.page);
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const [records, contactPage, kuwaitIds] = await Promise.all([
    loadMarketingRecords(m.orgId, [
      "task", "platform_state", "certificate", "channel_target", "message_template", "daily_sales_report",
    ]),
    loadMarketingContactsPage(m.orgId, { query, category, includeArchived, page, pageSize: 50 }),
    loadMarketingContactIdsByCategory(m.orgId, "kuwait_distributor"),
  ]);
  const activity = await loadMarketingContactActivityForContacts(
    m.orgId,
    contactPage.rows.map((contact) => contact.id),
  );
  const kuwaitContactIds = new Set(kuwaitIds);
  // Kuwait-distributor follow-up tasks live on the Markets page (SPEC-0032); campaign tasks here
  // exclude anything linked to a Kuwait-distributor contact so the same record isn't shown twice.
  const campaignTasks = records.filter((r) => r.recordType === "task" && !kuwaitContactIds.has(r.contactId ?? ""));
  const options = contactOptions(contactPage.rows);
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-bold">الحملات</h1>
        <p style={{ color: "var(--ink-muted)" }}>
          جهات الاتصال، مهام الحملات، حالة المنصّات، الشهادات، أهداف القنوات، وقوالب رسائل جاهزة للنسخ (بدون إرسال آلي).
        </p>
      </header>

      <MarketingAreaNav />

      <div id="contacts">
        <MarketingContactTable
          orgId={m.orgId}
          rows={contactPage.rows}
          activity={activity}
          canWrite
          query={query}
          category={category}
          includeArchived={includeArchived}
          page={contactPage.page}
          pages={contactPage.pages}
          total={contactPage.total}
        />
      </div>

      <MarketingRecordTable
        sectionId="daily-campaign"
        recordType="task"
        orgId={m.orgId}
        title="مهام الحملات"
        description="مهام تحضير خطابات التصدير، مسودّات البريد، والحملات."
        fields={TASK_FIELDS}
        hasStatus
        statusOptions={TASK_STATUS_OPTIONS}
        contacts={options}
        rows={campaignTasks}
        canWrite
      />
      <MarketingRecordTable
        sectionId="platforms"
        recordType="platform_state"
        orgId={m.orgId}
        title="حالة المنصّات"
        description="حالة كل منصّة بيع (نشطة/مسودة/متوقفة)."
        fields={PLATFORM_STATE_FIELDS}
        hasStatus
        statusOptions={PLATFORM_STATUS_OPTIONS}
        rows={records.filter((r) => r.recordType === "platform_state")}
        canWrite
      />
      <MarketingRecordTable
        sectionId="certificates"
        recordType="certificate"
        orgId={m.orgId}
        title="الشهادات"
        description="شهادات الجودة/التصدير وتواريخ انتهائها."
        fields={CERTIFICATE_FIELDS}
        hasStatus
        statusOptions={CERTIFICATE_STATUS_OPTIONS}
        rows={records.filter((r) => r.recordType === "certificate")}
        canWrite
      />
      <MarketingRecordTable
        sectionId="channel-targets"
        recordType="channel_target"
        orgId={m.orgId}
        title="أهداف القنوات"
        description="هدف الإيراد لكل قناة بيع/تصدير."
        fields={CHANNEL_TARGET_FIELDS}
        hasAmount
        amountLabel="الهدف (دولار)"
        rows={records.filter((r) => r.recordType === "channel_target")}
        canWrite
      />
      <MarketingRecordTable
        sectionId="message-templates"
        recordType="message_template"
        orgId={m.orgId}
        title="قوالب الرسائل"
        description="نص جاهز للنسخ اليدوي إلى بريدك أو واتساب — لا يوجد إرسال آلي من هذه الشاشة."
        fields={MESSAGE_TEMPLATE_FIELDS}
        rows={records.filter((r) => r.recordType === "message_template")}
        canWrite
      />
      <MarketingRecordTable
        sectionId="daily-report"
        recordType="daily_sales_report"
        orgId={m.orgId}
        title="التقرير اليومي"
        description="حركة التواصل والردود والفرص والعروض خلال اليوم."
        fields={DAILY_SALES_REPORT_FIELDS}
        rows={records.filter((record) => record.recordType === "daily_sales_report")}
        canWrite
      />
    </div>
  );
}
