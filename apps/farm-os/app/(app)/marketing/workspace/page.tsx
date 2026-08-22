import { requireMembership } from "@/lib/auth";
import { EmptyState } from "@/components/ui";
import { MarketingAreaNav } from "@/components/marketing/MarketingAreaNav";
import { WorkspaceArea } from "@/components/marketing/workspace/WorkspaceArea";
import { WorkspaceShell } from "@/components/marketing/workspace/WorkspaceShell";
import type { MarketingWorkspaceData } from "@/components/marketing/workspace/workspace-data";
import { marketingTemplateDefaults } from "@/lib/marketing/workspace/template-defaults";
import {
  canAccessMarketing,
  loadMarketingDashboardSnapshot,
  loadMarketingRecordsPage,
  loadMarketingContactsByCategory,
  loadMarketingContactsPage,
  loadMarketingContactActivityForContacts,
  loadMarketingSelectedContacts,
  loadMarketingContactedCount,
  loadMarketingWorkspaceControlValues,
  loadMarketingWorkspaceAggregates,
} from "@/lib/marketing/queries";
import { MARKETING_AREA_BLUEPRINTS } from "@/lib/marketing/fidelity-manifest";
import { WORKSPACE_RECORD_SECTIONS } from "@/lib/marketing/workspace/section-config";
import type { MarketingRecordType } from "@/lib/database.types.ext";
import type { MarketingDashboardSnapshot, MarketingContactsPage } from "@/lib/marketing/queries";

const EMPTY_DASHBOARD: MarketingDashboardSnapshot = {
  activeContacts: 0,
  selectedContacts: 0,
  activeRecords: 0,
  overdueFollowUps: 0,
  dueFollowUps7Days: 0,
  recordsByType: {},
  recordsByStatus: {},
  recentActivity: [],
  latestImport: null,
};

const EMPTY_DIRECTORY: MarketingContactsPage = {
  rows: [],
  total: 0,
  page: 1,
  pageSize: 50,
  pages: 0,
};

/**
 * SPEC-0032 — the authenticated, full-fidelity Marketing workspace: all 25 legacy source tabs, in
 * their exact order, driven by `lib/marketing/fidelity-manifest.ts` (the machine-checked oracle —
 * see `lib/marketing/workspace/fidelity.test.ts`). The compact 5-page module (/marketing, /marketing/
 * product, /markets, /pipeline, /campaigns) keeps working unchanged; this route is a 1:1-shaped view
 * over the exact same normalized database (`marketing_record` / `marketing_contact` /
 * `marketing_contact_activity`), not a second source of truth.
 */
export default async function MarketingWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ area?: string; q?: string; category?: string; archived?: string; page?: string; recordsPage?: string }>;
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
  const category = (params.category ?? "buyer_lead").trim().slice(0, 40) || null;
  const includeArchived = params.archived === "1";
  const parsedPage = Number(params.page);
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const parsedRecordsPage = Number(params.recordsPage);
  const recordsPage = Number.isInteger(parsedRecordsPage) && parsedRecordsPage > 0 ? parsedRecordsPage : 1;
  const activeArea = MARKETING_AREA_BLUEPRINTS.find((area) => area.sourceId === params.area)
    ?? MARKETING_AREA_BLUEPRINTS[0];

  const recordTypes = new Set<MarketingRecordType>();
  let needsDashboard = false;
  let needsExporterContacts = false;
  let needsKuwaitContacts = false;
  let needsSelectedContacts = false;
  let needsDirectory = false;
  let needsDirectoryContactedCount = false;
  let needsExporterContactedCount = false;

  for (const section of activeArea.sections) {
    const recordConfig = WORKSPACE_RECORD_SECTIONS[section.id];
    if (recordConfig) {
      recordTypes.add(recordConfig.recordType);
      needsExporterContacts ||= recordConfig.contactCategory === "exporter";
      needsKuwaitContacts ||= recordConfig.contactCategory === "kuwait_distributor";
    }
    if (section.kind === "kpi") needsDashboard = true;
    if (section.kind === "templates") recordTypes.add("message_template");
    if (section.kind === "checklist") recordTypes.add("task");
    if (section.kind === "contacts") {
      needsDirectory ||= section.contactCategory === "buyer_lead";
      needsExporterContacts ||= section.contactCategory === "exporter";
      needsKuwaitContacts ||= section.contactCategory === "kuwait_distributor";
    }
    if (section.kind === "outbox") {
      recordTypes.add("market_reference");
      recordTypes.add("message_template");
      needsSelectedContacts = true;
    }
    if (section.calculatorId === "availability-mix") recordTypes.add("weekly_availability");
    if (section.calculatorId === "campaign-funnel") {
      needsDashboard = true;
      needsExporterContacts = true;
      needsExporterContactedCount = true;
      needsDirectoryContactedCount = true;
    }
  }

  const [dashboard, recordResult, exporterContacts, kuwaitContacts, selectedContacts, directoryPage, exporterContactedCount, directoryContactedCount, sourceControlValues, aggregates] =
    await Promise.all([
      needsDashboard ? loadMarketingDashboardSnapshot(m.orgId) : Promise.resolve(EMPTY_DASHBOARD),
      recordTypes.size > 0
        ? loadMarketingRecordsPage(m.orgId, [...recordTypes], recordsPage)
        : Promise.resolve({ rows: [], page: 1, pages: 0 }),
      needsExporterContacts ? loadMarketingContactsByCategory(m.orgId, "exporter") : Promise.resolve([]),
      needsKuwaitContacts ? loadMarketingContactsByCategory(m.orgId, "kuwait_distributor") : Promise.resolve([]),
      needsSelectedContacts ? loadMarketingSelectedContacts(m.orgId) : Promise.resolve([]),
      needsDirectory
        ? loadMarketingContactsPage(m.orgId, { query, category, includeArchived, page, pageSize: 50 })
        : Promise.resolve(EMPTY_DIRECTORY),
      needsExporterContactedCount ? loadMarketingContactedCount(m.orgId, "exporter") : Promise.resolve(0),
      needsDirectoryContactedCount ? loadMarketingContactedCount(m.orgId, "buyer_lead") : Promise.resolve(0),
      loadMarketingWorkspaceControlValues(m.orgId, activeArea.sourceId),
      loadMarketingWorkspaceAggregates(m.orgId),
    ]);
  const directoryActivity = needsDirectory
    ? await loadMarketingContactActivityForContacts(m.orgId, directoryPage.rows.map((contact) => contact.id))
    : [];
  const selectedActivity = needsSelectedContacts
    ? await loadMarketingContactActivityForContacts(m.orgId, selectedContacts.map((contact) => contact.id))
    : [];

  const data: MarketingWorkspaceData = {
    orgId: m.orgId,
    canWrite: true,
    canImport: m.role === "owner",
    dashboard,
    records: recordResult.rows,
    recordsPage: recordResult.page,
    recordsPages: recordResult.pages,
    sourceControlValues,
    aggregates,
    exporterContacts,
    kuwaitContacts,
    selectedContacts,
    selectedActivity,
    exporterContactedCount,
    directoryContactedCount,
    directory: {
      rows: directoryPage.rows,
      activity: directoryActivity,
      query,
      category,
      includeArchived,
      page: directoryPage.page,
      pages: directoryPage.pages,
      total: directoryPage.total,
    },
    templateDefaults: marketingTemplateDefaults(),
  };

  const tabs = MARKETING_AREA_BLUEPRINTS.map((area) => ({
    id: area.sourceId,
    label: area.label,
  }));

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-bold">مساحة عمل التسويق الكاملة</h1>
        <p style={{ color: "var(--ink-muted)" }}>
          كل أقسام ملف التسويق ٢٠٢٦ المصدر (٢٥ قسمًا)، بنفس الترتيب. كل تبويب يعرض أولًا النص والجداول
          الأصلية حرفيًا للمطابقة، ثم الأقسام الحيّة القابلة للتحرير. لا شيء يُحفظ في التخزين المحلي
          للمتصفح: أغلب البيانات القابلة للتحرير محفوظة في جداول <code>marketing_record</code>/
          <code>marketing_contact</code> و<code>marketing_contact_activity</code> المنظّمة، وهي نفس
          قاعدة الصفحات المختصرة الحالية ولا توجد نسخة موازية من بيانات الملف القديم.
        </p>
      </header>
      <MarketingAreaNav />
      <WorkspaceShell
        tabs={tabs}
        activeId={activeArea.sourceId}
        activePanel={<WorkspaceArea area={activeArea} data={data} />}
      />
    </div>
  );
}
