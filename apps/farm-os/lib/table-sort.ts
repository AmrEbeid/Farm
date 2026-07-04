export type TableSortDirection = "asc" | "desc";

export interface TableSortState {
  columnId: string;
  direction: TableSortDirection;
}

export interface SortableColumn {
  id: string;
  numeric?: boolean;
}

export type SortableRow = Record<string, string | number | null | undefined>;

const AR_COLLATOR = new Intl.Collator("ar", {
  numeric: true,
  sensitivity: "base",
});

function numericValue(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function compareValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  numeric: boolean,
): number {
  if (numeric) {
    const av = numericValue(a);
    const bv = numericValue(b);
    if (av != null && bv != null) return av - bv;
  }

  return AR_COLLATOR.compare(String(a), String(b));
}

export function sortRows<T extends SortableRow>(
  rows: T[],
  columns: SortableColumn[],
  sort: TableSortState | null,
): T[] {
  if (!sort) return rows;

  const column = columns.find((c) => c.id === sort.columnId);
  if (!column) return rows;

  const direction = sort.direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const av = a.row[column.id];
      const bv = b.row[column.id];
      const aEmpty = av == null || av === "";
      const bEmpty = bv == null || bv === "";
      if (aEmpty || bEmpty) {
        if (aEmpty && bEmpty) return a.index - b.index;
        return aEmpty ? 1 : -1;
      }
      const byValue =
        compareValues(av, bv, Boolean(column.numeric)) * direction;
      return byValue === 0 ? a.index - b.index : byValue;
    })
    .map((entry) => entry.row);
}
