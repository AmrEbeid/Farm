import type { ReactNode } from "react";
import type { PillStatus } from "@amrebeid/ui";
import { StatusPill } from "@/components/ui";
import { PageHeader } from "@/components/PageHeader";

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
    <PageHeader
      title={title}
      subtitle={subtitle}
      metadata={pills.map((p, i) => (
        <StatusPill key={i} status={p.status}>
          {p.label}
        </StatusPill>
      ))}
      actions={actions}
    />
  );
}
