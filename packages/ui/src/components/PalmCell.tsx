import * as React from "react";

export type PalmStatus = "healthy" | "watch" | "sick" | "dead" | "removed" | "male";

export interface PalmCellProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  status: PalmStatus;
  ariaLabel: string;
  glyph?: React.ReactNode;
  selected?: boolean;
}

const STATUS_CLASS: Record<PalmStatus, string> = {
  healthy: "fos-palm--healthy",
  watch: "fos-palm--watch",
  sick: "fos-palm--sick",
  dead: "fos-palm--dead",
  removed: "fos-palm--removed",
  male: "fos-palm--male",
};

/**
 * Domain unit: a single palm cell in the grid map. A focusable button colored by
 * palm status (via role-token modifier class). The accessible label (status + position)
 * is consumer-supplied — the library holds no strings.
 */
export function PalmCell({
  status, ariaLabel, glyph, selected = false, className = "", type = "button", ...rest
}: PalmCellProps) {
  return (
    <button
      type={type}
      className={`fos-palm ${STATUS_CLASS[status]}${selected ? " fos-palm--selected" : ""} ${className}`.trim()}
      aria-label={ariaLabel}
      aria-pressed={selected || undefined}
      {...rest}
    >
      {glyph != null && <span aria-hidden="true">{glyph}</span>}
    </button>
  );
}
