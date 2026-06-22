import * as React from "react";

export type StatTrend = "up" | "down" | "flat";

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Metric label. */
  label: React.ReactNode;
  /** The main value (use the `unit` slot for the suffix). */
  value: React.ReactNode;
  /** Small unit/suffix shown after the value (e.g. "كجم"). */
  unit?: React.ReactNode;
  /** Optional caption shown under the value. */
  help?: React.ReactNode;
  /** Direction of the change — colors the change line. */
  trend?: StatTrend;
  /** Optional change line (e.g. "+٨٪"); colored by `trend`. */
  change?: React.ReactNode;
}

/** Inline metric: label, large tabular value + unit, optional trend change line and help caption. */
export function Stat({
  label, value, unit, help, trend = "flat", change, className = "", ...rest
}: StatProps) {
  return (
    <div className={`fos-stat ${className}`.trim()} {...rest}>
      <div className="fos-stat__label">{label}</div>
      <div className="fos-stat__value">
        {value}
        {unit != null && <small className="fos-stat__unit">{unit}</small>}
      </div>
      {change != null && (
        <div className={`fos-stat__change fos-stat__change--${trend}`}>{change}</div>
      )}
      {help != null && <div className="fos-stat__help">{help}</div>}
    </div>
  );
}
