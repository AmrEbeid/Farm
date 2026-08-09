import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SALE_PAYMENT_STATUS_AR } from "@/lib/labels";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { CategoryBarChart, MultiInsightChart } from "@/components/charts";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { ImportPanel } from "@/components/import/ImportPanel";
import { fmtDate } from "@/lib/dates";
import { num, pct } from "@/lib/money";
import { StoryLine } from "@/components/StoryLine";
import { PrintButton } from "@/components/print-button";
import { compareDecimals, decimalToSafeNumber, type DecimalString } from "@/lib/decimal";
import { cairoTodayIso } from "@/lib/payroll-close";
import { receivableAmountEgp, receivableQuantity } from "@/lib/receivable workflow money";
import {
  parseExactRevenueReport,
  exactRevenueChartRows,
  type RevenueSaleRow,
} from "@/lib/revenue report exact";

const PRICE_STATUS_AR: Record<RevenueSaleRow["price_status"], string> = {
  pending: "السعر معلّق",
  finalized: "مسعّر",
};

const BUYER_TYPE_AR: Record<string, string> = {
  cash_customer: "عميل نقدي",
  trader: "تاجر",
  company: "شركة",
};

export default async function FinanceRevenueReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string; asOf?: string }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const params = await searchParams;
  const defaultEnd = cairoTodayIso();
  const defaultStart = `${defaultEnd.slice(0, 7)}-01`;
  const start = parseDateParam(params.start, defaultStart);
  const end = parseDateParam(params.end, defaultEnd);
  const asOf = parseDateParam(params.asOf, end);

  const reportRes = await sb.rpc("fn_revenue_sales_report_exact", {
    p_org: m.orgId,
    p_period_start: start,
    p_period_end: end,
    p_as_of: asOf,
  });
  if (reportRes.error) throw reportRes.error;

  const report = parseExactRevenueReport(reportRes.data);
  const salesRows: SimpleRow[] = report.sales.map((row) => ({
    id: row.sale_id,
    date: fmtDate(row.report_date),
    buyer: row.buyer_name ?? "نقدي/غير محدد",
    buyerType: row.buyer_type ? BUYER_TYPE_AR[row.buyer_type] ?? row.buyer_type : "—",
    crop: formatCrop(row.crop, row.season),
    qty: row.qty ?? undefined,
    unit: row.unit ?? "—",
    unitPrice: row.unit_price ?? undefined,
    total: row.total ?? undefined,
    collected: row.collected_to_as_of,
    outstanding: row.outstanding ?? undefined,
    price: PRICE_STATUS_AR[row.price_status] ?? row.price_status,
    payment: SALE_PAYMENT_STATUS_AR[row.payment_status] ?? row.payment_status,
    center: formatCenter(row.cost_center_code, row.cost_center_name),
    location: formatLocation(row.farm_name, row.sector_name, row.hawsha_name),
  }));

  const buyerRows: SimpleRow[] = report.by_buyer.map((row) => ({
    id: row.buyer_id ?? row.buyer_name,
    buyer: row.buyer_name,
    buyer_href: row.buyer_id ? `/finance/buyers/${row.buyer_id}` : "",
    type: row.buyer_type ? BUYER_TYPE_AR[row.buyer_type] ?? row.buyer_type : "—",
    sales: row.sale_count,
    pending: row.pending_count,
    qty: row.qty,
    revenue: row.finalized_revenue,
    collected: row.collected_in_period,
    outstanding: row.outstanding,
  }));

  const cropRows: SimpleRow[] = report.by_crop_season.map((row) => ({
    id: `${row.crop}-${row.season}`,
    crop: formatCrop(row.crop, row.season),
    sales: row.sale_count,
    pending: row.pending_count,
    qty: row.qty,
    revenue: row.finalized_revenue,
    collected: row.collected_in_period,
    outstanding: row.outstanding,
  }));

  const arRows: SimpleRow[] = report.ar_rows.map((row) => ({
    id: row.sale_id,
    date: fmtDate(row.report_date),
    buyer: row.buyer_name ?? "نقدي/غير محدد",
    crop: formatCrop(row.crop, row.season),
    total: row.total,
    collected: row.collected_to_as_of,
    outstanding: row.outstanding,
    age: row.age_days,
    bucket: row.aging_bucket,
    payment: SALE_PAYMENT_STATUS_AR[row.payment_status] ?? row.payment_status,
  }));

  const collectionRows: SimpleRow[] = report.collections.map((row) => ({
    id: row.collection_id,
    date: fmtDate(row.occurred_at),
    buyer: row.buyer_name,
    crop: formatCrop(row.crop, row.season),
    amount: row.amount,
    collectedBy: row.collected_by ?? "—",
    journal: row.journal_entry_id ? "مرحل" : "—",
    note: row.note ?? "—",
  }));

  const buyerChart = exactRevenueChartRows(report.by_buyer.slice(0, 8).map((row) => ({
    label: row.buyer_name,
    finalizedRevenue: row.finalized_revenue,
    outstanding: row.outstanding,
  })));
  const cropChart = exactRevenueChartRows(report.by_crop_season.slice(0, 8).map((row) => ({
    label: formatCrop(row.crop, row.season),
    finalizedRevenue: row.finalized_revenue,
    outstanding: row.outstanding,
  })));
  const showCharts = report.by_buyer.length > 0 || report.by_crop_season.length > 0;

  // U-12 (§2c): the period's story in one sentence — same live data as the tables below (#1).
  const topCrop = [...report.by_crop_season].sort((a, b) =>
    compareDecimals(b.finalized_revenue, a.finalized_revenue),
  )[0];
  const topCropShare = topCrop
    ? exactPercentage(topCrop.finalized_revenue, report.finalized_revenue)
    : null;
  const storyLead =
    compareDecimals(report.finalized_revenue, "0") > 0
      ? `حقّقت المزرعة في هذه الفترة ${receivableAmountEgp(report.finalized_revenue)} إيرادًا مؤكدًا` +
        (topCrop && topCropShare != null && compareDecimals(topCrop.finalized_revenue, "0") > 0
          ? ` — ${pct(topCropShare)} منها من «${topCrop.crop}»`
          : "") +
        `، وحُصِّل منها ${receivableAmountEgp(report.period_collections)}.`
      : "لا إيرادات مؤكدة في هذه الفترة بعد.";
  const storyNotes: string[] = [];
  if (report.pending_count > 0)
    storyNotes.push(`${num(report.pending_count)} بيع بسعر معلّق لا يظهر في الإيراد حتى يُحدَّد سعره.`);
  if (compareDecimals(report.outstanding_total, "0") > 0)
    storyNotes.push(
      `المستحق لدى العملاء ${receivableAmountEgp(report.outstanding_total)}` +
        (report.over_30_count > 0 ? ` — منها ${num(report.over_30_count)} بيع تجاوز ٣٠ يومًا (${receivableAmountEgp(report.over_30_amount)}).` : "."),
    );

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">تقارير الإيرادات والذمم</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            إيراد مسعّر، تسليمات بسعر معلّق، تحصيلات العملاء، وأعمار الذمم من سجل المبيعات فقط.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PrintButton label="طباعة التقرير" />
          <HeaderLink href="/finance/dashboard">لوحة المالية</HeaderLink>
          <HeaderLink href="/finance/reports">تقارير التكلفة</HeaderLink>
          <HeaderLink href="/accounting">المحاسبة</HeaderLink>
        </div>
      </header>

      <StoryLine lead={storyLead} notes={storyNotes} />


      <Card title="الفترة">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" method="get">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            من تاريخ
            <input name="start" type="date" defaultValue={start} className="rounded-md px-3 py-2" style={inputStyle} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            إلى تاريخ
            <input name="end" type="date" defaultValue={end} className="rounded-md px-3 py-2" style={inputStyle} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            تاريخ أعمار الذمم
            <input name="asOf" type="date" defaultValue={asOf} className="rounded-md px-3 py-2" style={inputStyle} />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              className="inline-flex min-h-10 items-center justify-center rounded-md px-4 text-sm font-semibold"
              style={{ color: "white", background: "var(--brand)" }}
            >
              تحديث التقرير
            </button>
          </div>
        </form>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard label="إيراد مسعّر" value={receivableAmountEgp(report.finalized_revenue)} />
        <KpiCard label="تحصيلات الفترة" value={receivableAmountEgp(report.period_collections)} />
        <KpiCard label="ذمم قائمة" value={receivableAmountEgp(report.outstanding_total)} deltaDirection={compareDecimals(report.outstanding_total, "0") > 0 ? "down" : "none"} />
        <KpiCard label="ذمم ٣٠+ يوم" value={receivableAmountEgp(report.over_30_amount)} deltaDirection={compareDecimals(report.over_30_amount, "0") > 0 ? "down" : "none"} />
        <KpiCard label="تسليمات بسعر معلّق" value={num(report.pending_count)} deltaDirection={report.pending_count > 0 ? "down" : "none"} />
        <KpiCard label="كمية معلقة السعر" value={receivableQuantity(report.pending_qty)} />
      </section>

      {showCharts && (
        <Card title="تحليل الإيراد والذمم">
          <MultiInsightChart
            ariaLabel="اختيار زاوية تحليل الإيرادات"
            options={[
              {
                id: "buyer",
                label: "حسب العميل",
                render: () =>
                  buyerChart?.length ? (
                    <CategoryBarChart
                      data={buyerChart}
                      categoryKey="label"
                      series={[
                        { dataKey: "إيراد مسعّر", name: "إيراد مسعّر" },
                        { dataKey: "ذمم قائمة", name: "ذمم قائمة" },
                      ]}
                      ariaLabel="الإيراد والذمم حسب العميل"
                      caption="حسب العميل"
                      columnHeader="العميل"
                    />
                  ) : (
                    <EmptyState title={buyerChart === null ? "تعذر رسم قيم العملاء الكبيرة بدقة — راجع الجدول أدناه" : "لا توجد مبيعات للعملاء في الفترة"} />
                  ),
              },
              {
                id: "crop",
                label: "حسب المحصول",
                render: () =>
                  cropChart?.length ? (
                    <CategoryBarChart
                      data={cropChart}
                      categoryKey="label"
                      series={[
                        { dataKey: "إيراد مسعّر", name: "إيراد مسعّر" },
                        { dataKey: "ذمم قائمة", name: "ذمم قائمة" },
                      ]}
                      ariaLabel="الإيراد والذمم حسب المحصول والموسم"
                      caption="حسب المحصول"
                      columnHeader="المحصول"
                    />
                  ) : (
                    <EmptyState title={cropChart === null ? "تعذر رسم قيم المحاصيل الكبيرة بدقة — راجع الجدول أدناه" : "لا توجد مبيعات لمحاصيل في الفترة"} />
                  ),
              },
            ]}
          />
        </Card>
      )}

      <section className="grid gap-4 xl:grid-cols-2">
        <Card title="الإيراد حسب العميل">
          {buyerRows.length ? (
            <FilterableTable
              columns={buyerColumns}
              rows={buyerRows}
              ariaLabel="الإيراد حسب العميل"
              exportFilename={`revenue-by-buyer-${start}-to-${end}.csv`}
              minRowsForSearch={1}
            />
          ) : (
            <EmptyState title="لا توجد مبيعات في الفترة" />
          )}
        </Card>
        <Card title="الإيراد حسب المحصول والموسم">
          {cropRows.length ? (
            <FilterableTable
              columns={cropColumns}
              rows={cropRows}
              ariaLabel="الإيراد حسب المحصول والموسم"
              exportFilename={`revenue-by-crop-season-${start}-to-${end}.csv`}
              minRowsForSearch={1}
            />
          ) : (
            <EmptyState title="لا توجد محاصيل في الفترة" />
          )}
        </Card>
      </section>

      <Card title="المبيعات والتسليمات في الفترة">
        {salesRows.length ? (
          <FilterableTable
            columns={saleColumns}
            rows={salesRows}
            ariaLabel="المبيعات والتسليمات في الفترة"
            exportFilename={`revenue-sales-${start}-to-${end}.csv`}
            minRowsForSearch={1}
          />
        ) : (
          <EmptyState title="لا توجد مبيعات أو تسليمات في الفترة" />
        )}
      </Card>

      <Card title={`الذمم القائمة حتى ${fmtDate(report.as_of)}`}>
        {arRows.length ? (
          <FilterableTable
            columns={arColumns}
            rows={arRows}
            ariaLabel="الذمم القائمة وأعمارها"
            exportFilename={`accounts-receivable-aging-${asOf}.csv`}
            minRowsForSearch={1}
          />
        ) : (
          <EmptyState title="لا توجد ذمم قائمة حتى تاريخ التقرير" />
        )}
      </Card>

      <Card title="تحصيلات الفترة">
        {collectionRows.length ? (
          <FilterableTable
            columns={collectionColumns}
            rows={collectionRows}
            ariaLabel="تحصيلات الفترة"
            exportFilename={`sale-collections-${start}-to-${end}.csv`}
            minRowsForSearch={1}
          />
        ) : (
          <EmptyState title="لا توجد تحصيلات في الفترة" />
        )}
      </Card>

      {/* SPEC-0024 S-9 (D.1): every entry has its template + Excel/CSV import. Deliveries import as
          PENDING (no price) — bulk import can never fabricate revenue (#1). */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="استيراد المشترين (قالب Excel/CSV)">
          <ImportPanel descriptorKey="buyers" titleAr="المشترون" />
        </Card>
        <Card title="استيراد التسليمات — بسعر لاحق (قالب Excel/CSV)">
          <ImportPanel descriptorKey="sales" titleAr="المبيعات" />
        </Card>
      </div>
    </div>
  );
}

const buyerColumns: SimpleColumn[] = [
  { id: "buyer", header: "العميل", kind: "link" },
  { id: "type", header: "النوع", kind: "status" },
  { id: "sales", header: "مبيعات", kind: "num", numeric: true },
  { id: "pending", header: "معلقة السعر", kind: "num", numeric: true },
  { id: "qty", header: "الكمية", kind: "decimal-exact", numeric: true, decimal: true },
  { id: "revenue", header: "إيراد مسعّر", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "collected", header: "تحصيلات الفترة", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "outstanding", header: "ذمم قائمة", kind: "money-preserve-exact", numeric: true, decimal: true },
];

const cropColumns: SimpleColumn[] = [
  { id: "crop", header: "المحصول / الموسم" },
  { id: "sales", header: "مبيعات", kind: "num", numeric: true },
  { id: "pending", header: "معلقة السعر", kind: "num", numeric: true },
  { id: "qty", header: "الكمية", kind: "decimal-exact", numeric: true, decimal: true },
  { id: "revenue", header: "إيراد مسعّر", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "collected", header: "تحصيلات الفترة", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "outstanding", header: "ذمم قائمة", kind: "money-preserve-exact", numeric: true, decimal: true },
];

const saleColumns: SimpleColumn[] = [
  { id: "date", header: "تاريخ التقرير" },
  { id: "buyer", header: "العميل" },
  { id: "buyerType", header: "نوع العميل", kind: "status" },
  { id: "crop", header: "المحصول / الموسم" },
  { id: "qty", header: "الكمية", kind: "decimal-exact", numeric: true, decimal: true },
  { id: "unit", header: "الوحدة" },
  { id: "unitPrice", header: "سعر الوحدة", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "total", header: "الإجمالي", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "collected", header: "محصل حتى التاريخ", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "outstanding", header: "المتبقي", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "price", header: "السعر", kind: "status" },
  { id: "payment", header: "التحصيل", kind: "status" },
  { id: "center", header: "مركز التكلفة" },
  { id: "location", header: "الموقع" },
];

const arColumns: SimpleColumn[] = [
  { id: "date", header: "تاريخ البيع" },
  { id: "buyer", header: "العميل" },
  { id: "crop", header: "المحصول / الموسم" },
  { id: "total", header: "إجمالي البيع", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "collected", header: "محصل", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "outstanding", header: "ذمم قائمة", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "age", header: "العمر بالأيام", kind: "num", numeric: true },
  { id: "bucket", header: "فئة العمر", kind: "status" },
  { id: "payment", header: "التحصيل", kind: "status" },
];

const collectionColumns: SimpleColumn[] = [
  { id: "date", header: "تاريخ التحصيل" },
  { id: "buyer", header: "العميل" },
  { id: "crop", header: "المحصول / الموسم" },
  { id: "amount", header: "المبلغ", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "collectedBy", header: "المحصّل" },
  { id: "journal", header: "القيد", kind: "status" },
  { id: "note", header: "ملاحظات" },
];

const inputStyle = {
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--ink)",
};

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

function parseDateParam(value: string | undefined, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function formatCrop(crop: string | null, season: string | null): string {
  if (!crop && !season) return "—";
  return season ? `${crop ?? "غير محدد"} · ${season}` : crop ?? "غير محدد";
}

function formatCenter(code: string | null, name: string | null): string {
  if (!code && !name) return "غير موزع";
  return [code, name].filter(Boolean).join(" · ");
}

function formatLocation(farm: string | null, sector: string | null, hawsha: string | null): string {
  const parts = [farm, sector, hawsha].filter(Boolean);
  return parts.length ? parts.join(" / ") : "—";
}

function exactPercentage(part: DecimalString, total: DecimalString): number | null {
  const safePart = decimalToSafeNumber(part);
  const safeTotal = decimalToSafeNumber(total);
  if (safePart == null || safeTotal == null || safeTotal <= 0) return null;
  return Math.round((safePart / safeTotal) * 100);
}
