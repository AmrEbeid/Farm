import type { ReactNode } from "react";
import type { PillStatus } from "@amrebeid/ui";
import { StatusPill } from "@/components/ui";

export interface Entity360Pill {
  status: PillStatus;
  label: ReactNode;
}

/**
 * Identity header for an entity 360 page: title + optional subtitle/ID line,
 * a row of semantic status pills, and a quick-actions slot. Presentational and
 * server-rendered — pills carry meaning (status), never decoration.
 */
export function Entity360Header({
  title,
  subtitle,
  pills = [],
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  pills?: Entity360Pill[];
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{title}</h1>
          {pills.map((p, i) => (
            <StatusPill key={i} status={p.status}>
              {p.label}
            </StatusPill>
          ))}
        </div>
        {subtitle != null && <p style={{ color: "var(--ink-muted)" }}>{subtitle}</p>}
      </div>
      {actions != null && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}
