"use client";

import { Button } from "@/components/ui";

export function PrintButton({ label = "طباعة التقرير" }: { label?: string }) {
  return (
    <span className="no-print">
      <Button variant="ghost" onClick={() => window.print()}>
        {label}
      </Button>
    </span>
  );
}
