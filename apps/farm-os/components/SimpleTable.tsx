"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { DataTable, StatusPill, Tag } from "@/components/ui";
import { Code } from "@/components/Code";
import { egp, num } from "@/lib/money";
import { sortRows, type TableSortState } from "@/lib/table-sort";

// "money": the row carries the RAW number and this formats it (egp) for display, so the SAME table is
// extractable — ExportButton/exportToCsv then serialize the raw number (Excel SUM works) instead of a
// formatted "١٬٢٣٤ ج.م" string. (SPEC-0017 export contract; see lib/export-csv.ts.)
// "code": an LTR technical string (PR code, phone, ref) bidi-isolated for the RTL layout (F4). The
// raw string is still what exportToCsv serializes — the wrapper is display-only.
type CellKind = "text" | "num" | "money" | "status" | "tag-danger" | "tag-ok" | "tag-warn" | "link" | "code" | "bar";

export interface SimpleColumn {
  id: string;
  header: string;
  kind?: CellKind;
  numeric?: boolean;
  /** Defaults to true for plain cells and false for render-backed action/composite cells. */
  sortable?: boolean;
  /**
   * Escape hatch for interactive/composite cells (badges + inline actions) that the plain
   * kind-based text formatting below can't express — e.g. assignee badges with a per-item
   * remove button. When set, this REPLACES `renderCell` for the column entirely; the row's
   * `row[c.id]` value is not read (the renderer typically closes over external per-row data
   * instead), so `render`-backed columns are NOT part of exportToCsv's plain-value output.
   */
  render?: (row: SimpleRow) => ReactNode;
}

export interface SimpleRow {
  id: string;
  href?: string;
  [key: string]: string | number | undefined;
}

/**
 * Server-friendly table: pages pass plain serializable rows + a column spec, and
 * this client wrapper renders the @amrebeid/ui DataTable. Optional per-row href
 * makes the row clickable (client navigation).
 */
export function SimpleTable({
  columns,
  rows,
  caption,
  ariaLabel,
  empty,
  sort,
  onSortChange,
}: {
  columns: SimpleColumn[];
  rows: SimpleRow[];
  caption?: string;
  /**
   * Accessible name for the table when there is no visible `caption` (the usual case here — the page
   * `<h1>` already labels the screen). Forwarded to the underlying `<table aria-label>` so screen-reader
   * users hear what the table is without a visually-redundant caption. Pass the page/section heading text.
   */
  ariaLabel?: string;
  empty?: string;
  /** Controlled sort state. Omit for SimpleTable's own client-side sort state. */
  sort?: TableSortState | null;
  onSortChange?: (next: TableSortState) => void;
}) {
  const [internalSort, setInternalSort] = useState<TableSortState | null>(null);
  const activeSort = sort === undefined ? internalSort : sort;
  const sortableColumns = useMemo(
    () =>
      columns.filter((c) => c.sortable ?? !c.render).map((c) => ({
        id: c.id,
        numeric: c.numeric,
      })),
    [columns],
  );
  const sortedRows = useMemo(
    () => sortRows(rows, sortableColumns, activeSort),
    [rows, sortableColumns, activeSort],
  );

  function handleSortChange(next: TableSortState) {
    if (sort === undefined) setInternalSort(next);
    onSortChange?.(next);
  }

  return (
    <DataTable<SimpleRow>
      caption={caption}
      aria-label={ariaLabel}
      columns={columns.map((c, i) => ({
        id: c.id,
        header: c.header,
        numeric: c.numeric,
        sortable: c.sortable ?? !c.render,
        // Make the first cell a real <Link> when the row has an href. Restores
        // row→detail navigation and is keyboard/AT-accessible (a real anchor) —
        // the previous table-level onClick looked for a `tr[data-href]` that
        // DataTable never renders, so navigation was dead for everyone.
        cell: (row) =>
          i === 0 && row.href ? (
            <Link
              href={row.href}
              className="font-medium underline underline-offset-4"
              style={{ color: "var(--brand)" }}
            >
              {c.render ? c.render(row) : renderCell(c, row)}
            </Link>
          ) : c.render ? (
            c.render(row)
          ) : (
            renderCell(c, row)
          ),
      }))}
      rows={sortedRows}
      getRowId={(r) => r.id}
      sort={activeSort}
      onSortChange={handleSortChange}
      empty={empty ?? "لا توجد بيانات"}
    />
  );
}

function renderCell(c: SimpleColumn, row: SimpleRow): React.ReactNode {
  const v = row[c.id];
  if (v == null || v === "") return "—";
  switch (c.kind) {
    case "num":
      return num(Number(v));
    case "money":
      return egp(Number(v));
    case "status":
      return <StatusPill status={statusFor(String(v))}>{String(v)}</StatusPill>;
    case "tag-danger":
      return <Tag tone="danger">{String(v)}</Tag>;
    case "tag-ok":
      return <Tag tone="ok">{String(v)}</Tag>;
    case "tag-warn":
      return <Tag tone="warning">{String(v)}</Tag>;
    case "code":
      return <Code>{String(v)}</Code>;
    case "bar": {
      // Coverage bar (Stitch inventory): row[c.id] = fill percent 0–100 (number);
      // row[`${c.id}_tone`] = "ok" | "warn" | "danger" (defaults to ok).
      const fill = Math.max(0, Math.min(100, Number(v)));
      const tone = String(row[`${c.id}_tone`] ?? "ok");
      const color = tone === "danger" ? "var(--danger-fg)" : tone === "warn" ? "var(--warning-fg)" : "var(--success-fg)";
      return (
        <div className="flex items-center gap-2" style={{ minWidth: 96 }}>
          <div
            className="flex-1"
            style={{ height: 6, borderRadius: 999, background: "var(--surface-sunken)", overflow: "hidden" }}
            role="progressbar"
            aria-valuenow={Math.round(fill)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div style={{ width: `${fill}%`, height: "100%", background: color, borderRadius: 999 }} />
          </div>
          <span className="text-xs tabular-nums" style={{ color: "var(--ink-muted)" }}>
            {num(Math.round(fill))}٪
          </span>
        </div>
      );
    }
    case "link": {
      // Convention: the row carries the link target in `${c.id}_href` and the visible
      // label in `row[c.id]` (v). Falls back to plain text if no href was supplied.
      const href = row[`${c.id}_href`];
      return typeof href === "string" && href !== "" ? (
        <Link href={href} className="font-medium underline underline-offset-4" style={{ color: "var(--brand)" }}>
          {String(v)}
        </Link>
      ) : (
        String(v)
      );
    }
    default:
      return String(v);
  }
}

function statusFor(
  s: string,
): "draft" | "scheduled" | "active" | "done" | "warning" | "blocked" {
  switch (s) {
    case "done":
    case "معتمد":
    case "منفذ":
      return "done";
    case "reserved":
    case "محجوز":
    case "submitted":
    case "مرسل":
      return "scheduled";
    case "blocked":
    case "محظور":
    case "مرفوض":
      return "blocked";
    case "warn":
    case "منخفض":
    case "تحت حد إعادة الطلب":
      return "warning";
    case "active":
    case "planned":
    case "مخطط":
      return "active";
    case "فوق حد إعادة الطلب":
      return "done";
    default:
      return "draft";
  }
}
