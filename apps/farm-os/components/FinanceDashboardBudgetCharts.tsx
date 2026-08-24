"use client";

import { Card } from "@/components/ui";
import { BudgetDoughnut, VarianceChart } from "@/components/charts-client";

export interface FinanceDashboardVarianceRow {
  category: string;
  planned: number;
  actual: number;
  plannedLabel: string;
  actualLabel: string;
}

export interface FinanceDashboardBudgetChartData {
  used: number;
  available: number;
  usedLabel: string;
  availableLabel: string;
  variance: FinanceDashboardVarianceRow[];
}

export function FinanceDashboardBudgetCharts({
  used,
  available,
  variance,
}: FinanceDashboardBudgetChartData) {
  return (
    <section className="grid gap-4 lg:grid-cols-2" data-testid="finance-budget-charts">
      <Card title="استخدام لقطة الموازنة">
        <BudgetDoughnut used={used} available={available} />
      </Card>
      {variance.length > 0 && (
        <Card title="المعتمد مقابل لقطة الملتزم والفعلي حسب الفئة">
          <VarianceChart data={variance} />
        </Card>
      )}
    </section>
  );
}
