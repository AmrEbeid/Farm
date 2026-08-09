import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { KpiCard } from "@/components/ui";
import { FilterableTable } from "@/components/FilterableTable";
import { type SimpleColumn, type SimpleRow } from "@/components/SimpleTable";
import { PrintButton } from "@/components/print-button";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { formatDecimalArabic, type DecimalString } from "@/lib/decimal";
import {
  TX_ROW_LIMIT,
  compareTxByDateThenId,
  isAnySourceTruncated,
  isTypeTruncated,
} from "@/lib/transactions-ledger";
import { parseTransactionsSnapshot, type TransactionType } from "@/lib/transactions snapshot";

// SPEC-0025 U-3 — «المعاملات»: one read-only ledger of expenses, sales, collections and custody movements.
// One database snapshot supplies exact full counts plus a bounded sample per type; money never crosses JS Number.

export const dynamic = "force-dynamic";

type TxType = TransactionType;
const TYPE_AR: Record<TxType, string> = {
  expense: "مصروف",
  sale: "بيع",
  collection: "تحصيل",
  custody: "حركة عهدة",
};

function quantity(value: DecimalString): string {
  const scale = value.includes(".") ? value.length - value.indexOf(".") - 1 : 0;
  return formatDecimalArabic(value, scale);
}

const COLUMNS: SimpleColumn[] = [
  { id: "date", header: "التاريخ" },
  { id: "type", header: "النوع", kind: "tag-warn" },
  { id: "label", header: "البيان" },
  { id: "party", header: "الطرف", kind: "link" },
  { id: "amount", header: "المبلغ (ج.م)", kind: "money-preserve-exact", numeric: true, decimal: true },
  { id: "direction", header: "الاتجاه" },
];

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  const { type } = await searchParams;
  const active = (["expense", "sale", "collection", "custody"] as TxType[]).includes(type as TxType)
    ? (type as TxType)
    : null;
  const sb = await createClient();

  const snapshotRes = await sb.rpc("fn_transactions_snapshot", {
    p_org: m.orgId,
    p_row_limit: TX_ROW_LIMIT,
  });
  if (snapshotRes.error) throw snapshotRes.error;
  const { counts, rows: snapshotRows } = parseTransactionsSnapshot(snapshotRes.data, m.orgId);
  const expenseCount = counts.expense;
  const saleCount = counts.sale;
  const collectionCount = counts.collection;
  const custodyCount = counts.custody;
  const pendingPriceCount = counts.pendingPrice;
  const allCount = expenseCount + saleCount + collectionCount + custodyCount;

  interface Tx extends SimpleRow {
    sortDate: string;
  }
  const rows: Tx[] = [];

  for (const item of snapshotRows) {
    const common = {
      id: `${item.type}-${item.id}`,
      sortDate: item.event_date ?? "",
      date: item.event_date ? fmtDate(item.event_date) : "—",
      type: TYPE_AR[item.type],
      amount: item.amount ?? undefined,
      direction: item.direction === "in" ? "داخل" : "خارج",
      _t: item.type,
    };
    if (item.type === "expense") {
      rows.push({
        ...common,
        href: `/expenses/${item.id}`,
        label: [item.category, item.description].filter(Boolean).join(" — ") || "مصروف",
        party: item.party_name ?? "—",
      });
    } else if (item.type === "sale") {
      rows.push({
        ...common,
        href: "/finance/revenue-reports",
        label: `${item.crop}${item.quantity ? ` — ${quantity(item.quantity)} ${item.unit ?? ""}` : ""}${item.pending_price ? " (السعر معلّق)" : ""}`,
        party: item.party_name ?? "—",
        party_href: item.party_id ? `/finance/buyers/${item.party_id}` : "",
      });
    } else if (item.type === "collection") {
      rows.push({
        ...common,
        href: "/finance/revenue-reports",
        label: `تحصيل من عميل${item.collected_by ? ` (${item.collected_by})` : ""}`,
        party: "—",
      });
    } else {
      rows.push({
        ...common,
        href: "/custody",
        label: [item.movement_type, item.description].filter(Boolean).join(" — "),
        party: item.party_name ?? "—",
      });
    }
  }

  rows.sort(compareTxByDateThenId);
  const visible = active ? rows.filter((row) => row._t === active) : rows;
  const countOf: Record<TxType, number> = {
    expense: expenseCount,
    sale: saleCount,
    collection: collectionCount,
    custody: custodyCount,
  };
  const chips: { t: TxType | null; label: string; count: number }[] = [
    { t: null, label: "الكل", count: allCount },
    { t: "expense", label: TYPE_AR.expense, count: expenseCount },
    { t: "sale", label: TYPE_AR.sale, count: saleCount },
    { t: "collection", label: TYPE_AR.collection, count: collectionCount },
    { t: "custody", label: TYPE_AR.custody, count: custodyCount },
  ];

  const isTruncated = active
    ? isTypeTruncated(countOf[active])
    : isAnySourceTruncated([expenseCount, saleCount, collectionCount, custodyCount]);
  const activeExactCount = active ? countOf[active] : allCount;
  const searchExportNote =
    "البحث أدناه يقتصر على الصفوف المعروضة فقط، وتصدير CSV غير متاح هنا لتفادي ملف يبدو كاملاً بينما هو جزء من السجل.";
  const truncationNotice = !isTruncated
    ? null
    : active
      ? `يظهر أحدث ${num(visible.length)} من إجمالي ${num(activeExactCount)} عملية ${TYPE_AR[active]} مطابقة — الجدول غير مكتمل. الشرائح أعلاه محسوبة على السجل الكامل. ${searchExportNote}`
      : `تعرض هذه الصفحة حتى ${num(TX_ROW_LIMIT)} من أحدث كل نوع من العمليات على حدة (مصروف، بيع، تحصيل، حركة عهدة) — وليس أحدث ${num(visible.length)} عملية إجمالاً. المعروض الآن ${num(visible.length)} عملية من إجمالي ${num(activeExactCount)} عملية مطابقة عبر كل الأنواع — الجدول غير مكتمل. الشرائح أعلاه محسوبة على السجل الكامل. ${searchExportNote}`;

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>
            المعاملات
          </h1>
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            كل حركات الفلوس في مكان واحد — آخر {num(TX_ROW_LIMIT)} عملية من كل نوع.
          </p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-3">
          <PrintButton label="طباعة المعاملات" />
          <Link href="/record" className="text-sm font-bold underline underline-offset-4" style={{ color: "var(--brand)" }}>
            + سجّل عملية جديدة
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {chips.map((chip) => (
          <Link key={chip.label} href={chip.t ? `/transactions?type=${chip.t}` : "/transactions"} className="block">
            <KpiCard
              label={chip.label}
              value={num(chip.count)}
              icon={active === chip.t || (!active && chip.t === null) ? "◉" : undefined}
            />
          </Link>
        ))}
      </div>

      {truncationNotice && (
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          {truncationNotice}
        </p>
      )}

      <FilterableTable
        columns={COLUMNS}
        rows={visible}
        ariaLabel="سجل المعاملات الموحد"
        placeholder={isTruncated ? "ابحث ضمن أحدث الصفوف المعروضة…" : "ابحث في المعاملات…"}
        exportFilename={isTruncated ? undefined : "transactions"}
        empty="لا معاملات مطابقة"
      />

      {pendingPriceCount > 0 && (
        <div className="no-print flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-sm" style={{ background: "var(--surface-raised, #fff)", border: "1px solid var(--line)" }}>
          <span className="font-bold" style={{ color: "var(--ink)" }}>التالي المقترح:</span>
          <Link href="/record/price" className="font-bold underline underline-offset-4" style={{ color: "var(--brand)" }}>
            حدّد أسعار {num(pendingPriceCount)} بيع معلّق ليدخل الدفاتر ←
          </Link>
        </div>
      )}
    </div>
  );
}
