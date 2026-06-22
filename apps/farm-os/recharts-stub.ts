/*
 * Server-side stub for Recharts.
 *
 * @amrebeid/ui's barrel statically imports Recharts to build its chart
 * components, so importing any UI component pulls Recharts into the React
 * Server Components / SSR module graph. Recharts 2.x is not compatible with
 * React 19 under Next's server module evaluation (its class components throw
 * "Super expression must either be null or a function" at import time).
 *
 * No Phase A route renders a chart, so on the server we alias Recharts to this
 * stub: every named export resolves to a component that renders nothing. The
 * real Recharts is still used in the browser bundle, so charts work client-side
 * when they are introduced in a later phase.
 */
const Noop = () => null;

const handler: ProxyHandler<Record<string, unknown>> = {
  get: (_target, prop) => {
    if (prop === "__esModule") return true;
    if (prop === "default") return Noop;
    return Noop;
  },
};

const stub = new Proxy({}, handler);

export default stub;
export const ResponsiveContainer = Noop;
export const BarChart = Noop;
export const LineChart = Noop;
export const PieChart = Noop;
export const CartesianGrid = Noop;
export const XAxis = Noop;
export const YAxis = Noop;
export const Tooltip = Noop;
export const Legend = Noop;
export const Bar = Noop;
export const Line = Noop;
export const Pie = Noop;
export const Cell = Noop;
