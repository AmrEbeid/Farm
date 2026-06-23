import * as React from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../theme";
import { useOverlay } from "./useOverlay";

export type ModalSize = "sm" | "md" | "lg";

export interface ModalProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Whether the modal is open. Controlled. */
  open: boolean;
  /** Called when the user requests to close (Esc, backdrop, close button). */
  onClose: () => void;
  /** Heading shown in the header; also names the dialog for assistive tech. */
  title?: React.ReactNode;
  /** Optional footer region (e.g. action buttons), pinned below the body. */
  footer?: React.ReactNode;
  /** Width preset. */
  size?: ModalSize;
  /** Close when the backdrop is clicked. Default true. */
  closeOnBackdrop?: boolean;
  /** Close on the Escape key. Default true. */
  closeOnEsc?: boolean;
  /** Accessible label for the × close button (consumer-supplied — no i18n in lib). */
  closeLabel?: string;
  children: React.ReactNode;
}

/** Accessible, portal-rendered modal dialog. Re-applies the active theme inside the portal. */
export function Modal({
  open, onClose, title, footer, size = "md",
  closeOnBackdrop = true, closeOnEsc = true, closeLabel,
  className = "", children, ...rest
}: ModalProps): React.ReactPortal | null {
  const theme = useTheme();
  const { ref } = useOverlay({ open, onClose, closeOnEsc });
  const titleId = React.useId();

  if (!open) return null;

  return createPortal(
    <div className="fos" data-theme={theme.scheme} data-density={theme.density} data-radius={theme.radius} style={theme.brandStyle}>
      <div
        className="fos-modal__backdrop"
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
          className={`fos-modal fos-modal--${size} ${className}`.trim()}
          {...rest}
        >
          {(title != null || closeLabel != null) && (
            <div className="fos-modal__header">
              {title != null && <h2 id={titleId} className="fos-modal__title">{title}</h2>}
              {closeLabel != null && (
                <button type="button" className="fos-modal__close" aria-label={closeLabel} onClick={onClose}>
                  ✕
                </button>
              )}
            </div>
          )}
          <div className="fos-modal__body">{children}</div>
          {footer != null && <div className="fos-modal__footer">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Alias — Dialog is the same component. */
export const Dialog = Modal;
