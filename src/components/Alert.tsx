import * as React from "react";

export type AlertTone = "ok" | "info" | "warning" | "danger";

export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Severity. `danger` announces assertively to screen readers. */
  tone?: AlertTone;
  /** Bold title line. */
  title: React.ReactNode;
  /** Optional muted description. */
  description?: React.ReactNode;
  /** Optional leading icon (emoji or node). */
  icon?: React.ReactNode;
}

/** Inline message / alert used in dashboards and the notifications drawer. */
export function Alert({ tone = "info", title, description, icon, className = "", ...rest }: AlertProps) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={`fos-alert fos-alert--${tone} ${className}`.trim()}
      {...rest}
    >
      {icon != null && <span className="fos-alert__icon" aria-hidden="true">{icon}</span>}
      <div>
        <div className="fos-alert__title">{title}</div>
        {description != null && <div className="fos-alert__desc">{description}</div>}
      </div>
    </div>
  );
}
