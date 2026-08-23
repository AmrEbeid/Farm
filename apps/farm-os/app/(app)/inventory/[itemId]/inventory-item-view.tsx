// SPEC-0033 R4a — the inventory item 360. One bounded, active-organisation, role-scoped snapshot per
// page view; server-rendered throughout, phone-first Arabic RTL.
//
// WHAT REPLACED WHAT. The old page ran three parallel PostgREST reads, embedded `inventory_bin` and
// then took `inventory_bin[0]`. For an item stored in two locations it therefore published ONE bin's
// balance as the item's stock — on the very page a buyer uses to decide a purchase. Here every
// balance is the sum of EVERY bin, and «المخازن» lists each physical location in full so the
// aggregate can be checked against the rows behind it rather than trusted.
//
// NO CLIENT COMPONENT, AND NO TABS, ON PURPOSE. The field/store roles are explicitly
// mobile-and-offline-tolerant (docs/CLAUDE.md #2). Tabs hide bounded content behind a tap that needs
// JavaScript to work; this page is instead one column of short labelled sections, so the whole item
// is readable by scrolling, with no JavaScript and no horizontal axis to overflow on. Every section
// is bounded by the snapshot, so the column stays short.
//
// ROLE SCOPE. The `operational` (storekeeper) payload has no cost, valuation, supplier, purchase
// free text or purchase-request id at all, so this component cannot render one even by mistake — the
// discriminated union simply has no such property on that branch, and the finance blocks below are
// unreachable for it. Nothing is fetched and then hidden.
//
// HONESTY (docs/CLAUDE.md #1). «بلا رصيد مسجل» is never «٠»; an unrecorded policy value is
// «غير مسجل»; an unknown cost is «غير معروف» and the item is excluded from its own valuation. The
// reorder reading is a point-in-time reading and is never called coverage — that verdict stays on
// the per-item coverage page, which only the finance scope may open.

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Boxes, History, Ruler, ShoppingCart, Warehouse } from "lucide-react";
import { Entity360Header } from "@/components/Entity360Header";
import { Alert, Breadcrumbs, EmptyState } from "@/components/ui";
import { fmtDate } from "@/lib/dates";
import { isAuthoritative } from "@/lib/data-authority";
import { MOVEMENT_TYPE_AR, PR_STATUS_AR } from "@/lib/labels";
import {
  binCountLabel,
  daysLabel,
  exactCount,
  moneyText,
  quantity,
  recordedQuantity,
  STOCK_STATE_LABEL,
  STOCK_STATE_NOTE,
  STOCK_STATE_PILL,
  thresholdLabel,
} from "@/lib/inventory-display";
import type {
  InventoryItemFinanceMovement,
  InventoryItemFinancePurchase,
  InventoryItemLocation,
  InventoryItemMovement,
  InventoryItemPurchase,
  InventoryItemSnapshot,
} from "@/lib/inventory-snapshot-reads";

/** One labelled fact. `min-w-0` + wrapping is what keeps a long Arabic value off a second axis. */
function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs" style={{ color: "var(--ink-muted)" }}>{term}</dt>
      <dd className="text-sm font-semibold" style={{ overflowWrap: "anywhere" }}>{children}</dd>
    </div>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">{children}</dl>;
}

function SectionTitle({ id, icon, children }: { id: string; icon: ReactNode; children: ReactNode }) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-sm font-bold">
      {icon}
      {children}
    </h2>
  );
}

/** «هذه أحدث ١٠ حركة من ٤٢ حركة مسجلة» — a sample never presents itself as the whole ledger. */
function sampleNote(shown: number, total: string, noun: string): string | null {
  if (BigInt(total) <= BigInt(shown)) return null;
  return `هذه ${exactCount(String(shown))} ${noun} فقط من ${exactCount(total)} ${noun} مسجلة.`;
}

function LocationRow({ row, unit }: { row: InventoryItemLocation; unit: string | null }) {
  return (
    <li className="border-b py-2 last:border-b-0" style={{ borderColor: "var(--line)" }}>
      <p className="text-sm font-semibold" style={{ overflowWrap: "anywhere" }}>{row.location}</p>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>
        المتاح {quantity(row.available, unit)} · الموجود {quantity(row.onHand, unit)} ·
        {" "}المحجوز {quantity(row.reserved, unit)} · قيد الطلب {quantity(row.ordered, unit)} ·
        {" "}المتوقع {quantity(row.projected, unit)}
      </p>
    </li>
  );
}

function MovementRow({
  row,
  unit,
}: {
  row: InventoryItemMovement | InventoryItemFinanceMovement;
  unit: string | null;
}) {
  const finance = "unitCost" in row ? row : null;
  return (
    <li className="border-b py-2 last:border-b-0" style={{ borderColor: "var(--line)" }}>
      <p className="text-sm font-semibold">
        {MOVEMENT_TYPE_AR[row.type] ?? row.type} {quantity(row.qty, row.unit ?? unit)}
      </p>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)", overflowWrap: "anywhere" }}>
        {fmtDate(row.occurredOn)} · {row.location}
        {row.batchNo ? ` · تشغيلة ${row.batchNo}` : ""}
        {row.expiryDate ? ` · تنتهي ${fmtDate(row.expiryDate)}` : ""}
        {finance ? ` · تكلفة الوحدة ${moneyText(finance.unitCost)}` : ""}
      </p>
    </li>
  );
}

function PurchaseRow({
  row,
  unit,
}: {
  row: InventoryItemPurchase | InventoryItemFinancePurchase;
  unit: string | null;
}) {
  const finance = "prId" in row ? row : null;
  // The line's own unit is what the order says; the item's unit is what a receipt is actually
  // recorded in. When they differ, both are shown rather than letting one quietly win.
  const lineUnit = row.unit ?? row.itemUnit ?? unit;
  const unitNote = row.unit && row.itemUnit && row.unit !== row.itemUnit
    ? ` · يُسجَّل الاستلام بـ${row.itemUnit}`
    : "";
  const whenNote = row.neededBy ? `مطلوب بحلول ${fmtDate(row.neededBy)}` : "بلا موعد مسجل";
  return (
    <li className="border-b py-2 last:border-b-0" style={{ borderColor: "var(--line)" }}>
      <div className="flex flex-wrap items-center gap-2">
        {finance ? (
          <Link
            href={`/purchase-requests/${finance.prId}`}
            className="text-sm font-semibold underline underline-offset-4"
            style={{ color: "var(--brand)", minHeight: 44, display: "inline-flex", alignItems: "center" }}
          >
            {row.code}
          </Link>
        ) : (
          <span className="text-sm font-semibold">{row.code}</span>
        )}
        <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {PR_STATUS_AR[row.status] ?? row.status}
        </span>
      </div>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)", overflowWrap: "anywhere" }}>
        {row.ordered === null
          ? "الطلب بلا كمية مسجلة — لا يوجد متبقٍ يُحسب"
          : `المطلوب ${quantity(row.ordered, lineUnit)} · المستلم ${quantity(row.received, lineUnit)}`
            + ` · المتبقي ${quantity(row.remaining, lineUnit)}`}
        {unitNote}
        {` · ${whenNote}`}
      </p>
      {finance && (
        <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)", overflowWrap: "anywhere" }}>
          التكلفة التقديرية {moneyText(finance.estCost)}
          {finance.reason ? ` · السبب ${finance.reason}` : ""}
        </p>
      )}
    </li>
  );
}

export function InventoryItemView({
  snapshot,
  returnTo,
}: {
  snapshot: InventoryItemSnapshot;
  /** A validated internal list path. Never the caller's own bytes — see lib/inventory-list-context. */
  returnTo: string;
}) {
  const { item, policy, stock, locations } = snapshot;
  const finance = snapshot.scope === "finance" ? snapshot : null;
  const unit = item.unit;
  const inventoryVerified = isAuthoritative(snapshot.authority.inventory);
  // Widened to the union element type so the two scopes share one render path. The finance-only
  // fields stay unreachable on an operational row: `in` is what narrows them, not a cast.
  const movements: (InventoryItemMovement | InventoryItemFinanceMovement)[] = snapshot.movements;
  const purchases: (InventoryItemPurchase | InventoryItemFinancePurchase)[] = snapshot.purchases;
  const movementNote = sampleNote(movements.length, snapshot.movementTotal, "حركة");
  const purchaseNote = sampleNote(purchases.length, snapshot.purchaseTotal, "بند");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4" data-testid="inventory-item-360">
      <Breadcrumbs
        ariaLabel="المسار"
        items={[
          { id: "inventory", label: "الأصناف", href: returnTo },
          { id: "item", label: item.name },
        ]}
      />

      <Entity360Header
        title={item.name}
        subtitle={`${item.category ?? "بلا فئة مسجلة"} · ${unit ?? "بلا وحدة مسجلة"} · ${binCountLabel(stock.binCount)}`}
        pills={[{ status: STOCK_STATE_PILL[stock.state], label: STOCK_STATE_LABEL[stock.state] }]}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Link href={returnTo} className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
              <ArrowRight size={16} aria-hidden /> رجوع إلى الأصناف
            </Link>
            {finance && (
              <Link
                href={`/inventory/${snapshot.itemId}/coverage`}
                className="fos-btn fos-btn--secondary fos-btn--md"
                style={{ minHeight: 44 }}
              >
                تغطية الصنف
              </Link>
            )}
          </div>
        )}
      />

      {!inventoryVerified && (
        <Alert
          tone="warning"
          title="الأرقام هنا مسجلة فقط، وتغطية مصدر المخزون غير مؤكدة"
          description="كل رقم في هذه الصفحة قراءة دقيقة لما هو مسجل في المؤسسة النشطة، وليس تأكيدًا أن كل حركة مخزن جرى تسجيلها."
        />
      )}

      <section aria-labelledby="item-stock-title" className="flex flex-col gap-2">
        <SectionTitle id="item-stock-title" icon={<Boxes size={17} aria-hidden />}>الرصيد الآن</SectionTitle>
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>{STOCK_STATE_NOTE[stock.state]}</p>
        <Facts>
          <Fact term="المتاح من كل المخازن">{quantity(stock.available, unit)}</Fact>
          <Fact term="الموجود">{quantity(stock.onHand, unit)}</Fact>
          <Fact term="المحجوز">{quantity(stock.reserved, unit)}</Fact>
          <Fact term="قيد الطلب">{quantity(stock.ordered, unit)}</Fact>
          <Fact term="الرصيد المتوقع">{quantity(stock.projected, unit)}</Fact>
          <Fact term="عدد المخازن">{binCountLabel(stock.binCount)}</Fact>
        </Facts>
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {thresholdLabel(stock.threshold, stock.thresholdSource, unit)}
        </p>
        {finance && (
          <Facts>
            <Fact term="تكلفة الوحدة المسجلة">{moneyText(finance.unitCost)}</Fact>
            <Fact term="قيمة الموجود">
              {finance.valuation === null
                ? "لا يمكن تقييمه — التكلفة أو الرصيد غير مسجل"
                : moneyText(finance.valuation)}
            </Fact>
          </Facts>
        )}
      </section>

      <section aria-labelledby="item-locations-title" className="flex flex-col gap-2">
        <SectionTitle id="item-locations-title" icon={<Warehouse size={17} aria-hidden />}>
          المخازن ({exactCount(stock.binCount)})
        </SectionTitle>
        {locations.length === 0 ? (
          <EmptyState
            title="لا يوجد مخزن مسجل لهذا الصنف"
            description="لم يُسجَّل لهذا الصنف رصيد في أي مخزن. هذه ليست حالة «لا يوجد مخزون»."
          />
        ) : (
          <>
            <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
              كل موقع مسجل لهذا الصنف، بلا استثناء. مجموع هذه الصفوف هو نفسه الرصيد أعلاه.
            </p>
            <ul>
              {locations.map((row) => (
                <LocationRow key={row.location} row={row} unit={unit} />
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="item-policy-title" className="flex flex-col gap-2">
        <SectionTitle id="item-policy-title" icon={<Ruler size={17} aria-hidden />}>سياسة إعادة الطلب المسجلة</SectionTitle>
        <Facts>
          <Fact term="الحد الأدنى">{recordedQuantity(policy.minStock, unit)}</Fact>
          <Fact term="الحد الأقصى">{recordedQuantity(policy.maxStock, unit)}</Fact>
          <Fact term="مخزون الأمان">{recordedQuantity(policy.safetyStock, unit)}</Fact>
          <Fact term="نقطة إعادة الطلب">{recordedQuantity(policy.reorderPoint, unit)}</Fact>
          <Fact term="كمية إعادة الطلب">{recordedQuantity(policy.reorderQty, unit)}</Fact>
          <Fact term="مدة التوريد">{daysLabel(policy.leadTimeDays)}</Fact>
          <Fact term="حجم العبوة">{recordedQuantity(item.packSize, null)}</Fact>
          <Fact term="الأهمية">{item.criticality ?? "غير مسجلة"}</Fact>
          <Fact term="متابعة الصلاحية">{item.expiryTracked ? "نعم" : "لا"}</Fact>
        </Facts>
        {finance && (
          <p className="text-xs" style={{ color: "var(--ink-muted)", overflowWrap: "anywhere" }}>
            {finance.supplier === null
              ? "لا يوجد مورد مفضل مسجل لهذا الصنف."
              : `المورد المفضل ${finance.supplier.name} · مدة توريده ${daysLabel(finance.supplier.leadTimeDays)}`}
          </p>
        )}
      </section>

      <section aria-labelledby="item-movements-title" className="flex flex-col gap-2">
        <SectionTitle id="item-movements-title" icon={<History size={17} aria-hidden />}>
          آخر الحركات ({exactCount(snapshot.movementTotal)})
        </SectionTitle>
        {movements.length === 0 ? (
          <EmptyState
            title="لا توجد حركة مسجلة لهذا الصنف"
            description="لم تُسجَّل أي حركة وارد أو صرف أو تسوية لهذا الصنف في المؤسسة النشطة."
          />
        ) : (
          <>
            {movementNote && (
              <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                {movementNote}
                {" "}
                <Link href="/inventory/movements" className="underline underline-offset-4" style={{ color: "var(--brand)" }}>
                  كل الحركات
                </Link>
              </p>
            )}
            <ul>
              {movements.map((row) => (
                <MovementRow key={row.id} row={row} unit={unit} />
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="item-purchases-title" className="flex flex-col gap-2">
        <SectionTitle id="item-purchases-title" icon={<ShoppingCart size={17} aria-hidden />}>
          طلبات الشراء ({exactCount(snapshot.purchaseTotal)})
        </SectionTitle>
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {exactCount(snapshot.openPurchaseTotal)} بند ما زال ينتظر الاستلام. هذه بنود مسجلة على طلبات شراء،
          وليست توقّعًا لما سيصل.
        </p>
        {purchases.length === 0 ? (
          <EmptyState
            title="لا يوجد بند شراء مسجل لهذا الصنف"
            description="لم يُسجَّل لهذا الصنف بند على أي طلب شراء في المؤسسة النشطة."
          />
        ) : (
          <>
            {purchaseNote && (
              <p className="text-xs" style={{ color: "var(--ink-muted)" }}>{purchaseNote}</p>
            )}
            <ul>
              {purchases.map((row) => (
                <PurchaseRow key={row.id} row={row} unit={unit} />
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
