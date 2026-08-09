// @vitest-environment jsdom

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import {
  ReviewWorkspaceGuard,
  useReviewWorkspaceGuard,
} from "@/app/(app)/finance/reconciliation/[batchId]/review workspace guard";

function GuardedContent() {
  const { reviewOpen, historyGuardStatus, setReviewOpen } = useReviewWorkspaceGuard();
  useEffect(() => {
    setReviewOpen(true);
  }, [setReviewOpen]);
  return createElement(
    "div",
    null,
    createElement(
      "output",
      { "data-testid": "guard-state" },
      `${historyGuardStatus}:${reviewOpen ? "open" : "closed"}`
    ),
    createElement("a", { href: "/finance/reconciliation" }, "كل الدفعات"),
    createElement(
      "form",
      { method: "get", action: "/finance/reconciliation/batch" },
      createElement("input", { name: "state", defaultValue: "unreviewed" }),
      createElement("button", { type: "submit" }, "تطبيق")
    )
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

type FakeHistoryEntry = { key: string; url: string };

function installNavigationHistory(
  entries: FakeHistoryEntry[],
  initialIndex: number,
  { deferProgrammatic = false }: { deferProgrammatic?: boolean } = {}
) {
  let currentIndex = initialIndex;
  const historyEntries = entries.map((entry, index) => ({ ...entry, index }));
  const pendingTraversals: {
    destinationIndex: number;
    resolve: (entry: (typeof historyEntries)[number]) => void;
    reject: (error: DOMException) => void;
  }[] = [];

  function commitTraversal(destinationIndex: number) {
    currentIndex = destinationIndex;
    window.history.replaceState({}, "", historyEntries[currentIndex].url);
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    return historyEntries[currentIndex];
  }

  const browserNavigation = {
    get currentEntry() {
      return historyEntries[currentIndex];
    },
    entries: () => historyEntries,
    traverseTo(key: string) {
      const destinationIndex = historyEntries.findIndex((entry) => entry.key === key);
      if (destinationIndex < 0) throw new DOMException("Missing history entry", "InvalidStateError");
      const finished = new Promise<(typeof historyEntries)[number]>((resolve, reject) => {
        if (deferProgrammatic) {
          pendingTraversals.push({ destinationIndex, resolve, reject });
          return;
        }
        queueMicrotask(() => resolve(commitTraversal(destinationIndex)));
      });
      return { committed: finished, finished };
    },
  };

  Object.defineProperty(window, "navigation", {
    configurable: true,
    value: browserNavigation,
  });
  window.history.replaceState({}, "", historyEntries[currentIndex].url);

  return {
    currentKey: () => historyEntries[currentIndex].key,
    flushLatestProgrammaticTraversal() {
      const latest = pendingTraversals.pop();
      if (!latest) throw new Error("No pending programmatic traversal");
      for (const stale of pendingTraversals.splice(0)) {
        stale.reject(new DOMException("Traversal superseded", "AbortError"));
      }
      latest.resolve(commitTraversal(latest.destinationIndex));
    },
    traverseAsUser(key: string) {
      const destinationIndex = historyEntries.findIndex((entry) => entry.key === key);
      if (destinationIndex < 0) throw new Error(`Missing history entry: ${key}`);
      commitTraversal(destinationIndex);
    },
  };
}

async function renderGuard(withNavigation = true) {
  if (withNavigation && !("navigation" in window)) {
    installNavigationHistory([{ key: "review", url: "/finance/reconciliation/batch" }], 0);
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(ReviewWorkspaceGuard, null, createElement(GuardedContent)));
  });
}

function byText(selector: string, text: string): HTMLElement {
  const element = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
    (candidate) => candidate.textContent?.trim() === text
  );
  if (!element) throw new Error(`Missing ${selector} with text: ${text}`);
  return element;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  push.mockReset();
  Reflect.deleteProperty(window, "navigation");
  window.history.replaceState({}, "", "/");
});

describe("reconciliation review workspace guard", () => {
  it("fails closed when the browser cannot preserve guarded history traversal", async () => {
    await renderGuard(false);

    expect(document.querySelector('[data-testid="guard-state"]')?.textContent).toBe("unsupported:closed");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("does not navigate a link until the reviewer explicitly discards", async () => {
    await renderGuard();

    await click(byText("a", "كل الدفعات"));
    expect(push).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("توجد تعديلات مراجعة غير محفوظة");

    await click(byText("button", "العودة للمراجعة"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(push).not.toHaveBeenCalled();

    await click(byText("a", "كل الدفعات"));
    await click(byText("button", "إلغاء التعديلات والانتقال"));
    expect(push).toHaveBeenCalledWith("/finance/reconciliation");
  });

  it("guards filter submissions and preserves their GET values", async () => {
    await renderGuard();

    await act(async () => {
      document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(push).not.toHaveBeenCalled();
    await click(byText("button", "إلغاء التعديلات والانتقال"));
    expect(push).toHaveBeenCalledWith("/finance/reconciliation/batch?state=unreviewed");
  });

  it("registers a browser-unload warning while the form is open", async () => {
    await renderGuard();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("preserves the history stack across cancelled and confirmed back or forward traversal", async () => {
    const entries = [
      { key: "previous", url: "/finance/reconciliation" },
      { key: "review", url: "/finance/reconciliation/batch" },
      { key: "next", url: "/finance/reconciliation/batch?page=2" },
    ];
    const history = installNavigationHistory(entries, 1);
    await renderGuard();

    const laterPopstateListener = vi.fn();
    window.addEventListener("popstate", laterPopstateListener);
    await act(async () => {
      history.traverseAsUser("previous");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(history.currentKey()).toBe("review");
    expect(window.location.pathname).toBe("/finance/reconciliation/batch");
    expect(laterPopstateListener).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();

    await click(byText("button", "العودة للمراجعة"));
    expect(push).not.toHaveBeenCalled();

    expect(history.currentKey()).toBe("review");
    expect(entries.map((entry) => entry.key)).toEqual(["previous", "review", "next"]);

    await act(async () => {
      history.traverseAsUser("next");
      await Promise.resolve();
      await Promise.resolve();
    });
    await click(byText("button", "إلغاء التعديلات والانتقال"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(history.currentKey()).toBe("next");
    expect(window.location.search).toBe("?page=2");
    expect(entries.map((entry) => entry.key)).toEqual(["previous", "review", "next"]);
    expect(laterPopstateListener).toHaveBeenCalledTimes(1);

    await act(async () => {
      history.traverseAsUser("review");
    });
    expect(history.currentKey()).toBe("review");
    expect(window.location.search).toBe("");
    expect(laterPopstateListener).toHaveBeenCalledTimes(2);
    window.removeEventListener("popstate", laterPopstateListener);
  });

  it("serializes rapid traversals and prompts for the latest destination after exact restoration", async () => {
    const entries = [
      { key: "earliest", url: "/finance/reconciliation?page=1" },
      { key: "previous", url: "/finance/reconciliation?page=2" },
      { key: "review", url: "/finance/reconciliation/batch" },
      { key: "next", url: "/finance/reconciliation/batch?page=2" },
    ];
    const history = installNavigationHistory(entries, 2, { deferProgrammatic: true });
    await renderGuard();

    const laterPopstateListener = vi.fn();
    window.addEventListener("popstate", laterPopstateListener);
    await act(async () => {
      history.traverseAsUser("previous");
      history.traverseAsUser("earliest");
    });

    expect(history.currentKey()).toBe("earliest");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(laterPopstateListener).not.toHaveBeenCalled();

    await act(async () => {
      history.flushLatestProgrammaticTraversal();
      await Promise.resolve();
    });

    expect(history.currentKey()).toBe("review");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("توجد تعديلات مراجعة غير محفوظة");
    expect(entries.map((entry) => entry.key)).toEqual(["earliest", "previous", "review", "next"]);
    expect(laterPopstateListener).not.toHaveBeenCalled();

    await click(byText("button", "العودة للمراجعة"));
    expect(history.currentKey()).toBe("review");
    window.removeEventListener("popstate", laterPopstateListener);
  });
});
