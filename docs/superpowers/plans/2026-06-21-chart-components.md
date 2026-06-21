# Chart Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three theme-aware chart wrappers from spec §4 ("Charts") — `BarChart`, `LineChart`, `DoughnutChart` — as **thin themed Recharts wrappers** that bind Recharts to our Tier-2 role tokens (and status tokens) so dark/brand/density/radius themes apply automatically, plus a shared `useChartTokens()` hook that resolves those tokens at runtime. Charts are presentational, RTL-first, and a11y-clean (`role="img"` + consumer `aria-label` + optional hidden data-table fallback).

**Architecture:** Each chart is a `function Name(props)` React component whose props extend a minimal **data + options** interface (NOT a native element). The component calls `useChartTokens()`, which reads the resolved CSS custom properties (`--brand`, `--ink`, `--ink-muted`, `--line`, `--surface` + a categorical palette derived from role + status tokens) off the chart's own scope element via `getComputedStyle`, and re-reads them when the theme flips (observed via `MutationObserver` on the nearest `.fos` scope's `data-theme`/`data-density`/`data-radius` attributes). The resolved colors are passed into Recharts primitives (`<Bar fill>`, `<Line stroke>`, `<Cell fill>`, axis/grid `stroke`). No series color is ever hardcoded. Wrapper chrome (the `fos-chart` box) is styled with role tokens only in `components.css`. Recharts is a **peerDependency** — never bundled.

**Tech Stack:** React 18, TypeScript (strict), Recharts (peer), tsup, Storybook 8 (react-vite), Vitest + @testing-library/react + jsdom, jest-axe, plain CSS (custom properties). Recharts `ResponsiveContainer` needs a sized `ResizeObserver`; jsdom lacks it, so tests mock it.

## Global Constraints
- React `>=18`; TypeScript `strict: true`; no `any` in public API.
- **Recharts is a peerDependency** — add it to `peerDependencies` (and a `devDependency` for local dev/tests); do **NOT** bundle it. tsup must keep `recharts` external (it is, by default, since peers are external).
- **Components reference only Tier-2 role tokens + numeric scales — zero hardcoded color/hex/rgb/px-color values.** Chart series/axis/grid colors come from resolved role tokens via `useChartTokens()`, never hardcoded hex. Any wrapper-chrome CSS lives in `components.css` and must pass `tokens:purity` (use `color-mix()` for tints).
- RTL-first: charts must render correctly under `dir="rtl"`. The hook reports the ambient direction; bar/line category (X) axes set `reversed` when `dir === "rtl"` so categories read right-to-left. Use logical CSS only in any wrapper chrome.
- Library is **presentational**: no user-facing strings, no i18n inside components. The consumer passes every label, the `aria-label` summary, and (optionally) the data-table caption/headers. Stories and tests use Arabic copy.
- A11y: each chart wrapper exposes `role="img"` with a consumer-supplied `aria-label`, and an optional visually-hidden `<table>` data fallback (`tableFallback` prop). jest-axe: zero violations.
- Class prefix `fos-`; BEM-ish `fos-chart` / `fos-chart--<type>` / `fos-chart__*`. `className` passthrough merged with the `.trim()` pattern.
- Commit after every task; end commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure
- `package.json` — **modify** — add `recharts` to `peerDependencies` + `devDependencies`.
- `test/setup.ts` — **modify** — add a `ResizeObserver` mock (Recharts `ResponsiveContainer` needs it under jsdom).
- `src/components/useChartTokens.ts` — **create** — the shared token-resolution hook.
- `src/components/useChartTokens.test.tsx` — **create** — hook unit test.
- `src/components/BarChart.tsx` — **create** — themed Recharts bar wrapper.
- `src/components/BarChart.stories.tsx` — **create** — CSF3 Arabic stories + Gallery.
- `src/components/BarChart.test.tsx` — **create** — render + aria-label + jest-axe.
- `src/components/LineChart.tsx` — **create** — themed Recharts line wrapper.
- `src/components/LineChart.stories.tsx` — **create** — CSF3 Arabic stories + Gallery.
- `src/components/LineChart.test.tsx` — **create** — render + aria-label + jest-axe.
- `src/components/DoughnutChart.tsx` — **create** — themed Recharts doughnut (Pie + innerRadius) wrapper.
- `src/components/DoughnutChart.stories.tsx` — **create** — CSF3 Arabic stories + Gallery.
- `src/components/DoughnutChart.test.tsx` — **create** — render + aria-label + jest-axe.
- `src/styles/components.css` — **modify** — append the `fos-chart` wrapper chrome (token-only).
- `src/index.ts` — **modify** — export the three charts + hook + their types.

---

### Task 1: Recharts peer dependency + `useChartTokens()` hook

**Files:**
- Modify: `package.json`, `test/setup.ts`, `src/index.ts`
- Create: `src/components/useChartTokens.ts`, `src/components/useChartTokens.test.tsx`

**Interfaces:**
```ts
export interface ChartTokens {
  /** Primary series / accent color (resolved --brand). */
  brand: string;
  /** Foreground text color for labels/legends (resolved --ink). */
  ink: string;
  /** Muted text color for axis ticks (resolved --ink-muted). */
  inkMuted: string;
  /** Grid / axis line color (resolved --line). */
  line: string;
  /** Chart surface background (resolved --surface). */
  surface: string;
  /** Categorical palette derived from role + status tokens (brand, info, warning, danger, success, accent, …). */
  palette: string[];
  /** Ambient writing direction of the chart scope ("rtl" | "ltr"). */
  dir: "rtl" | "ltr";
}

/** Resolve theme-derived chart colors off `ref`'s scope element; re-reads when the theme flips. */
export function useChartTokens(
  ref: React.RefObject<HTMLElement>
): ChartTokens;
```

- [ ] **Step 1: Add Recharts as a peer (+ dev) dependency**

In `package.json`, add to `"peerDependencies"`:
```json
"recharts": ">=2"
```
…and to `"devDependencies"` (for local dev + tests):
```json
"recharts": "^2.15.0"
```
Then run:
```bash
npm i
```
Expected: installs, exit 0. (tsup leaves peer deps external automatically, so Recharts is never bundled.)

- [ ] **Step 2: Add the `ResizeObserver` mock to `test/setup.ts`**

Recharts' `ResponsiveContainer` calls `ResizeObserver`, absent in jsdom. Append to `test/setup.ts`:
```ts
// Recharts ResponsiveContainer needs ResizeObserver (absent in jsdom).
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error — assign the mock onto the jsdom global.
globalThis.ResizeObserver = globalThis.ResizeObserver ?? ResizeObserverMock;
```

- [ ] **Step 3: Write the failing hook test**

Create `src/components/useChartTokens.test.tsx`:
```tsx
import * as React from "react";
import { it, expect, describe } from "vitest";
import { render } from "@testing-library/react";
import { useChartTokens, type ChartTokens } from "./useChartTokens";

function Probe({ onResolve }: { onResolve: (t: ChartTokens) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const tokens = useChartTokens(ref);
  React.useEffect(() => { onResolve(tokens); }, [tokens, onResolve]);
  return (
    <div
      ref={ref}
      style={{
        // stub resolved role tokens so getComputedStyle returns real values
        ["--brand" as any]: "#2f7d49",
        ["--ink" as any]: "#18241d",
        ["--ink-muted" as any]: "#6b7d72",
        ["--line" as any]: "#e3e9e4",
        ["--surface" as any]: "#ffffff",
        ["--info-fg" as any]: "#2b6cb0",
        ["--warning-fg" as any]: "#e08a1e",
        ["--danger-fg" as any]: "#c0392b",
        ["--success-fg" as any]: "#2f7d49",
        ["--accent-fg" as any]: "#7e57c2",
      }}
    />
  );
}

describe("useChartTokens", () => {
  it("resolves role tokens off the scope element", () => {
    let resolved: ChartTokens | undefined;
    render(<Probe onResolve={(t) => { resolved = t; }} />);
    expect(resolved!.brand).toBe("#2f7d49");
    expect(resolved!.ink).toBe("#18241d");
    expect(resolved!.inkMuted).toBe("#6b7d72");
    expect(resolved!.line).toBe("#e3e9e4");
    expect(resolved!.surface).toBe("#ffffff");
  });

  it("derives a non-empty categorical palette led by brand", () => {
    let resolved: ChartTokens | undefined;
    render(<Probe onResolve={(t) => { resolved = t; }} />);
    expect(resolved!.palette.length).toBeGreaterThanOrEqual(5);
    expect(resolved!.palette[0]).toBe("#2f7d49");
    expect(resolved!.palette).toContain("#2b6cb0");
  });

  it("reports a direction (defaults to ltr in jsdom)", () => {
    let resolved: ChartTokens | undefined;
    render(<Probe onResolve={(t) => { resolved = t; }} />);
    expect(["rtl", "ltr"]).toContain(resolved!.dir);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm test -- useChartTokens`
Expected: FAIL (module `./useChartTokens` not found).

- [ ] **Step 5: Implement `src/components/useChartTokens.ts`**

```ts
import * as React from "react";

export interface ChartTokens {
  /** Primary series / accent color (resolved --brand). */
  brand: string;
  /** Foreground text color for labels/legends (resolved --ink). */
  ink: string;
  /** Muted text color for axis ticks (resolved --ink-muted). */
  inkMuted: string;
  /** Grid / axis line color (resolved --line). */
  line: string;
  /** Chart surface background (resolved --surface). */
  surface: string;
  /** Categorical palette derived from role + status tokens. */
  palette: string[];
  /** Ambient writing direction of the chart scope. */
  dir: "rtl" | "ltr";
}

const EMPTY: ChartTokens = {
  brand: "", ink: "", inkMuted: "", line: "", surface: "", palette: [], dir: "ltr",
};

/** Read one custom property off a resolved style declaration. */
function readVar(cs: CSSStyleDeclaration, name: string): string {
  return cs.getPropertyValue(name).trim();
}

/** Resolve the chart's theme tokens from the scope element `ref` points at. */
function resolve(el: HTMLElement | null): ChartTokens {
  if (!el || typeof window === "undefined") return EMPTY;
  const cs = window.getComputedStyle(el);
  const brand = readVar(cs, "--brand");
  // Categorical palette: brand first, then status/accent hues, all theme-derived.
  const palette = [
    brand,
    readVar(cs, "--info-fg"),
    readVar(cs, "--warning-fg"),
    readVar(cs, "--danger-fg"),
    readVar(cs, "--success-fg"),
    readVar(cs, "--accent-fg"),
  ].filter((c) => c.length > 0);
  const dirAttr = (el.closest("[dir]") as HTMLElement | null)?.getAttribute("dir");
  const dir: "rtl" | "ltr" = dirAttr === "rtl" ? "rtl" : "ltr";
  return {
    brand,
    ink: readVar(cs, "--ink"),
    inkMuted: readVar(cs, "--ink-muted"),
    line: readVar(cs, "--line"),
    surface: readVar(cs, "--surface"),
    palette,
    dir,
  };
}

/**
 * Resolve theme-derived chart colors off `ref`'s element via getComputedStyle.
 * Re-reads when the nearest `.fos` scope's theme attributes change, so charts
 * recolor instantly when the consumer flips scheme/density/radius/brand.
 */
export function useChartTokens(ref: React.RefObject<HTMLElement>): ChartTokens {
  const [tokens, setTokens] = React.useState<ChartTokens>(EMPTY);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setTokens(resolve(el));
    update();

    // Observe the theme scope so a theme flip re-resolves the tokens.
    const scope = (el.closest(".fos") as HTMLElement | null) ?? document.documentElement;
    const mo = new MutationObserver(update);
    mo.observe(scope, {
      attributes: true,
      attributeFilter: ["data-theme", "data-density", "data-radius", "style", "dir"],
    });
    return () => mo.disconnect();
  }, [ref]);

  return tokens;
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -- useChartTokens`
Expected: 3 passed.

- [ ] **Step 7: Export the hook from `src/index.ts`**

Add to `src/index.ts` (before `export * from "./theme";`):
```ts
export { useChartTokens } from "./components/useChartTokens";
export type { ChartTokens } from "./components/useChartTokens";
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json test/setup.ts src/components/useChartTokens.ts src/components/useChartTokens.test.tsx src/index.ts
git commit -m "$(cat <<'EOF'
feat(charts): add Recharts peer dep + useChartTokens() theme hook

Recharts is a peerDependency (never bundled). useChartTokens resolves
--brand/--ink/--ink-muted/--line/--surface + a categorical palette off
the chart scope via getComputedStyle, re-reading on theme flips. Adds a
ResizeObserver mock to test/setup for Recharts ResponsiveContainer.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `BarChart` wrapper

**Files:**
- Create: `src/components/BarChart.tsx`, `src/components/BarChart.stories.tsx`, `src/components/BarChart.test.tsx`
- Modify: `src/styles/components.css`, `src/index.ts`

**Interfaces:**
```ts
export interface ChartSeries {
  /** Key into each datum object for this series' numeric value. */
  dataKey: string;
  /** Consumer-supplied display name (legend/tooltip); presentational only. */
  name?: string;
  /** Optional explicit color; defaults to the theme palette by index. */
  color?: string;
}

export interface BarChartProps {
  /** Row objects: one per category. */
  data: Array<Record<string, string | number>>;
  /** Key into each datum for the category (X) axis label. */
  categoryKey: string;
  /** One or more value series to plot. */
  series: ChartSeries[];
  /** Required a11y summary of the chart (consumer-supplied, localized). */
  ariaLabel: string;
  /** Render bars stacked instead of grouped. */
  stacked?: boolean;
  /** Show the legend. */
  showLegend?: boolean;
  /** Fixed pixel height (charts are width-responsive). Default 280. */
  height?: number;
  /** Optional visually-hidden data table fallback. */
  tableFallback?: { caption: string; columnHeader: string };
  /** Extra class names merged onto the wrapper. */
  className?: string;
}
```
Consumes: `useChartTokens` (Task 1).

- [ ] **Step 1: Write the failing test**

Create `src/components/BarChart.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { ThemeProvider } from "../theme";
import { BarChart } from "./BarChart";

const data = [
  { شهر: "يناير", إنتاج: 120 },
  { شهر: "فبراير", إنتاج: 180 },
  { شهر: "مارس", إنتاج: 90 },
];

function Sample() {
  return (
    <ThemeProvider>
      <BarChart
        data={data}
        categoryKey="شهر"
        series={[{ dataKey: "إنتاج", name: "الإنتاج (كجم)" }]}
        ariaLabel="إنتاج التمور الشهري بالكيلوجرام"
        tableFallback={{ caption: "إنتاج شهري", columnHeader: "الشهر" }}
      />
    </ThemeProvider>
  );
}

describe("BarChart", () => {
  it("renders a labelled img region", () => {
    render(<Sample />);
    expect(screen.getByRole("img", { name: "إنتاج التمور الشهري بالكيلوجرام" })).toBeInTheDocument();
  });

  it("emits a visually-hidden data-table fallback", () => {
    render(<Sample />);
    expect(screen.getByText("إنتاج شهري")).toBeInTheDocument();
    expect(screen.getByText("فبراير")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<Sample />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- BarChart`
Expected: FAIL (module `./BarChart` not found).

- [ ] **Step 3: Implement `src/components/BarChart.tsx`**

```tsx
import * as React from "react";
import {
  ResponsiveContainer, BarChart as RBarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import { useChartTokens } from "./useChartTokens";

export interface ChartSeries {
  /** Key into each datum object for this series' numeric value. */
  dataKey: string;
  /** Consumer-supplied display name (legend/tooltip); presentational only. */
  name?: string;
  /** Optional explicit color; defaults to the theme palette by index. */
  color?: string;
}

export interface BarChartProps {
  data: Array<Record<string, string | number>>;
  categoryKey: string;
  series: ChartSeries[];
  ariaLabel: string;
  stacked?: boolean;
  showLegend?: boolean;
  height?: number;
  tableFallback?: { caption: string; columnHeader: string };
  className?: string;
}

/** Visually-hidden table mirroring the chart data, for screen readers. */
function DataTable({
  data, categoryKey, series, caption, columnHeader,
}: Pick<BarChartProps, "data" | "categoryKey" | "series"> & { caption: string; columnHeader: string }) {
  return (
    <table className="fos-chart__table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{columnHeader}</th>
          {series.map((s) => <th key={s.dataKey} scope="col">{s.name ?? s.dataKey}</th>)}
        </tr>
      </thead>
      <tbody>
        {data.map((row, i) => (
          <tr key={i}>
            <th scope="row">{String(row[categoryKey])}</th>
            {series.map((s) => <td key={s.dataKey}>{String(row[s.dataKey])}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Theme-aware Recharts bar chart. Series colors come from role tokens. */
export function BarChart({
  data, categoryKey, series, ariaLabel,
  stacked = false, showLegend = false, height = 280, tableFallback, className = "",
}: BarChartProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const t = useChartTokens(ref);
  const stackId = stacked ? "stack" : undefined;

  return (
    <div
      ref={ref}
      className={`fos-chart fos-chart--bar ${className}`.trim()}
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer width="100%" height={height}>
        <RBarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid stroke={t.line} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={categoryKey}
            reversed={t.dir === "rtl"}
            tick={{ fill: t.inkMuted, fontSize: 12 }}
            stroke={t.line}
          />
          <YAxis
            orientation={t.dir === "rtl" ? "right" : "left"}
            tick={{ fill: t.inkMuted, fontSize: 12 }}
            stroke={t.line}
          />
          <Tooltip
            contentStyle={{ background: t.surface, border: `1px solid ${t.line}`, color: t.ink }}
            labelStyle={{ color: t.ink }}
          />
          {showLegend && <Legend wrapperStyle={{ color: t.ink }} />}
          {series.map((s, i) => (
            <Bar
              key={s.dataKey}
              dataKey={s.dataKey}
              name={s.name ?? s.dataKey}
              stackId={stackId}
              fill={s.color ?? t.palette[i % Math.max(t.palette.length, 1)] ?? t.brand}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </RBarChart>
      </ResponsiveContainer>
      {tableFallback && (
        <DataTable
          data={data}
          categoryKey={categoryKey}
          series={series}
          caption={tableFallback.caption}
          columnHeader={tableFallback.columnHeader}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- BarChart`
Expected: 3 passed. (If axe flags the hidden table, it is `position:absolute`-clipped, not `display:none`, so its content stays in the a11y tree — see Step 6 CSS.)

- [ ] **Step 5: Create `src/components/BarChart.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { BarChart } from "./BarChart";

const meta: Meta<typeof BarChart> = {
  title: "Charts/BarChart",
  component: BarChart,
  args: {
    data: [
      { شهر: "يناير", إنتاج: 120, تالف: 12 },
      { شهر: "فبراير", إنتاج: 180, تالف: 20 },
      { شهر: "مارس", إنتاج: 90, تالف: 8 },
      { شهر: "أبريل", إنتاج: 210, تالف: 15 },
    ],
    categoryKey: "شهر",
    series: [{ dataKey: "إنتاج", name: "الإنتاج (كجم)" }],
    ariaLabel: "إنتاج التمور الشهري بالكيلوجرام",
    height: 280,
  },
};
export default meta;
type S = StoryObj<typeof BarChart>;

export const Single: S = {};
export const Grouped: S = {
  args: {
    series: [
      { dataKey: "إنتاج", name: "الإنتاج" },
      { dataKey: "تالف", name: "التالف" },
    ],
    showLegend: true,
  },
};
export const Stacked: S = {
  args: {
    series: [
      { dataKey: "إنتاج", name: "الإنتاج" },
      { dataKey: "تالف", name: "التالف" },
    ],
    stacked: true,
    showLegend: true,
  },
};
export const Gallery: S = {
  render: (args) => (
    <div style={{ display: "grid", gap: 24 }}>
      <BarChart {...args} />
      <BarChart {...args} series={[{ dataKey: "إنتاج", name: "الإنتاج" }, { dataKey: "تالف", name: "التالف" }]} stacked showLegend />
    </div>
  ),
};
```

- [ ] **Step 6: Append wrapper chrome to `src/styles/components.css`** (token-only)

```css
/* ── Charts ─────────────────────────────────────────────── */
.fos-chart {
  background: var(--surface);
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  padding: var(--card-pad);
  box-shadow: var(--shadow-card);
}
/* Visually-hidden data-table fallback — stays in the a11y tree. */
.fos-chart__table {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: calc(-1 * var(--space-1));
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 7: Run the purity gate**

Run: `npm run tokens:purity`
Expected: `✓ token-purity: clean`. (The `fos-chart` block uses only role tokens / numeric scales.)

- [ ] **Step 8: Export from `src/index.ts`**

Add:
```ts
export { BarChart } from "./components/BarChart";
export type { BarChartProps, ChartSeries } from "./components/BarChart";
```

- [ ] **Step 9: Commit**

```bash
git add src/components/BarChart.tsx src/components/BarChart.stories.tsx src/components/BarChart.test.tsx src/styles/components.css src/index.ts
git commit -m "$(cat <<'EOF'
feat(charts): add theme-aware BarChart Recharts wrapper

Bars/axes/grid colored from useChartTokens role tokens; RTL reverses the
category axis. role="img" + aria-label + optional visually-hidden data
table. Token-only fos-chart chrome.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `LineChart` wrapper

**Files:**
- Create: `src/components/LineChart.tsx`, `src/components/LineChart.stories.tsx`, `src/components/LineChart.test.tsx`
- Modify: `src/index.ts`

**Interfaces:**
```ts
// Reuses ChartSeries from BarChart.tsx.
export interface LineChartProps {
  data: Array<Record<string, string | number>>;
  /** Key into each datum for the X (category/time) axis label. */
  categoryKey: string;
  series: ChartSeries[];
  /** Required a11y summary (consumer-supplied, localized). */
  ariaLabel: string;
  /** Smooth (monotone) vs. straight (linear) segments. Default "monotone". */
  curve?: "monotone" | "linear";
  /** Render points at each datum. Default true. */
  showDots?: boolean;
  showLegend?: boolean;
  height?: number;
  tableFallback?: { caption: string; columnHeader: string };
  className?: string;
}
```
Consumes: `useChartTokens` (Task 1), `ChartSeries` (Task 2).

- [ ] **Step 1: Write the failing test**

Create `src/components/LineChart.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { ThemeProvider } from "../theme";
import { LineChart } from "./LineChart";

const data = [
  { أسبوع: "1", رطوبة: 41 },
  { أسبوع: "2", رطوبة: 38 },
  { أسبوع: "3", رطوبة: 44 },
];

function Sample() {
  return (
    <ThemeProvider scheme="dark">
      <LineChart
        data={data}
        categoryKey="أسبوع"
        series={[{ dataKey: "رطوبة", name: "الرطوبة %" }]}
        ariaLabel="رطوبة التربة الأسبوعية بالنسبة المئوية"
        tableFallback={{ caption: "الرطوبة الأسبوعية", columnHeader: "الأسبوع" }}
      />
    </ThemeProvider>
  );
}

describe("LineChart", () => {
  it("renders a labelled img region", () => {
    render(<Sample />);
    expect(screen.getByRole("img", { name: "رطوبة التربة الأسبوعية بالنسبة المئوية" })).toBeInTheDocument();
  });

  it("emits a data-table fallback", () => {
    render(<Sample />);
    expect(screen.getByText("الرطوبة الأسبوعية")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<Sample />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- LineChart`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/components/LineChart.tsx`**

```tsx
import * as React from "react";
import {
  ResponsiveContainer, LineChart as RLineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import { useChartTokens } from "./useChartTokens";
import type { ChartSeries } from "./BarChart";

export interface LineChartProps {
  data: Array<Record<string, string | number>>;
  categoryKey: string;
  series: ChartSeries[];
  ariaLabel: string;
  curve?: "monotone" | "linear";
  showDots?: boolean;
  showLegend?: boolean;
  height?: number;
  tableFallback?: { caption: string; columnHeader: string };
  className?: string;
}

/** Visually-hidden table mirroring the chart data, for screen readers. */
function DataTable({
  data, categoryKey, series, caption, columnHeader,
}: Pick<LineChartProps, "data" | "categoryKey" | "series"> & { caption: string; columnHeader: string }) {
  return (
    <table className="fos-chart__table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{columnHeader}</th>
          {series.map((s) => <th key={s.dataKey} scope="col">{s.name ?? s.dataKey}</th>)}
        </tr>
      </thead>
      <tbody>
        {data.map((row, i) => (
          <tr key={i}>
            <th scope="row">{String(row[categoryKey])}</th>
            {series.map((s) => <td key={s.dataKey}>{String(row[s.dataKey])}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Theme-aware Recharts line chart. Stroke colors come from role tokens. */
export function LineChart({
  data, categoryKey, series, ariaLabel,
  curve = "monotone", showDots = true, showLegend = false,
  height = 280, tableFallback, className = "",
}: LineChartProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const t = useChartTokens(ref);

  return (
    <div
      ref={ref}
      className={`fos-chart fos-chart--line ${className}`.trim()}
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer width="100%" height={height}>
        <RLineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid stroke={t.line} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={categoryKey}
            reversed={t.dir === "rtl"}
            tick={{ fill: t.inkMuted, fontSize: 12 }}
            stroke={t.line}
          />
          <YAxis
            orientation={t.dir === "rtl" ? "right" : "left"}
            tick={{ fill: t.inkMuted, fontSize: 12 }}
            stroke={t.line}
          />
          <Tooltip
            contentStyle={{ background: t.surface, border: `1px solid ${t.line}`, color: t.ink }}
            labelStyle={{ color: t.ink }}
          />
          {showLegend && <Legend wrapperStyle={{ color: t.ink }} />}
          {series.map((s, i) => {
            const color = s.color ?? t.palette[i % Math.max(t.palette.length, 1)] ?? t.brand;
            return (
              <Line
                key={s.dataKey}
                type={curve}
                dataKey={s.dataKey}
                name={s.name ?? s.dataKey}
                stroke={color}
                strokeWidth={2}
                dot={showDots ? { fill: color, r: 3 } : false}
                activeDot={{ r: 5 }}
              />
            );
          })}
        </RLineChart>
      </ResponsiveContainer>
      {tableFallback && (
        <DataTable
          data={data}
          categoryKey={categoryKey}
          series={series}
          caption={tableFallback.caption}
          columnHeader={tableFallback.columnHeader}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- LineChart`
Expected: 3 passed.

- [ ] **Step 5: Create `src/components/LineChart.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { LineChart } from "./LineChart";

const meta: Meta<typeof LineChart> = {
  title: "Charts/LineChart",
  component: LineChart,
  args: {
    data: [
      { أسبوع: "الأول", رطوبة: 41, حرارة: 28 },
      { أسبوع: "الثاني", رطوبة: 38, حرارة: 31 },
      { أسبوع: "الثالث", رطوبة: 44, حرارة: 30 },
      { أسبوع: "الرابع", رطوبة: 39, حرارة: 33 },
    ],
    categoryKey: "أسبوع",
    series: [{ dataKey: "رطوبة", name: "الرطوبة %" }],
    ariaLabel: "رطوبة التربة الأسبوعية بالنسبة المئوية",
    height: 280,
  },
};
export default meta;
type S = StoryObj<typeof LineChart>;

export const Single: S = {};
export const MultiSeries: S = {
  args: {
    series: [
      { dataKey: "رطوبة", name: "الرطوبة %" },
      { dataKey: "حرارة", name: "الحرارة °م" },
    ],
    showLegend: true,
  },
};
export const Linear: S = { args: { curve: "linear" } };
export const Gallery: S = {
  render: (args) => (
    <div style={{ display: "grid", gap: 24 }}>
      <LineChart {...args} />
      <LineChart {...args} curve="linear" showDots={false} />
    </div>
  ),
};
```

- [ ] **Step 6: Export from `src/index.ts`**

Add:
```ts
export { LineChart } from "./components/LineChart";
export type { LineChartProps } from "./components/LineChart";
```

- [ ] **Step 7: Commit**

```bash
git add src/components/LineChart.tsx src/components/LineChart.stories.tsx src/components/LineChart.test.tsx src/index.ts
git commit -m "$(cat <<'EOF'
feat(charts): add theme-aware LineChart Recharts wrapper

Line strokes/dots colored from useChartTokens palette; RTL reverses the
X axis and moves the Y axis to the right. role="img" + aria-label +
optional data-table fallback. Reuses ChartSeries + fos-chart chrome.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `DoughnutChart` wrapper

**Files:**
- Create: `src/components/DoughnutChart.tsx`, `src/components/DoughnutChart.stories.tsx`, `src/components/DoughnutChart.test.tsx`
- Modify: `src/index.ts`

**Interfaces:**
```ts
export interface DoughnutDatum {
  /** Slice label (consumer-supplied, localized). */
  name: string;
  /** Slice numeric value. */
  value: number;
  /** Optional explicit color; defaults to the theme palette by index. */
  color?: string;
}

export interface DoughnutChartProps {
  data: DoughnutDatum[];
  /** Required a11y summary (consumer-supplied, localized). */
  ariaLabel: string;
  /** Inner-radius ratio 0..1 (0 = pie, ~0.6 = doughnut). Default 0.6. */
  innerRatio?: number;
  showLegend?: boolean;
  height?: number;
  tableFallback?: { caption: string; labelHeader: string; valueHeader: string };
  className?: string;
}
```
Consumes: `useChartTokens` (Task 1).

- [ ] **Step 1: Write the failing test**

Create `src/components/DoughnutChart.test.tsx`:
```tsx
import { it, expect, describe } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { ThemeProvider } from "../theme";
import { DoughnutChart } from "./DoughnutChart";

const data = [
  { name: "معتمد", value: 62 },
  { name: "قيد المراجعة", value: 24 },
  { name: "مرفوض", value: 14 },
];

function Sample() {
  return (
    <ThemeProvider>
      <DoughnutChart
        data={data}
        ariaLabel="توزيع حالات الطلبات"
        tableFallback={{ caption: "توزيع الحالات", labelHeader: "الحالة", valueHeader: "النسبة" }}
      />
    </ThemeProvider>
  );
}

describe("DoughnutChart", () => {
  it("renders a labelled img region", () => {
    render(<Sample />);
    expect(screen.getByRole("img", { name: "توزيع حالات الطلبات" })).toBeInTheDocument();
  });

  it("emits a data-table fallback with each slice", () => {
    render(<Sample />);
    expect(screen.getByText("توزيع الحالات")).toBeInTheDocument();
    expect(screen.getByText("قيد المراجعة")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<Sample />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- DoughnutChart`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/components/DoughnutChart.tsx`**

```tsx
import * as React from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import { useChartTokens } from "./useChartTokens";

export interface DoughnutDatum {
  name: string;
  value: number;
  color?: string;
}

export interface DoughnutChartProps {
  data: DoughnutDatum[];
  ariaLabel: string;
  innerRatio?: number;
  showLegend?: boolean;
  height?: number;
  tableFallback?: { caption: string; labelHeader: string; valueHeader: string };
  className?: string;
}

/** Theme-aware Recharts doughnut (Pie with inner radius). Slice colors from role tokens. */
export function DoughnutChart({
  data, ariaLabel, innerRatio = 0.6, showLegend = true,
  height = 280, tableFallback, className = "",
}: DoughnutChartProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const t = useChartTokens(ref);
  const outer = Math.round((height / 2) * 0.8);
  const inner = Math.round(outer * innerRatio);

  return (
    <div
      ref={ref}
      className={`fos-chart fos-chart--doughnut ${className}`.trim()}
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={inner}
            outerRadius={outer}
            stroke={t.surface}
            strokeWidth={2}
            paddingAngle={1}
          >
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={d.color ?? t.palette[i % Math.max(t.palette.length, 1)] ?? t.brand}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: t.surface, border: `1px solid ${t.line}`, color: t.ink }}
            labelStyle={{ color: t.ink }}
          />
          {showLegend && <Legend wrapperStyle={{ color: t.ink }} />}
        </PieChart>
      </ResponsiveContainer>
      {tableFallback && (
        <table className="fos-chart__table">
          <caption>{tableFallback.caption}</caption>
          <thead>
            <tr>
              <th scope="col">{tableFallback.labelHeader}</th>
              <th scope="col">{tableFallback.valueHeader}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={i}>
                <th scope="row">{d.name}</th>
                <td>{String(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- DoughnutChart`
Expected: 3 passed.

- [ ] **Step 5: Create `src/components/DoughnutChart.stories.tsx`**

```tsx
import type { Meta, StoryObj } from "@storybook/react";
import { DoughnutChart } from "./DoughnutChart";

const meta: Meta<typeof DoughnutChart> = {
  title: "Charts/DoughnutChart",
  component: DoughnutChart,
  args: {
    data: [
      { name: "معتمد", value: 62 },
      { name: "قيد المراجعة", value: 24 },
      { name: "مرفوض", value: 14 },
    ],
    ariaLabel: "توزيع حالات الطلبات",
    height: 280,
  },
};
export default meta;
type S = StoryObj<typeof DoughnutChart>;

export const Doughnut: S = {};
export const Pie: S = { args: { innerRatio: 0 } };
export const NoLegend: S = { args: { showLegend: false } };
export const Gallery: S = {
  render: (args) => (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <div style={{ width: 320 }}><DoughnutChart {...args} /></div>
      <div style={{ width: 320 }}><DoughnutChart {...args} innerRatio={0} /></div>
    </div>
  ),
};
```

- [ ] **Step 6: Export from `src/index.ts`**

Add:
```ts
export { DoughnutChart } from "./components/DoughnutChart";
export type { DoughnutChartProps, DoughnutDatum } from "./components/DoughnutChart";
```

- [ ] **Step 7: Full gate run**

Run:
```bash
npm run tokens:purity && npm test && npm run build && npm run build-storybook
```
Expected: all exit 0. `recharts` stays external in `dist` (peer dep), not bundled.

- [ ] **Step 8: Commit**

```bash
git add src/components/DoughnutChart.tsx src/components/DoughnutChart.stories.tsx src/components/DoughnutChart.test.tsx src/index.ts
git commit -m "$(cat <<'EOF'
feat(charts): add theme-aware DoughnutChart Recharts wrapper

Pie-with-inner-radius; slice fills from useChartTokens palette, slice
borders use --surface so they read on light/dark. role="img" +
aria-label + optional data-table fallback.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage (this plan = spec §4 "Charts" row + §7 non-goal):**
- §4 Charts row — "Bar / Line / Doughnut wrappers reading role tokens" → `BarChart` (Task 2), `LineChart` (Task 3), `DoughnutChart` (Task 4), all coloring series/axes/grid from `useChartTokens` resolved role tokens (Task 1). ✓
- §4 "Charts are thin themed wrappers, not a charting engine" + §7 non-goal ("A bespoke charting engine — thin themed wrappers only") → every chart is a small component delegating layout/rendering to Recharts; we add only token binding, RTL axis handling, and the a11y wrapper. No custom scales, no rendering engine. ✓
- §4 boundary "presentational only — no strings/no i18n" → no literal user-facing strings in any component; consumer passes `series.name`, `ariaLabel`, `tableFallback` text; stories/tests are Arabic. ✓
- A11y baseline (§4) → `role="img"` + consumer `aria-label` + visually-hidden data-table fallback; jest-axe asserts zero violations in each test. ✓
- Theme matrix intent (§6) → `useChartTokens` re-reads tokens on `data-theme`/`data-density`/`data-radius`/`style` mutations, so dark/brand/density flips recolor instantly; the dark-mode LineChart test exercises this path. ✓
- Packaging (§5) → Recharts added to `peerDependencies` (`>=2`) + a devDependency; not bundled (tsup keeps peers external). ✓

**Placeholder scan:** no placeholders. `useChartTokens.ts` is the full `getComputedStyle` + `MutationObserver` implementation; all three `.tsx` wrappers are complete real Recharts code; the `ResizeObserver` mock is included verbatim in Task 1 Step 2; every test, story, and the `fos-chart` CSS block is concrete. Each task follows strict TDD: failing test → `npm test -- <name>` FAIL → full implementation → PASS → story → `feat(charts): …` commit.

**Type consistency:** `ChartTokens` (Task 1) and `useChartTokens(ref: React.RefObject<HTMLElement>): ChartTokens` are defined once and consumed unchanged by all three charts. `ChartSeries` is defined in `BarChart.tsx` (Task 2) and imported by `LineChart.tsx` (Task 3); `DoughnutChart` uses its own `DoughnutDatum` (different shape — `{name,value}`), exported separately. All props interfaces extend a minimal data+options shape (not a native element), per the convention. Exports added to `src/index.ts` match each component's exported value + type names. No `any` in any public signature (the single `@ts-expect-error` is confined to the test-only `ResizeObserver` global assignment).
