import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { KpiCard } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { StoryLine } from "@/components/StoryLine";
import { PrintButton } from "@/components/print-button";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import {
  absoluteDecimal,
  compareDecimals,
  egpExact,
  formatDecimalArabic,
  subtractDecimals,
  type DecimalString,
} from "@/lib/decimal";
import { cairoTodayIso, isCalendarDate } from "@/lib/payroll-close";
import { parseSeasonDashboardSnapshot } from "@/lib/season dashboard snapshot";

// SPEC-0027 H-3 — لوحة الموسم: the harvest cockpit. One page answers the Owner's daily season
// questions from Cairo: كم طنًا سلّمنا؟ لمن؟ كم بلا سعر؟ كم حُصِّل؟ وأي حوش يُنتج أكثر لكل فدان؟
// Story-first (§2c); every row links onward (pending → the pricing wizard). Honest nulls (#1):
// pending deliveries are counted in tonnage but NEVER valued.

export const dynamic = "force-dynamic";
const SEASON_ROW_LIMIT = 400;

const DELIVERY_COLUMNS: SimpleColumn[] = [
  { id: "note", header: "بون", kind: "code" },
  { id: "date", header: "التاريخ" },
  { id: "crop", header: "المحصول" },
  { id: "buyer", header: "التاجر", kind: "link" },
  { id: "qty", header: "الكمية (كجم)", kind: "decimal-exact", numeric: true, decimal: true },
  { id: "total", header: "القيمة (ج.م)", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "status", header: "الحالة", kind: "status" },
];

const CENTER_COLUMNS: SimpleColumn[] = [
  { id: "center", header: "المركز", kind: "link" },
  { id: "qty", header: "كجم مسلَّمة", kind: "decimal-exact", numeric: true, decimal: true },
  { id: "perFeddan", header: "كجم/فدان", kind: "decimal-exact", numeric: true, decimal: true },
  { id: "value", header: "قيمة مؤكدة (ج.م)", kind: "money-preserve-exact", numeric: true, decimal: true },
];

function decimal(value: DecimalString, scale?: number): string {
  const fractionDigits = value.includes(".") ? value.length - value.indexOf(".") - 1 : 0;
  return formatDecimalArabic(value, scale ?? fractionDigits);
}

export default async function SeasonPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const m = await requireRole(["owner", "accountant"]);
  const { from } = await searchParams;
  const asOf = cairoTodayIso();
  const seasonStart = from && isCalendarDate(from) && from <= asOf ? from : `${asOf.slice(0, 4)}-01-01`;
  const sb = await createClient();
  const snapshotRes = await sb.rpc("fn_season_dashboard_snapshot", {
    p_org: m.orgId,
    p_from: seasonStart,
    p_as_of: asOf,
    p_row_limit: SEASON_ROW_LIMIT,
  });
  if (snapshotRes.error) throw snapshotRes.error;
  const snapshot = parseSeasonDashboardSnapshot(snapshotRes.data, m.orgId, seasonStart, asOf);
  const { summary } = snapshot;
  const isTruncated = summary.deliveryCount > snapshot.rowLimit;

  const lead =
    summary.deliveryCount === 0
      ? "لا تسليمات في هذا الموسم بعد — أول حمولة تمر على الميزان تظهر هنا فورًا."
      : `الموسم حتى اليوم: ${decimal(summary.deliveredTons, 0)} طن في ${num(summary.deliveryCount)} حمولة لـ${num(summary.traderCount)} تاجر — ` +
        `${compareDecimals(summary.pendingQuantity, "0") > 0 ? `${decimal(summary.pendingTons, 0)} طن بلا سعر بعد، و` : "كل الكميات المسجلة مسعّرة، و"}` +
        `المحصَّل ${egpExact(summary.collectedTotal)} من ${egpExact(summary.finalizedTotal)}${summary.collectionPercent ? ` (${decimal(summary.collectionPercent, 0)}٪)` : ""}.`;
  const notes: string[] = [];
  if (summary.pendingCount > 0) notes.push(`${num(summary.pendingCount)} تسليمًا ينتظر التسعير — كل يوم تأخير يؤخر القيد والتحصيل.`);
  if (summary.invalidRevenueCount > 0) notes.push(`${num(summary.invalidRevenueCount)} تسليمًا مسعّرًا بلا قيد إيراد صالح — يبقى ضمن الكمية ولا يدخل في الإيراد أو التحصيل أو الذمم حتى تصحيح القيد.`);
  if (compareDecimals(summary.outstandingTotal, "0") > 0) notes.push(`ذمم على التجار: ${egpExact(summary.outstandingTotal)}.`);
  if (summary.unnamedCount > 0) notes.push(`⚠ ${num(summary.unnamedCount)} تسليمًا بلا اسم تاجر — قاعدة الموسم: كل حمولة باسم.`);
  if (summary.unknownQuantityCount > 0) notes.push(`${num(summary.unknownQuantityCount)} تسليمًا بلا كمية مقروءة لا يدخل في إجمالي الوزن.`);
  if (
    compareDecimals(summary.pickedCrates, "0") > 0 &&
    compareDecimals(summary.deliveredCrates, "0") > 0 &&
    compareDecimals(summary.pickedCrates, summary.deliveredCrates) !== 0
  ) {
    const difference = absoluteDecimal(subtractDecimals(summary.pickedCrates, summary.deliveredCrates));
    notes.push(`🧺 مقطوف حقليًا ${decimal(summary.pickedCrates)} عبوة مقابل ${decimal(summary.deliveredCrates)} وصلت الميزان — فارق ${decimal(difference)} عبوة يستحق نظرة.`);
  }

  const deliveryRows: SimpleRow[] = snapshot.rows.map((row) => ({
    id: row.id,
    note: row.deliveryNoteNo != null ? String(row.deliveryNoteNo) : "—",
    date: fmtDate(row.eventDate),
    crop: row.crop,
    buyer: row.buyerName ?? "بدون اسم",
    buyer_href: row.buyerId ? `/finance/buyers/${row.buyerId}` : "",
    qty: row.quantity ?? undefined,
    total: row.amount ?? undefined,
    status: row.priceStatus === "pending"
      ? "السعر معلّق"
      : !row.revenuePosted
        ? "قيد الإيراد غير صالح"
        : row.paymentStatus === "collected"
          ? "محصَّل"
          : "غير محصل",
  }));

  const centerRows: SimpleRow[] = snapshot.centers.map((center) => ({
    id: center.id,
    center: center.name,
    center_href: `/finance/cost-centers/${center.id}`,
    qty: center.quantity,
    perFeddan: center.quantityPerFeddan ?? undefined,
    value: center.finalizedTotal,
  }));

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>لوحة الموسم</h1>
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>من {fmtDate(seasonStart)} حتى اليوم — تتحدث مع كل حمولة تمر على الميزان.</p>
        </div>
        <div className="no-print flex flex-wrap gap-2 text-sm font-bold">
          <PrintButton label="طباعة الموسم" />
          <Link href="/record/scale" className="underline underline-offset-4" style={{ color: "var(--brand)" }}>⚖️ الميزان</Link>
          <Link href="/record/price" className="underline underline-offset-4" style={{ color: "var(--brand)" }}>🏷️ سعّر المعلّق</Link>
          <Link href="/record/collect" className="underline underline-offset-4" style={{ color: "var(--brand)" }}>💰 حصّل</Link>
        </div>
      </header>

      <StoryLine lead={lead} notes={notes} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="طن مسلَّم" value={decimal(summary.deliveredTons, 0)} />
        <KpiCard label="حمولات (بونات)" value={num(summary.deliveryCount)} />
        <KpiCard label="طن بلا سعر" value={decimal(summary.pendingTons, 0)} deltaDirection={summary.pendingCount > 0 ? "down" : "none"} />
        <KpiCard label="إيراد مُقيّد" value={egpExact(summary.finalizedTotal)} />
        <KpiCard label="محصَّل" value={egpExact(summary.collectedTotal)} />
        <KpiCard label="ذمم التجار" value={egpExact(summary.outstandingTotal)} deltaDirection={compareDecimals(summary.outstandingTotal, "0") > 0 ? "down" : "none"} />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-bold" style={{ color: "var(--ink)" }}>التسليمات</h2>
        {isTruncated && (
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            يظهر أحدث {num(deliveryRows.length)} من إجمالي {num(summary.deliveryCount)} حمولة. البحث داخل الصفوف المعروضة فقط، وتصدير CSV متوقف حتى لا يبدو الملف الجزئي كاملًا.
          </p>
        )}
        <FilterableTable
          columns={DELIVERY_COLUMNS}
          rows={deliveryRows}
          ariaLabel="تسليمات الموسم"
          placeholder={isTruncated ? "ابحث ضمن أحدث الصفوف المعروضة…" : "ابحث ببون/تاجر/محصول…"}
          exportFilename={isTruncated ? undefined : "season-deliveries"}
          empty="لا تسليمات"
        />
      </section>

      {centerRows.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-bold" style={{ color: "var(--ink)" }}>الإنتاج لكل مركز (كجم/فدان)</h2>
          <FilterableTable
            columns={CENTER_COLUMNS}
            rows={centerRows}
            ariaLabel="إنتاج المراكز"
            exportFilename="season-by-center"
            empty="لا بيانات مراكز"
          />
        </section>
      )}
    </div>
  );
}
