import "@testing-library/jest-dom/vitest";
import { expect } from "vitest";
import { toHaveNoViolations } from "jest-axe";
expect.extend(toHaveNoViolations);

// Recharts ResponsiveContainer needs ResizeObserver (absent in jsdom).
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error — assign the mock onto the jsdom global.
globalThis.ResizeObserver = globalThis.ResizeObserver ?? ResizeObserverMock;
