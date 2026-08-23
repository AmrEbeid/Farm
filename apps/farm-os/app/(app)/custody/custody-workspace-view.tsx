import type { CSSProperties } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleAlert,
  Search,
  WalletCards,
} from "lucide-react";
import { CustodyForms } from "@/components/CustodyForms";
import { PageHeader } from "@/components/PageHeader";
import { PrintButton } from "@/components/print-button";
import { Alert, EmptyState, StatusPill } from "@/components/ui";
import {
  compareDecimals,
  egpExact,
  sumDecimals,
} from "@/lib/decimal";
import { fmtDate } from "@/lib/dates";
import {
  assertFinanceUnpaidSummary,
  unpaidKnownTotal,
  unpaidUnknownCount,
} from "@/lib/expense-register-summary";
import { num } from "@/lib/money";
import type { CustodyDailySnapshot, CustodyRequestFilter } from "@/lib/custody-daily-snapshot";
import {
  custodyListHref,
  custodyAccountSummary,
  custodyMovementState,
  custodyRequestSearchMatches,
  custodyRequestWorkCounts,
  type CustodyListContext,
} from "@/lib/custody-workspace";

const REQUEST_STATUS_AR: Record<string, string> = {
  draft: "مسودة",
  submitted: "مُرسل",
  approved_operational: "اعتماد تشغيلي",
  approved_final: "اعتماد نهائي",
  paid: "مدفوع",
  closed: "مُقفل",
};

const REQUEST_FILTER_AR: Record<CustodyRequestFilter, string> = {
  all: "كل الطلبات",
  awaiting: "بانتظار اعتماد أو سداد",
  settled: "مدفوعة ومقفلة",
};

function SummaryItem({ label, value, tone = "brand", detail }: {
  label: string;
  value: string;
  tone?: "brand" | "warning" | "danger";
  detail?: string;
}) {
  const color = tone === "danger" ? "var(--danger-fg)" : tone === "warning" ? "var(--warning-fg)" : "var(--brand)";
  return (
    <div className="border-s-4 px-3 py-2" style={{ borderColor: color, background: "var(--surface)" }}>
      <p className="text-xs" style={{ color: "var(--ink-muted)" }}>{label}</p>
      <strong className="block text-base tabular-nums">{value}</strong>
      {detail && <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>{detail}</p>}
    </div>
  );
}

function RequestSearch({ context }: { context: CustodyListContext }) {
  return (
    <form action="/custody" method="get" role="search" className="flex flex-wrap items-center gap-2">
      <label htmlFor="custody-request-search" className="sr-only">ابحث في طلبات الصرف المعروضة</label>
      <input
        id="custody-request-search"
        name="q"
        type="search"
        defaultValue={context.query}
        maxLength={60}
        placeholder="ابحث برقم الطلب أو الحالة أو الفترة…"
        className="fos-input fos-input--md min-w-0 flex-1"
        style={{ minHeight: 44 }}
      />
      {context.requestFilter !== "all" && <input type="hidden" name="requests" value={context.requestFilter} />}
      <button type="submit" className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
        <Search size={16} aria-hidden /> ابحث
      </button>
      {context.query && (
        <Link href={custodyListHref({ requestFilter: context.requestFilter })} className="fos-btn fos-btn--ghost fos-btn--md">
          امسح البحث
        </Link>
      )}
    </form>
  );
}

export function CustodyWorkspaceView({ snapshot, context }: {
  snapshot: CustodyDailySnapshot;
  context: CustodyListContext;
}) {
  const expenseSummary = snapshot.expenseSummary;
  assertFinanceUnpaidSummary(expenseSummary);

  const accounts = snapshot.accountRows;
  const {
    activeAccounts,
    topUps,
    totalBalance,
    totalTarget,
    totalTopUp,
    inactiveCashCount,
  } = custodyAccountSummary(accounts);
  const unpaidKnown = unpaidKnownTotal(expenseSummary);
  const unpaidUnknown = unpaidUnknownCount(expenseSummary);
  const netRequest = sumDecimals([unpaidKnown, totalTopUp]).total;
  const awaitingCount = snapshot.awaitingRequestCount;
  const { draft: draftCount, work: workCount } = custodyRequestWorkCounts({
    all: snapshot.allRequestCount,
    awaiting: snapshot.awaitingRequestCount,
    settled: snapshot.settledRequestCount,
  });

  const requestCounts: Record<CustodyRequestFilter, number> = {
    all: snapshot.allRequestCount,
    awaiting: awaitingCount,
    settled: snapshot.settledRequestCount,
  };
  const visibleRequests = snapshot.requestRows.filter((request) => custodyRequestSearchMatches(
    request,
    REQUEST_STATUS_AR[request.status] ?? request.status,
    context.query,
  ));
  const requestsTruncated = snapshot.selectedRequestCount > snapshot.requestRows.length;

  return (
    <main
      className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4"
      data-testid="custody-workspace"
      style={{ "--ink-muted": "#5f7066" } as CSSProperties}
    >
      <PageHeader
        title="العهدة وطلبات الصرف"
        subtitle="النقد لدى حاملي العهدة، وما يحتاج تمويلًا أو اعتمادًا أو سدادًا الآن."
        metadata={<span className="text-xs" style={{ color: "var(--ink-muted)" }}>{num(activeAccounts.length)} حساب عهدة نشط</span>}
        actions={(
          <div className="no-print flex flex-wrap gap-2">
            <PrintButton label="طباعة العهدة" />
            <Link href="/record" className="fos-btn fos-btn--primary fos-btn--md">سجّل عملية</Link>
          </div>
        )}
      />

      <section aria-labelledby="custody-now-title" className="flex flex-col gap-2">
        <h2 id="custody-now-title" className="flex items-center gap-2 text-sm font-bold">
          <CircleAlert size={17} aria-hidden /> القرار الآن
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <SummaryItem
            label={unpaidUnknown > 0 ? "المطلوب المعروف من المالك" : "المطلوب من المالك"}
            value={egpExact(netRequest)}
            tone={compareDecimals(netRequest, "0") > 0 ? "warning" : "brand"}
            detail={`تغذية عهدة ${egpExact(totalTopUp)} + التزامات آجلة ${egpExact(unpaidKnown)}`}
          />
          <SummaryItem label="النقد الحالي في العهدة" value={egpExact(totalBalance)} detail={`المستهدف ${egpExact(totalTarget)}`} />
          <SummaryItem
            label="طلبات تحتاج متابعة"
            value={num(workCount)}
            tone={workCount > 0 ? "danger" : "brand"}
            detail={`${num(draftCount)} مسودة + ${num(awaitingCount)} بانتظار اعتماد أو سداد`}
          />
          <SummaryItem
            label="مصروفات آجلة بمبلغ غير مكتمل"
            value={num(unpaidUnknown)}
            tone={unpaidUnknown > 0 ? "danger" : "brand"}
            detail={unpaidUnknown > 0 ? "لا تدخل في الإجمالي حتى يُسجل مبلغها" : "لا توجد مبالغ مجهولة"}
          />
        </div>
      </section>

      {unpaidUnknown > 0 && (
        <Alert
          tone="warning"
          title="الإجمالي لا يشمل المصروفات الآجلة بلا مبلغ"
          description={<>استكمل {num(unpaidUnknown)} سجلًا من <Link href="/expenses">المصروفات</Link> قبل اعتماد قيمة طلب الصرف.</>}
        />
      )}

      {inactiveCashCount > 0 && (
        <Alert
          tone="warning"
          title={`${num(inactiveCashCount)} حساب عهدة متوقف ما زال يحمل رصيدًا`}
          description="الرصيد ظاهر ضمن النقد الحالي للمراجعة، لكنه لا يدخل في المستهدف أو التغذية ولا يظهر في إجراءات الكتابة."
        />
      )}

      <section aria-labelledby="custody-accounts-title" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="custody-accounts-title" className="text-sm font-bold">أرصدة حاملي العهدة</h2>
            <p className="text-xs" style={{ color: "var(--ink-muted)" }}>التغذية المطلوبة لا تنخفض عن صفر حتى لو تجاوز الرصيد المستهدف.</p>
          </div>
          <Link href="/finance/custody-reports" className="text-sm font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>
            افتح تقارير العهدة
          </Link>
        </div>
        {accounts.length === 0 ? <EmptyState title="لا توجد حسابات عهدة بعد" /> : (
          <ul>
            {accounts.map((account, index) => (
              <li key={account.id} className="border-b py-3 last:border-b-0" style={{ borderColor: "var(--line)" }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>{account.holderLabel}</strong>
                  <StatusPill status={account.active ? "active" : "blocked"}>{account.active ? "نشط" : "متوقف"}</StatusPill>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span>الرصيد <strong className="tabular-nums">{egpExact(account.balance)}</strong></span>
                  <span style={{ color: "var(--ink-muted)" }}>المستهدف {egpExact(account.targetFloat)}</span>
                  <span style={{ color: compareDecimals(topUps[index], "0") > 0 ? "var(--warning-fg)" : "var(--ink-muted)" }}>
                    التغذية {egpExact(topUps[index])}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="custody-requests-title" className="flex flex-col gap-3">
        <div>
          <h2 id="custody-requests-title" className="text-sm font-bold">طلبات الصرف</h2>
          <p className="text-xs" style={{ color: "var(--ink-muted)" }}>ابدأ بالطلبات التي تحتاج إجراء، ثم افتح الطلب لإكمال الاعتماد أو التمويل أو السداد.</p>
        </div>
        <RequestSearch context={context} />
        <nav aria-label="تصفية طلبات الصرف" className="flex flex-wrap gap-2">
          {(["all", "awaiting", "settled"] as const).map((filter) => {
            const active = context.requestFilter === filter;
            return (
              <Link
                key={filter}
                href={custodyListHref({ requestFilter: filter, query: context.query })}
                aria-current={active ? "page" : undefined}
                className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold"
                style={{
                  color: active ? "var(--brand-contrast)" : filter === "awaiting" && requestCounts[filter] > 0 ? "var(--danger-fg)" : "var(--ink)",
                  background: active ? "var(--brand)" : "var(--surface)",
                  border: "1px solid var(--line)",
                }}
              >
                <span>{REQUEST_FILTER_AR[filter]}</span><span style={{ opacity: 0.85 }}>{num(requestCounts[filter])}</span>
              </Link>
            );
          })}
        </nav>
        {requestsTruncated && (
          <Alert
            tone="info"
            title={`المعروض أحدث ${num(snapshot.requestRows.length)} من أصل ${num(snapshot.selectedRequestCount)} طلبًا`}
            description="البحث داخل المعروض فقط، ولا يوجد تصدير جزئي من هذه المساحة. استخدم تقارير العهدة للسجل المالي الكامل."
          />
        )}
        {visibleRequests.length === 0 ? (
          <EmptyState
            title={context.query ? "لا يوجد طلب مطابق في المعروض" : "لا توجد طلبات في هذا الفلتر"}
            description={context.query && requestsTruncated ? "قد توجد نتيجة أقدم خارج العينة المحدودة." : undefined}
            action={context.query ? <Link href={custodyListHref({ requestFilter: context.requestFilter })} className="fos-btn fos-btn--secondary fos-btn--md">امسح البحث</Link> : undefined}
          />
        ) : (
          <ul>
            {visibleRequests.map((request) => {
              const statusLabel = REQUEST_STATUS_AR[request.status] ?? request.status;
              const attention = !["paid", "closed"].includes(request.status);
              return (
                <li key={request.id} className="border-b py-3 last:border-b-0" style={{ borderColor: "var(--line)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/custody/request/${request.id}`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>
                      طلب صرف رقم {num(request.requestNo)}
                    </Link>
                    <StatusPill status={attention ? "warning" : "done"}>{statusLabel}</StatusPill>
                  </div>
                  <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                    {request.periodStart ? `${fmtDate(request.periodStart)} إلى ${request.periodEnd ? fmtDate(request.periodEnd) : "فترة مفتوحة"}` : "الفترة غير محددة"}
                    {` · أُنشئ ${fmtDate(request.createdAt)}`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="custody-movements-title" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="custody-movements-title" className="text-sm font-bold">آخر حركات العهدة</h2>
            <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
              {snapshot.movementCount > snapshot.movementRows.length
                ? `أحدث ${num(snapshot.movementRows.length)} من أصل ${num(snapshot.movementCount)} حركة.`
                : `${num(snapshot.movementCount)} حركة في السجل.`}
            </p>
          </div>
          <Link href="/transactions?type=custody" className="text-sm font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>
            افتح معاملات العهدة
          </Link>
        </div>
        {snapshot.movementRows.length === 0 ? <EmptyState title="لا توجد حركات عهدة بعد" /> : (
          <ul>
            {snapshot.movementRows.map((movement) => {
              const incoming = compareDecimals(movement.amountIn, "0") > 0;
              const state = custodyMovementState(movement);
              const DirectionIcon = incoming ? ArrowDownToLine : ArrowUpFromLine;
              return (
                <li key={movement.id} className="border-b py-3 last:border-b-0" style={{ borderColor: "var(--line)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/custody/movements/${movement.id}`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>
                      {movement.holderLabel}
                    </Link>
                    <strong className="tabular-nums">{egpExact(incoming ? movement.amountIn : movement.amountOut)}</strong>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusPill status={state.status}>{state.label}</StatusPill>
                    <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--ink-muted)" }}>
                      <DirectionIcon size={14} aria-hidden /> {incoming ? "وارد" : "صادر"} · {fmtDate(movement.occurredAt)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="custody-actions-title" className="no-print flex flex-col gap-2">
        <h2 id="custody-actions-title" className="flex items-center gap-2 text-sm font-bold">
          <WalletCards size={17} aria-hidden /> إجراءات إضافية للعهدة
        </h2>
        <CustodyForms accounts={activeAccounts.map((account) => ({ id: account.id, holder_label: account.holderLabel }))} />
      </section>
    </main>
  );
}
