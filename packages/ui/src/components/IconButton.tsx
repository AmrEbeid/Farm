import * as React from "react";

export type IconButtonVariant = "primary" | "ghost" | "danger";
export type IconButtonSize = "md" | "sm";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — required because the visible content is an icon only. */
  label: string;
  /** Visual style. */
  variant?: IconButtonVariant;
  /** Control size. */
  size?: IconButtonSize;
  /** Shows a spinner and disables interaction. */
  loading?: boolean;
  /** The icon (emoji or node). */
  children: React.ReactNode;
}

/** Square, icon-only button. `label` provides the accessible name (aria-label). */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = "ghost", size = "md", loading = false, disabled, children, className = "", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`fos-iconbtn fos-iconbtn--${variant} fos-iconbtn--${size} ${className}`.trim()}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="fos-iconbtn__spinner" aria-hidden="true" /> : children}
    </button>
  );
});
