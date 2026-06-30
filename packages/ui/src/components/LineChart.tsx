import * as React from "react";
import {
  ResponsiveContainer, LineChart as RLineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import { useChartTokens } from "./useChartTokens";
import { formatChartNumber } from "./formatChartNumber";
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
            {series.map((s) => <td key={s.dataKey}>{formatChartNumber(row[s.dataKey])}</td>)}
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
            tickFormatter={formatChartNumber}
          />
          <Tooltip
            contentStyle={{ background: t.surface, border: `1px solid ${t.line}`, color: t.ink }}
            labelStyle={{ color: t.ink }}
            formatter={(value) => formatChartNumber(value)}
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
