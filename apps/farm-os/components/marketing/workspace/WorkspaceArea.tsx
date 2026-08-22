import Link from "next/link";
import { MarketingRecordTable } from "@/components/marketing/MarketingRecordTable";
import { MarketingContactTable } from "@/components/marketing/MarketingContactTable";
import { SourceStagingPreview } from "@/components/marketing/SourceStagingPreview";
import { contactOptions } from "@/lib/marketing/queries";
import { MARKETING_TEMPLATES, type MarketingAreaBlueprint } from "@/lib/marketing/fidelity-manifest";
import { WORKSPACE_RECORD_SECTIONS } from "@/lib/marketing/workspace/section-config";
import { CAMPAIGN_TASKS, PLATFORM_TASKS } from "@/lib/marketing/source-pack";
import { MARKETING_WORKSPACE_CONTENT } from "@/lib/marketing/workspace/content.generated";
import { tabPanelId, tabId } from "@/lib/tab-ids";
import { SourceContentRenderer } from "./SourceContentRenderer";
import { WorkspaceKpiPanel } from "./WorkspaceKpiPanel";
import { WorkspaceGuidePanel } from "./WorkspaceGuidePanel";
import { WorkspaceReadonlyStatePanel } from "./WorkspaceReadonlyStatePanel";
import { WorkspaceTemplatesPanel } from "./WorkspaceTemplatesPanel";
import { WorkspaceChecklistPanel } from "./WorkspaceChecklistPanel";
import { WorkspaceCalculatorPanel } from "./WorkspaceCalculatorPanel";
import { WorkspaceOutboxPanel } from "./WorkspaceOutboxPanel";
import { WorkspaceCategoryContactsPanel } from "./WorkspaceCategoryContactsPanel";
import { DailySalesReportPanel } from "./DailySalesReportPanel";
import type { MarketingWorkspaceData } from "./workspace-data";
import { num } from "@/lib/money";

const SOURCE_CONTENT_BY_AREA = new Map(MARKETING_WORKSPACE_CONTENT.map((a) => [a.id, a]));

const CHECKLIST_DEFAULTS: Record<string, readonly string[]> = {
  daily_campaign: CAMPAIGN_TASKS,
  platform_readiness: PLATFORM_TASKS,
};

/** SPEC-0032 — dispatches every section of one area blueprint to the component its `kind` needs. */
export function WorkspaceArea({ area, data }: { area: MarketingAreaBlueprint; data: MarketingWorkspaceData }) {
  const exporterOptions = contactOptions(data.exporterContacts);
  const kuwaitOptions = contactOptions(data.kuwaitContacts);
  const sourceContent = SOURCE_CONTENT_BY_AREA.get(area.sourceId);

  return (
    <div role="tabpanel" id={tabPanelId(area.sourceId)} aria-labelledby={tabId(area.sourceId)} tabIndex={0} className="flex flex-col gap-4">
      <header>
        <h2 className="text-lg font-bold">{area.label}</h2>
        <p style={{ color: "var(--ink-muted)" }}>{area.summary}</p>
      </header>
      {sourceContent && (
        <SourceContentRenderer
          area={sourceContent}
          orgId={data.orgId}
          canWrite={data.canWrite}
          values={data.sourceControlValues}
        />
      )}
      <div id={`source-live-${area.sourceId}`} className="flex flex-col gap-4">
      {area.sections.map((section) => {
        switch (section.kind) {
          case "kpi":
            return <WorkspaceKpiPanel key={section.id} snapshot={data.dashboard} />;

          case "guide": {
            if (section.stateKeys.includes("ep_owner_whatsapp")) {
              return (
                <WorkspaceReadonlyStatePanel
                  key={section.id}
                  title={section.title}
                  description={section.description}
                  points={section.points ?? []}
                  link={{ href: "/website", label: "افتح /website" }}
                  statusLabel="رقم واتساب المالك يُدار من صفحة الموقع، وليس من نسخة داخل مساحة التسويق."
                />
              );
            }
            if (section.stateKeys.includes("ep_harvest_log")) {
              return (
                <WorkspaceReadonlyStatePanel
                  key={section.id}
                  title={section.title}
                  description={section.description}
                  points={section.points ?? []}
                  link={{ href: "/harvest", label: "افتح /harvest" }}
                  statusLabel="سجل الحصاد الحقيقي يُدار من صفحة الحصاد، وليس من نسخة داخل مساحة التسويق."
                />
              );
            }
            return (
              <WorkspaceGuidePanel key={section.id} title={section.title} description={section.description} points={section.points ?? []} />
            );
          }

          case "records":
          case "reference": {
            if (section.id === "daily-reports") {
              return (
                <DailySalesReportPanel
                  key={section.id}
                  orgId={data.orgId}
                  canWrite={data.canWrite}
                  rows={data.records}
                  sectorLedger={data.aggregates.dailySectorLedger}
                />
              );
            }
            const config = WORKSPACE_RECORD_SECTIONS[section.id];
            if (!config) return null;
            const rows = data.records.filter((r) => r.recordType === config.recordType && (!config.filter || config.filter(r)));
            const contacts = config.contactCategory === "exporter" ? exporterOptions : config.contactCategory === "kuwait_distributor" ? kuwaitOptions : undefined;
            return (
              <MarketingRecordTable
                key={section.id}
                sectionId={section.id}
                recordType={config.recordType}
                orgId={data.orgId}
                title={section.title}
                description={section.description}
                fields={config.fields}
                hasAmount={config.hasAmount}
                amountLabel={config.amountLabel}
                hasStatus={config.hasStatus}
                statusOptions={config.statusOptions}
                fixedPayload={config.fixedPayload}
                contacts={contacts}
                rows={rows}
                canWrite={data.canWrite}
                addLabel={config.addLabel}
                empty={config.empty}
                exportFilename={`marketing-${section.id}`}
              />
            );
          }

          case "contacts": {
            if (section.contactCategory === "buyer_lead") {
              return (
                <div key={section.id} id={section.id}>
                  <MarketingContactTable
                    orgId={data.orgId}
                    rows={data.directory.rows}
                    activity={data.directory.activity}
                    canWrite={data.canWrite}
                    query={data.directory.query}
                    category={data.directory.category}
                    includeArchived={data.directory.includeArchived}
                    page={data.directory.page}
                    pages={data.directory.pages}
                    total={data.directory.total}
                    basePath="/marketing/workspace"
                    hash={section.id}
                    fixedParams={{ area: area.sourceId }}
                  />
                </div>
              );
            }
            const rows = section.contactCategory === "kuwait_distributor" ? data.kuwaitContacts : data.exporterContacts;
            return (
              <div key={section.id} id={section.id}>
                <WorkspaceCategoryContactsPanel
                  title={section.title}
                  description={section.description}
                  category={section.contactCategory ?? "other"}
                  rows={rows}
                  orgId={data.orgId}
                  canWrite={data.canWrite}
                  exportFilename={`marketing-${section.id}`}
                />
              </div>
            );
          }

          case "templates": {
            const templates = MARKETING_TEMPLATES.filter((t) => (section.templateIds ?? []).includes(t.id));
            const savedRows = data.records.filter((r) => r.recordType === "message_template" && templates.some((t) => t.id === r.payload.templateId));
            return (
              <WorkspaceTemplatesPanel
                key={section.id}
                title={section.title}
                description={section.description}
                templates={templates}
                defaults={data.templateDefaults}
                savedRows={savedRows}
                orgId={data.orgId}
                canWrite={data.canWrite}
                exportFilename={`marketing-${section.id}`}
              />
            );
          }

          case "checklist": {
            const group = section.payloadKind ?? "";
            const rows = data.records.filter((r) => r.recordType === "task" && r.payload.group === group);
            return (
              <WorkspaceChecklistPanel
                key={section.id}
                title={section.title}
                description={section.description}
                group={group}
                defaultTitles={CHECKLIST_DEFAULTS[group] ?? []}
                rows={rows}
                orgId={data.orgId}
                canWrite={data.canWrite}
                exportFilename={`marketing-${section.id}`}
              />
            );
          }

          case "calculator": {
            if (!section.calculatorId) return null;
            if (section.calculatorId === "campaign-funnel") {
              return (
                <WorkspaceCalculatorPanel
                  key={section.id}
                  title={section.title}
                  description={section.description}
                  calculatorId="campaign-funnel"
                  funnelCounts={{
                    exportersContacted: data.exporterContactedCount,
                    directoryContacted: data.directoryContactedCount,
                    linkedinLeads: data.dashboard.recordsByType.lead_linkedin ?? 0,
                    exwBids: data.dashboard.recordsByType.exw_bid ?? 0,
                    brokersContacted: data.dashboard.recordsByType.broker_state ?? 0,
                    offshootLeads: data.dashboard.recordsByType.lead_offshoot ?? 0,
                    localLeads: data.dashboard.recordsByType.lead_local ?? 0,
                    dailySalesReportDays: data.dashboard.recordsByType.daily_sales_report ?? 0,
                  }}
                />
              );
            }
            if (section.calculatorId === "availability-mix") {
              return (
                <WorkspaceCalculatorPanel
                  key={section.id}
                  title={section.title}
                  description={section.description}
                  calculatorId="availability-mix"
                  weeklyAvailabilitySummary={data.aggregates.weeklyAvailability}
                />
              );
            }
            return (
              <WorkspaceCalculatorPanel key={section.id} title={section.title} description={section.description} calculatorId={section.calculatorId} />
            );
          }

          case "outbox": {
            const gmailSettings = data.records.find((r) => r.recordType === "market_reference" && r.payload.kind === "compose_settings");
            const subject = typeof gmailSettings?.payload.subject === "string" ? gmailSettings.payload.subject : "متابعة تصدير بلح عبيد";
            const templateId = typeof gmailSettings?.payload.templateId === "string" ? gmailSettings.payload.templateId : "mailTemplate";
            const savedTemplate = data.records.find((r) => r.recordType === "message_template" && r.payload.templateId === templateId);
            const messageBody = typeof savedTemplate?.payload.body === "string" ? savedTemplate.payload.body : (data.templateDefaults[templateId] ?? "");
            return (
              <WorkspaceOutboxPanel
                key={section.id}
                contacts={data.selectedContacts}
                activity={data.selectedActivity}
                messageBody={messageBody}
                subject={subject}
              />
            );
          }

          case "import":
            return (
              <div key={section.id} id={section.id}>
                <SourceStagingPreview canImport={data.canImport} />
              </div>
            );

          default:
            return null;
        }
      })}
      </div>
      {data.recordsPages > 1 && (
        <nav aria-label="صفحات سجلات التسويق" className="no-print flex items-center justify-between gap-3">
          {data.recordsPage > 1 ? (
            <Link className="fos-btn fos-btn--ghost" href={`/marketing/workspace?area=${encodeURIComponent(area.sourceId)}&recordsPage=${data.recordsPage - 1}`}>
              السابق
            </Link>
          ) : <span />}
          <span className="text-sm">{num(data.recordsPage)} / {num(data.recordsPages)}</span>
          {data.recordsPage < data.recordsPages ? (
            <Link className="fos-btn fos-btn--ghost" href={`/marketing/workspace?area=${encodeURIComponent(area.sourceId)}&recordsPage=${data.recordsPage + 1}`}>
              التالي
            </Link>
          ) : <span />}
        </nav>
      )}
    </div>
  );
}
