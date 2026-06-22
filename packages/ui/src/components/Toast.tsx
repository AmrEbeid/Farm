import * as React from "react";
import { createPortal } from "react-dom";
import { useTheme } from "../theme";

export type ToastTone = "ok" | "info" | "warning" | "danger";

export interface ToastOptions {
  /** Bold heading line. */
  title: React.ReactNode;
  /** Optional muted second line. */
  description?: React.ReactNode;
  /** Severity. Default "info". */
  tone?: ToastTone;
  /** Auto-dismiss after N ms. `0` or negative = sticky. Default 4500. */
  duration?: number;
  /** Optional leading icon (emoji or node). */
  icon?: React.ReactNode;
}

export interface ToastRecord extends ToastOptions {
  id: string;
}

type ShorthandOpts = Omit<ToastOptions, "title" | "tone">;

export interface ToastApi {
  toast(opts: ToastOptions): string;
  dismiss(id: string): void;
  clear(): void;
  ok(title: React.ReactNode, opts?: ShorthandOpts): string;
  info(title: React.ReactNode, opts?: ShorthandOpts): string;
  warning(title: React.ReactNode, opts?: ShorthandOpts): string;
  danger(title: React.ReactNode, opts?: ShorthandOpts): string;
}

type Action =
  | { type: "add"; toast: ToastRecord; max: number }
  | { type: "remove"; id: string }
  | { type: "clear" };

function reducer(state: ToastRecord[], action: Action): ToastRecord[] {
  switch (action.type) {
    case "add": {
      const next = [...state, action.toast];
      return next.length > action.max ? next.slice(next.length - action.max) : next;
    }
    case "remove":
      return state.filter((t) => t.id !== action.id);
    case "clear":
      return [];
  }
}

interface ToastInternalContext {
  toasts: ToastRecord[];
  api: ToastApi;
}
const ToastContext = React.createContext<ToastInternalContext | null>(null);

export interface ToastProviderProps {
  children: React.ReactNode;
  /** Max simultaneous toasts; oldest is dropped past this. Default 4. */
  max?: number;
}

let seq = 0;

export function ToastProvider({ children, max = 4 }: ToastProviderProps) {
  const [toasts, dispatch] = React.useReducer(reducer, [] as ToastRecord[]);

  const api = React.useMemo<ToastApi>(() => {
    const push = (opts: ToastOptions): string => {
      const id = `fos-toast-${++seq}`;
      dispatch({ type: "add", toast: { duration: 4500, tone: "info", ...opts, id }, max });
      return id;
    };
    const shorthand =
      (tone: ToastTone) =>
      (title: React.ReactNode, opts: ShorthandOpts = {}): string =>
        push({ ...opts, title, tone });
    return {
      toast: push,
      dismiss: (id) => dispatch({ type: "remove", id }),
      clear: () => dispatch({ type: "clear" }),
      ok: shorthand("ok"),
      info: shorthand("info"),
      warning: shorthand("warning"),
      danger: shorthand("danger"),
    };
  }, [max]);

  const value = React.useMemo(() => ({ toasts, api }), [toasts, api]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a <ToastProvider>");
  return ctx.api;
}

/** The live region that renders queued toasts. Auto-mounted by ToastProvider. */
export function Toaster(): React.ReactPortal | null {
  const ctx = React.useContext(ToastContext);
  const theme = useTheme();
  if (!ctx || typeof document === "undefined") return null;
  const { toasts, api } = ctx;

  return createPortal(
    <div
      className="fos"
      data-theme={theme.scheme}
      data-density={theme.density}
      data-radius={theme.radius}
    >
      <div className="fos-toaster" role="status" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => api.dismiss(t.id)} />
        ))}
      </div>
    </div>,
    document.body
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) {
  const { tone = "info", duration = 4500 } = toast;
  const paused = React.useRef(false);
  const elRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (duration <= 0) return;
    let remaining = duration;
    let start = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      start = Date.now();
      timer = setTimeout(onDismiss, remaining);
    };
    const pause = () => {
      paused.current = true;
      clearTimeout(timer);
      remaining -= Date.now() - start;
    };
    const resume = () => {
      if (!paused.current) return;
      paused.current = false;
      run();
    };
    run();
    const el = elRef.current;
    el?.addEventListener("mouseenter", pause);
    el?.addEventListener("mouseleave", resume);
    el?.addEventListener("focusin", pause);
    el?.addEventListener("focusout", resume);
    return () => {
      clearTimeout(timer);
      el?.removeEventListener("mouseenter", pause);
      el?.removeEventListener("mouseleave", resume);
      el?.removeEventListener("focusin", pause);
      el?.removeEventListener("focusout", resume);
    };
  }, [duration, onDismiss]);

  return (
    <div ref={elRef} className={`fos-toast fos-toast--${tone}`}>
      {toast.icon != null && <span className="fos-toast__icon" aria-hidden="true">{toast.icon}</span>}
      <div className="fos-toast__body">
        <div className="fos-toast__title">{toast.title}</div>
        {toast.description != null && <div className="fos-toast__desc">{toast.description}</div>}
      </div>
      <button type="button" className="fos-toast__close" aria-label="✕" onClick={onDismiss}>✕</button>
    </div>
  );
}
