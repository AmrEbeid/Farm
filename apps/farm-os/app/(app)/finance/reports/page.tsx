import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState, KpiCard, Tag } from "@/components/ui";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { CategoryBarChart, MultiInsightChart, TrendLineChart } from "@/components/charts";
import { egp, num } from "@/lib/money";
import { StoryLine } from "@/components/StoryLine";

type CostCenterRollupRow = {
  org_id: string;
  cost_center_id: string;
  parent_id: string | null;
  code: string;
  name_ar: string;
  sector_id: string | null;
  enterprise: string | null;
  area_feddan: number | null;
  active: boolean;
  is_system: boolean;
  sort_order: number | null;
  debit: number;
  credit: number;
  net: number;
  net_per_feddan: number | null;
};

type ReconciliationFlagRow = {
  org_id: string;
  cost_center_id: string;
  code: string;
  name_ar: string;
  flag_code: string;
  message_ar: string;
};

type JournalLineRow = {
  id: string;
  journal_entry_id: string;
  account_id: string;
  cost_center_id: string | null;
  debit: number;
  credit: number;
};

type JournalEntryRow = {
  id: string;
  entry_date: string;
};

type AccountRow = {
  id: string;
  code: string;
  name_ar: string;
  account_type: string;
};

type Focus = "all" | "posted" | "flags";

const ACCOUNT_TYPE_AR: Record<string, string> = {
  expense: "مصروف",
  revenue: "إيراد",
};

const FLAG_LABEL_AR: Record<string, string> = {
  missing_sector_link: "بلا ربط قطاع",
  area_mismatch: "اختلاف مساحة",
};

export default async function FinanceReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ center?: string; focus?: string }>;
}) {
  const { center, focus: requestedFocus } = await searchParams;
  const focus = parseFocus(requestedFocus);
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();

  const [rollupRes, flagsRes, journalLines, journalEntries, accounts] = await Promise.all([
    sb.from("v_cost_center_rollup").select("*").eq("org_id", m.orgId).order("sort_order", { ascending: true }),
    sb.from("v_cost_center_reconciliation_flags").select("*").eq("org_id", m.orgId).order("code", { ascending: true }),
    fetchAllRows<JournalLineRow>(async (from, to) =>
      await sb
        .from("journal_lines")
        .select("id, journal_entry_id, account_id, cost_center_id, debit, credit")
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows<JournalEntryRow>(async (from, to) =>
      await sb.from("journal_entries").select("id, entry_date").order("entry_date", { ascending: true }).range(from, to),
    ),
    fetchAllRows<AccountRow>(async (from, to) =>
      await sb.from("accounts").select("id, code, name_ar, account_type").order("code", { ascending: true }).range(from, to),
    ),
  ]);
  if (rollupRes.error) throw rollupRes.error;
  if (flagsRes.error) throw flagsRes.error;

  const rollup = ((rollupRes.data ?? []) as CostCenterRollupRow[]).filter((row) => row.org_id === m.orgId);
  const flags = ((flagsRes.data ?? []) as ReconciliationFlagRow[]).filter((row) => row.org_id === m.orgId);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const entryById = new Map(journalEntries.map((entry) => [entry.id, entry]));
  const centerById = new Map(rollup.map((row) => [row.cost_center_id, row]));
  const centerByCode = new Map(rollup.map((row) => [row.code, row]));
  const flaggedIds = new Set(flags.map((flag) => flag.cost_center_id));
  const hasPosted = new Set(
    rollup
      .filter((row) => Number(row.debit ?? 0) !== 0 || Number(row.credit ?? 0) !== 0 || Number(row.net ?? 0) !== 0)
      .map((row) => row.cost_center_id),
  );
  const selectedCenter = center ? centerByCode.get(center) : null;
  const visibleRollup = rollup.filter((row) => {
    if (selectedCenter) return row.cost_center_id === selectedCenter.cost_center_id;
    if (focus === "posted") return hasPosted.has(row.cost_center_id);
    if (focus === "flags") return flaggedIds.has(row.cost_center_id);
    return true;
  });

  const financeLines = journalLines.filter((line) => {
    const accountType = accountById.get(line.account_id)?.account_type;
    return accountType === "expense" || accountType === "revenue";
  });
  const unallocatedLines = financeLines.filter((line) => line.cost_center_id == null).length;
  const expenseTotal = financeLines.reduce((sum, line) => {
    const account = accountById.get(line.account_id);
    return account?.account_type === "expense" ? sum + Number(line.debit ?? 0) - Number(line.credit ?? 0) : sum;
  }, 0);
  const revenueTotal = financeLines.reduce((sum, line) => {
    const account = accountById.get(line.account_id);
    return account?.account_type === "revenue" ? sum + Number(line.credit ?? 0) - Number(line.debit ?? 0) : sum;
  }, 0);
  const profit = revenueTotal - expenseTotal;

  const rollupRows = visibleRollup.map((row) => {
    const parent = row.parent_id ? centerById.get(row.parent_id) : null;
    const flagged = flaggedIds.has(row.cost_center_id);
    return {
      id: row.cost_center_id,
      code: row.code,
      center: row.name_ar,
      parent: parent ? parent.name_ar : "جذر",
      enterprise: row.enterprise ?? "غير متوفر",
      area: row.area_feddan ?? undefined,
      debit: Number(row.debit ?? 0),
      credit: Number(row.credit ?? 0),
      net: Number(row.net ?? 0),
      netPerFeddan: row.net_per_feddan ?? undefined,
      status: row.active ? (flagged ? "مراجعة" : "نشط") : "مؤرشف",
    };
  });

  const matrix = buildYearMatrix(financeLines, entryById, accountById, centerById, centerByCode.get("CC-UNALLOC"));
  const centerCharts = buildCenterChartData(rollup);
  const trendChart = buildYearTrend(financeLines, entryById, accountById);

  // U-12 (§2c): the period's story in one sentence — derived from the same journal lines below (#1).
  const costLead =
    expenseTotal > 0 || revenueTotal > 0
      ? `أنفقت المزرعة ${egp(expenseTotal)} مقابل ${egp(revenueTotal)} إيرادًا — ${profit >= 0 ? "فائض" : "عجز"} ${egp(Math.abs(profit))} في هذه الفترة.`
      : "لا قيود مصروفات أو إيرادات في هذه الفترة بعد.";
  const costNotes: string[] = [];
  if (unallocatedLines > 0)
    costNotes.push(`⚠ ${num(unallocatedLines)} قيد غير موزَّع على مركز تكلفة — وزّعها لتكتمل صورة «أين تذهب الفلوس».`);

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">تقارير مراكز التكلفة</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            مصروفات وإيرادات كل مركز تكلفة من القيود المرحّلة فقط؛ غير الموزع يظهر صراحة ولا يتم تخمينه.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <HeaderLink href="/finance/dashboard">لوحة المالية</HeaderLink>
          <HeaderLink href="/finance/accounts">شجرة الحسابات</HeaderLink>
          <HeaderLink href="/accounting">المحاسبة</HeaderLink>
        </div>
      </header>

      <StoryLine lead={costLead} notes={costNotes} />


      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <DashboardKpiLink href="/finance/reports" active={!center && focus === "all"}>
          <KpiCard label="مراكز التكلفة" value={num(rollup.length)} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/finance/reports?focus=posted" active={!center && focus === "posted"}>
          <KpiCard label="لها قيود" value={num(hasPosted.size)} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/finance/reports?center=CC-UNALLOC" active={center === "CC-UNALLOC"}>
          <KpiCard label="سطور غير موزّعة" value={num(unallocatedLines)} deltaDirection={unallocatedLines > 0 ? "down" : "none"} />
        </DashboardKpiLink>
        <DashboardKpiLink href="/finance/reports?focus=flags" active={!center && focus === "flags"}>
          <KpiCard label="بنود مراجعة" value={num(flags.length)} deltaDirection={flags.length > 0 ? "down" : "none"} />
        </DashboardKpiLink>
        <KpiCard label="صافي التشغيل" value={egp(profit)} deltaDirection={profit < 0 ? "down" : "none"} />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="مصروفات" value={egp(expenseTotal)} />
        <KpiCard label="إيرادات" value={revenueTotal === 0 ? "لا يوجد نموذج إيرادات بعد" : egp(revenueTotal)} />
        <KpiCard label="صافي غير موزّع" value={egp(centerByCode.get("CC-UNALLOC")?.net ?? 0)} />
      </section>

      {(selectedCenter || focus !== "all") && (
        <Card title="الفلتر الحالي">
          <div className="flex flex-wrap items-center gap-3">
            <Tag tone="warning">
              {selectedCenter ? `${selectedCenter.code} · ${selectedCenter.name_ar}` : focus === "posted" ? "مراكز لها قيود" : "بنود تحتاج مراجعة"}
            </Tag>
            <HeaderLink href="/finance/reports">كل التقرير</HeaderLink>
          </div>
        </Card>
      )}

      {(centerCharts.length > 0 || trendChart.length > 0) && (
        <section className="grid gap-4 xl:grid-cols-2">
          <Card title="رؤية متعددة">
            <MultiInsightChart
              ariaLabel="اختيار زاوية التحليل"
              options={[
                {
                  id: "center",
                  label: "حسب المركز",
                  render: () =>
                    centerCharts.length > 0 ? (
                      <CategoryBarChart
                        data={centerCharts}
                        categoryKey="center"
                        series={[
                          { dataKey: "مصروفات", name: "مصروفات" },
                          { dataKey: "إيرادات", name: "إيرادات" },
                        ]}
                        ariaLabel="مصروفات وإيرادات حسب مركز التكلفة"
                        caption="حسب المركز"
                        columnHeader="المركز"
                      />
                    ) : (
                      <EmptyState title="لا توجد قيود موزعة على مراكز بعد" />
                    ),
                },
                {
                  id: "year",
                  label: "حسب السنة",
                  render: () =>
                    trendChart.length > 0 ? (
                      <TrendLineChart
                        data={trendChart}
                        categoryKey="year"
                        series={[{ dataKey: "مصروفات", name: "مصروفات" }]}
                        overlaySeries={[
                          { dataKey: "إيرادات", name: "إيرادات" },
                          { dataKey: "صافي", name: "صافي" },
                        ]}
                        ariaLabel="اتجاه مصروفات وإيرادات مراكز التكلفة حسب السنة"
                        caption="حسب السنة"
                        columnHeader="السنة"
                      />
                    ) : (
                      <EmptyState title="لا توجد قيود مؤرخة بعد" />
                    ),
                },
              ]}
            />
          </Card>

          <Card title="إشارات المراجعة">
            {flags.length ? (
              <FilterableTable
                columns={flagColumns}
                rows={flags.map((flag) => ({
                  id: `${flag.cost_center_id}-${flag.flag_code}`,
                  code: flag.code,
                  center: flag.name_ar,
                  flag: FLAG_LABEL_AR[flag.flag_code] ?? flag.flag_code,
                  message: flag.message_ar,
                }))}
                ariaLabel="إشارات مراجعة مراكز التكلفة"
                exportFilename="cost center reconciliation flags.csv"
                minRowsForSearch={1}
              />
            ) : (
              <EmptyState title="لا توجد إشارات مراجعة" />
            )}
          </Card>
        </section>
      )}

      <Card title="اقتصاديات مراكز التكلفة">
        {rollupRows.length ? (
          <FilterableTable
            columns={rollupColumns}
            rows={rollupRows}
            ariaLabel="اقتصاديات مراكز التكلفة"
            exportFilename="cost center rollup.csv"
            minRowsForSearch={1}
          />
        ) : (
          <EmptyState title="لا توجد مراكز مطابقة للفلتر" />
        )}
      </Card>

      <Card title="المصفوفة: الحساب × السنة × المركز">
        {matrix.rows.length ? (
          <FilterableTable
            columns={matrix.columns}
            rows={matrix.rows}
            ariaLabel="مصفوفة الحساب والسنة ومركز التكلفة"
            exportFilename="cost center year matrix.csv"
            minRowsForSearch={1}
          />
        ) : (
          <EmptyState title="لا توجد قيود مصروفات أو إيرادات بعد" />
        )}
      </Card>
    </div>
  );
}

const rollupColumns: SimpleColumn[] = [
  { id: "code", header: "الكود", kind: "code" },
  { id: "center", header: "المركز" },
  { id: "parent", header: "الأصل" },
  { id: "enterprise", header: "النشاط" },
  { id: "area", header: "فدان", kind: "num", numeric: true },
  { id: "debit", header: "مصروفات", kind: "money", numeric: true },
  { id: "credit", header: "إيرادات", kind: "money", numeric: true },
  { id: "net", header: "مصروف - إيراد", kind: "money", numeric: true },
  { id: "netPerFeddan", header: "صافي/فدان", kind: "money", numeric: true },
  { id: "status", header: "الحالة", kind: "status" },
];

const flagColumns: SimpleColumn[] = [
  { id: "code", header: "الكود", kind: "code" },
  { id: "center", header: "المركز" },
  { id: "flag", header: "الإشارة", kind: "status" },
  { id: "message", header: "التفاصيل" },
];

async function fetchAllRows<T>(
  load: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await load(from, from + pageSize - 1);
    if (page.error) throw page.error;
    const data = page.data ?? [];
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

function buildYearMatrix(
  lines: JournalLineRow[],
  entryById: Map<string, JournalEntryRow>,
  accountById: Map<string, AccountRow>,
  centerById: Map<string, CostCenterRollupRow>,
  unallocated: CostCenterRollupRow | undefined,
): { columns: SimpleColumn[]; rows: SimpleRow[] } {
  const years = new Set<string>();
  const rows = new Map<string, SimpleRow>();
  for (const line of lines) {
    const account = accountById.get(line.account_id);
    if (!account || (account.account_type !== "expense" && account.account_type !== "revenue")) continue;
    const entry = entryById.get(line.journal_entry_id);
    if (!entry?.entry_date) continue;
    const year = String(entry.entry_date).slice(0, 4);
    years.add(year);
    const center = line.cost_center_id ? centerById.get(line.cost_center_id) : unallocated;
    const centerCode = center?.code ?? "CC-UNALLOC";
    const key = `${account.id}:${centerCode}`;
    const row = rows.get(key) ?? {
      id: key,
      account: `${account.code} · ${account.name_ar}`,
      type: ACCOUNT_TYPE_AR[account.account_type] ?? account.account_type,
      center: center ? `${center.code} · ${center.name_ar}` : "غير موزَّع",
    };
    const amount = account.account_type === "revenue"
      ? Number(line.credit ?? 0) - Number(line.debit ?? 0)
      : Number(line.debit ?? 0) - Number(line.credit ?? 0);
    row[`y_${year}`] = Number(row[`y_${year}`] ?? 0) + amount;
    rows.set(key, row);
  }

  const sortedYears = [...years].sort();
  return {
    columns: [
      { id: "account", header: "الحساب" },
      { id: "type", header: "النوع", kind: "status" },
      { id: "center", header: "مركز التكلفة" },
      ...sortedYears.map((year) => ({ id: `y_${year}`, header: year, kind: "money" as const, numeric: true })),
    ],
    rows: [...rows.values()],
  };
}

function buildCenterChartData(rollup: CostCenterRollupRow[]): Array<Record<string, string | number>> {
  return rollup
    .filter((row) => row.parent_id != null || row.code === "CC-UNALLOC")
    .filter((row) => Number(row.debit ?? 0) !== 0 || Number(row.credit ?? 0) !== 0)
    .sort((a, b) => Math.abs(Number(b.net ?? 0)) - Math.abs(Number(a.net ?? 0)))
    .slice(0, 8)
    .map((row) => ({
      center: row.name_ar,
      "مصروفات": Number(row.debit ?? 0),
      "إيرادات": Number(row.credit ?? 0),
    }));
}

function buildYearTrend(
  lines: JournalLineRow[],
  entryById: Map<string, JournalEntryRow>,
  accountById: Map<string, AccountRow>,
): Array<Record<string, string | number>> {
  const byYear = new Map<string, { expense: number; revenue: number }>();
  for (const line of lines) {
    const account = accountById.get(line.account_id);
    if (!account || (account.account_type !== "expense" && account.account_type !== "revenue")) continue;
    const entry = entryById.get(line.journal_entry_id);
    if (!entry?.entry_date) continue;
    const year = String(entry.entry_date).slice(0, 4);
    const bucket = byYear.get(year) ?? { expense: 0, revenue: 0 };
    if (account.account_type === "expense") {
      bucket.expense += Number(line.debit ?? 0) - Number(line.credit ?? 0);
    } else {
      bucket.revenue += Number(line.credit ?? 0) - Number(line.debit ?? 0);
    }
    byYear.set(year, bucket);
  }
  return [...byYear.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, value]) => ({
    year,
    "مصروفات": value.expense,
    "إيرادات": value.revenue,
    "صافي": value.revenue - value.expense,
  }));
}

function parseFocus(value: string | undefined): Focus {
  return value === "posted" || value === "flags" ? value : "all";
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
