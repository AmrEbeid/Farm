import * as React from 'react';

interface ChartTokens {
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
/**
 * Resolve theme-derived chart colors off `ref`'s element via getComputedStyle.
 * Re-reads when the nearest `.fos` scope's theme attributes change, so charts
 * recolor instantly when the consumer flips scheme/density/radius/brand.
 */
declare function useChartTokens(ref: React.RefObject<HTMLElement>): ChartTokens;

interface ChartSeries {
    /** Key into each datum object for this series' numeric value. */
    dataKey: string;
    /** Consumer-supplied display name (legend/tooltip); presentational only. */
    name?: string;
    /** Optional explicit color; defaults to the theme palette by index. */
    color?: string;
}
interface BarChartProps {
    data: Array<Record<string, string | number>>;
    categoryKey: string;
    series: ChartSeries[];
    ariaLabel: string;
    stacked?: boolean;
    showLegend?: boolean;
    height?: number;
    tableFallback?: {
        caption: string;
        columnHeader: string;
    };
    className?: string;
}
/** Theme-aware Recharts bar chart. Series colors come from role tokens. */
declare function BarChart({ data, categoryKey, series, ariaLabel, stacked, showLegend, height, tableFallback, className, }: BarChartProps): React.JSX.Element;

interface LineChartProps {
    data: Array<Record<string, string | number>>;
    categoryKey: string;
    series: ChartSeries[];
    ariaLabel: string;
    curve?: "monotone" | "linear";
    showDots?: boolean;
    showLegend?: boolean;
    height?: number;
    tableFallback?: {
        caption: string;
        columnHeader: string;
    };
    className?: string;
}
/** Theme-aware Recharts line chart. Stroke colors come from role tokens. */
declare function LineChart({ data, categoryKey, series, ariaLabel, curve, showDots, showLegend, height, tableFallback, className, }: LineChartProps): React.JSX.Element;

interface DoughnutDatum {
    name: string;
    value: number;
    color?: string;
}
interface DoughnutChartProps {
    data: DoughnutDatum[];
    ariaLabel: string;
    innerRatio?: number;
    showLegend?: boolean;
    height?: number;
    tableFallback?: {
        caption: string;
        labelHeader: string;
        valueHeader: string;
    };
    className?: string;
}
/** Theme-aware Recharts doughnut (Pie with inner radius). Slice colors from role tokens. */
declare function DoughnutChart({ data, ariaLabel, innerRatio, showLegend, height, tableFallback, className, }: DoughnutChartProps): React.JSX.Element;

export { BarChart, type BarChartProps, type ChartSeries, type ChartTokens, DoughnutChart, type DoughnutChartProps, type DoughnutDatum, LineChart, type LineChartProps, useChartTokens };
