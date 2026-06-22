"use client";

import { useState } from "react";
import {
  Tabs,
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
}: {
  name: string;
  meta: { id: string; term: string; description: string }[];
  events: TimelineEvent[];
  palmLines: PalmLine[];
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
        <Card title="بيانات القطاع">
          <DescriptionList layout="inline" items={meta} />
        </Card>
      )}

      {tab === "timeline" && (
        <Card title="سجل العمليات">
          {events.length === 0 ? (
            <EmptyState title="لا توجد عمليات مسجّلة بعد" />
          ) : (
            <FileTimeline events={events} ariaLabel={`السجل الزمني لـ ${name}`} />
          )}
        </Card>
      )}

      {tab === "palms" && (
        <Card title="خريطة النخيل — حوشة 2">
          {palmLines.length === 0 ? (
            <EmptyState title="لا توجد نخيل مسجّلة" />
          ) : (
            <PalmGrid lines={palmLines} ariaLabel={`خريطة نخيل ${name}`} />
          )}
        </Card>
      )}
    </div>
  );
}
