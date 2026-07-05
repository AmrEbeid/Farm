import type { ReactNode } from "react";
import { SimpleTableClient } from "@/components/SimpleTableClient";
export type { SimpleColumn, SimpleRow } from "@/components/SimpleTableClient";
import type { SimpleColumn, SimpleRow } from "@/components/SimpleTableClient";

export function SimpleTable({
  columns,
  rows,
  caption,
  ariaLabel,
  empty,
}: {
  columns: SimpleColumn[];
  rows: SimpleRow[];
  caption?: string;
  ariaLabel?: string;
  empty?: string;
}) {
  const renderedCells: Record<string, Record<string, ReactNode>> = {};
  const clientColumns = columns.map(({ render, ...column }) => {
    if (!render) return column;

    for (const row of rows) {
      renderedCells[row.id] ??= {};
      renderedCells[row.id][column.id] = render(row);
    }

    return {
      ...column,
      sortable: column.sortable ?? false,
    };
  });

  return (
    <SimpleTableClient
      columns={clientColumns}
      rows={rows}
      caption={caption}
      ariaLabel={ariaLabel}
      empty={empty}
      renderedCells={renderedCells}
    />
  );
}
