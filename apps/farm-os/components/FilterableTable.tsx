"use client";

import { useId, useMemo, useState } from "react";
import { SimpleTable, type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { ExportButton } from "@/components/ExportButton";
import { filterRows } from "@/lib/filter";
import { num } from "@/lib/money";
import { sortRows, type TableSortState } from "@/lib/table-sort";

/**
 * Client wrapper that adds an Arabic search box + live result count over
 * SimpleTable. Filtering is purely client-side over the already-fetched rows
 * (the list pages select the full set, no server limit), so there is no extra
 * round-trip and no backend/query change. The search box only appears once a
 * list is long enough to warrant it (minRowsForSearch), keeping small/demo
 * lists uncluttered. RTL is inherited from the root <html dir="rtl">.
 */
export function FilterableTable({
  columns,
  rows,
  caption,
  ariaLabel,
  empty,
  searchColumns,
  placeholder = "بحث…",
  minRowsForSearch = 8,
  exportFilename,
}: {
  columns: SimpleColumn[];
  rows: SimpleRow[];
  caption?: string;
  /** Accessible name for the table (forwarded to SimpleTable → `<table aria-label>`). Pass the page heading. */
  ariaLabel?: string;
  empty?: string;
  /** Column ids to match against; defaults to every column. */
  searchColumns?: string[];
  placeholder?: string;
  /** Hide the search box until the list has at least this many rows. */
  minRowsForSearch?: number;
  /** When set, show a CSV Export button (SPEC-0017) that exports the CURRENT (filtered) view. */
  exportFilename?: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TableSortState | null>(null);
  const baseId = useId();
  const inputId = `${baseId}-q`;
  const resultsId = `${baseId}-results`;

  const cols = useMemo(
    () => searchColumns ?? columns.map((c) => c.id),
    [searchColumns, columns],
  );
  const filtered = useMemo(() => filterRows(rows, cols, query), [rows, cols, query]);
  const sortableColumns = useMemo(
    () =>
      columns.filter((c) => c.sortable ?? !c.render).map((c) => ({
        id: c.id,
        numeric: c.numeric,
      })),
    [columns],
  );

  // Search box appears once a list is long enough; export can appear for any length.
  const showSearch = rows.length >= minRowsForSearch;
  const visible = useMemo(
    () => sortRows(showSearch ? filtered : rows, sortableColumns, sort),
    [showSearch, filtered, rows, sortableColumns, sort],
  );
  const searching = showSearch && query.trim().length > 0;

  // Nothing extra to show → plain table (unchanged behavior for short, non-exportable lists).
  if (!showSearch && !exportFilename) {
    return (
      <SimpleTable
        columns={columns}
        rows={rows}
        caption={caption}
        ariaLabel={ariaLabel}
        empty={empty}
        sort={sort}
        onSortChange={setSort}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {showSearch && (
          <div role="search" className="flex flex-wrap items-center gap-3">
            <label htmlFor={inputId} className="sr-only">
              {placeholder}
            </label>
            <input
              id={inputId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              aria-controls={resultsId}
              className="w-full max-w-xs rounded-md px-3 py-2 text-sm"
              style={{
                border: "1px solid var(--line, rgba(0,0,0,0.15))",
                backgroundColor: "var(--surface, #fff)",
                color: "var(--ink, inherit)",
              }}
            />
            <span aria-live="polite" className="text-sm tabular-nums" style={{ color: "var(--ink-muted)" }}>
              {searching
                ? `${num(filtered.length)} من ${num(rows.length)} نتيجة`
                : `${num(rows.length)} عنصر`}
            </span>
          </div>
        )}
        {exportFilename && (
          <div className="ms-auto">
            <ExportButton rows={visible} columns={columns} filename={exportFilename} />
          </div>
        )}
      </div>
      <div id={resultsId}>
        <SimpleTable
          columns={columns}
          rows={visible}
          caption={caption}
          ariaLabel={ariaLabel}
          empty={searching ? "لا نتائج مطابقة للبحث" : empty}
          sort={sort}
          onSortChange={setSort}
        />
      </div>
    </div>
  );
}
