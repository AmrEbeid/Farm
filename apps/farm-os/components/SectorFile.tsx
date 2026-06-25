"use client";

import { useState } from "react";
import {
  Tabs,
  tabId,
  tabPanelId,
  Card,
  DescriptionList,
  FileTimeline,
  PalmGrid,
  EmptyState,
  type TimelineEvent,
  type PalmLine,
} from "@/components/ui";

export function SectorFile({
  name,
  meta,
  events,
  palmLines,
  overviewTitle = "بيانات القطاع",
}: {
  name: string;
  meta: { id: string; term: string; description: string }[];
  events: TimelineEvent[];
  palmLines: PalmLine[];
  /** Title of the overview card — defaults to the sector wording; the hawsha file passes its own. */
  overviewTitle?: string;
}) {
  const [tab, setTab] = useState("overview");

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={tab}
        onChange={setTab}
        ariaLabel={`ملف ${name}`}
        items={[
          { id: "overview", label: "نظرة عامة" },
          { id: "timeline", label: "السجل الزمني" },
          { id: "palms", label: "خريطة النخيل" },
        ]}
      />

      {tab === "overview" && (
        <div role="tabpanel" id={tabPanelId("overview")} aria-labelledby={tabId("overview")} tabIndex={0}>
          <Card title={overviewTitle}>
            <DescriptionList layout="inline" items={meta} />
          </Card>
        </div>
      )}

      {tab === "timeline" && (
        <div role="tabpanel" id={tabPanelId("timeline")} aria-labelledby={tabId("timeline")} tabIndex={0}>
          <Card title="سجل العمليات">
            {events.length === 0 ? (
              <EmptyState title="لا توجد عمليات مسجّلة بعد" />
            ) : (
              <FileTimeline events={events} ariaLabel={`السجل الزمني لـ ${name}`} />
            )}
          </Card>
        </div>
      )}

      {tab === "palms" && (
        <div role="tabpanel" id={tabPanelId("palms")} aria-labelledby={tabId("palms")} tabIndex={0}>
          <Card title="خريطة النخيل">
            {palmLines.length === 0 ? (
              <EmptyState title="لا توجد نخيل مسجّلة" />
            ) : (
              <PalmGrid lines={palmLines} ariaLabel={`خريطة نخيل ${name}`} />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
