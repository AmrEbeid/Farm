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

/** Open overlays in paint order. Only the topmost layer may trap focus or handle Escape. */
const overlayStack: symbol[] = [];
let overflowBeforeFirstOverlay: string | null = null;

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
  const tokenRef = React.useRef(Symbol("overlay"));
  // Keep the latest onClose without re-binding the keydown listener.
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    if (!open) return;
    const token = tokenRef.current;
    restoreRef.current = document.activeElement as HTMLElement | null;
    if (overlayStack.length === 0) {
      overflowBeforeFirstOverlay = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    overlayStack.push(token);
    const panel = ref.current;
    // Move focus into the panel.
    const initial = panel ? focusable(panel)[0] ?? panel : null;
    initial?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (overlayStack[overlayStack.length - 1] !== token) return;
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
      const stackIndex = overlayStack.lastIndexOf(token);
      const wasTopmost = stackIndex === overlayStack.length - 1;
      if (stackIndex >= 0) overlayStack.splice(stackIndex, 1);
      if (overlayStack.length === 0) {
        document.body.style.overflow = overflowBeforeFirstOverlay ?? "";
        overflowBeforeFirstOverlay = null;
      } else {
        document.body.style.overflow = "hidden";
      }
      if (wasTopmost && restoreRef.current?.isConnected) restoreRef.current.focus();
    };
  }, [open, closeOnEsc]);

  return { ref };
}
