"use client";

import Link from "next/link";
import { DataTable, StatusPill, Tag } from "@/components/ui";
import { egp } from "@/lib/money";

// "money": the row carries the RAW number and this formats it (egp) for display, so the SAME table is
// extractable — ExportButton/exportToCsv then serialize the raw number (Excel SUM works) instead of a
// formatted "١٬٢٣٤ ج.م" string. (SPEC-0017 export contract; see lib/export-csv.ts.)
type CellKind = "text" | "num" | "money" | "status" | "tag-danger" | "tag-ok" | "tag-warn" | "link";

export interface SimpleColumn {
  id: string;
  header: string;
  kind?: CellKind;
  numeric?: boolean;
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
}) {
  return (
    <DataTable<SimpleRow>
      caption={caption}
      aria-label={ariaLabel}
      columns={columns.map((c, i) => ({
        id: c.id,
        header: c.header,
        numeric: c.numeric,
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
              {renderCell(c, row)}
            </Link>
          ) : (
            renderCell(c, row)
          ),
      }))}
      rows={rows}
      getRowId={(r) => r.id}
      empty={empty ?? "لا توجد بيانات"}
    />
  );
}

function renderCell(c: SimpleColumn, row: SimpleRow): React.ReactNode {
  const v = row[c.id];
  if (v == null || v === "") return "—";
  switch (c.kind) {
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
