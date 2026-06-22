"use client";

import { useRouter } from "next/navigation";
import { DataTable, StatusPill, Tag } from "@/components/ui";

type CellKind = "text" | "num" | "status" | "tag-danger" | "tag-ok" | "tag-warn";

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
  empty,
}: {
  columns: SimpleColumn[];
  rows: SimpleRow[];
  caption?: string;
  empty?: string;
}) {
  const router = useRouter();

  return (
    <DataTable<SimpleRow>
      caption={caption}
      columns={columns.map((c) => ({
        id: c.id,
        header: c.header,
        numeric: c.numeric,
        cell: (row) => renderCell(c, row),
      }))}
      rows={rows}
      getRowId={(r) => r.id}
      empty={empty ?? "لا توجد بيانات"}
      onClick={(e) => {
        const tr = (e.target as HTMLElement).closest("tr[data-href]") as HTMLElement | null;
        if (tr?.dataset.href) router.push(tr.dataset.href);
      }}
    />
  );
}

function renderCell(c: SimpleColumn, row: SimpleRow): React.ReactNode {
  const v = row[c.id];
  if (v == null || v === "") return "—";
  switch (c.kind) {
    case "status":
      return <StatusPill status={statusFor(String(v))}>{String(v)}</StatusPill>;
    case "tag-danger":
      return <Tag tone="danger">{String(v)}</Tag>;
    case "tag-ok":
      return <Tag tone="ok">{String(v)}</Tag>;
    case "tag-warn":
      return <Tag tone="warning">{String(v)}</Tag>;
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
      return "warning";
    case "active":
    case "planned":
    case "مخطط":
      return "active";
    default:
      return "draft";
  }
}
