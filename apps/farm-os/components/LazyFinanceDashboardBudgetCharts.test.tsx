// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/FinanceDashboardBudgetCharts", async () => {
  const React = await import("react");
  return {
    FinanceDashboardBudgetCharts: () =>
      React.createElement("div", { "data-testid": "loaded-finance-budget-charts" }),
  };
});

import { LazyFinanceDashboardBudgetCharts } from "./LazyFinanceDashboardBudgetCharts";

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let observerCallback: IntersectionObserverCallback;
let observerOptions: IntersectionObserverInit | undefined;
const disconnect = vi.fn();
const observe = vi.fn();

class FakeIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "300px";
  readonly scrollMargin = "0px";
  readonly thresholds = [0];

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    observerCallback = callback;
    observerOptions = options;
  }

  disconnect = disconnect;
  observe = observe;
  takeRecords = () => [];
  unobserve = vi.fn();
}

async function renderCharts() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <LazyFinanceDashboardBudgetCharts
        used={120}
        available={80}
        usedLabel="١٢٠٫٠٠ ج.م"
        availableLabel="٨٠٫٠٠ ج.م"
        variance={[{
          category: "تشغيل",
          planned: 200,
          actual: 120,
          plannedLabel: "٢٠٠٫٠٠ ج.م",
          actualLabel: "١٢٠٫٠٠ ج.م",
        }]}
      />,
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  disconnect.mockReset();
  observe.mockReset();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("LazyFinanceDashboardBudgetCharts", () => {
  it("keeps a stable placeholder until the chart region approaches the viewport", async () => {
    await renderCharts();

    expect(observerOptions).toEqual({ rootMargin: "300px" });
    expect(observe).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="loaded-finance-budget-charts"]')).toBeNull();
    expect(document.querySelectorAll(".finance-lazy-chart__fallback")).toHaveLength(2);
    expect(document.body.textContent).toContain("١٢٠٫٠٠ ج.م");
    expect(document.body.textContent).toContain("٢٠٠٫٠٠ ج.م");

    await act(async () => {
      observerCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      await Promise.resolve();
    });

    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(document.querySelector('[data-testid="loaded-finance-budget-charts"]')).not.toBeNull();
    expect(disconnect).toHaveBeenCalled();
  });
});
