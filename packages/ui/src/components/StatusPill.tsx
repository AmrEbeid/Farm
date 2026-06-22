import * as React from "react";

export type PillStatus = "draft" | "scheduled" | "active" | "done" | "warning" | "blocked";

export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: PillStatus;
  dot?: boolean;
}

const STATUS_CLASS: Record<PillStatus, string> = {
  draft: "fos-pill--draft",
  scheduled: "fos-pill--scheduled",
  active: "fos-pill--active",
  done: "fos-pill--done",
  warning: "fos-pill--warning",
  blocked: "fos-pill--blocked",
};

/**
 * Domain status indicator (Farm-OS status set). Tone is semantic, never decorative —
 * the consumer-supplied label must carry the meaning too.
 */
export function StatusPill({ status, dot = true, children, className = "", ...rest }: StatusPillProps) {
  return (
    <span className={`fos-pill ${STATUS_CLASS[status]} ${className}`.trim()} {...rest}>
      {dot && <span className="fos-pill__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
