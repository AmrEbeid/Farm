import * as React from "react";

export interface UseOverlayOptions {
  /** Whether the overlay is mounted/visible. */
  open: boolean;
  /** Called on Esc (when enabled) or when the consumer requests close. */
  onClose: () => void;
  /** Close on the Escape key. Default true. */
  closeOnEsc?: boolean;
}

const FOCUSABLE =
  'a[href],area[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function isVisible(el: HTMLElement): boolean {
  if (el === document.activeElement) return true;
  if (el.hidden) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  return true;
}

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
}

/** Shared dialog/drawer a11y: focus-trap + Esc + return-focus + body scroll-lock. */
export function useOverlay({ open, onClose, closeOnEsc = true }: UseOverlayOptions) {
  const ref = React.useRef<HTMLDivElement>(null);
  const restoreRef = React.useRef<HTMLElement | null>(null);
  // Keep the latest onClose without re-binding the keydown listener.
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    // Move focus into the panel.
    const initial = panel ? focusable(panel)[0] ?? panel : null;
    initial?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && closeOnEsc) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = focusable(panel);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus();
    };
  }, [open, closeOnEsc]);

  return { ref };
}
