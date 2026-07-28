import * as React from "react";

/**
 * `false` for the server render AND for React's first client (hydration)
 * render, `true` from the first commit onwards. `useSyncExternalStore` is the
 * React-sanctioned way to express this: the server snapshot is what hydration
 * renders, so client and server markup are identical by construction — no
 * `suppressHydrationWarning`, no extra dependency.
 */
const subscribe = () => () => {};
export function useHydrated(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export interface ChartCanvasProps {
  /** Chart height in px — reserved before AND after mount, so nothing jumps. */
  height: number;
  /** The Recharts subtree. Only rendered once hydration has committed. */
  children: React.ReactNode;
}

/**
 * Holds the space for a Recharts visualization and withholds Recharts itself
 * until after hydration.
 *
 * Farm OS aliases `recharts` to a null-rendering stub on the server (see
 * apps/farm-os/next.config.ts + recharts-stub.ts), so server markup can never
 * match a client render that draws a real chart — that mismatch is the React
 * #418 on /dashboard/owner. Worse, Recharts' `getStringSize` appends
 * `<span id="recharts_measurement_span">` directly to `<body>` while
 * rendering, mutating the document mid-hydration.
 *
 * Gating only the visualization keeps the accessible table fallback (rendered
 * by the chart components outside this canvas) in the server HTML and in the
 * first client render, so screen readers and no-JS clients are unaffected.
 */
export function ChartCanvas({ height, children }: ChartCanvasProps) {
  const hydrated = useHydrated();
  return (
    <div className="fos-chart__canvas" style={{ height }}>
      {hydrated ? children : null}
    </div>
  );
}
