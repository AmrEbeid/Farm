import * as React from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../theme";
import { useOverlay } from "./useOverlay";

export type DrawerSide = "start" | "end";

export interface DrawerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Whether the drawer is open. Controlled. */
  open: boolean;
  /** Called when the user requests to close (Esc, backdrop, close button). */
  onClose: () => void;
  /** Inline edge to dock to. Logical — auto-flips under RTL. Default "end". */
  side?: DrawerSide;
  /** Heading; also names the dialog for assistive tech. */
  title?: React.ReactNode;
  /** Optional pinned footer region. */
  footer?: React.ReactNode;
  /** Close when the backdrop is clicked. Default true. */
  closeOnBackdrop?: boolean;
  /** Close on the Escape key. Default true. */
  closeOnEsc?: boolean;
  /** Accessible label for the × close button (consumer-supplied). */
  closeLabel?: string;
  children: React.ReactNode;
}

/** Accessible, portal-rendered side sheet. Slides from the inline `side` (RTL-aware). */
export function Drawer({
  open, onClose, side = "end", title, footer,
  closeOnBackdrop = true, closeOnEsc = true, closeLabel,
  className = "", children, ...rest
}: DrawerProps): React.ReactPortal | null {
  const theme = useTheme();
  const { ref } = useOverlay({ open, onClose, closeOnEsc });
  const titleId = React.useId();

  if (!open) return null;

  return createPortal(
    <div className="fos" data-theme={theme.scheme} data-density={theme.density} data-radius={theme.radius} style={theme.brandStyle}>
      <div
        className="fos-drawer__backdrop"
        onMouseDown={(e) => {
          if (closeOnBackdrop && e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title != null ? titleId : undefined}
          tabIndex={-1}
          className={`fos-drawer fos-drawer--${side} ${className}`.trim()}
          {...rest}
        >
          {(title != null || closeLabel != null) && (
            <div className="fos-drawer__header">
              {title != null && <h2 id={titleId} className="fos-drawer__title">{title}</h2>}
              {closeLabel != null && (
                <button type="button" className="fos-drawer__close" aria-label={closeLabel || "Close"} onClick={onClose}>
                  ✕
                </button>
              )}
            </div>
          )}
          <div className="fos-drawer__body">{children}</div>
          {footer != null && <div className="fos-drawer__footer">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Alias — Sheet is the same component. */
export const Sheet = Drawer;
