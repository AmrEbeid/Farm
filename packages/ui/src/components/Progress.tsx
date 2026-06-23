import * as React from "react";

export type ProgressTone = "default" | "warning" | "danger";

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0–100. Clamped. */
  value: number;
  /** Color tone — pair with a number/label nearby. */
  tone?: ProgressTone;
  /** Accessible label for the bar. */
  label?: string;
}

/** Linear progress bar for budget / plan completion. */
export function Progress({ value, tone = "default", label, className = "", ...rest }: ProgressProps) {
  // Guard non-finite values so aria-valuenow / width stay valid (NaN → 0).
  const pct = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div
      className={`fos-progress${tone !== "default" ? ` fos-progress--${tone}` : ""} ${className}`.trim()}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      {...rest}
    >
      <span className="fos-progress__bar" style={{ width: `${pct}%` }} />
    </div>
  );
}
