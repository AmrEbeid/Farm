"use client";

// impeccable distill (P0): the owner dashboard's left column stacked five heavy sections into a long scroll
// (the PR table was last and easy to miss). This groups the DETAIL sections under three tabs — المالية /
// الوحدات / المشتريات — so the owner picks a view instead of scrolling past everything. The at-a-glance layer
// (trimmed KPI hero + the alerts sidebar) stays OUTSIDE the tabs, always visible, so problem-spotting is
// preserved. Nothing is removed — every section still renders, just grouped. Server Components pass their
// already-rendered section trees in as `finance`/`modules`/`purchasing`. Only the active panel mounts (keeps
// the heavy charts out of the DOM until their tab is opened).

import { useState } from "react";
import { Tabs, tabId, tabPanelId, type TabItem } from "@amrebeid/ui";

const ITEMS: TabItem[] = [
  { id: "finance", label: "المالية" },
  { id: "modules", label: "الوحدات" },
  { id: "purchasing", label: "الموازنة والمشتريات" },
];

export function DashboardTabs({
  finance,
  modules,
  purchasing,
}: {
  finance: React.ReactNode;
  modules: React.ReactNode;
  purchasing: React.ReactNode;
}) {
  const [value, setValue] = useState("finance");
  const panels: Record<string, React.ReactNode> = { finance, modules, purchasing };
  return (
    <div className="flex flex-col gap-4">
      <Tabs items={ITEMS} value={value} onChange={setValue} ariaLabel="أقسام لوحة المالك" />
      <div
        role="tabpanel"
        id={tabPanelId(value)}
        aria-labelledby={tabId(value)}
        tabIndex={0}
        className="flex flex-col gap-6"
      >
        {panels[value]}
      </div>
    </div>
  );
}
