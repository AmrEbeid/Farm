"use client";

import { Button } from "@/components/ui";

export function PrintButton({ label = "طباعة التقرير" }: { label?: string }) {
  return (
    <span className="no-print">
      <Button variant="ghost" style={{ minHeight: 44 }} onClick={() => window.print()}>
        {label}
      </Button>
    </span>
  );
}
