// SPEC-0033 R3f — the Storekeeper home on «المخزون». One bounded, storekeeper-only snapshot of the
// RECORDED store day in the active organisation, for the current Cairo date.
//
// HONESTY (docs/CLAUDE.md #1). Every number is labelled المسجل — an exact count of recorded rows,
// never a claim that the store has been counted or that the shelf matches the book. No monetary
// figure of any kind appears here, and no individual is named. "Nothing left" is only ever said when
// the inventory source is verified.
//
// THERE IS NO "STOCK-TAKES DONE" NUMBER, ON PURPOSE. The gated reconciliation RPC writes no
// provenance row and posts nothing at all when the count matches the book, so a completed
// reconciliation leaves no trace to count. الجرد appears here only as an available action. The
// adjustment / loss / expiry rows in «حركات مسجلة تحتاج تفسيرًا» are RECORDED MOVEMENTS and are
// never labelled الجرد.
//
// «استلم الآن» is offered only for a request with no recorded blocker (see lib/storekeeper-home-reads).
// It is a shortcut, not a promise: the receipt RPC remains the enforcement, and an over-receipt or a
// concurrent claim can still refuse the posting.

import Link from "next/link";
import {
  AlertOctagon,
  ArrowDownToLine,
  ClipboardList,
  HelpCircle,
  PackageMinus,
  PackageSearch,
  ScrollText,
  TrendingDown,
} from "lucide-react";
import { AttentionInbox, type AttentionItem } from "@/components/DashboardHub";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { PageHeader } from "@/components/PageHeader";
import { Alert, EmptyState, KpiCard } from "@/components/ui";
import { cairoTodayIso } from "@/lib/payroll-close";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/dates";
import { formatDecimalArabic } from "@/lib/decimal";
import { MOVEMENT_TYPE_AR, PR_STATUS_AR } from "@/lib/labels";
import { isAuthoritative } from "@/lib/data-authority";
import {
  STOREKEEPER_HOME_DETAIL_LIMIT,
  parseStorekeeperHomeSnapshot,
  type ExactCountString,
  type StorekeeperBlocker,
  type StorekeeperHomeSnapshot,
  type StorekeeperIssue,
  type StorekeeperReceipt,
  type StorekeeperShrinkMovement,
  type StorekeeperStockItem,
} from "@/lib/storekeeper-home-reads";

/** Plain store Arabic for each recorded blocker — what is wrong and who fixes it. */
const BLOCKER_AR: Record<StorekeeperBlocker, string> = {
  unquantified_line: "بند بلا كمية مسجلة — يرفض النظام الطلب كله حتى يصحّحه مدير المزرعة",
};

/** One Arabic-Indic integer formatter for the whole page (docs/CLAUDE.md #2 — no Western digits). */
const ARABIC_INTEGER = new Intl.NumberFormat("ar-EG");

function exactCount(value: ExactCountString): string {
  return ARABIC_INTEGER.format(BigInt(value));
}

function hasCount(value: ExactCountString): boolean {
  return value !== "0";
}

function decimal(value: string): string {
  const scale = value.includes(".") ? value.split(".")[1].length : 0;
  return formatDecimalArabic(value, scale);
}

function quantity(value: string, unit: string | null): string {
  return unit ? `${decimal(value)} ${unit}` : decimal(value);
}

function whenLabel(row: StorekeeperReceipt): string {
  if (!row.neededBy) return "بلا موعد مسجل";
  return `مطلوب بحلول ${fmtDate(row.neededBy)}`;
}

/**
 * بماذا — the still-owed lines, quantities only, with the exact total behind a truncated sample.
 * The quantity is labelled with the ITEM's unit because that is the unit the receipt is recorded in;
 * when the order line says something else, both are shown rather than one silently winning.
 */
function linesLabel(row: StorekeeperReceipt): string {
  const shown = row.lines
    .map((line) => {
      const recorded = quantity(line.remaining, line.itemUnit ?? line.unit);
      return line.itemUnit && line.unit && line.unit !== line.itemUnit
        ? `${line.itemName} ${recorded} (مسجل على الطلب بـ${line.unit})`
        : `${line.itemName} ${recorded}`;
    })
    .join("، ");
  const hidden = BigInt(row.openLineCount) - BigInt(row.lines.length);
  return hidden > BigInt(0)
    ? `${shown} و${ARABIC_INTEGER.format(hidden)} بند مفتوح آخر`
    : shown;
}

function receiptDetail(row: StorekeeperReceipt): string {
  return [
    row.urgency === "overdue" ? "متأخر" : null,
    whenLabel(row),
    PR_STATUS_AR[row.status] ?? row.status,
    `${exactCount(row.openLineCount)} بند مفتوح`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function receiptHref(
  snapshot: StorekeeperHomeSnapshot,
  urgency: StorekeeperReceipt["urgency"],
): string {
  if (snapshot.drivers.receivable.some((row) => row.urgency === urgency)) {
    return "#storekeeper-receive";
  }
  if (snapshot.drivers.blocked.some((row) => row.urgency === urgency)) {
    return "#storekeeper-blocked";
  }
  return "#storekeeper-summary";
}

function buildAttention(snapshot: StorekeeperHomeSnapshot): AttentionItem[] {
  const items: AttentionItem[] = [];
  const { recorded } = snapshot;
  if (hasCount(recorded.overdueReceipts)) items.push({
    href: receiptHref(snapshot, "overdue"), tone: "act",
    text: `${exactCount(recorded.overdueReceipts)} طلب شراء تجاوز موعد استلامه`,
  });
  if (hasCount(recorded.blockedReceipts)) items.push({
    href: "#storekeeper-blocked", tone: "act",
    text: `${exactCount(recorded.blockedReceipts)} طلب لا يقبله النظام حتى يُصحَّح سببه المسجل`,
  });
  if (hasCount(recorded.belowReorder)) items.push({
    href: "#storekeeper-reorder", tone: "act",
    text: `${exactCount(recorded.belowReorder)} صنف تحت حد إعادة الطلب المسجل`,
  });
  if (hasCount(recorded.unknownStock)) items.push({
    href: "#storekeeper-unknown", tone: "watch",
    text: `${exactCount(recorded.unknownStock)} صنف بلا رصيد مسجل إطلاقًا`,
  });
  if (hasCount(recorded.undatedReceipts)) items.push({
    href: receiptHref(snapshot, "undated"), tone: "watch",
    text: `${exactCount(recorded.undatedReceipts)} طلب مفتوح بلا موعد مسجل`,
  });
  return items;
}

function Section({
  id, title, note, icon, children,
}: {
  id: string;
  title: string;
  note?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-1">
      <h3 id={`${id}-title`} className="flex items-center gap-2 text-sm font-bold">{icon}{title}</h3>
      {note && <p className="text-xs" style={{ color: "var(--ink-muted)" }}>{note}</p>}
      <ul id={id}>{children}</ul>
    </section>
  );
}

function RowShell({ title, detail, children }: {
  title: React.ReactNode;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="border-b py-3 last:border-b-0" style={{ borderColor: "var(--line)" }}>
      <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{title}</div>
      <div className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>{detail}</div>
      {children}
    </li>
  );
}

function ReceiptRow({ row, action }: { row: StorekeeperReceipt; action: "receive" | "none" }) {
  return (
    <RowShell title={`طلب شراء ${row.code}`} detail={receiptDetail(row)}>
      <div className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>{linesLabel(row)}</div>
      {row.blockers.length > 0 && (
        <ul className="mt-1 text-xs" style={{ color: "var(--danger, #b23b3b)" }}>
          {row.blockers.map((blocker) => (
            <li key={blocker}>{BLOCKER_AR[blocker]}</li>
          ))}
        </ul>
      )}
      {/* SECURITY: no drill-down to the purchase-request detail route — it renders an estimated
          spend figure and a per-line money column to any member, which this role must never be
          shown. Receiving happens on the storekeeper's own receive surface; a blocked request
          escalates to a human instead. */}
      {action === "receive" && (
        <div className="mt-2">
          <Link
            href="/m/receive"
            className="fos-btn fos-btn--primary fos-btn--md inline-flex w-full items-center justify-center"
            style={{ minHeight: 44 }}
          >
            استلم الآن
          </Link>
        </div>
      )}
    </RowShell>
  );
}

/**
 * A stock reading, known or unknown. Which one it is comes from the row itself: the parser gives a
 * threshold reading both a balance and a threshold, and an unknown-stock item neither.
 */
function StockRow({ row }: { row: StorekeeperStockItem }) {
  const detail = row.available !== null && row.threshold !== null
    ? `المتاح ${quantity(row.available, row.unit)} · حد إعادة الطلب المسجل ${quantity(row.threshold, row.unit)}`
    : "لا يوجد رصيد مسجل لهذا الصنف — هذه ليست حالة «لا يوجد مخزون»";
  return <RowShell title={row.name} detail={detail} />;
}

function IssueRow({ row }: { row: StorekeeperIssue }) {
  return (
    <RowShell
      title={row.itemName}
      detail={`${quantity(row.qty, row.unit)} · ${fmtDate(row.occurredOn)}`}
    />
  );
}

function ShrinkRow({ row }: { row: StorekeeperShrinkMovement }) {
  return (
    <RowShell
      title={`${MOVEMENT_TYPE_AR[row.type] ?? row.type} · ${row.itemName}`}
      detail={`${quantity(row.qty, row.unit)} · ${fmtDate(row.occurredOn)}`}
    />
  );
}

export async function StorekeeperHome({ orgId }: { orgId: string }) {
  const supabase = await createClient();
  const asOf = cairoTodayIso(new Date());
  const { data, error } = await supabase.rpc("fn_storekeeper_home_snapshot", {
    p_org: orgId, p_as_of: asOf, p_detail_limit: STOREKEEPER_HOME_DETAIL_LIMIT,
  });
  if (error) throw error;
  return <StorekeeperHomeView snapshot={parseStorekeeperHomeSnapshot(data, orgId, asOf)} />;
}

export function StorekeeperHomeView({ snapshot }: { snapshot: StorekeeperHomeSnapshot }) {
  const { recorded, drivers } = snapshot;
  const attention = buildAttention(snapshot);
  const inventoryVerified = isAuthoritative(snapshot.authority.inventory);
  const hasWork = drivers.receivable.length > 0 || drivers.blocked.length > 0
    || drivers.belowReorder.length > 0 || drivers.unknownStock.length > 0
    || drivers.issuedToday.length > 0 || drivers.recentShrink.length > 0;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-5 p-4" data-testid="storekeeper-home">
      <PageHeader
        title="شغل المخزن"
        subtitle="ما ينتظر الاستلام، وما نزل تحت حده، وما خرج اليوم."
        metadata={<span className="text-xs" style={{ color: "var(--ink-muted)" }}>حتى {fmtDate(snapshot.asOf)}</span>}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Link href="/m/receive" className="fos-btn fos-btn--primary fos-btn--md" style={{ minHeight: 44 }}>
              استلم بضاعة
            </Link>
            <Link href="/inventory/stock-take" className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
              ابدأ جردًا
            </Link>
          </div>
        )}
      />

      {attention.length > 0 || inventoryVerified ? <AttentionInbox items={attention} /> : null}

      {!inventoryVerified && (
        <Alert tone="warning" title="الأرقام هنا مسجلة فقط، وتغطية مصدر المخزون غير مؤكدة"
          description="كل رقم في هذه الصفحة عدد دقيق لما هو مسجل في المؤسسة النشطة، وليس تأكيدًا أن كل حركة مخزن جرى تسجيلها." />
      )}

      <section id="storekeeper-summary" aria-labelledby="storekeeper-state-title" className="space-y-3">
        <div>
          <h2 id="storekeeper-state-title" className="text-base font-bold">المسجل الآن</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>
            أربعة أعداد من دفتر المخزن، بلا أي قيمة مالية.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <DashboardKpiLink href={drivers.receivable.length > 0 ? "#storekeeper-receive" : "#storekeeper-summary"} active={false}>
            <KpiCard label="جاهز للاستلام" value={exactCount(recorded.receivableNow)}
              icon={<ArrowDownToLine size={18} />}
              delta={inventoryVerified ? "المسجل من الطلبات المفتوحة بلا مانع" : "المسجل فقط · المصدر غير مؤكد"}
              deltaDirection="none" />
          </DashboardKpiLink>
          <DashboardKpiLink href={receiptHref(snapshot, "overdue")} active={false}>
            <KpiCard label="متأخر عن موعده" value={exactCount(recorded.overdueReceipts)}
              icon={<ClipboardList size={18} />}
              delta={inventoryVerified ? "المسجل بعد موعد الاستلام المطلوب" : "المسجل فقط · المصدر غير مؤكد"}
              deltaDirection={inventoryVerified && !hasCount(recorded.overdueReceipts) ? "up" : hasCount(recorded.overdueReceipts) ? "down" : "none"} />
          </DashboardKpiLink>
          <DashboardKpiLink href={drivers.belowReorder.length > 0 ? "#storekeeper-reorder" : "#storekeeper-summary"} active={false}>
            <KpiCard label="تحت حد إعادة الطلب" value={exactCount(recorded.belowReorder)}
              icon={<TrendingDown size={18} />}
              delta={inventoryVerified ? "المسجل من مجموع كل المخازن" : "المسجل فقط · المصدر غير مؤكد"}
              deltaDirection={inventoryVerified && !hasCount(recorded.belowReorder) ? "up" : hasCount(recorded.belowReorder) ? "down" : "none"} />
          </DashboardKpiLink>
          <DashboardKpiLink href={drivers.issuedToday.length > 0 ? "#storekeeper-issued" : "#storekeeper-summary"} active={false}>
            <KpiCard label="صرف اليوم" value={exactCount(recorded.issuedToday)}
              icon={<PackageMinus size={18} />}
              delta={inventoryVerified ? "المسجل من حركات الصرف اليوم" : "المسجل فقط · المصدر غير مؤكد"}
              deltaDirection="none" />
          </DashboardKpiLink>
        </div>
      </section>

      {!hasWork ? (
        <EmptyState
          title={inventoryVerified ? "لا يوجد شغل مخزن مفتوح الآن" : "لا يوجد شغل مخزن مسجل الآن"}
          description={inventoryVerified
            ? "إن استلمت بضاعة أو عددت المخزون، سجّلها من الأزرار أعلاه."
            : "هذا وصف لما هو مسجل فقط؛ لا يعني أن كل حركة مخزن جرى تسجيلها."} />
      ) : (
        <div className="space-y-5">
          {drivers.receivable.length > 0 && (
            <Section
              id="storekeeper-receive"
              title={`جاهز للاستلام (${exactCount(recorded.receivableNow)})`}
              note="المتأخر أولًا. الاستلام نفسه يتحقق على الخادم، وقد يرفضه النظام إن تجاوزت الكمية المتبقية على الطلب."
              icon={<ArrowDownToLine size={17} aria-hidden />}
            >
              {drivers.receivable.map((row) => <ReceiptRow key={row.id} row={row} action="receive" />)}
            </Section>
          )}

          {drivers.blocked.length > 0 && (
            <Section
              id="storekeeper-blocked"
              title={`موقوف حتى يُصحَّح (${exactCount(recorded.blockedReceipts)})`}
              note="طلبات يرفضها النظام كلها لسبب مسجل في بنودها. أبلغ مدير المزرعة؛ لا يمكن تجاوزه من هنا."
              icon={<AlertOctagon size={17} aria-hidden />}
            >
              {drivers.blocked.map((row) => <ReceiptRow key={row.id} row={row} action="none" />)}
            </Section>
          )}

          {drivers.belowReorder.length > 0 && (
            <Section
              id="storekeeper-reorder"
              title={`تحت حد إعادة الطلب (${exactCount(recorded.belowReorder)})`}
              note="قراءة لحظية لمجموع كل مخازن الصنف مقابل حده المسجل. توقّع النقص القادم يبقى في صفحة تغطية الصنف."
              icon={<PackageSearch size={17} aria-hidden />}
            >
              {drivers.belowReorder.map((row) => <StockRow key={row.itemId} row={row} />)}
            </Section>
          )}

          {drivers.unknownStock.length > 0 && (
            <Section
              id="storekeeper-unknown"
              title={`بلا رصيد مسجل (${exactCount(recorded.unknownStock)})`}
              note="أصناف لم يُسجَّل لها رصيد في أي مخزن، فلا تُقرأ كصفر ولا تدخل في حساب الحد."
              icon={<HelpCircle size={17} aria-hidden />}
            >
              {drivers.unknownStock.map((row) => <StockRow key={row.itemId} row={row} />)}
            </Section>
          )}

          {drivers.issuedToday.length > 0 && (
            <Section
              id="storekeeper-issued"
              title={`صرف اليوم (${exactCount(recorded.issuedToday)})`}
              note="حركات الصرف المسجلة اليوم فقط، وليست كل ما خرج فعلًا من المخزن."
              icon={<PackageMinus size={17} aria-hidden />}
            >
              {drivers.issuedToday.map((row) => <IssueRow key={row.id} row={row} />)}
            </Section>
          )}

          {drivers.recentShrink.length > 0 && (
            <Section
              id="storekeeper-evidence"
              title={`حركات مسجلة تحتاج تفسيرًا (${exactCount(recorded.recentShrink)})`}
              note={`تسويات وفاقد وانتهاء صلاحية خلال ${ARABIC_INTEGER.format(snapshot.evidenceWindowDays)} أيام. هذه حركات مسجلة فقط — ليست سجل جرد، لأن الجرد لا يترك أثرًا مسجلًا عند تطابق العد.`}
              icon={<ScrollText size={17} aria-hidden />}
            >
              {drivers.recentShrink.map((row) => <ShrinkRow key={row.id} row={row} />)}
            </Section>
          )}
        </div>
      )}

      <section aria-labelledby="storekeeper-more-title" className="space-y-2">
        <h3 id="storekeeper-more-title" className="text-sm font-bold">دفاتر المخزن</h3>
        <div className="flex flex-wrap gap-2">
          <Link href="/inventory/movements" className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
            كل حركات المخزون
          </Link>
        </div>
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          الجرد أداة المطابقة مع الواقع، ولا يُسجَّل كإنجاز هنا: عند تطابق العدّ مع الدفتر لا يكتب النظام أي أثر.
        </p>
      </section>
    </main>
  );
}
