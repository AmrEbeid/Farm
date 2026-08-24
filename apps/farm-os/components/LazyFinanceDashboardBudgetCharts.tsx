"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui";
import type { FinanceDashboardBudgetChartData } from "@/components/FinanceDashboardBudgetCharts";

const FinanceDashboardBudgetCharts = lazy(
  () =>
    import("@/components/FinanceDashboardBudgetCharts").then(
      (module) => ({ default: module.FinanceDashboardBudgetCharts }),
    ),
);

function ChartPlaceholder({ height, children }: { height: number; children: React.ReactNode }) {
  return (
    <div className="fos-chart finance-lazy-chart__placeholder">
      <div
        className="fos-chart__canvas no-print flex items-center justify-center"
        style={{ height }}
        aria-hidden="true"
      >
        <div className="h-36 w-full max-w-md animate-pulse rounded-md" style={{ background: "var(--surface-subtle)" }} />
      </div>
      {children}
    </div>
  );
}

function BudgetChartsPlaceholder({
  usedLabel,
  availableLabel,
  variance,
}: Pick<FinanceDashboardBudgetChartData, "usedLabel" | "availableLabel" | "variance">) {
  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-label="رسوم الموازنة" aria-busy="true">
      <Card title="استخدام لقطة الموازنة">
        <ChartPlaceholder height={240}>
          <table className="fos-chart__table finance-lazy-chart__fallback">
            <caption>استخدام الموازنة</caption>
            <thead><tr><th scope="col">البند</th><th scope="col">القيمة</th></tr></thead>
            <tbody>
              <tr><th scope="row">المستخدم</th><td>{usedLabel}</td></tr>
              <tr><th scope="row">المتاح</th><td>{availableLabel}</td></tr>
            </tbody>
          </table>
        </ChartPlaceholder>
      </Card>
      {variance.length > 0 && (
        <Card title="المعتمد مقابل لقطة الملتزم والفعلي حسب الفئة">
          <ChartPlaceholder height={260}>
            <table className="fos-chart__table finance-lazy-chart__fallback">
              <caption>المخطط مقابل الفعلي</caption>
              <thead><tr><th scope="col">البند</th><th scope="col">المخطط</th><th scope="col">الفعلي</th></tr></thead>
              <tbody>
                {variance.map((row) => (
                  <tr key={row.category}>
                    <th scope="row">{row.category}</th>
                    <td>{row.plannedLabel}</td>
                    <td>{row.actualLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ChartPlaceholder>
        </Card>
      )}
    </section>
  );
}

export function LazyFinanceDashboardBudgetCharts({
  used,
  available,
  usedLabel,
  availableLabel,
  variance,
}: FinanceDashboardBudgetChartData) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "300px" },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  if (shouldLoad) {
    return (
      <Suspense fallback={<BudgetChartsPlaceholder usedLabel={usedLabel} availableLabel={availableLabel} variance={variance} />}>
        <FinanceDashboardBudgetCharts
          used={used}
          available={available}
          usedLabel={usedLabel}
          availableLabel={availableLabel}
          variance={variance}
        />
      </Suspense>
    );
  }

  return (
    <div ref={rootRef}>
      <BudgetChartsPlaceholder usedLabel={usedLabel} availableLabel={availableLabel} variance={variance} />
    </div>
  );
}
