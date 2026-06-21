import * as React from "react";

export type ButtonVariant = "primary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. `primary` = main action, `ghost` = secondary, `danger` = destructive/reject. */
  variant?: ButtonVariant;
  /** Control size. */
  size?: ButtonSize;
  /** Shows a spinner and disables interaction; the label is kept. */
  loading?: boolean;
  /** Optional leading icon (emoji or node). */
  icon?: React.ReactNode;
}

/**
 * Primary interactive control. Use one `primary` button per view.
 * A `disabled` button is also how the UI expresses a permission the role lacks
 * (e.g. a non-owner sees Approve disabled).
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, icon, disabled, children, className = "", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={`fos-btn fos-btn--${variant} fos-btn--${size} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="fos-btn__spinner" aria-hidden="true" />}
      {!loading && icon}
      {children}
    </button>
  );
});
