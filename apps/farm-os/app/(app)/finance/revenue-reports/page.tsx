import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { Card, EmptyState, KpiCard } from "@/components/ui";
import { CategoryBarChart, MultiInsightChart } from "@/components/charts";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { fmtDate } from "@/lib/dates";
import { egp, num } from "@/lib/money";

type RevenueSaleRow = {
  sale_id: string;
  report_date: string;
  sale_date: string | null;
  delivery_date: string | null;
  crop: string;
  season: string | null;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  total: number | null;
  price_status: "pending" | "finalized";
  payment_status: "unpaid" | "partially_collected" | "collected";
  buyer_id: string | null;
  buyer_name: string | null;
  buyer_type: string | null;
  cost_center_id: string | null;
  cost_center_code: string | null;
  cost_center_name: string | null;
  farm_name: string | null;
  sector_name: string | null;
  hawsha_name: string | null;
  collected_to_as_of: number;
  collected_in_period: number;
  outstanding: number | null;
};

type RevenueBuyerRow = {
  buyer_id: string | null;
  buyer_name: string;
  buyer_type: string | null;
  sale_count: number;
  pending_count: number;
  qty: number;
  finalized_revenue: number;
  collected_in_period: number;
  collected_to_as_of: number;
  outstanding: number;
};

type RevenueCropRow = {
  crop: string;
  season: string;
  sale_count: number;
  pending_count: number;
  qty: number;
  finalized_revenue: number;
  collected_in_period: number;
  outstanding: number;
};

type RevenueArRow = {
  sale_id: string;
  report_date: string;
  buyer_id: string | null;
  buyer_name: string | null;
  buyer_type: string | null;
  crop: string;
  season: string | null;
  total: number;
  collected_to_as_of: number;
  outstanding: number;
  age_days: number;
  aging_bucket: string;
  payment_status: "unpaid" | "partially_collected" | "collected";
};

type RevenueCollectionRow = {
  collection_id: string;
  sale_id: string;
  occurred_at: string;
  amount: number;
  buyer_name: string;
  crop: string;
  season: string | null;
  collected_by: string | null;
  note: string | null;
  journal_entry_id: string | null;
};

type RevenueReport = {
  period_start: string;
  period_end: string;
  as_of: string;
  finalized_revenue: number;
  period_collections: number;
  outstanding_total: number;
  over_30_amount: number;
  over_30_count: number;
  pending_count: number;
  pending_qty: number;
  sales: RevenueSaleRow[];
  by_buyer: RevenueBuyerRow[];
  by_crop_season: RevenueCropRow[];
  ar_rows: RevenueArRow[];
  collections: RevenueCollectionRow[];
};

const PRICE_STATUS_AR: Record<RevenueSaleRow["price_status"], string> = {
  pending: "السعر لم يحدد",
  finalized: "مسعّر",
};

const PAYMENT_STATUS_AR: Record<RevenueSaleRow["payment_status"], string> = {
  unpaid: "غير محصل",
  partially_collected: "محصل جزئي",
  collected: "محصل",
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
  const today = new Date();
  const defaultStart = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;
  const defaultEnd = isoDate(today);
  const start = parseDateParam(params.start, defaultStart);
  const end = parseDateParam(params.end, defaultEnd);
  const asOf = parseDateParam(params.asOf, end);

  const reportRes = await sb.rpc("fn_revenue_sales_report", {
    p_org: m.orgId,
    p_period_start: start,
    p_period_end: end,
    p_as_of: asOf,
  });
  if (reportRes.error) throw reportRes.error;

  const report = normalizeReport(reportRes.data);
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
    collected: Number(row.collected_to_as_of ?? 0),
    outstanding: row.outstanding ?? undefined,
    price: PRICE_STATUS_AR[row.price_status] ?? row.price_status,
    payment: PAYMENT_STATUS_AR[row.payment_status] ?? row.payment_status,
    center: formatCenter(row.cost_center_code, row.cost_center_name),
    location: formatLocation(row.farm_name, row.sector_name, row.hawsha_name),
  }));

  const buyerRows: SimpleRow[] = report.by_buyer.map((row) => ({
    id: row.buyer_id ?? row.buyer_name,
    buyer: row.buyer_name,
    type: row.buyer_type ? BUYER_TYPE_AR[row.buyer_type] ?? row.buyer_type : "—",
    sales: Number(row.sale_count ?? 0),
    pending: Number(row.pending_count ?? 0),
    qty: Number(row.qty ?? 0),
    revenue: Number(row.finalized_revenue ?? 0),
    collected: Number(row.collected_in_period ?? 0),
    outstanding: Number(row.outstanding ?? 0),
  }));

  const cropRows: SimpleRow[] = report.by_crop_season.map((row) => ({
    id: `${row.crop}-${row.season}`,
    crop: formatCrop(row.crop, row.season),
    sales: Number(row.sale_count ?? 0),
    pending: Number(row.pending_count ?? 0),
    qty: Number(row.qty ?? 0),
    revenue: Number(row.finalized_revenue ?? 0),
    collected: Number(row.collected_in_period ?? 0),
    outstanding: Number(row.outstanding ?? 0),
  }));

  const arRows: SimpleRow[] = report.ar_rows.map((row) => ({
    id: row.sale_id,
    date: fmtDate(row.report_date),
    buyer: row.buyer_name ?? "نقدي/غير محدد",
    crop: formatCrop(row.crop, row.season),
    total: Number(row.total ?? 0),
    collected: Number(row.collected_to_as_of ?? 0),
    outstanding: Number(row.outstanding ?? 0),
    age: Number(row.age_days ?? 0),
    bucket: row.aging_bucket,
    payment: PAYMENT_STATUS_AR[row.payment_status] ?? row.payment_status,
  }));

  const collectionRows: SimpleRow[] = report.collections.map((row) => ({
    id: row.collection_id,
    date: fmtDate(row.occurred_at),
    buyer: row.buyer_name,
    crop: formatCrop(row.crop, row.season),
    amount: Number(row.amount ?? 0),
    collectedBy: row.collected_by ?? "—",
    journal: row.journal_entry_id ? "مرحل" : "—",
    note: row.note ?? "—",
  }));

  const buyerChart = report.by_buyer.slice(0, 8).map((row) => ({
    buyer: row.buyer_name,
    "إيراد مسعّر": Number(row.finalized_revenue ?? 0),
    "ذمم قائمة": Number(row.outstanding ?? 0),
  }));
  const cropChart = report.by_crop_season.slice(0, 8).map((row) => ({
    crop: formatCrop(row.crop, row.season),
    "إيراد مسعّر": Number(row.finalized_revenue ?? 0),
    "ذمم قائمة": Number(row.outstanding ?? 0),
  }));
  const showCharts = buyerChart.length > 0 || cropChart.length > 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">تقارير الإيرادات والذمم</h1>
          <p style={{ color: "var(--ink-muted)" }}>
            إيراد مسعّر، تسليمات بسعر معلق، تحصيلات العملاء، وأعمار الذمم من سجل المبيعات فقط.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <HeaderLink href="/finance/dashboard">لوحة المالية</HeaderLink>
          <HeaderLink href="/finance/reports">تقارير التكلفة</HeaderLink>
          <HeaderLink href="/accounting">المحاسبة</HeaderLink>
        </div>
      </header>

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
        <KpiCard label="إيراد مسعّر" value={egp(report.finalized_revenue)} />
        <KpiCard label="تحصيلات الفترة" value={egp(report.period_collections)} />
        <KpiCard label="ذمم قائمة" value={egp(report.outstanding_total)} deltaDirection={report.outstanding_total > 0 ? "down" : "none"} />
        <KpiCard label="ذمم ٣٠+ يوم" value={egp(report.over_30_amount)} deltaDirection={report.over_30_amount > 0 ? "down" : "none"} />
        <KpiCard label="تسليمات بسعر معلق" value={num(report.pending_count)} deltaDirection={report.pending_count > 0 ? "down" : "none"} />
        <KpiCard label="كمية معلقة السعر" value={num(report.pending_qty)} />
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
                  buyerChart.length ? (
                    <CategoryBarChart
                      data={buyerChart}
                      categoryKey="buyer"
                      series={[
                        { dataKey: "إيراد مسعّر", name: "إيراد مسعّر" },
                        { dataKey: "ذمم قائمة", name: "ذمم قائمة" },
                      ]}
                      ariaLabel="الإيراد والذمم حسب العميل"
                      caption="حسب العميل"
                      columnHeader="العميل"
                    />
                  ) : (
                    <EmptyState title="لا توجد مبيعات للعملاء في الفترة" />
                  ),
              },
              {
                id: "crop",
                label: "حسب المحصول",
                render: () =>
                  cropChart.length ? (
                    <CategoryBarChart
                      data={cropChart}
                      categoryKey="crop"
                      series={[
                        { dataKey: "إيراد مسعّر", name: "إيراد مسعّر" },
                        { dataKey: "ذمم قائمة", name: "ذمم قائمة" },
                      ]}
                      ariaLabel="الإيراد والذمم حسب المحصول والموسم"
                      caption="حسب المحصول"
                      columnHeader="المحصول"
                    />
                  ) : (
                    <EmptyState title="لا توجد مبيعات لمحاصيل في الفترة" />
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
              exportFilename="revenue by buyer.csv"
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
              exportFilename="revenue by crop season.csv"
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
            exportFilename="revenue sales report.csv"
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
            exportFilename="accounts receivable aging.csv"
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
            exportFilename="sale collections report.csv"
            minRowsForSearch={1}
          />
        ) : (
          <EmptyState title="لا توجد تحصيلات في الفترة" />
        )}
      </Card>
    </div>
  );
}

const buyerColumns: SimpleColumn[] = [
  { id: "buyer", header: "العميل" },
  { id: "type", header: "النوع", kind: "status" },
  { id: "sales", header: "مبيعات", kind: "num", numeric: true },
  { id: "pending", header: "معلقة السعر", kind: "num", numeric: true },
  { id: "qty", header: "الكمية", kind: "num", numeric: true },
  { id: "revenue", header: "إيراد مسعّر", kind: "money", numeric: true },
  { id: "collected", header: "تحصيلات الفترة", kind: "money", numeric: true },
  { id: "outstanding", header: "ذمم قائمة", kind: "money", numeric: true },
];

const cropColumns: SimpleColumn[] = [
  { id: "crop", header: "المحصول / الموسم" },
  { id: "sales", header: "مبيعات", kind: "num", numeric: true },
  { id: "pending", header: "معلقة السعر", kind: "num", numeric: true },
  { id: "qty", header: "الكمية", kind: "num", numeric: true },
  { id: "revenue", header: "إيراد مسعّر", kind: "money", numeric: true },
  { id: "collected", header: "تحصيلات الفترة", kind: "money", numeric: true },
  { id: "outstanding", header: "ذمم قائمة", kind: "money", numeric: true },
];

const saleColumns: SimpleColumn[] = [
  { id: "date", header: "تاريخ التقرير" },
  { id: "buyer", header: "العميل" },
  { id: "buyerType", header: "نوع العميل", kind: "status" },
  { id: "crop", header: "المحصول / الموسم" },
  { id: "qty", header: "الكمية", kind: "num", numeric: true },
  { id: "unit", header: "الوحدة" },
  { id: "unitPrice", header: "سعر الوحدة", kind: "money", numeric: true },
  { id: "total", header: "الإجمالي", kind: "money", numeric: true },
  { id: "collected", header: "محصل حتى التاريخ", kind: "money", numeric: true },
  { id: "outstanding", header: "المتبقي", kind: "money", numeric: true },
  { id: "price", header: "السعر", kind: "status" },
  { id: "payment", header: "التحصيل", kind: "status" },
  { id: "center", header: "مركز التكلفة" },
  { id: "location", header: "الموقع" },
];

const arColumns: SimpleColumn[] = [
  { id: "date", header: "تاريخ البيع" },
  { id: "buyer", header: "العميل" },
  { id: "crop", header: "المحصول / الموسم" },
  { id: "total", header: "إجمالي البيع", kind: "money", numeric: true },
  { id: "collected", header: "محصل", kind: "money", numeric: true },
  { id: "outstanding", header: "ذمم قائمة", kind: "money", numeric: true },
  { id: "age", header: "العمر بالأيام", kind: "num", numeric: true },
  { id: "bucket", header: "فئة العمر", kind: "status" },
  { id: "payment", header: "التحصيل", kind: "status" },
];

const collectionColumns: SimpleColumn[] = [
  { id: "date", header: "تاريخ التحصيل" },
  { id: "buyer", header: "العميل" },
  { id: "crop", header: "المحصول / الموسم" },
  { id: "amount", header: "المبلغ", kind: "money", numeric: true },
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

function normalizeReport(value: unknown): RevenueReport {
  const report = (value ?? {}) as Partial<RevenueReport>;
  return {
    period_start: String(report.period_start ?? ""),
    period_end: String(report.period_end ?? ""),
    as_of: String(report.as_of ?? ""),
    finalized_revenue: Number(report.finalized_revenue ?? 0),
    period_collections: Number(report.period_collections ?? 0),
    outstanding_total: Number(report.outstanding_total ?? 0),
    over_30_amount: Number(report.over_30_amount ?? 0),
    over_30_count: Number(report.over_30_count ?? 0),
    pending_count: Number(report.pending_count ?? 0),
    pending_qty: Number(report.pending_qty ?? 0),
    sales: Array.isArray(report.sales) ? report.sales : [],
    by_buyer: Array.isArray(report.by_buyer) ? report.by_buyer : [],
    by_crop_season: Array.isArray(report.by_crop_season) ? report.by_crop_season : [],
    ar_rows: Array.isArray(report.ar_rows) ? report.ar_rows : [],
    collections: Array.isArray(report.collections) ? report.collections : [],
  };
}

function parseDateParam(value: string | undefined, fallback: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
