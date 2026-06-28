"use client";

import { Button } from "@/components/ui";
import { rowsToCsv, type CsvColumn, type CsvRow } from "@/lib/export-csv";

/**
 * SPEC-0017 slice 1 — drop next to any SimpleTable to make it extractable:
 *   <ExportButton rows={rows} columns={columns} filename="purchase-requests" />
 * Exports only what's already on the page (RLS/role-gated server-side), so it leaks nothing beyond what
 * the user can already see. For sensitive tables, pass disabled={!canSee} to hide the affordance.
 */
export function ExportButton({
  rows,
  columns,
  filename = "export",
  label = "تصدير CSV",
  disabled,
}: {
  rows: CsvRow[];
  columns: CsvColumn[];
  filename?: string;
  label?: string;
  disabled?: boolean;
}) {
  function download() {
    const csv = rowsToCsv(rows, columns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Button variant="ghost" onClick={download} disabled={disabled || rows.length === 0}>
      {label}
    </Button>
  );
}
