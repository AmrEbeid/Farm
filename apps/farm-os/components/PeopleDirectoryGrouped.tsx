"use client";

import { useId, useMemo, useState } from "react";
import { SimpleTable, type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { ExportButton } from "@/components/ExportButton";
import { Tag } from "@/components/ui";
import { filterRows } from "@/lib/filter";
import { num } from "@/lib/money";

export interface PersonRow extends SimpleRow {
  /** Manager's person id this row is grouped under, or undefined for the "no manager" catch-all. */
  groupId: string | undefined;
}

export interface PersonGroup {
  /** Manager's person id, or undefined for the catch-all group. */
  id: string | undefined;
  /** Section header, e.g. "فريق السيد أبو أحمد" or "بدون مدير مباشر". */
  label: string;
}

/**
 * Team directory grouped one level by direct manager (`reports_to_person_id`), replacing the
 * previous flat list. Each manager's direct reports render under a collapsible "فريق <المدير>"
 * section (native <details> — no new interaction pattern, no accordion component exists yet in
 * @amrebeid/ui); people with no manager, INCLUDING top-level managers themselves, fall into the
 * "بدون مدير مباشر" catch-all. One-level only: a manager who also reports to someone else still
 * gets their own section header here, and separately appears as a row inside their own manager's
 * section — deliberately not nested, to keep this a display/grouping change rather than a full
 * org-chart rewrite (see PR description).
 *
 * Search/export are preserved but now operate across the whole (still-flat) row set, then the
 * matching rows are re-split into their groups — so filtering a name still surfaces it no matter
 * which section it lives in, matching the prior flat-list search behavior.
 */
export function PeopleDirectoryGrouped({
  columns,
  rows,
  groups,
  ariaLabel,
  empty,
  searchColumns,
  placeholder = "بحث…",
  minRowsForSearch = 8,
  exportFilename,
}: {
  columns: SimpleColumn[];
  rows: PersonRow[];
  groups: PersonGroup[];
  ariaLabel?: string;
  empty?: string;
  searchColumns?: string[];
  placeholder?: string;
  minRowsForSearch?: number;
  exportFilename?: string;
}) {
  const [query, setQuery] = useState("");
  const baseId = useId();
  const inputId = `${baseId}-q`;
  const resultsId = `${baseId}-results`;

  const cols = useMemo(() => searchColumns ?? columns.map((c) => c.id), [searchColumns, columns]);
  const filtered = useMemo(() => filterRows(rows, cols, query), [rows, cols, query]);

  const showSearch = rows.length >= minRowsForSearch;
  const visible = showSearch ? filtered : rows;
  const searching = showSearch && query.trim().length > 0;

  const rowsByGroup = useMemo(() => {
    const map = new Map<string | undefined, PersonRow[]>();
    for (const row of visible) {
      const key = row.groupId;
      const list = map.get(key);
      if (list) list.push(row);
      else map.set(key, [row]);
    }
    return map;
  }, [visible]);

  const visibleGroups = groups.filter((g) => (rowsByGroup.get(g.id) ?? []).length > 0);

  return (
    <div className="flex flex-col gap-4">
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
                border: "1px solid var(--border, rgba(0,0,0,0.15))",
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

      <div id={resultsId} className="flex flex-col gap-3">
        {visibleGroups.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            {searching ? "لا نتائج مطابقة للبحث" : empty ?? "لا يوجد عاملون مسجّلون"}
          </p>
        ) : (
          visibleGroups.map((group) => {
            const groupRows = rowsByGroup.get(group.id) ?? [];
            return (
              <details key={group.id ?? "no-manager"} open className="fos-card" data-group-id={group.id ?? "no-manager"}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                  <span className="fos-card__title">{group.label}</span>
                  <Tag tone="neutral">{num(groupRows.length)} عضو</Tag>
                </summary>
                <div className="mt-3">
                  <SimpleTable
                    columns={columns}
                    rows={groupRows}
                    ariaLabel={`${ariaLabel ?? "الفريق"} - ${group.label}`}
                    empty={empty}
                  />
                </div>
              </details>
            );
          })
        )}
      </div>
    </div>
  );
}
