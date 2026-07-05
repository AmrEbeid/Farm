// Sector scorecard (بطاقة أداء القطاعات) — SPEC-0029 Phase 3. The prototype's crown-jewel / best-unit
// benchmark insight, grounded on TRUE per-sector profit.
//
// PROFIT ATTRIBUTION (the subtle part, done right): revenue is NOT posted to cost-center journal lines — it is
// a reporting dimension on `sales` (tagged to an active LEAF center by fn_save_sale). So per sector we join:
//   revenue  = Σ finalized sales.total grouped by cost_center_id   (like finance/season)
//   expenses = the leaf center's v_cost_center_rollup.net           (net = expenses; leaf ⇒ subtree = own)
//   profit   = revenue − expenses
// at LEAF granularity (sales are always leaf-tagged), so revenue and expenses line up. HONESTY (#1): revenue
// with no center + the CC-UNALLOC expenses are surfaced as «غير موزّع», never spread onto sectors; owner
// drawings never enter (equity, not on sales or expense-tagged lines).
// Server Component; role owner/accountant (finance.read enforced by the view's RLS).

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Alert, Card, EmptyState, KpiCard, Tag } from "@/components/ui";
import { SimpleTable, type SimpleColumn } from "@/components/SimpleTable";
import { StoryLine } from "@/components/StoryLine";
import { egp, num } from "@/lib/money";
import {
  bestUnitBenchmark,
  concentrationThesis,
  profitPerFeddan,
  sectorStatus,
  type CenterPerf,
  type SectorStatus,
} from "@/lib/pnl-insights";
import type { CostCenterInsightRollup } from "@/lib/finance-insights";

const mutedStyle = { color: "var(--ink-muted)" } as const;

const STATUS_AR: Record<SectorStatus, string> = {
  crown: "الدرة المكنونة 👑",
  strong: "قوي",
  recovering: "في تعافٍ",
  attention: "يحتاج عناية",
};
const STATUS_TONE: Record<SectorStatus, "ok" | "info" | "warning" | "danger"> = {
  crown: "ok",
  strong: "info",
  recovering: "warning",
  attention: "danger",
};

type SaleRow = { cost_center_id: string | null; total: number | null; price_status: string };

export default async function SectorScorecardPage() {
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

  // Finalized revenue grouped by (leaf) cost center; and the unallocated (no-center) revenue.
  const revenueByCenter = new Map<string, number>();
  // Sector = active, non-system, has area, and is a LEAF (so its rollup net = its OWN expenses and its
  // leaf-tagged sales revenue line up). profit = revenue − expenses(net).
  const parentIds = new Set(rollup.map((r) => r.parent_id).filter(Boolean) as string[]);
  const sectorRows = rollup.filter(
    (r) => r.active && !r.is_system && (r.area_feddan ?? 0) > 0 && !parentIds.has(r.cost_center_id),
  );
  const sectorIds = new Set(sectorRows.map((r) => r.cost_center_id));

  // Attribute finalized revenue to sectors; anything not on a sector (null center OR a non-sector center) is
  // «غير موزّع» — so no sale's revenue silently vanishes from the picture.
  let unallocRevenue = 0;
  for (const s of sales) {
    const v = Number(s.total ?? 0);
    if (s.cost_center_id && sectorIds.has(s.cost_center_id)) {
      revenueByCenter.set(s.cost_center_id, (revenueByCenter.get(s.cost_center_id) ?? 0) + v);
    } else {
      unallocRevenue += v;
    }
  }

  const sectors: CenterPerf[] = sectorRows.map((r) => ({
    id: r.cost_center_id,
    name: r.name_ar,
    net: (revenueByCenter.get(r.cost_center_id) ?? 0) - Number(r.net ?? 0),
    areaFeddan: Number(r.area_feddan),
  }));

  // Untagged EXPENSES = the CC-UNALLOC row's DEBIT (its expense-account debits with no center). NOT its `net`:
  // net = debit − credit, and EVERY sales revenue credit is null-center → lands in CC-UNALLOC's credit, so net
  // is contaminated by all farm revenue (would show a large negative). debit is the honest untagged-cost figure.
  const unallocExpense = Number(rollup.find((r) => r.code === "CC-UNALLOC")?.debit ?? 0);
  const benchmark = bestUnitBenchmark(sectors);
  const concentration = concentrationThesis(sectors);
  const upsideById = new Map((benchmark?.rows ?? []).map((r) => [r.id, r.upside]));

  const cols: SimpleColumn[] = [
    { id: "sector", header: "القطاع" },
    { id: "net", header: "صافي الربح", numeric: true, kind: "money" },
    { id: "perFeddan", header: "ربح/فدان", numeric: true, kind: "money" },
    { id: "status", header: "التقييم" },
    { id: "upside", header: "الفرصة عند بلوغ الأفضل", numeric: true, kind: "money" },
  ];
  const tableRows = [...sectors]
    .sort((a, b) => (profitPerFeddan(b) ?? -Infinity) - (profitPerFeddan(a) ?? -Infinity))
    .map((s) => {
      const pf = profitPerFeddan(s);
      const status = benchmark ? sectorStatus(pf, benchmark.benchmarkPerFeddan) : null;
      return {
        id: s.id,
        sector: `${s.name} · ${num(s.areaFeddan, 1)} فدان`,
        net: s.net,
        perFeddan: pf ?? 0,
        status: status ? STATUS_AR[status] : "—",
        upside: upsideById.get(s.id) ?? 0,
      };
    });

  const punchline =
    benchmark &&
    `لو بلغت كل القطاعات إنتاجية «${benchmark.benchmarkName}» (${egp(benchmark.benchmarkPerFeddan)} لكل فدان) ` +
      `لحققت المزرعة ${egp(benchmark.fullPotential)} — أي فرصة إضافية قدرها ${egp(benchmark.impliedUpside)}. ` +
      `المزرعة ليست ضعيفة الأداء بل في مرحلة نمو؛ القطاع الأنضج يثبت نجاح النموذج.`;

  const hasUnalloc = Math.abs(unallocExpense) > 0 || unallocRevenue > 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">بطاقة أداء القطاعات</h1>
        <p style={mutedStyle}>
          ترتيب القطاعات حسب الربح لكل فدان، والفرصة الكامنة لو بلغ كل قطاع إنتاجية الأفضل — إيراد كل قطاع من
          مبيعاته الموسمية ناقص مصروفاته الموزّعة.
        </p>
      </header>

      {sectors.length < 2 || !benchmark ? (
        <Card title="بطاقة أداء القطاعات">
          <EmptyState title="لا تتوفر بيانات كافية للقطاعات (تحتاج قطاعين على الأقل بمساحة وربح موجب) لعرض المقارنة بعد." />
        </Card>
      ) : (
        <>
          {punchline && <StoryLine lead={punchline} />}

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="القطاع الأفضل" value={benchmark.benchmarkName} icon="👑" />
            <KpiCard label="أفضل ربح/فدان" value={egp(benchmark.benchmarkPerFeddan)} icon="📈" />
            <KpiCard label="الإمكانات الكاملة" value={egp(benchmark.fullPotential)} icon="🎯" />
            <KpiCard label="الفرصة الإضافية" value={egp(benchmark.impliedUpside)} icon="🚀" deltaDirection="up" />
          </section>

          {concentration && <Alert tone="info" title={concentration.title} description={concentration.body} />}

          {hasUnalloc && (
            <Alert
              tone="warning"
              title="دقّة المقارنة تعتمد على توزيع الإيراد والتكلفة"
              description={`إيرادات غير مرتبطة بقطاع: ${egp(unallocRevenue)}؛ ومصروفات غير موزّعة: ${egp(unallocExpense)}. ` +
                `ربح كل قطاع يشمل فقط ما تم ربطه به من مبيعات ومصروفات — كلما تحسّن الربط دقّت هذه المقارنة. راجع «رؤى المالك» لدرجة التوزيع.`}
            />
          )}

          <Card title="ترتيب القطاعات">
            <SimpleTable columns={cols} rows={tableRows} ariaLabel="ترتيب القطاعات حسب الربح لكل فدان" empty="—" />
            <div className="mt-3 flex flex-wrap gap-2">
              {(["crown", "strong", "recovering", "attention"] as SectorStatus[]).map((s) => (
                <Tag key={s} tone={STATUS_TONE[s]}>{STATUS_AR[s]}</Tag>
              ))}
            </div>
          </Card>

          <p className="text-sm" style={mutedStyle}>
            «الفرصة» = فجوة الربح/فدان عن الأفضل × مساحة القطاع — ليست تنبؤًا بل ما كان القطاع سيضيفه عند بلوغ
            إنتاجية الأفضل. الإيراد من المبيعات المُسعّرة؛ المسحوبات لا تُحتسب.{" "}
            <Link href="/finance/insights" className="font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>
              رؤى المالك ←
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
