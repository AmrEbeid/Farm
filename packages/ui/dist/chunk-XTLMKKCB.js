import * as React from 'react';
import { ResponsiveContainer, BarChart as BarChart$1, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar, LineChart as LineChart$1, Line, PieChart, Pie, Cell } from 'recharts';
import { jsxs, jsx } from 'react/jsx-runtime';

// src/components/useChartTokens.ts
var EMPTY = {
  brand: "",
  ink: "",
  inkMuted: "",
  line: "",
  surface: "",
  palette: [],
  dir: "ltr"
};
function readVar(cs, name) {
  return cs.getPropertyValue(name).trim();
}
function resolve(el) {
  if (!el || typeof window === "undefined") return EMPTY;
  const cs = window.getComputedStyle(el);
  const brand = readVar(cs, "--brand");
  const palette = [
    brand,
    readVar(cs, "--info-fg"),
    readVar(cs, "--warning-fg"),
    readVar(cs, "--danger-fg"),
    readVar(cs, "--success-fg"),
    readVar(cs, "--accent-fg")
  ].filter((c) => c.length > 0);
  const dirAttr = el.closest("[dir]")?.getAttribute("dir");
  const dir = dirAttr === "rtl" ? "rtl" : "ltr";
  return {
    brand,
    ink: readVar(cs, "--ink"),
    inkMuted: readVar(cs, "--ink-muted"),
    line: readVar(cs, "--line"),
    surface: readVar(cs, "--surface"),
    palette,
    dir
  };
}
function useChartTokens(ref) {
  const [tokens, setTokens] = React.useState(EMPTY);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setTokens(resolve(el));
    update();
    const scope = el.closest(".fos") ?? document.documentElement;
    const mo = new MutationObserver(update);
    mo.observe(scope, {
      attributes: true,
      attributeFilter: ["data-theme", "data-density", "data-radius", "style", "dir"]
    });
    return () => mo.disconnect();
  }, [ref]);
  return tokens;
}

// src/components/formatChartNumber.ts
var arNumber = new Intl.NumberFormat("ar-EG-u-nu-arab", { maximumFractionDigits: 2 });
function formatChartNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? arNumber.format(value) : "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed !== "" && !Number.isNaN(Number(trimmed))) {
      return arNumber.format(Number(trimmed));
    }
    return value;
  }
  return value == null ? "" : String(value);
}
function DataTable({
  data,
  categoryKey,
  series,
  caption,
  columnHeader
}) {
  return /* @__PURE__ */ jsxs("table", { className: "fos-chart__table", children: [
    /* @__PURE__ */ jsx("caption", { children: caption }),
    /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
      /* @__PURE__ */ jsx("th", { scope: "col", children: columnHeader }),
      series.map((s) => /* @__PURE__ */ jsx("th", { scope: "col", children: s.name ?? s.dataKey }, s.dataKey))
    ] }) }),
    /* @__PURE__ */ jsx("tbody", { children: data.map((row, i) => /* @__PURE__ */ jsxs("tr", { children: [
      /* @__PURE__ */ jsx("th", { scope: "row", children: String(row[categoryKey]) }),
      series.map((s) => /* @__PURE__ */ jsx("td", { children: formatChartNumber(row[s.dataKey]) }, s.dataKey))
    ] }, i)) })
  ] });
}
function BarChart({
  data,
  categoryKey,
  series,
  ariaLabel,
  stacked = false,
  showLegend = false,
  height = 280,
  tableFallback,
  className = ""
}) {
  const ref = React.useRef(null);
  const t = useChartTokens(ref);
  const stackId = stacked ? "stack" : void 0;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ref,
      className: `fos-chart fos-chart--bar ${className}`.trim(),
      role: "img",
      "aria-label": ariaLabel,
      children: [
        /* @__PURE__ */ jsx(ResponsiveContainer, { width: "100%", height, children: /* @__PURE__ */ jsxs(BarChart$1, { data, margin: { top: 8, right: 8, bottom: 8, left: 8 }, children: [
          /* @__PURE__ */ jsx(CartesianGrid, { stroke: t.line, strokeDasharray: "3 3", vertical: false }),
          /* @__PURE__ */ jsx(
            XAxis,
            {
              dataKey: categoryKey,
              reversed: t.dir === "rtl",
              tick: { fill: t.inkMuted, fontSize: 12 },
              stroke: t.line
            }
          ),
          /* @__PURE__ */ jsx(
            YAxis,
            {
              orientation: t.dir === "rtl" ? "right" : "left",
              tick: { fill: t.inkMuted, fontSize: 12 },
              stroke: t.line,
              tickFormatter: formatChartNumber
            }
          ),
          /* @__PURE__ */ jsx(
            Tooltip,
            {
              contentStyle: { background: t.surface, border: `1px solid ${t.line}`, color: t.ink },
              labelStyle: { color: t.ink },
              formatter: (value) => formatChartNumber(value)
            }
          ),
          showLegend && /* @__PURE__ */ jsx(Legend, { wrapperStyle: { color: t.ink } }),
          series.map((s, i) => /* @__PURE__ */ jsx(
            Bar,
            {
              dataKey: s.dataKey,
              name: s.name ?? s.dataKey,
              stackId,
              fill: s.color ?? t.palette[i % Math.max(t.palette.length, 1)] ?? t.brand,
              radius: [4, 4, 0, 0]
            },
            s.dataKey
          ))
        ] }) }),
        tableFallback && /* @__PURE__ */ jsx(
          DataTable,
          {
            data,
            categoryKey,
            series,
            caption: tableFallback.caption,
            columnHeader: tableFallback.columnHeader
          }
        )
      ]
    }
  );
}
function DataTable2({
  data,
  categoryKey,
  series,
  caption,
  columnHeader
}) {
  return /* @__PURE__ */ jsxs("table", { className: "fos-chart__table", children: [
    /* @__PURE__ */ jsx("caption", { children: caption }),
    /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
      /* @__PURE__ */ jsx("th", { scope: "col", children: columnHeader }),
      series.map((s) => /* @__PURE__ */ jsx("th", { scope: "col", children: s.name ?? s.dataKey }, s.dataKey))
    ] }) }),
    /* @__PURE__ */ jsx("tbody", { children: data.map((row, i) => /* @__PURE__ */ jsxs("tr", { children: [
      /* @__PURE__ */ jsx("th", { scope: "row", children: String(row[categoryKey]) }),
      series.map((s) => /* @__PURE__ */ jsx("td", { children: formatChartNumber(row[s.dataKey]) }, s.dataKey))
    ] }, i)) })
  ] });
}
function LineChart({
  data,
  categoryKey,
  series,
  ariaLabel,
  curve = "monotone",
  showDots = true,
  showLegend = false,
  height = 280,
  tableFallback,
  className = ""
}) {
  const ref = React.useRef(null);
  const t = useChartTokens(ref);
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ref,
      className: `fos-chart fos-chart--line ${className}`.trim(),
      role: "img",
      "aria-label": ariaLabel,
      children: [
        /* @__PURE__ */ jsx(ResponsiveContainer, { width: "100%", height, children: /* @__PURE__ */ jsxs(LineChart$1, { data, margin: { top: 8, right: 8, bottom: 8, left: 8 }, children: [
          /* @__PURE__ */ jsx(CartesianGrid, { stroke: t.line, strokeDasharray: "3 3", vertical: false }),
          /* @__PURE__ */ jsx(
            XAxis,
            {
              dataKey: categoryKey,
              reversed: t.dir === "rtl",
              tick: { fill: t.inkMuted, fontSize: 12 },
              stroke: t.line
            }
          ),
          /* @__PURE__ */ jsx(
            YAxis,
            {
              orientation: t.dir === "rtl" ? "right" : "left",
              tick: { fill: t.inkMuted, fontSize: 12 },
              stroke: t.line,
              tickFormatter: formatChartNumber
            }
          ),
          /* @__PURE__ */ jsx(
            Tooltip,
            {
              contentStyle: { background: t.surface, border: `1px solid ${t.line}`, color: t.ink },
              labelStyle: { color: t.ink },
              formatter: (value) => formatChartNumber(value)
            }
          ),
          showLegend && /* @__PURE__ */ jsx(Legend, { wrapperStyle: { color: t.ink } }),
          series.map((s, i) => {
            const color = s.color ?? t.palette[i % Math.max(t.palette.length, 1)] ?? t.brand;
            return /* @__PURE__ */ jsx(
              Line,
              {
                type: curve,
                dataKey: s.dataKey,
                name: s.name ?? s.dataKey,
                stroke: color,
                strokeWidth: 2,
                dot: showDots ? { fill: color, r: 3 } : false,
                activeDot: { r: 5 }
              },
              s.dataKey
            );
          })
        ] }) }),
        tableFallback && /* @__PURE__ */ jsx(
          DataTable2,
          {
            data,
            categoryKey,
            series,
            caption: tableFallback.caption,
            columnHeader: tableFallback.columnHeader
          }
        )
      ]
    }
  );
}
function DoughnutChart({
  data,
  ariaLabel,
  innerRatio = 0.6,
  showLegend = true,
  height = 280,
  tableFallback,
  className = ""
}) {
  const ref = React.useRef(null);
  const t = useChartTokens(ref);
  const outer = Math.round(height / 2 * 0.8);
  const inner = Math.round(outer * innerRatio);
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ref,
      className: `fos-chart fos-chart--doughnut ${className}`.trim(),
      role: "img",
      "aria-label": ariaLabel,
      children: [
        /* @__PURE__ */ jsx(ResponsiveContainer, { width: "100%", height, children: /* @__PURE__ */ jsxs(PieChart, { children: [
          /* @__PURE__ */ jsx(
            Pie,
            {
              data,
              dataKey: "value",
              nameKey: "name",
              cx: "50%",
              cy: "50%",
              innerRadius: inner,
              outerRadius: outer,
              stroke: t.surface,
              strokeWidth: 2,
              paddingAngle: 1,
              children: data.map((d, i) => /* @__PURE__ */ jsx(
                Cell,
                {
                  fill: d.color ?? t.palette[i % Math.max(t.palette.length, 1)] ?? t.brand
                },
                i
              ))
            }
          ),
          /* @__PURE__ */ jsx(
            Tooltip,
            {
              contentStyle: { background: t.surface, border: `1px solid ${t.line}`, color: t.ink },
              labelStyle: { color: t.ink },
              formatter: (value) => formatChartNumber(value)
            }
          ),
          showLegend && /* @__PURE__ */ jsx(Legend, { wrapperStyle: { color: t.ink } })
        ] }) }),
        tableFallback && /* @__PURE__ */ jsxs("table", { className: "fos-chart__table", children: [
          /* @__PURE__ */ jsx("caption", { children: tableFallback.caption }),
          /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
            /* @__PURE__ */ jsx("th", { scope: "col", children: tableFallback.labelHeader }),
            /* @__PURE__ */ jsx("th", { scope: "col", children: tableFallback.valueHeader })
          ] }) }),
          /* @__PURE__ */ jsx("tbody", { children: data.map((d, i) => /* @__PURE__ */ jsxs("tr", { children: [
            /* @__PURE__ */ jsx("th", { scope: "row", children: d.name }),
            /* @__PURE__ */ jsx("td", { children: formatChartNumber(d.value) })
          ] }, i)) })
        ] })
      ]
    }
  );
}

export { BarChart, DoughnutChart, LineChart, useChartTokens };
