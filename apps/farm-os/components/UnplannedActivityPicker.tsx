"use client";

// SPEC-0030 A4 — surface the ad-hoc activity recorder in the task-first flow. A supervisor who did UNPLANNED
// work previously had to hunt to a specific location's detail page to log it; here they pick the location and
// the existing RecordActivity recorder (fn_record_event, gated op.execute) mounts inline. Non-consuming field
// activities (inspection/note/operation) — material-consuming ops still go through a plan (#778 option a).

import { useState } from "react";
import { FormRow, Select, type SelectOption } from "@/components/ui";
import { RecordActivity } from "@/components/RecordActivity";

export function UnplannedActivityPicker({ sectors }: { sectors: { id: string; name: string }[] }) {
  const [sectorId, setSectorId] = useState("");
  const options: SelectOption[] = [
    { value: "", label: "— اختر القطاع —" },
    ...sectors.map((s) => ({ value: s.id, label: s.name })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <FormRow id="activity-sector" label="الموقع (القطاع الذي تمّ فيه النشاط)">
        <Select options={options} value={sectorId} onChange={(e) => setSectorId(e.target.value)} />
      </FormRow>

      {sectorId ? (
        <RecordActivity locationType="sector" locationId={sectorId} canRecord activities={[]} />
      ) : (
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          اختر القطاع الذي تمّ فيه النشاط لتسجيله. تظهر التفاصيل الكاملة (والسجل) في صفحة القطاع نفسه.
        </p>
      )}
    </div>
  );
}
