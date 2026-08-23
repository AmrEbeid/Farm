import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Alert, EmptyState, StatusPill } from "@/components/ui";
import { fmtDate } from "@/lib/dates";
import { formatDecimalArabic, type DecimalString } from "@/lib/decimal";
import { num } from "@/lib/money";
import { compareTxByDateThenId, TX_ROW_LIMIT } from "@/lib/transactions-ledger";
import {
  transactionNextStep,
  transactionRowTarget,
  transactionSearchMatches,
  transactionsListHref,
  type TransactionsListContext,
} from "@/lib/transactions-list-context";
import type { TransactionSnapshotRow, TransactionsSnapshot, TransactionType } from "@/lib/transactions snapshot";

const TYPE_AR: Record<TransactionType, string> = {
  expense: "مصروف",
  sale: "بيع",
  collection: "تحصيل",
  custody: "حركة عهدة",
};

function decimal(value: DecimalString): string {
  const scale = value.includes(".") ? value.length - value.indexOf(".") - 1 : 0;
  return formatDecimalArabic(value, scale);
}

function money(row: TransactionSnapshotRow): string {
  if (row.amount === null) return row.type === "sale" ? "السعر معلّق" : "المبلغ غير مسجل";
  const scale = row.amount.includes(".") ? row.amount.length - row.amount.indexOf(".") - 1 : 0;
  return `${formatDecimalArabic(row.amount, Math.max(2, scale))} ج.م`;
}

function rowLabel(row: TransactionSnapshotRow): string {
  if (row.type === "expense") return [row.category, row.description].filter(Boolean).join(" — ") || "مصروف بلا بيان";
  if (row.type === "sale") {
    const quantity = row.quantity ? ` — ${decimal(row.quantity)} ${row.unit ?? ""}` : "";
    return `${row.crop ?? "بيع محصول"}${quantity}`;
  }
  if (row.type === "collection") return `تحصيل من عميل${row.collected_by ? ` (${row.collected_by})` : ""}`;
  return [row.movement_type, row.description].filter(Boolean).join(" — ") || "حركة عهدة";
}

function SearchForm({ context }: { context: TransactionsListContext }) {
  return (
    <form action="/transactions" method="get" role="search" className="flex flex-wrap items-center gap-2">
      <label htmlFor="transaction-search" className="sr-only">ابحث في المعاملات المعروضة</label>
      <input id="transaction-search" name="q" type="search" defaultValue={context.query} maxLength={60}
        placeholder="ابحث بالبيان أو الطرف أو المبلغ…" className="fos-input fos-input--md min-w-0 flex-1" style={{ minHeight: 44 }} />
      {context.type && <input type="hidden" name="type" value={context.type} />}
      <button type="submit" className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
        <Search size={16} aria-hidden /> ابحث
      </button>
      {context.query && <Link href={transactionsListHref({ type: context.type })} className="fos-btn fos-btn--ghost fos-btn--md">امسح البحث</Link>}
    </form>
  );
}

function TransactionRow({ row, context }: { row: TransactionSnapshotRow; context: TransactionsListContext }) {
  const next = transactionNextStep(row);
  const target = transactionRowTarget(row, context);
  const label = rowLabel(row);
  const DirectionIcon = row.direction === "in" ? ArrowDownToLine : ArrowUpFromLine;
  const title = target.href ? (
    <Link href={target.href} className="inline-flex min-h-11 min-w-0 items-center font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>
      <span className="truncate">{label}</span>
    </Link>
  ) : <span className="inline-flex min-h-11 min-w-0 items-center font-semibold"><span className="truncate">{label}</span></span>;

  return (
    <li className="border-b py-3 last:border-b-0" style={{ borderColor: "var(--line)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">{title}<strong className="shrink-0 text-sm tabular-nums">{money(row)}</strong></div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <StatusPill status={next.attention ? "warning" : "done"}>{next.label}</StatusPill>
        <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--ink-muted)" }}>
          <DirectionIcon size={14} aria-hidden /> {row.direction === "in" ? "داخل" : "خارج"} · {TYPE_AR[row.type]} · {row.event_date ? fmtDate(row.event_date) : "بدون تاريخ"}
        </span>
      </div>
      <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>{row.party_name ?? target.reason ?? "لا يوجد طرف مسجل"}</p>
    </li>
  );
}

export function TransactionsListView({ snapshot, context }: { snapshot: TransactionsSnapshot; context: TransactionsListContext }) {
  const counts = snapshot.counts;
  const allCount = counts.expense + counts.sale + counts.collection + counts.custody;
  const chips: Array<{ type: TransactionType | null; label: string; count: number }> = [
    { type: null, label: "الكل", count: allCount },
    { type: "expense", label: TYPE_AR.expense, count: counts.expense },
    { type: "sale", label: TYPE_AR.sale, count: counts.sale },
    { type: "collection", label: TYPE_AR.collection, count: counts.collection },
    { type: "custody", label: TYPE_AR.custody, count: counts.custody },
  ];
  const typeRows = context.type ? snapshot.rows.filter((row) => row.type === context.type) : snapshot.rows;
  const sortedRows = [...typeRows].sort((a, b) => compareTxByDateThenId(
    { id: `${a.type}-${a.id}`, sortDate: a.event_date ?? "" },
    { id: `${b.type}-${b.id}`, sortDate: b.event_date ?? "" },
  ));
  const visibleRows = sortedRows.filter((row) => transactionSearchMatches([
    TYPE_AR[row.type], rowLabel(row), row.party_name, row.amount, row.event_date,
  ], context.query));
  const exactSelectedCount = context.type ? counts[context.type] : allCount;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4" data-testid="transactions-ledger"
      style={{ "--ink-muted": "#5f7066" } as CSSProperties}>
      <PageHeader title="المعاملات" subtitle="آخر المصروفات والمبيعات والتحصيلات وحركات العهدة المسجلة، وما يحتاج متابعة الآن."
        metadata={<span className="text-xs" style={{ color: "var(--ink-muted)" }}>{num(allCount)} معاملة في السجل</span>}
        actions={<Link href="/record" className="fos-btn fos-btn--primary fos-btn--md">سجّل عملية</Link>} />

      {counts.pendingPrice > 0 && <div className="flex flex-col gap-2">
        <Alert tone="warning" title={`${num(counts.pendingPrice)} بيع بسعر معلّق`}
          description="حدّد السعر حتى يدخل البيع في الدفاتر والتقارير المالية." />
        <div><Link href="/record/price" className="fos-btn fos-btn--secondary fos-btn--sm">حدّد الأسعار</Link></div>
      </div>}

      <section aria-labelledby="transaction-find-title" className="flex flex-col gap-3">
        <h2 id="transaction-find-title" className="sr-only">ابحث وصفِّ المعاملات</h2>
        <SearchForm context={context} />
        <nav aria-label="تصفية المعاملات" className="flex flex-wrap gap-2">
          {chips.map((chip) => {
            const active = chip.type === context.type;
            return <Link key={chip.label} href={transactionsListHref({ type: chip.type, query: context.query })}
              aria-current={active ? "page" : undefined} className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold"
              style={{ color: active ? "var(--brand-contrast)" : "var(--ink)", background: active ? "var(--brand)" : "var(--surface)", border: "1px solid var(--line)" }}>
              <span>{chip.label}</span><span style={{ opacity: 0.85 }}>{num(chip.count)}</span>
            </Link>;
          })}
        </nav>
      </section>

      <Alert tone="info" title="هذه قائمة تشغيل محدودة وليست دفترًا زمنيًا كاملاً"
        description={`تجمع الصفحة حتى ${num(TX_ROW_LIMIT)} من أحدث كل نوع على حدة؛ لذلك لا تعني أن الصفوف المعروضة هي أحدث المعاملات إجمالاً. العدّادات من السجل الكامل، والبحث داخل الصفوف المعروضة فقط، ولا يتوفر تصدير جزئي.`} />

      <section aria-labelledby="transaction-rows-title" className="flex flex-col gap-2">
        <h2 id="transaction-rows-title" className="text-sm font-bold">
          {context.type ? TYPE_AR[context.type] : "كل الأنواع"} ({num(exactSelectedCount)})
          {context.query && <span className="font-normal" style={{ color: "var(--ink-muted)" }}> · {num(visibleRows.length)} ظاهر في البحث</span>}
        </h2>
        {visibleRows.length === 0 ? <EmptyState
          title={context.query ? "لا توجد معاملة مطابقة في الصفوف المعروضة" : "لا توجد معاملات في هذه القائمة"}
          description={context.query ? "جرّب كلمة أقصر أو امسح البحث. قد توجد نتائج أقدم خارج العينة المحدودة." : "غيّر النوع أو سجّل العملية التالية."}
          action={context.query ? <Link href={transactionsListHref({ type: context.type })} className="fos-btn fos-btn--secondary fos-btn--md">امسح البحث</Link> : undefined}
        /> : <ul>{visibleRows.map((row) => <TransactionRow key={`${row.type}-${row.id}`} row={row} context={context} />)}</ul>}
      </section>
    </main>
  );
}
