"use client";

// SPEC-0030 / impeccable distill (P1): the owner dashboard's cross-module KPI hero was 6 equal cards, so the
// three the owner must see first (money · what needs a decision · plan readiness) had no visual priority.
// This shows the primary trio always and folds the rest behind «عرض كل المؤشرات» — progressive disclosure,
// nothing removed. Server Components pass their already-rendered KPI cards in as `primary`/`more`.

import { useState } from "react";
import { Button } from "@/components/ui";

export function ExpandableKpiHero({
  primary,
  more,
  moreCount,
}: {
  primary: React.ReactNode;
  more: React.ReactNode;
  moreCount: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">{primary}</div>
      {open && <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">{more}</div>}
      <Button
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="self-start"
      >
        {open ? "إخفاء المؤشرات الإضافية ↑" : `عرض كل المؤشرات (${moreCount} أخرى) ↓`}
      </Button>
    </section>
  );
}
