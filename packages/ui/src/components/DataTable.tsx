import * as React from "react";

export type SortDirection = "asc" | "desc";

export interface SortState {
  /** Active sorted column id. */ columnId: string;
  /** Sort direction. */ direction: SortDirection;
}

export interface DataTableColumn<Row> {
  /** Stable column id (matches `SortState.columnId`). */
  id: string;
  /** Header content. */
  header: React.ReactNode;
  /** Cell renderer for a row. */
  cell: (row: Row) => React.ReactNode;
  /** Whether this column is sortable. */
  sortable?: boolean;
  /** Logical alignment of the cell content. */
  align?: "start" | "center" | "end";
  /** Numeric column — applies tabular-nums + end alignment by default. */
  numeric?: boolean;
  /** Optional fixed width (any CSS length). */
  width?: string;
}

export interface DataTableProps<Row>
  extends Omit<React.TableHTMLAttributes<HTMLTableElement>, "children"> {
  /** Column definitions. */
  columns: DataTableColumn<Row>[];
  /** Row data. */
  rows: Row[];
  /** Stable id per row (used as the React key). */
  getRowId: (row: Row) => string;
  /** Accessible caption / table name. */
  caption?: React.ReactNode;
  /** Controlled sort state (or null for unsorted). */
  sort?: SortState | null;
  /** Called with the next sort state when a sortable header is activated. */
  onSortChange?: (next: SortState) => void;
  /** Sticky header on vertical scroll. */
  stickyHeader?: boolean;
  /** Content shown (spanning all columns) when `rows` is empty. */
  empty?: React.ReactNode;
  /**
   * Narrow-screen behaviour (below ~48rem):
   * - `"cards"` (default): the table reflows into one stacked card per row,
   *   each cell shown as a `label: value` pair. The desktop table is unchanged.
   * - `"scroll"`: legacy behaviour — the wide table horizontal-scrolls.
   */
  reflow?: "cards" | "scroll";
}

/**
 * Per-cell mobile label. Only string/number headers can become a CSS
 * `::before` label; richer headers are skipped (the cell value still renders).
 */
function cellLabel(header: React.ReactNode): string | undefined {
  return typeof header === "string" || typeof header === "number"
    ? String(header)
    : undefined;
}

const ARIA_SORT: Record<SortDirection, "ascending" | "descending"> = {
  asc: "ascending",
  desc: "descending",
};

/**
 * Generic, controlled-sort data table. RTL-first, sticky header optional,
 * numeric columns are tabular-nums. Sortable headers are keyboard-operable
 * buttons carrying `aria-sort`.
 */
export function DataTable<Row>({
  columns, rows, getRowId, caption, sort = null, onSortChange,
  stickyHeader = false, empty, reflow = "cards", className = "", ...rest
}: DataTableProps<Row>) {
  function toggle(columnId: string) {
    if (!onSortChange) return;
    const next: SortState =
      sort && sort.columnId === columnId
        ? { columnId, direction: sort.direction === "asc" ? "desc" : "asc" }
        : { columnId, direction: "asc" };
    onSortChange(next);
  }

  return (
    <div
      className={`fos-table-wrap${stickyHeader ? " fos-table-wrap--sticky" : ""}${reflow === "cards" ? " fos-table-wrap--reflow" : ""} ${className}`.trim()}
    >
      <table className="fos-table" {...rest}>
        {caption != null && <caption className="fos-table__caption">{caption}</caption>}
        <thead className="fos-table__head">
          <tr>
            {columns.map((col) => {
              const active = sort?.columnId === col.id;
              const align = col.align ?? (col.numeric ? "end" : "start");
              return (
                <th
                  key={col.id}
                  scope="col"
                  className={`fos-table__th fos-table__th--${align}`}
                  style={col.width ? { width: col.width } : undefined}
                  aria-sort={col.sortable ? (active ? ARIA_SORT[sort!.direction] : "none") : undefined}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      className="fos-table__sort"
                      onClick={() => toggle(col.id)}
                    >
                      {col.header}
                      <span className="fos-table__sort-icon" aria-hidden="true">
                        {active ? (sort!.direction === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="fos-table__empty" colSpan={columns.length}>{empty}</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={getRowId(row)} className="fos-table__row">
                {columns.map((col) => {
                  const align = col.align ?? (col.numeric ? "end" : "start");
                  return (
                    <td
                      key={col.id}
                      className={`fos-table__td fos-table__td--${align}${col.numeric ? " fos-table__td--num" : ""}`}
                      data-label={cellLabel(col.header)}
                    >
                      {col.cell(row)}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
