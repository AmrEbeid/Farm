// Enterprise (crop) scorecard (اقتصاد المحاصيل) — SPEC-0029, over cropRoi. Ranks each enterprise/crop by ROI
// and margin and fires the crop-mix imbalance thesis ("the prestige crop subsidizes; the rotation crop is the
// profit engine"). Grounded on the `enterprise` dimension of cost_centers.
//
// ATTRIBUTION (same discipline as the sector scorecard): per enterprise, over LEAF centers carrying that
// enterprise label (leaf ⇒ rollup net = own expenses; sales are leaf-tagged so revenue lines up):
//   expenses = Σ leaf-center rollup.net grouped by enterprise
//   revenue  = Σ finalized sales.total, mapped through the sale's cost center → its enterprise
//   profit/margin/roi via cropRoi.
// HONESTY (#1): revenue/expenses NOT tied to any enterprise (null center, no-enterprise center, or CC-UNALLOC
// untagged cost via its DEBIT — never its revenue-contaminated net) are surfaced as «غير موزّع», never spread
// onto a crop. Owner drawings never enter (equity). Server Component; role owner/accountant.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, Card, EmptyState, KpiCard } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn } from "@/components/SimpleTable";
import { StoryLine } from "@/components/StoryLine";
import { PrintButton } from "@/components/print-button";
import { egp, num, pct } from "@/lib/money";
import { cropRoi, cropRoiThesis } from "@/lib/pnl-insights";
import { computeEnterprisePnl } from "@/lib/entity-pnl";
import type { CostCenterInsightRollup } from "@/lib/finance-insights";

const mutedStyle = { color: "var(--ink-muted)" } as const;
type SaleRow = { cost_center_id: string | null; total: number | null; price_status: string };

export default async function EnterpriseScorecardPage() {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const [rollupRes, salesRes] = await Promise.all([
    sb.from("v_cost_center_rollup").select("*").eq("org_id", m.orgId).order("sort_order", { ascending: true }),
    sb.from("sales").select("cost_center_id, total, price_status").eq("org_id", m.orgId).eq("price_status", "finalized"),
  ]);
  if (rollupRes.error) throw rollupRes.error;
  if (salesRes.error) throw salesRes.error;
  const rollup = (rollupRes.data ?? []) as CostCenterInsightRollup[];
  const sales = (salesRes.data ?? []) as SaleRow[];

  // Per-enterprise (crop) revenue/expenses via the cost-center `enterprise` label; untagged → «غير موزّع».
  // The subtle attribution lives (and is unit-tested) in lib/entity-pnl, not duplicated here.
  const { enterprises, unallocRevenue, unallocExpense } = computeEnterprisePnl(rollup, sales);
  const rows = cropRoi(enterprises).sort((a, b) => (b.roi ?? -Infinity) - (a.roi ?? -Infinity));
  const thesis = cropRoiThesis(rows);
  const hasData = rows.some((r) => r.revenue !== 0 || r.expenses !== 0);
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0);

  const cols: SimpleColumn[] = [
    { id: "crop", header: "المحصول" },
    { id: "revenue", header: "الإيراد", numeric: true, kind: "money" },
    { id: "expenses", header: "التكلفة", numeric: true, kind: "money" },
    { id: "profit", header: "الربح", numeric: true, kind: "money" },
    { id: "margin", header: "هامش الربح", numeric: true },
    { id: "roi", header: "العائد على التكلفة", numeric: true },
  ];
  const tableRows = rows.map((r) => ({
    id: r.key,
    crop: r.key,
    revenue: r.revenue,
    expenses: r.expenses,
    profit: r.profit,
    margin: r.margin == null ? "—" : pct(r.margin * 100),
    roi: r.roi == null ? "—" : pct(r.roi * 100),
  }));

  const hasUnalloc = Math.abs(unallocExpense) > 0 || unallocRevenue > 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">اقتصاد المحاصيل</h1>
          <p style={mutedStyle}>
            ربحية كل محصول وعائده على التكلفة — إيراد المحصول من مبيعاته الموسمية ناقص مصروفات مراكزه، مرتّبة حسب
            العائد على التكلفة.
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <PrintButton label="طباعة اقتصاد المحاصيل" />
        </div>
      </header>

      {!hasData || rows.length < 1 ? (
        <Card title="اقتصاد المحاصيل">
          <EmptyState title="لا توجد بيانات محاصيل موزّعة على مراكز التكلفة بعد لعرض المقارنة." />
        </Card>
      ) : (
        <>
          {thesis && <StoryLine lead={thesis.body} />}

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="عدد المحاصيل" value={num(rows.length)} icon="🌱" />
            <KpiCard
              label="أعلى عائد على التكلفة"
              value={rows[0]?.roi == null ? "—" : `${rows[0].key} · ${pct((rows[0].roi ?? 0) * 100)}`}
              icon="🏆"
            />
            <KpiCard label="إجمالي ربح المحاصيل" value={egp(totalProfit)} icon="📈" deltaDirection={totalProfit >= 0 ? "up" : "down"} />
            <KpiCard label="غير موزّع (إيراد)" value={egp(unallocRevenue)} icon="❓" />
          </section>

          {hasUnalloc && (
            <Alert
              tone="warning"
              title="دقّة المقارنة تعتمد على ربط المبيعات والمصروفات بالمحاصيل"
              description={`إيرادات غير مرتبطة بمحصول: ${egp(unallocRevenue)}؛ ومصروفات غير مرتبطة بمحصول: ${egp(unallocExpense)}. ` +
                `يُحتسب لكل محصول فقط ما رُبط به عبر مراكز التكلفة — كلما تحسّن الربط دقّت هذه المقارنة.`}
            />
          )}

          <Card title="ترتيب المحاصيل حسب العائد">
            <FilterableTable
              columns={cols}
              rows={tableRows}
              ariaLabel="ربحية المحاصيل والعائد على التكلفة"
              exportFilename="enterprise-scorecard"
              minRowsForSearch={1}
              empty="—"
            />
          </Card>

          <p className="text-sm" style={mutedStyle}>
            «العائد على التكلفة» = الربح ÷ التكلفة؛ «هامش الربح» = الربح ÷ الإيراد. الإيراد من المبيعات المُسعّرة؛
            المسحوبات لا تُحتسب.
            {" "}
            <Link href="/finance/sector-scorecard" className="no-print font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>
              أداء القطاعات ←
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
