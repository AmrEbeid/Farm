import * as React from "react";

export type VerdictTone = "ok" | "warning" | "danger";

export interface VerdictBannerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** ok = covered/enough · warning = low/reorder soon · danger = shortage/over-budget. */
  tone?: VerdictTone;
  /** Optional leading icon (emoji or node). Defaults by tone. */
  icon?: React.ReactNode;
}

const DEFAULT_ICON: Record<VerdictTone, string> = { ok: "✅", warning: "⚠️", danger: "⛔" };

/**
 * Domain component: the one-line verdict from a stock-coverage or budget check
 * (e.g. "⛔ نقص حرج — الغطاء 4 أيام < مهلة 5 أيام. اطلب الآن").
 */
export function VerdictBanner({ tone = "ok", icon, children, className = "", ...rest }: VerdictBannerProps) {
  return (
    <div role="status" className={`fos-verdict fos-verdict--${tone} ${className}`.trim()} {...rest}>
      <span aria-hidden="true">{icon ?? DEFAULT_ICON[tone]}</span>
      <span>{children}</span>
    </div>
  );
}
