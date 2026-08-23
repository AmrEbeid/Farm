// SPEC-0033 R4a — the inventory list. One bounded, active-organisation, role-scoped snapshot per
// page view; server-rendered throughout, phone-first Arabic RTL.
//
// WHAT REPLACED WHAT. The old page selected EVERY inventory item with a nested bin join, read
// `inventory_bin[0]` in JavaScript, and filtered/searched/exported the whole set in the browser. So
// an item stored in two locations showed the first bin's balance as if it were the whole stock, an
// item with no bin row showed «٠» when the truth was "never recorded", and the page grew without
// bound. All three are fixed at the database boundary, not here.
//
// NO CLIENT COMPONENT, ON PURPOSE. Search is a plain GET form and every filter/page control is a
// link, so the list works with no JavaScript, keeps its whole state in the URL, and can be
// bookmarked, shared and back-buttoned. That also means opening a row cannot lose the list context:
// the row link carries it (lib/inventory-list-context).
//
// NO TABLE, ON PURPOSE. A nine-column table cannot reflow into 390px without a horizontal scrollbar
// on the page. Each item is one block that stacks on a phone and widens on a desk, so there is no
// axis to overflow on.
//
// HONESTY (docs/CLAUDE.md #1). «بلا رصيد مسجل» is never «٠». An unknown unit cost is «غير معروف» and
// its item is excluded from the valuation total, which always states how many items it left out. The
// reorder reading is labelled a point-in-time reading and is never called coverage.

import Link from "next/link";
import { AlertTriangle, HelpCircle, PackageSearch, Search, Wallet } from "lucide-react";
import { ImportPanel } from "@/components/import/ImportPanel";
import { PageHeader } from "@/components/PageHeader";
import { Alert, EmptyState, StatusPill } from "@/components/ui";
import { isAuthoritative } from "@/lib/data-authority";
import {
  binCountLabel,
  exactCount,
  moneyText,
  plainCount,
  quantity,
  STOCK_STATE_LABEL,
  STOCK_STATE_PILL,
  thresholdLabel,
} from "@/lib/inventory-display";
import {
  inventoryItemHref,
  inventoryListHref,
  inventoryPageCount,
  type InventoryListContext,
} from "@/lib/inventory-list-context";
import {
  inventoryFiltersForScope,
  type ExactCountString,
  type InventoryListFilter,
  type InventoryListFinanceRow,
  type InventoryListRow,
  type InventoryListSnapshot,
} from "@/lib/inventory-snapshot-reads";

const FILTER_LABEL: Record<InventoryListFilter, string> = {
  all: "كل الأصناف",
  below_reorder: "تحت حد إعادة الطلب",
  unknown: "بلا رصيد مسجل",
  uncosted: "بلا تكلفة مسجلة",
};

function filterCount(snapshot: InventoryListSnapshot, filter: InventoryListFilter): ExactCountString {
  switch (filter) {
    case "below_reorder":
      return snapshot.counts.belowReorder;
    case "unknown":
      return snapshot.counts.unknownStock;
    case "uncosted":
      return snapshot.scope === "finance" ? snapshot.counts.uncosted : "0";
    default:
      return snapshot.counts.queryTotal;
  }
}

function isFinanceRow(
  row: InventoryListRow | InventoryListFinanceRow,
): row is InventoryListFinanceRow {
  return "unitCost" in row;
}

/** The search box. A plain GET form, so it needs no JavaScript and resets to page one by omission. */
function SearchForm({ context }: { context: InventoryListContext }) {
  return (
    <form action="/inventory" method="get" role="search" className="flex flex-wrap items-center gap-2">
      <label htmlFor="inventory-search" className="sr-only">ابحث في الأصناف</label>
      <input
        id="inventory-search"
        name="q"
        type="search"
        defaultValue={context.query}
        maxLength={60}
        placeholder="ابحث باسم الصنف أو فئته…"
        className="fos-input fos-input--md min-w-0 flex-1"
        style={{ minHeight: 44 }}
      />
      {context.filter !== "all" && <input type="hidden" name="filter" value={context.filter} />}
      <button type="submit" className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
        <Search size={16} aria-hidden /> ابحث
      </button>
      {context.query !== "" && (
        <Link
          href={inventoryListHref({ filter: context.filter })}
          className="fos-btn fos-btn--ghost fos-btn--md"
          style={{ minHeight: 44 }}
        >
          امسح البحث
        </Link>
      )}
    </form>
  );
}

/** Filter chips. Each carries its own exact count, so choosing one never hides how big the set is. */
function FilterChips({
  snapshot,
  context,
}: {
  snapshot: InventoryListSnapshot;
  context: InventoryListContext;
}) {
  return (
    <nav aria-label="تصفية الأصناف" className="flex flex-wrap gap-2">
      {inventoryFiltersForScope(snapshot.scope).map((filter) => {
        const active = filter === context.filter;
        return (
          <Link
            key={filter}
            href={inventoryListHref({ query: context.query, filter, page: 1 })}
            aria-current={active ? "page" : undefined}
            className="inline-flex items-center gap-2 rounded-full px-3 text-sm font-semibold"
            style={{
              minHeight: 44,
              color: active ? "var(--brand-contrast)" : "var(--ink)",
              background: active ? "var(--brand)" : "var(--surface)",
              border: "1px solid var(--line)",
            }}
          >
            <span>{FILTER_LABEL[filter]}</span>
            <span style={{ opacity: 0.85 }}>{exactCount(filterCount(snapshot, filter))}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function ItemRow({
  row,
  scope,
  context,
  canCountStock,
}: {
  row: InventoryListRow | InventoryListFinanceRow;
  scope: InventoryListSnapshot["scope"];
  context: InventoryListContext;
  canCountStock: boolean;
}) {
  const finance = isFinanceRow(row) ? row : null;
  const balance = row.state === "unknown"
    ? "لا يوجد رصيد مسجل في أي مخزن — وهذه ليست «صفر»"
    : `المتاح ${quantity(row.available, row.unit)} · الموجود ${quantity(row.onHand, row.unit)}`
      + ` · المحجوز ${quantity(row.reserved, row.unit)} · ${binCountLabel(row.binCount)}`;

  return (
    <li className="border-b py-3 last:border-b-0" style={{ borderColor: "var(--line)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={inventoryItemHref(row.itemId, context)}
          className="text-sm font-semibold underline underline-offset-4"
          style={{ color: "var(--brand)", minHeight: 44, display: "inline-flex", alignItems: "center" }}
        >
          {row.name}
        </Link>
        <StatusPill status={STOCK_STATE_PILL[row.state]}>{STOCK_STATE_LABEL[row.state]}</StatusPill>
      </div>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>
        {row.category ?? "بلا فئة مسجلة"} · {balance}
      </p>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>
        {thresholdLabel(row.threshold, row.thresholdSource, row.unit)}
      </p>
      {finance && (
        <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>
          {finance.unitCost === null
            ? "التكلفة غير مسجلة — الصنف خارج إجمالي القيمة"
            : `تكلفة الوحدة ${moneyText(finance.unitCost)} · القيمة ${moneyText(finance.valuation)}`}
        </p>
      )}
      {row.state === "unknown" && canCountStock && (
        <div className="mt-2">
          <Link href="/inventory/stock-take" className="fos-btn fos-btn--secondary fos-btn--md inline-flex" style={{ minHeight: 44 }}>
            سجّل جردًا لهذا المخزن
          </Link>
        </div>
      )}
      {row.state === "below_reorder" && scope === "finance" && (
        <div className="mt-2">
          <Link
            href={`/inventory/${row.itemId}/coverage`}
            className="fos-btn fos-btn--secondary fos-btn--md inline-flex"
            style={{ minHeight: 44 }}
          >
            افحص تغطية الصنف
          </Link>
        </div>
      )}
    </li>
  );
}

function Pager({
  snapshot,
  context,
}: {
  snapshot: InventoryListSnapshot;
  context: InventoryListContext;
}) {
  const pages = inventoryPageCount(snapshot.counts.matching, snapshot.limit);
  if (pages <= 1) return null;
  const page = Math.min(context.page, pages);
  return (
    <nav aria-label="صفحات الأصناف" className="flex items-center justify-between gap-2">
      {page > 1 ? (
        <Link
          href={inventoryListHref({ ...context, page: page - 1 })}
          className="fos-btn fos-btn--secondary fos-btn--md"
          style={{ minHeight: 44 }}
        >
          السابق
        </Link>
      ) : <span />}
      <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
        صفحة {plainCount(page)} من {plainCount(pages)} · {exactCount(snapshot.counts.matching)} صنف مطابق
      </span>
      {page < pages ? (
        <Link
          href={inventoryListHref({ ...context, page: page + 1 })}
          className="fos-btn fos-btn--secondary fos-btn--md"
          style={{ minHeight: 44 }}
        >
          التالي
        </Link>
      ) : <span />}
    </nav>
  );
}

export function InventoryListView({
  snapshot,
  context,
  canCountStock,
}: {
  snapshot: InventoryListSnapshot;
  context: InventoryListContext;
  /** Roles the stock-take RPC actually accepts, so an unknown row never offers a dead affordance. */
  canCountStock: boolean;
}) {
  const { counts, rows } = snapshot;
  const inventoryVerified = isAuthoritative(snapshot.authority.inventory);
  const searching = context.query !== "";
  // A page beyond the last one is empty for a different reason than an empty search, and saying so
  // stops «لا توجد أصناف» from reading as "this organisation has no stock".
  const deepPage = rows.length === 0 && context.page > 1 && counts.matching !== "0";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4" data-testid="inventory-list">
      <PageHeader
        title="المخزون"
        subtitle="كل صنف، ورصيده من كل مخازنه، وحالته الآن."
        metadata={(
          <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
            {exactCount(counts.totalItems)} صنف مسجل
          </span>
        )}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Link href="/inventory/dashboard" className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
              لوحة المخزون
            </Link>
            <Link href="/inventory/movements" className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
              كل الحركات
            </Link>
          </div>
        )}
      />

      {!inventoryVerified && (
        <Alert
          tone="warning"
          title="الأرقام هنا مسجلة فقط، وتغطية مصدر المخزون غير مؤكدة"
          description="كل عدد في هذه الصفحة عدد دقيق لما هو مسجل في المؤسسة النشطة، وليس تأكيدًا أن كل حركة مخزن جرى تسجيلها."
        />
      )}

      <section aria-labelledby="inventory-find-title" className="flex flex-col gap-3">
        <h2 id="inventory-find-title" className="sr-only">ابحث وصفِّ الأصناف</h2>
        <SearchForm context={context} />
        <FilterChips snapshot={snapshot} context={context} />
      </section>

      <section aria-labelledby="inventory-state-title" className="flex flex-col gap-1">
        <h2 id="inventory-state-title" className="flex items-center gap-2 text-sm font-bold">
          <PackageSearch size={17} aria-hidden />
          الحالة الآن
        </h2>
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {searching
            ? `${exactCount(counts.queryTotal)} صنف يطابق بحثك من ${exactCount(counts.totalItems)} صنف مسجل.`
            : `${exactCount(counts.totalItems)} صنف مسجل.`}
          {" "}
          <AlertTriangle size={13} aria-hidden className="inline align-[-2px]" />
          {" "}
          {exactCount(counts.belowReorder)} تحت الحد المسجل ·
          {" "}
          <HelpCircle size={13} aria-hidden className="inline align-[-2px]" />
          {" "}
          {exactCount(counts.unknownStock)} بلا رصيد مسجل ·
          {" "}
          {exactCount(counts.noThreshold)} بلا حد مسجل ·
          {" "}
          {exactCount(counts.okStock)} فوق الحد.
        </p>
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          «تحت الحد» قراءة لحظية لمجموع كل المخازن مقابل الحد المسجل، وليست توقّع النقص القادم؛ ذلك يبقى في صفحة
          تغطية الصنف.
        </p>
        {snapshot.scope === "finance" && (
          <p className="mt-1 flex flex-wrap items-center gap-1 text-xs" style={{ color: "var(--ink-muted)" }}>
            <Wallet size={13} aria-hidden />
            <span>
              قيمة ما أمكن تقييمه: {moneyText(snapshot.valuation.knownTotal)} عن{" "}
              {exactCount(snapshot.valuation.valuedItems)} صنف.
            </span>
            <span>
              خارج هذا الإجمالي: {exactCount(snapshot.valuation.unknownCostItems)} صنف بلا تكلفة مسجلة و
              {exactCount(snapshot.valuation.unknownStockItems)} صنف بلا رصيد مسجل. الإجمالي ليس قيمة المخزون كله.
            </span>
          </p>
        )}
      </section>

      <section aria-labelledby="inventory-rows-title" className="flex flex-col gap-2">
        <h2 id="inventory-rows-title" className="text-sm font-bold">
          {FILTER_LABEL[context.filter]} ({exactCount(counts.matching)})
        </h2>
        {rows.length === 0 ? (
          <EmptyState
            title={
              deepPage
                ? "لا توجد أصناف في هذه الصفحة"
                : searching
                  ? "لا يوجد صنف مطابق لهذا البحث"
                  : "لا توجد أصناف في هذه القائمة"
            }
            description={
              deepPage
                ? `هذه القائمة بها ${exactCount(counts.matching)} صنف مطابق فقط، فصفحة ${plainCount(context.page)} خارجها.`
                : searching
                  ? "جرّب كلمة أقصر، أو امسح البحث للعودة إلى كل الأصناف."
                  : "غيّر التصفية أو ارجع إلى كل الأصناف."
            }
            action={(
              <Link
                href={deepPage ? inventoryListHref({ ...context, page: 1 }) : inventoryListHref()}
                className="fos-btn fos-btn--secondary fos-btn--md"
                style={{ minHeight: 44 }}
              >
                {deepPage ? "أول صفحة" : "كل الأصناف"}
              </Link>
            )}
          />
        ) : (
          <>
            <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
              الأصناف التي تحتاج قرارًا أولًا، ثم الباقي بالاسم. هذه صفحة واحدة من القائمة، لا القائمة كلها.
            </p>
            <ul>
              {rows.map((row) => (
                <ItemRow
                  key={row.itemId}
                  row={row}
                  scope={snapshot.scope}
                  context={context}
                  canCountStock={canCountStock}
                />
              ))}
            </ul>
            <Pager snapshot={snapshot} context={context} />
          </>
        )}
      </section>

      {snapshot.scope === "finance" && (
        // The bulk item import stays exactly where it has always been, for the roles that have
        // always had it. It is a data-management workbench — a file upload, a dry run and a commit —
        // not part of the operational store surface, so it is not offered in the operational scope.
        // That is a UX boundary, NOT a control and not a claim about leakage: the template carries
        // no cost and no supplier name (`inventoryItemsDescriptor.fromRow` blanks the ref column),
        // and the storekeeper's `inventory.write` permission is unchanged. `app/api/import` and
        // `fn_save_inventory_item` remain the enforcement.
        <section aria-labelledby="inventory-import-title" className="no-print flex flex-col gap-2">
          <h2 id="inventory-import-title" className="text-sm font-bold">استيراد الأصناف</h2>
          <ImportPanel descriptorKey="inventory-items" titleAr="أصناف المخزون" />
        </section>
      )}
    </main>
  );
}
