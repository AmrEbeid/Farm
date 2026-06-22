import * as React from "react";

export type TooltipPlacement = "top" | "bottom" | "start" | "end";

export interface TooltipProps {
  /** Tooltip text/content. */
  label: React.ReactNode;
  /** Logical placement relative to the trigger. */
  placement?: TooltipPlacement;
  /** A single focusable trigger element. */
  children: React.ReactElement;
}

let tooltipSeq = 0;

/**
 * Accessible tooltip. Wraps one focusable child; shows a `role="tooltip"` bubble on
 * hover + focus, links it via `aria-describedby`, dismisses on `Esc`.
 */
export function Tooltip({ label, placement = "top", children }: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const id = React.useMemo(() => `fos-tip-${++tooltipSeq}`, []);

  const show = () => setOpen(true);
  const hide = () => setOpen(false);

  const child = React.Children.only(children);
  const trigger = React.cloneElement(child, {
    "aria-describedby": open ? id : child.props["aria-describedby"],
    onMouseEnter: (e: React.MouseEvent) => { show(); child.props.onMouseEnter?.(e); },
    onMouseLeave: (e: React.MouseEvent) => { hide(); child.props.onMouseLeave?.(e); },
    onFocus: (e: React.FocusEvent) => { show(); child.props.onFocus?.(e); },
    onBlur: (e: React.FocusEvent) => { hide(); child.props.onBlur?.(e); },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") hide();
      child.props.onKeyDown?.(e);
    },
  });

  return (
    <span className="fos-tooltip">
      {trigger}
      {open && (
        <span role="tooltip" id={id} className={`fos-tooltip__bubble fos-tooltip__bubble--${placement}`}>
          {label}
        </span>
      )}
    </span>
  );
}
