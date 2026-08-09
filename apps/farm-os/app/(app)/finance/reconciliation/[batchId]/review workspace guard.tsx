"use client";

import {
  createContext,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui";

type HistoryGuardStatus = "checking" | "supported" | "unsupported";

type GuardContextValue = {
  reviewOpen: boolean;
  historyGuardStatus: HistoryGuardStatus;
  setReviewOpen: (open: boolean) => void;
};

const GuardContext = createContext<GuardContextValue | null>(null);
const subscribeToBrowserCapability = () => () => {};

export function useReviewWorkspaceGuard(): GuardContextValue {
  const value = useContext(GuardContext);
  if (!value) throw new Error("ReviewWorkspaceGuard is required");
  return value;
}

export function ReviewWorkspaceGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [reviewOpen, setReviewOpen] = useState(false);
  const historyGuardStatus = useSyncExternalStore<HistoryGuardStatus>(
    subscribeToBrowserCapability,
    () => (window.navigation?.currentEntry ? "supported" : "unsupported"),
    () => "checking"
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pendingNavigationRef = useRef<(() => void) | null>(null);
  const restoringHistoryRef = useRef(false);
  const allowHistoryTraversalRef = useRef(false);
  const pendingHistoryDestinationRef = useRef<string | null>(null);
  const historyRestoreAttemptRef = useRef(0);

  const setReviewOpenSafely = useCallback(
    (open: boolean) => {
      if (open && historyGuardStatus !== "supported") return;
      setReviewOpen(open);
    },
    [historyGuardStatus]
  );

  const requestNavigation = useCallback(
    (navigate: () => void) => {
      if (!reviewOpen) {
        navigate();
        return;
      }
      pendingNavigationRef.current = navigate;
      setConfirmOpen(true);
    },
    [reviewOpen]
  );

  useEffect(() => {
    if (!reviewOpen) return;
    const browserNavigation = window.navigation;
    const guardedEntry = browserNavigation?.currentEntry;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const guardHistoryTraversal = (event: PopStateEvent) => {
      if (!guardedEntry || !browserNavigation.currentEntry) return;
      if (allowHistoryTraversalRef.current) {
        allowHistoryTraversalRef.current = false;
        return;
      }

      event.stopImmediatePropagation();
      if (browserNavigation.currentEntry.key === guardedEntry.key) {
        if (!restoringHistoryRef.current) return;

        restoringHistoryRef.current = false;
        historyRestoreAttemptRef.current += 1;
        const destinationKey = pendingHistoryDestinationRef.current;
        pendingHistoryDestinationRef.current = null;
        if (!destinationKey) return;
        requestNavigation(() => {
          allowHistoryTraversalRef.current = true;
          void browserNavigation.traverseTo(destinationKey).finished?.catch(() => {
            allowHistoryTraversalRef.current = false;
          });
        });
        return;
      }

      const destinationKey = browserNavigation.currentEntry.key;
      pendingHistoryDestinationRef.current = destinationKey;
      restoringHistoryRef.current = true;
      const restoreAttempt = historyRestoreAttemptRef.current + 1;
      historyRestoreAttemptRef.current = restoreAttempt;
      void browserNavigation.traverseTo(guardedEntry.key).finished?.catch(() => {
        const currentEntry = browserNavigation.currentEntry;
        if (
          historyRestoreAttemptRef.current !== restoreAttempt ||
          !currentEntry ||
          currentEntry.key === guardedEntry.key
        ) {
          return;
        }
        const delta = guardedEntry.index - currentEntry.index;
        if (delta !== 0) window.history.go(delta);
      });
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    if (guardedEntry) window.addEventListener("popstate", guardHistoryTraversal, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      if (guardedEntry) window.removeEventListener("popstate", guardHistoryTraversal, true);
      restoringHistoryRef.current = false;
      allowHistoryTraversalRef.current = false;
      pendingHistoryDestinationRef.current = null;
      historyRestoreAttemptRef.current += 1;
    };
  }, [requestNavigation, reviewOpen, router]);

  function captureLink(event: MouseEvent<HTMLDivElement>) {
    if (!reviewOpen || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) {
      return;
    }
    const anchor = (event.target as Element).closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;

    const target = new URL(anchor.href, window.location.href);
    if (target.href === window.location.href) return;
    event.preventDefault();
    event.stopPropagation();
    requestNavigation(() => {
      if (target.origin === window.location.origin) {
        router.push(`${target.pathname}${target.search}${target.hash}`);
      } else {
        window.location.assign(target.href);
      }
    });
  }

  function captureForm(event: FormEvent<HTMLDivElement>) {
    if (!reviewOpen) return;
    const form = event.target as HTMLFormElement;
    if (!(form instanceof HTMLFormElement) || form.method.toLowerCase() !== "get") return;

    event.preventDefault();
    event.stopPropagation();
    const target = new URL(form.action || window.location.href, window.location.href);
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (typeof value === "string") params.append(key, value);
    }
    target.search = params.toString();
    requestNavigation(() => router.push(`${target.pathname}${target.search}`));
  }

  function discardAndNavigate() {
    const navigate = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    setConfirmOpen(false);
    setReviewOpen(false);
    navigate?.();
  }

  return (
    <GuardContext.Provider
      value={{
        reviewOpen,
        historyGuardStatus,
        setReviewOpen: setReviewOpenSafely,
      }}
    >
      <div onClickCapture={captureLink} onSubmitCapture={captureForm}>
        {children}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => {
          pendingNavigationRef.current = null;
          setConfirmOpen(false);
        }}
        onConfirm={discardAndNavigate}
        title="توجد تعديلات مراجعة غير محفوظة"
        description="سيؤدي الانتقال إلى إلغاء التعديلات المفتوحة. احفظ القرار أو عد إلى المراجعة."
        confirmLabel="إلغاء التعديلات والانتقال"
        cancelLabel="العودة للمراجعة"
        closeLabel="العودة للمراجعة"
        tone="danger"
      />
    </GuardContext.Provider>
  );
}
