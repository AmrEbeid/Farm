import * as React from "react";

export interface KpiCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Metric label. */
  label: React.ReactNode;
  /** The main value (use the `unit` slot for the suffix). */
  value: React.ReactNode;
  /** Small unit/suffix shown after the value (e.g. "م ج.م"). */
  unit?: React.ReactNode;
  /** Optional leading icon (emoji or node). */
  icon?: React.ReactNode;
  /** Optional delta line under the value. */
  delta?: React.ReactNode;
  /** Direction of the delta — colors it green (up) or red (down). */
  deltaDirection?: "up" | "down" | "none";
}

/** Dashboard metric tile: label + icon, large tabular value, optional delta. */
export function KpiCard({
  label, value, unit, icon, delta, deltaDirection = "none", className = "", ...rest
}: KpiCardProps) {
  return (
    <div className={`fos-kpi ${className}`.trim()} {...rest}>
      <div className="fos-kpi__label">
        {icon != null && <span className="fos-kpi__icon" aria-hidden="true">{icon}</span>}
        {label}
      </div>
      <div className="fos-kpi__value">
        {value} {unit != null && <small>{unit}</small>}
      </div>
      {delta != null && (
        <div className={`fos-kpi__delta${deltaDirection !== "none" ? ` fos-kpi__delta--${deltaDirection}` : ""}`}>
          {delta}
        </div>
      )}
    </div>
  );
}
