import * as React from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import { useChartTokens } from "./useChartTokens";
import { formatChartNumber } from "./formatChartNumber";

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
            formatter={(value) => formatChartNumber(value)}
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
                <td>{formatChartNumber(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
