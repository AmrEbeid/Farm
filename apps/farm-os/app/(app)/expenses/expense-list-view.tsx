import type { CSSProperties } from "react";
import Link from "next/link";
import { AlertTriangle, CircleDollarSign, Search } from "lucide-react";
import { AddExpense } from "@/components/AddExpense";
import { accountOptionLabel, leafPostingAccounts } from "@/components/AccountPicker";
import { ImportPanel } from "@/components/import/ImportPanel";
import { PageHeader } from "@/components/PageHeader";
import { PrintButton } from "@/components/print-button";
import { Alert, EmptyState, StatusPill } from "@/components/ui";
import { fmtDate } from "@/lib/dates";
import { egpDecimalSummary, formatDecimalArabic, type DecimalString } from "@/lib/decimal";
import {
  expenseHrefFromList,
  expenseListHref,
  type ExpenseListContext,
} from "@/lib/expense-list-context";
import type { ExpenseDailySnapshot } from "@/lib/expense-daily-snapshot";
import type { ExpenseFilter } from "@/lib/expense-register-summary";
import { expenseNextStep, expenseSearchMatches } from "@/lib/expense-workspace-display";
import { PAYMENT_STATUS_AR } from "@/lib/labels";
import { num } from "@/lib/money";

const KIND_LABELS: Record<string, string> = {
  operating: "تشغيلي",
  drawing: "مسحوبات",
  capex: "رأسمالي",
};

const FILTER_LABELS: Record<ExpenseFilter, string> = {
  all: "كل المصروفات",
  month: "هذا الشهر",
  operating: "تشغيلي",
  drawing: "مسحوبات",
  undated: "بدون تاريخ",
  unrouted: "غير موجّهة للسداد",
  unclassified: "بدون حساب",
  uncentered: "بدون مركز تكلفة",
};

function exactMoney(value: DecimalString | null): string {
  if (value == null) return "المبلغ غير مسجل";
  const scale = value.includes(".") ? value.length - value.indexOf(".") - 1 : 0;
  return `${formatDecimalArabic(value, Math.max(2, scale))} ج.م`;
}

function SearchForm({ context }: { context: ExpenseListContext }) {
  return (
    <form action="/expenses" method="get" role="search" className="flex flex-wrap items-center gap-2">
      <label htmlFor="expense-search" className="sr-only">ابحث في المصروفات المعروضة</label>
      <input
        id="expense-search"
        name="q"
        type="search"
        defaultValue={context.query}
        maxLength={60}
        placeholder="ابحث بالبيان أو المورّد أو الحساب…"
        className="fos-input fos-input--md min-w-0 flex-1"
        style={{ minHeight: 44 }}
      />
      {context.filter !== "all" && <input type="hidden" name="filter" value={context.filter} />}
      <button type="submit" className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
        <Search size={16} aria-hidden /> ابحث
      </button>
      {context.query !== "" && (
        <Link
          href={expenseListHref({ filter: context.filter })}
          className="fos-btn fos-btn--ghost fos-btn--md"
          style={{ minHeight: 44 }}
        >
          امسح البحث
        </Link>
      )}
    </form>
  );
}

function ExpenseRow({
  row,
  context,
}: {
  row: ExpenseDailySnapshot["expenseRows"][number] & { supplier: string | null; account: string | null };
  context: ExpenseListContext;
}) {
  const kind = KIND_LABELS[row.kind] ?? "غير مصنف";
  const next = expenseNextStep({ ...row, kind });
  const payment = row.paymentStatus ? PAYMENT_STATUS_AR[row.paymentStatus] ?? "حالة سداد غير معروفة" : "بلا مسار سداد";

  return (
    <li className="border-b py-3 last:border-b-0" style={{ borderColor: "var(--line)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={expenseHrefFromList(row.id, context)}
          className="inline-flex min-h-11 min-w-0 items-center font-semibold underline underline-offset-4"
          style={{ color: "var(--brand)" }}
        >
          <span className="truncate">{row.description ?? row.category ?? "مصروف بلا بيان"}</span>
        </Link>
        <strong className="shrink-0 text-sm tabular-nums">{exactMoney(row.total)}</strong>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <StatusPill status={next.attention ? "warning" : "done"}>{next.label}</StatusPill>
        <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {row.date ? fmtDate(row.date) : "بدون تاريخ"} · {kind} · {payment}
        </span>
      </div>
      <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
        {row.account ?? (row.accountId ? "حساب مسجل — الاسم غير متاح" : "بدون حساب محاسبي")} · {row.supplier ?? "بدون مورّد"}
      </p>
    </li>
  );
}

export function ExpenseListView({
  snapshot,
  context,
  canSeeOwnerDrawings,
  canWrite,
}: {
  snapshot: ExpenseDailySnapshot;
  context: ExpenseListContext;
  canSeeOwnerDrawings: boolean;
  canWrite: boolean;
}) {
  const { summary } = snapshot;
  const supplierMap = new Map(snapshot.supplierRows.map((supplier) => [supplier.id, supplier.name]));
  const postingAccounts = leafPostingAccounts(snapshot.accountRows);
  const accountMap = new Map(postingAccounts.map((account) => [account.id, accountOptionLabel(account)]));
  const rows = snapshot.expenseRows.map((row) => ({
    ...row,
    supplier: row.supplierId ? supplierMap.get(row.supplierId) ?? null : null,
    account: row.accountId ? accountMap.get(row.accountId) ?? null : null,
  }));
  const visibleRows = rows.filter((row) => expenseSearchMatches({
    ...row,
    kind: KIND_LABELS[row.kind] ?? "غير مصنف",
  }, context.query));
  const isTruncated = snapshot.matchingCount > snapshot.rowLimit;
  const monthNonDrawing = egpDecimalSummary({
    total: summary.monthNonDrawingTotal,
    hasUnknown: summary.monthNonDrawingUnknownCount > 0,
  });
  const monthDrawing = summary.monthDrawingTotal == null
    ? null
    : egpDecimalSummary({
        total: summary.monthDrawingTotal,
        hasUnknown: (summary.monthDrawingUnknownCount ?? 0) > 0,
      });
  const chips: { key: ExpenseFilter; count: number; attention?: boolean }[] = [
    { key: "all", count: summary.expenseCount },
    { key: "month", count: summary.monthCount },
    { key: "operating", count: summary.operatingCount },
    ...(canSeeOwnerDrawings ? [{ key: "drawing" as const, count: summary.drawingCount ?? 0 }] : []),
    ...(context.filter === "undated" ? [{ key: "undated" as const, count: snapshot.matchingCount, attention: true }] : []),
    { key: "unrouted", count: summary.unroutedCount, attention: true },
    { key: "unclassified", count: summary.unclassifiedCount, attention: true },
    { key: "uncentered", count: summary.uncenteredCount, attention: true },
  ];

  return (
    <main
      className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4"
      data-testid="expense-register"
      style={{ "--ink-muted": "#5f7066" } as CSSProperties}
    >
      <PageHeader
        title="المصروفات"
        subtitle="ما خرج من المال، وما يحتاج تصنيفًا أو سدادًا الآن."
        metadata={<span className="text-xs" style={{ color: "var(--ink-muted)" }}>{num(summary.expenseCount)} مصروف مسجل</span>}
        actions={(
          <div className="no-print flex flex-wrap gap-2">
            <PrintButton label="طباعة المصروفات" />
            <Link href="/record" className="fos-btn fos-btn--primary fos-btn--md" style={{ minHeight: 44 }}>
              سجّل عملية
            </Link>
          </div>
        )}
      />

      <section aria-labelledby="expense-state-title" className="flex flex-col gap-2">
        <h2 id="expense-state-title" className="flex items-center gap-2 text-sm font-bold">
          <CircleDollarSign size={17} aria-hidden /> هذا الشهر
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="border-s-4 px-3 py-2" style={{ borderColor: "var(--brand)", background: "var(--surface)" }}>
            <p className="text-xs" style={{ color: "var(--ink-muted)" }}>مصروفات هذا الشهر بدون المسحوبات</p>
            <strong className="text-base tabular-nums">{monthNonDrawing}</strong>
          </div>
          {canSeeOwnerDrawings && monthDrawing != null && (
            <div className="border-s-4 px-3 py-2" style={{ borderColor: "var(--warning-fg)", background: "var(--surface)" }}>
              <p className="text-xs" style={{ color: "var(--ink-muted)" }}>مسحوبات هذا الشهر</p>
              <strong className="text-base tabular-nums">{monthDrawing}</strong>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="expense-find-title" className="flex flex-col gap-3">
        <h2 id="expense-find-title" className="sr-only">ابحث وصفِّ المصروفات</h2>
        <SearchForm context={context} />
        <nav aria-label="تصفية المصروفات" className="flex flex-wrap gap-2">
          {chips.map((chip) => {
            const active = chip.key === context.filter;
            return (
              <Link
                key={chip.key}
                href={expenseListHref({ filter: chip.key, query: context.query })}
                aria-current={active ? "page" : undefined}
                className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold"
                style={{
                  color: active ? "var(--brand-contrast)" : chip.attention && chip.count > 0 ? "var(--danger-fg)" : "var(--ink)",
                  background: active ? "var(--brand)" : "var(--surface)",
                  border: "1px solid var(--line)",
                }}
              >
                <span>{FILTER_LABELS[chip.key]}</span>
                <span style={{ opacity: 0.85 }}>{num(chip.count)}</span>
              </Link>
            );
          })}
        </nav>
      </section>

      {isTruncated && (
        <Alert
          tone="warning"
          title={`المعروض أحدث ${num(snapshot.rowLimit)} من ${num(snapshot.matchingCount)} مصروف مطابق`}
          description="العدّادات وإجماليات الشهر من السجل الكامل. البحث داخل أحدث السجلات المعروضة فقط، لذلك لا نعرض تصديرًا قد يبدو كاملًا وهو ناقص."
        />
      )}

      <section aria-labelledby="expense-rows-title" className="flex flex-col gap-2">
        <h2 id="expense-rows-title" className="flex items-center gap-2 text-sm font-bold">
          {FILTER_LABELS[context.filter]} ({num(snapshot.matchingCount)})
          {context.query && <span className="font-normal" style={{ color: "var(--ink-muted)" }}>· {num(visibleRows.length)} ظاهر في البحث</span>}
        </h2>
        {visibleRows.length === 0 ? (
          <EmptyState
            title={context.query ? "لا يوجد مصروف مطابق في السجلات المعروضة" : "لا توجد مصروفات في هذه القائمة"}
            description={context.query ? "جرّب كلمة أقصر، أو امسح البحث. قد توجد نتائج أقدم إذا كانت القائمة محدودة." : "غيّر التصفية أو سجّل المصروف التالي."}
            action={context.query ? (
              <Link href={expenseListHref({ filter: context.filter })} className="fos-btn fos-btn--secondary fos-btn--md">
                امسح البحث
              </Link>
            ) : undefined}
          />
        ) : (
          <ul>
            {visibleRows.map((row) => <ExpenseRow key={row.id} row={row} context={context} />)}
          </ul>
        )}
      </section>

      {canWrite && (
        <section aria-labelledby="expense-add-title" className="no-print flex flex-col gap-2">
          <h2 id="expense-add-title" className="text-sm font-bold">إضافة سريعة</h2>
          <AddExpense suppliers={snapshot.supplierRows} accounts={postingAccounts} />
        </section>
      )}

      {canWrite && (
        <section aria-labelledby="expense-import-title" className="no-print flex flex-col gap-2">
          <h2 id="expense-import-title" className="flex items-center gap-2 text-sm font-bold">
            <AlertTriangle size={16} aria-hidden /> استيراد سجل
          </h2>
          <ImportPanel descriptorKey="expenses" titleAr="المصروفات" />
        </section>
      )}
    </main>
  );
}
