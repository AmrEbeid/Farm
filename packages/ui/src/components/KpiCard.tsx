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
  /**
   * Delta VALENCE (not a literal trend): `"down"` = attention/concern (red + a ⚠ mark), `"up"` =
   * positive/active (green + a ✓ mark), `"none"` = neutral. The mark is the non-colour cue required by
   * WCAG 1.4.1 (use of colour) so the state is distinguishable without seeing red/green; it's
   * aria-hidden because the delta TEXT already carries the meaning for assistive tech. Named
   * `deltaDirection` for back-compat, but consumers already use it as valence (down=problem, up=ok).
   */
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
          {/* WCAG 1.4.1 non-colour cue. VALENCE glyph — NOT a directional arrow: "▼/▲" would falsely
              claim "decreased/increased" (e.g. a positive over-budget variance is coloured "down" for
              attention, where ▼ would be a lie). "⚠"/"✓" convey concern/positive without asserting a
              direction, so they read correctly whatever the delta value's sign. `︎` forces text
              (not emoji) rendering. aria-hidden: the delta text carries the meaning for AT. */}
          {deltaDirection !== "none" && (
            <span className="fos-kpi__delta-mark" aria-hidden="true">
              {deltaDirection === "down" ? "⚠︎" : "✓"}
            </span>
          )}
          {deltaDirection !== "none" ? " " : null}
          {delta}
        </div>
      )}
    </div>
  );
}
