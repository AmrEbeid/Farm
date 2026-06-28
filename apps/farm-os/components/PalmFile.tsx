"use client";

import { useState } from "react";
import {
  Card,
  DescriptionList,
  FileTimeline,
  EmptyState,
  Tabs,
  tabId,
  tabPanelId,
  type TimelineEvent,
} from "@/components/ui";
import { PalmStatusForm } from "@/components/PalmStatusForm";
import { StructureForm } from "@/components/StructureForm";
import { StructureArchiveButton } from "@/components/StructureArchiveButton";
import { MediaGallery } from "@/components/MediaGallery";
import { RecordActivity, type ActivityItem } from "@/components/RecordActivity";

type MetaItem = { id: string; term: string; description: string };
type PalmAsset = {
  id: string;
  status: string | null;
  name: string | null;
  variety: string | null;
  sex: string | null;
  id_tag: string | null;
  planting_date: string | null;
  health_status: string | null;
  hawsha_id: string | null;
  line_id: string | null;
  archived: boolean;
};

/**
 * Entity-360 for a palm (SPEC-0017) — mirrors components/SectorFile.tsx's tabbed file pattern using the
 * existing @amrebeid/ui Tabs. Same data + forms as the old flat page, reorganized into Overview /
 * Status-history / Activity tabs. Tabs are controlled (useState), so this is a client component fed by
 * the server page. No data/logic/RPC change — purely presentational.
 */
export function PalmFile({
  label,
  meta,
  timeline,
  activities,
  canEdit,
  canEditStructure,
  asset,
  orgId,
  hawshaRedirect,
  attachments,
}: {
  label: string;
  meta: MetaItem[];
  timeline: TimelineEvent[];
  activities: ActivityItem[];
  canEdit: boolean;
  canEditStructure: boolean;
  asset: PalmAsset;
  orgId: string;
  hawshaRedirect: string;
  attachments: React.ComponentProps<typeof MediaGallery>["initial"];
}) {
  const [tab, setTab] = useState("overview");
  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={tab}
        onChange={setTab}
        ariaLabel={`ملف ${label}`}
        items={[
          { id: "overview", label: "نظرة عامة" },
          { id: "status", label: "سجل الحالة" },
          { id: "activity", label: "الأنشطة والمرفقات" },
        ]}
      />

      {tab === "overview" && (
        <div role="tabpanel" id={tabPanelId("overview")} aria-labelledby={tabId("overview")} tabIndex={0} className="flex flex-col gap-6">
          <Card title="بيانات النخلة">
            <DescriptionList layout="inline" items={meta} />
          </Card>
          {canEditStructure && (
            <Card title="إدارة النخلة">
              <div className="flex flex-col gap-3">
                <StructureForm
                  level="palm"
                  mode="edit"
                  context={{ hawshaId: asset.hawsha_id ?? undefined, lineId: asset.line_id ?? undefined }}
                  initial={{
                    id: asset.id,
                    name: asset.name,
                    variety: asset.variety,
                    sex: asset.sex,
                    idTag: asset.id_tag,
                    plantingDate: asset.planting_date,
                    healthStatus: asset.health_status,
                  }}
                  triggerLabel="تعديل بيانات النخلة"
                />
                <StructureArchiveButton type="palm" id={asset.id} archived={!!asset.archived} redirectTo={hawshaRedirect} />
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === "status" && (
        <div role="tabpanel" id={tabPanelId("status")} aria-labelledby={tabId("status")} tabIndex={0} className="flex flex-col gap-6">
          <Card title="سجل الحالة">
            {timeline.length === 0 ? (
              <EmptyState title="لا يوجد سجل حالة لهذه النخلة بعد" />
            ) : (
              <FileTimeline events={timeline} ariaLabel={`سجل حالة ${label}`} />
            )}
          </Card>
          {canEdit && (
            <Card title="تحديث حالة النخلة">
              <PalmStatusForm assetId={asset.id} currentStatus={asset.status ?? "active"} />
            </Card>
          )}
        </div>
      )}

      {tab === "activity" && (
        <div role="tabpanel" id={tabPanelId("activity")} aria-labelledby={tabId("activity")} tabIndex={0} className="flex flex-col gap-6">
          <RecordActivity locationType="palm" locationId={asset.id} canRecord={canEdit} activities={activities} />
          <MediaGallery entityType="palm" entityId={asset.id} orgId={orgId} initial={attachments} canAttach={canEdit} />
        </div>
      )}
    </div>
  );
}
