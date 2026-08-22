/**
 * SSR → hydration regression guard for the Recharts-based chart primitives.
 *
 * Farm OS aliases `recharts` to a null-rendering stub on the server
 * (apps/farm-os/next.config.ts + recharts-stub.ts), so ANY Recharts markup a
 * chart emits on its first client render is markup the server never produced →
 * React #418 on /dashboard/owner, plus Recharts' `getStringSize` appending
 * `<span id="recharts_measurement_span">` straight onto <body> mid-hydration.
 *
 * The contract this file pins:
 *   1. Server HTML contains the accessible table fallback and NO Recharts markup.
 *   2. The first client render is byte-identical to the server HTML, emits no
 *      recoverable (hydration) errors, and mutates neither <body> nor the
 *      measurement span.
 *   3. The real chart mounts only AFTER hydration, and the table fallback
 *      survives unchanged.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { ThemeProvider } from "../src/theme";
import { BarChart } from "../src/components/BarChart";
import { LineChart } from "../src/components/LineChart";
import { DoughnutChart } from "../src/components/DoughnutChart";

const act = (React as unknown as { act: (cb: () => void | Promise<void>) => Promise<void> }).act;

const MEASUREMENT_SPAN_ID = "recharts_measurement_span";
const RECHARTS_MARKUP = /recharts/i;

const series = [{ dataKey: "إنتاج", name: "الإنتاج (كجم)" }];
const rows = [
  { شهر: "يناير", إنتاج: 120 },
  { شهر: "فبراير", إنتاج: 180 },
];
const slices = [
  { name: "مثمر", value: 4380 },
  { name: "ذكور", value: 299 },
];

const CASES = [
  {
    name: "BarChart",
    caption: "إنتاج شهري",
    node: (
      <BarChart
        data={rows}
        categoryKey="شهر"
        series={series}
        ariaLabel="إنتاج التمور الشهري"
        tableFallback={{ caption: "إنتاج شهري", columnHeader: "الشهر" }}
      />
    ),
  },
  {
    name: "LineChart",
    caption: "اتجاه الإنتاج",
    node: (
      <LineChart
        data={rows}
        categoryKey="شهر"
        series={series}
        ariaLabel="اتجاه إنتاج التمور"
        tableFallback={{ caption: "اتجاه الإنتاج", columnHeader: "الشهر" }}
      />
    ),
  },
  {
    name: "DoughnutChart",
    caption: "توزيع النخيل",
    node: (
      <DoughnutChart
        data={slices}
        ariaLabel="توزيع حالة النخيل"
        tableFallback={{ caption: "توزيع النخيل", labelHeader: "الحالة", valueHeader: "العدد" }}
      />
    ),
  },
];

/**
 * Rendered as a sibling AFTER the chart, so its render phase runs once the
 * chart's own render phase is done — i.e. it observes exactly what the first
 * client render did to the document before React commits anything.
 */
function RenderProbe({ onFirstRender }: { onFirstRender: () => void }) {
  const seen = React.useRef(false);
  if (!seen.current) {
    seen.current = true;
    onFirstRender();
  }
  return null;
}

function tableHtml(root: ParentNode): string {
  const table = root.querySelector("table.fos-chart__table");
  return table ? table.outerHTML : "";
}

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom reports every element as 0×0; give charts a real box so Recharts'
  // ResponsiveContainer would actually draw (and measure) if it ever ran.
  for (const [prop, value] of [
    ["offsetWidth", 640],
    ["offsetHeight", 320],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
  }
});

afterEach(() => {
  document.getElementById(MEASUREMENT_SPAN_ID)?.remove();
  document.body.innerHTML = "";
});

describe.each(CASES)("$name SSR/hydration contract", ({ caption, node }) => {
  const sample = <ThemeProvider>{node}</ThemeProvider>;

  it("server-renders the accessible table fallback and no Recharts markup", () => {
    const html = renderToString(sample);

    expect(html).toContain(caption);
    expect(html).toMatch(/<table class="fos-chart__table"/);
    expect(html).not.toMatch(RECHARTS_MARKUP);
    expect(document.getElementById(MEASUREMENT_SPAN_ID)).toBeNull();
  });

  it("hydrates with no recoverable error, no body mutation, then mounts the real chart", async () => {
    const html = renderToString(sample);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    const serverTable = tableHtml(container);
    const bodyChildrenBefore = document.body.childElementCount;

    const recoverable: unknown[] = [];
    const firstRender: { html: string; bodyChildren: number; span: boolean } = {
      html: "",
      bodyChildren: -1,
      span: true,
    };

    const root = await act(async () => {
      return hydrateRoot(
        container,
        <>
          {sample}
          <RenderProbe
            onFirstRender={() => {
              firstRender.html = container.innerHTML;
              firstRender.bodyChildren = document.body.childElementCount;
              firstRender.span = document.getElementById(MEASUREMENT_SPAN_ID) !== null;
            }}
          />
        </>,
        { onRecoverableError: (error) => recoverable.push(error) },
      );
    }) as unknown as { unmount: () => void };

    // 1. First client render matched the server byte-for-byte.
    expect(recoverable).toEqual([]);
    expect(firstRender.html).toBe(html);
    // 2. Nothing was appended to <body> — no Recharts measurement span.
    expect(firstRender.span).toBe(false);
    expect(firstRender.bodyChildren).toBe(bodyChildrenBefore);
    // 3. The real chart mounts once hydration is done...
    expect(container.querySelector(".recharts-responsive-container")).not.toBeNull();
    // ...and the accessible fallback is untouched.
    expect(tableHtml(container)).toBe(serverTable);

    await act(async () => {
      root.unmount();
    });
  });
});
