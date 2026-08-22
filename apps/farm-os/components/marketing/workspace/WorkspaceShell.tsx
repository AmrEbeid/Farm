"use client";

import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

export interface WorkspacePanel {
  id: string;
  label: string;
}

/**
 * SPEC-0032 — URL-driven 25-tab shell. The server renders and queries only the active area; changing
 * tabs navigates to `?area=` so deep links, browser history, and bounded server queries all work.
 */
export function WorkspaceShell({
  tabs,
  activeId,
  activePanel,
}: {
  tabs: WorkspacePanel[];
  activeId: string;
  activePanel: ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function selectArea(area: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("area", area);
    next.delete("page");
    router.push(`?${next.toString()}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex items-center justify-between gap-3">
          <div className="overflow-x-auto">
            <Tabs
              ariaLabel="أقسام مساحة عمل التسويق (٢٥ قسمًا)"
              value={activeId}
              onChange={selectArea}
              items={tabs.map((p) => ({ id: p.id, label: p.label }))}
            />
          </div>
          <PrintButton label="طباعة هذا القسم" />
      </div>
      <div key={activeId}>{activePanel}</div>
    </div>
  );
}
