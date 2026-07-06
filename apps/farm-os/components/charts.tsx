import type { ReactNode } from "react";
import { MultiInsightChartClient } from "@/components/charts-client";

export {
  BudgetDoughnut,
  CategoryBarChart,
  CategoryDoughnut,
  PalmStatusDoughnut,
  PabChart,
  TrendLineChart,
  VarianceChart,
} from "@/components/charts-client";

export interface ChartInsightOption {
  id: string;
  label: string;
  render?: () => ReactNode;
  content?: ReactNode;
}

export function MultiInsightChart({
  options,
  defaultOptionId,
  ariaLabel,
}: {
  options: ChartInsightOption[];
  defaultOptionId?: string;
  ariaLabel: string;
}) {
  return (
    <MultiInsightChartClient
      options={options.map(({ render, content, ...option }) => ({
        ...option,
        content: content ?? render?.() ?? null,
      }))}
      defaultOptionId={defaultOptionId}
      ariaLabel={ariaLabel}
    />
  );
}
