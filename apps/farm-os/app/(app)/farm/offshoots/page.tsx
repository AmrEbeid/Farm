import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { CurrentFilterCard } from "@/components/CurrentFilterCard";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn } from "@/components/SimpleTable";
import { CategoryBarChart, MultiInsightChart } from "@/components/charts";
import { ImportPanel } from "@/components/import/ImportPanel";
import { PrintButton } from "@/components/print-button";
import { OffshootMovementForm, OffshootValuationForm, type OffshootCostCenterOption } from "@/components/OffshootBankForms";
import { buildOffshootBankSummary, OFFSHOOT_TYPE_AR, type OffshootMovementType } from "@/lib/offshoot-bank";
import { fmtDate } from "@/lib/dates";
import { egp, num, pct } from "@/lib/money";

type CostCenterRow = {
  id: string;
  code: string;
  name_ar: string;
  parent_id: string | null;
  active: boolean;
  is_system: boolean;
  sort_order: number | null;
};

type Focus = "all" | OffshootMovementType;

export const dynamic = "force-dynamic";

export default async function OffshootBankPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const focus = parseFocus(type);
  const m = await requireRole(["owner", "accountant", "farm_manager"]);
  const sb = await createClient();
  const canRecord = m.role === "owner" || m.role === "farm_manager";
  const canSeeValuation = m.role === "owner" || m.role === "accountant";

  const [movementsRes, centersRes, valuationRes] = await Promise.all([
    sb
      .from("offshoot_movements")
      .select("id, movement_date, movement_type, qty, source_cost_center_id, dest_cost_center_id, note")
      .eq("org_id", m.orgId)
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false }),
    sb
      .from("cost_centers")
      .select("id, code, name_ar, parent_id, active, is_system, sort_order")
      .eq("org_id", m.orgId)
      .order("sort_order", { ascending: true }),
    canSeeValuation
      ? sb.from("offshoot_valuation").select("low_per_unit, high_per_unit, updated_at").eq("org_id", m.orgId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (movementsRes.error) throw movementsRes.error;
  if (centersRes.error) throw centersRes.error;
  if (valuationRes.error) throw valuationRes.error;

  const costCenters = (centersRes.data ?? []) as CostCenterRow[];
  const childCount = new Map<string, number>();
  for (const center of costCenters) {
    if (center.parent_id && center.active) childCount.set(center.parent_id, (childCount.get(center.parent_id) ?? 0) + 1);
  }
  const centerOptions: OffshootCostCenterOption[] = costCenters.map((center) => ({
    id: center.id,
    label: `${center.code} · ${center.name_ar}`,
    isLeaf: (childCount.get(center.id) ?? 0) === 0,
    isSystem: center.is_system,
    active: center.active,
  }));
  const summary = buildOffshootBankSummary({
    movements: movementsRes.data ?? [],
    costCenters,
    valuation: valuationRes.data ?? null,
  });
  const visibleMovements = focus === "all"
    ? summary.movementRows
    : summary.movementRows.filter((row) => row.movementType === focus);
  const movementRows = visibleMovements.map((row) => ({
    id: row.id,
    date: fmtDate(row.date),
    type: row.type,
    qty: row.qty,
    source: row.source,
    destination: row.destination,
    note: row.note,
  }));
  const expansionChartRows = summary.destinationRows.map((row) => ({
    center: row.center,
    "زراعة": row.planted,
    "إحلال": row.replanted,
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">بنك الفسائل</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            سجل كمي للفسائل المنتجة والمزروعة والمباعة والمستخدمة في الإحلال، مرتبط بمراكز التكلفة.
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <PrintButton label="طباعة بنك الفسائل" />
          <HeaderLink href="/farm/dashboard">لوحة المزرعة</HeaderLink>
          <HeaderLink href="/farm">هيكل المزرعة</HeaderLink>
          {canSeeValuation && <HeaderLink href="/finance/insights">رؤى المالك</HeaderLink>}
          {canSeeValuation && <HeaderLink href="/finance/dashboard">لوحة المالية</HeaderLink>}
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardKpiLink href="/farm/offshoots?type=produce" active={focus === "produce"}>
          <KpiCard label="منتج" value={num(summary.produced)} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/farm/offshoots?type=plant" active={focus === "plant"}>
          <KpiCard label="مزروع" value={num(summary.planted)} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/farm/offshoots?type=sell" active={focus === "sell"}>
          <KpiCard label="مباع" value={num(summary.sold)} />
        </DashboardKpiLink>
        <KpiCard
          label="متاح"
          value={num(summary.remaining)}
          delta={summary.hasNegativeBalance ? "يحتاج مراجعة" : `${num(summary.replanted)} إحلال`}
          deltaDirection={summary.hasNegativeBalance ? "down" : "none"}
        />
        {/* Retention = share of produced offshoots KEPT for the farm's own expansion (not sold). Pure
            derivation from produced/sold — honest-null when nothing produced yet (#1). */}
        <KpiCard
          label="معدل الاحتفاظ"
          value={summary.produced > 0 ? pct((summary.produced - summary.sold) / summary.produced) : "—"}
          delta="المُبقى للمزرعة مقابل المُنتج"
        />
      </section>

      {canSeeValuation && (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="تقدير منخفض للوحدة" value={summary.lowPerUnit == null ? "—" : egp(summary.lowPerUnit)} />
          <KpiCard label="تقدير مرتفع للوحدة" value={summary.highPerUnit == null ? "—" : egp(summary.highPerUnit)} />
          <KpiCard label="تقدير منخفض للمخزون" value={summary.estimatedLow == null ? "—" : egp(summary.estimatedLow)} />
          <KpiCard label="تقدير مرتفع للمخزون" value={summary.estimatedHigh == null ? "—" : egp(summary.estimatedHigh)} />
        </section>
      )}

      <CurrentFilterCard
        label={focus === "all" ? "كل الحركات" : OFFSHOOT_TYPE_AR[focus]}
        clearHref="/farm/offshoots"
        showClear={focus !== "all"}
      />

      <section className="no-print grid gap-4 xl:grid-cols-2">
        {canRecord && (
          <Card title="تسجيل حركة">
            <OffshootMovementForm centers={centerOptions} />
          </Card>
        )}
        {canSeeValuation && (
          <Card title="تقييم تقديري">
            <OffshootValuationForm lowPerUnit={summary.lowPerUnit} highPerUnit={summary.highPerUnit} />
          </Card>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card title="تدفق الفسائل">
          {summary.typeChartRows.some((row) => row.qty > 0) ? (
            <MultiInsightChart
              ariaLabel="اختيار منظور بنك الفسائل"
              options={[
                {
                  id: "types",
                  label: "الحركات",
                  render: () => (
                    <CategoryBarChart
                      data={summary.typeChartRows}
                      categoryKey="type"
                      series={[{ dataKey: "qty", name: "فسيلة" }]}
                      ariaLabel="تدفق الفسائل حسب نوع الحركة"
                      caption="الحركات"
                      columnHeader="النوع"
                    />
                  ),
                },
                {
                  id: "destinations",
                  label: "التوسع",
                  render: () =>
                    expansionChartRows.length ? (
                      <CategoryBarChart
                        data={expansionChartRows}
                        categoryKey="center"
                        series={[
                          { dataKey: "زراعة", name: "زراعة" },
                          { dataKey: "إحلال", name: "إحلال" },
                        ]}
                        ariaLabel="زراعة وإحلال الفسائل حسب مركز التكلفة"
                        caption="التوسع"
                        columnHeader="المركز"
                      />
                    ) : (
                      <EmptyState title="لا توجد وجهات زراعة أو إحلال بعد" />
                    ),
                },
              ]}
            />
          ) : (
            <EmptyState title="لا توجد حركات فسائل بعد" />
          )}
        </Card>

        <Card title="التوسع حسب مركز التكلفة">
          {summary.destinationRows.length ? (
            <FilterableTable
              columns={destinationColumns}
              rows={summary.destinationRows}
              ariaLabel="التوسع حسب مركز التكلفة"
              exportFilename="offshoot expansion by cost center.csv"
              minRowsForSearch={1}
            />
          ) : (
            <EmptyState title="لا توجد فسائل مزروعة أو مستخدمة في الإحلال" />
          )}
        </Card>
      </section>

      <Card title="حركات بنك الفسائل">
        {movementRows.length ? (
          <FilterableTable
            columns={movementColumns}
            rows={movementRows}
            ariaLabel="حركات بنك الفسائل"
            exportFilename="offshoot movements.csv"
            minRowsForSearch={1}
          />
        ) : (
          <EmptyState title="لا توجد حركات مطابقة" />
        )}
      </Card>

      {canRecord && (
        <div className="no-print">
          <Card title="استيراد الحركات">
            <ImportPanel descriptorKey="offshoot-movements" titleAr="حركات بنك الفسائل" />
          </Card>
        </div>
      )}
    </div>
  );
}

const movementColumns: SimpleColumn[] = [
  { id: "date", header: "التاريخ" },
  { id: "type", header: "الحركة", kind: "status" },
  { id: "qty", header: "الكمية", kind: "num", numeric: true },
  { id: "source", header: "المصدر" },
  { id: "destination", header: "الوجهة" },
  { id: "note", header: "ملاحظة" },
];

const destinationColumns: SimpleColumn[] = [
  { id: "center", header: "مركز التكلفة" },
  { id: "planted", header: "زراعة", kind: "num", numeric: true },
  { id: "replanted", header: "إحلال", kind: "num", numeric: true },
  { id: "total", header: "الإجمالي", kind: "num", numeric: true },
];

function parseFocus(value: string | undefined): Focus {
  return value === "produce" || value === "plant" || value === "sell" || value === "replant" ? value : "all";
}

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center justify-center rounded-md px-3 text-sm font-semibold"
      style={{
        color: "var(--brand)",
        background: "var(--surface)",
        border: "1px solid var(--line)",
      }}
    >
      {children}
    </Link>
  );
}
