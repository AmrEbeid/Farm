import Link from "next/link";
import { ArrowLeft, BadgeDollarSign, BookOpenCheck, CalendarCheck2, CircleDollarSign, Landmark, ReceiptText, Scale, WalletCards } from "lucide-react";
import { Alert, EmptyState, KpiCard } from "@/components/ui";
import { AttentionInbox, type AttentionItem } from "@/components/DashboardHub";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { PageHeader } from "@/components/PageHeader";
import { createClient } from "@/lib/supabase/server";
import { cairoTodayIso } from "@/lib/payroll-close";
import { egpExact } from "@/lib/decimal";
import { fmtDate } from "@/lib/dates";
import {
  ACCOUNTANT_HOME_DETAIL_LIMIT,
  parseAccountantHomeSnapshot,
  type AccountantHomeSnapshot,
  type ExactCountString,
} from "@/lib/accountant-home-reads";

const CUTOVER = "2026-07-01";

function exactCount(value: ExactCountString): string {
  return new Intl.NumberFormat("ar-EG").format(BigInt(value));
}

function hasCount(value: ExactCountString): boolean {
  return value !== "0";
}

function paymentRequestNextAction(status: AccountantHomeSnapshot["drivers"]["paymentObligations"][number]["status"]): string {
  switch (status) {
    case "draft": return "أكمل البنود ثم أرسل الطلب للاعتماد";
    case "submitted": return "راجع الطلب واعتمده تشغيليًا";
    case "approved_operational": return "ينتظر اعتماد المالك النهائي";
    case "approved_final": return "سجّل تمويل المالك";
    case "paid": return "أكد سداد البنود من العهدة ثم أغلق الطلب";
  }
}

function buildAttention(snapshot: AccountantHomeSnapshot): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (hasCount(snapshot.attention.ledgerGapCount)) items.push({
    href: "/finance/close", tone: "act",
    text: exactCount(snapshot.attention.ledgerGapCount) + " بند مسجل لم يصل للدفتر",
  });
  if (hasCount(snapshot.attention.pendingPricingCount)) items.push({
    href: "/record/price", tone: "act",
    text: exactCount(snapshot.attention.pendingPricingCount) + " بيع يحتاج استكمال السعر أو بيانات الكمية",
  });
  if (hasCount(snapshot.attention.reconciliationActionableCount)) items.push({
    href: "/finance/reconciliation", tone: "act",
    text: exactCount(snapshot.attention.reconciliationActionableCount) + " دفعة مطابقة جاهزة لعمل المحاسب",
  });
  if (hasCount(snapshot.attention.paymentObligationsActionableCount)) items.push({
    href: "/custody", tone: "watch",
    text: exactCount(snapshot.attention.paymentObligationsActionableCount) + " طلب صرف في مرحلة عمل المحاسب",
  });
  if (hasCount(snapshot.attention.paymentObligationsOwnerBlockedCount)) items.push({
    href: "/custody", tone: "watch",
    text: exactCount(snapshot.attention.paymentObligationsOwnerBlockedCount) + " طلب صرف ينتظر اعتماد المالك النهائي",
  });
  return items;
}

function DriverLink({ href, title, detail }: { href: string; title: string; detail: string }) {
  return (
    <li>
      <Link href={href} className="flex min-h-11 items-center gap-3 border-b py-2.5 text-sm last:border-b-0"
        style={{ borderColor: "var(--line)", color: "var(--ink)" }}>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          <span className="block text-xs" style={{ color: "var(--ink-muted)" }}>{detail}</span>
        </span>
        <ArrowLeft size={16} aria-hidden style={{ flex: "none", color: "var(--ink-muted)" }} />
      </Link>
    </li>
  );
}

export async function AccountantHome({ orgId }: { orgId: string }) {
  const supabase = await createClient();
  const asOf = cairoTodayIso(new Date());
  const { data, error } = await supabase.rpc("fn_accountant_home_snapshot", {
    p_org: orgId, p_as_of: asOf, p_cutover: CUTOVER, p_detail_limit: ACCOUNTANT_HOME_DETAIL_LIMIT,
  });
  if (error) throw error;
  const snapshot = parseAccountantHomeSnapshot(data, orgId, asOf, CUTOVER);
  return <AccountantHomeView snapshot={snapshot} />;
}

export function AccountantHomeView({ snapshot }: { snapshot: AccountantHomeSnapshot }) {
  const attention = buildAttention(snapshot);
  const hasDrivers = Object.values(snapshot.drivers).some((rows) => rows.length > 0);

  return (
    <main className="space-y-6" data-testid="accountant-home">
      <PageHeader
        title="عمل المحاسب اليوم"
        subtitle="ما يحتاج التسجيل والمراجعة والإقفال، من لقطة واحدة للمؤسسة النشطة."
        metadata={<span className="text-xs" style={{ color: "var(--ink-muted)" }}>حتى {fmtDate(snapshot.asOf)}</span>}
        actions={<Link href="/record" className="fos-btn fos-btn--primary fos-btn--md" style={{ minHeight: 44 }}>سجّل حركة</Link>}
      />

      <AttentionInbox items={attention} />

      {!snapshot.moneyAvailable && (
        <Alert tone="warning" title="الأرصدة والمبالغ مخفية حتى اكتمال مطابقة دفتر المالية"
          description={<>حالة مصدر دفتر المالية غير مكتملة. <Link href="/finance/reconciliation" className="underline">افتح المطابقة</Link> قبل الاعتماد على مبلغ أو مقارنة.</>} />
      )}

      <section aria-labelledby="accountant-kpis-title" className="space-y-3">
        <h2 id="accountant-kpis-title" className="text-base font-bold">الحالة الآن</h2>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <DashboardKpiLink href="/finance/close" active={false}>
            <KpiCard label="بنود مسجلة لم تصل للدفتر" value={exactCount(snapshot.attention.ledgerGapCount)}
              icon={<BookOpenCheck size={18} />} delta="لا تشمل المبيعات المعلقة السعر"
              deltaDirection={hasCount(snapshot.attention.ledgerGapCount) ? "down" : "up"} />
          </DashboardKpiLink>
          <DashboardKpiLink href="/record/price" active={false}>
            <KpiCard label="مبيعات معلقة السعر" value={exactCount(snapshot.attention.pendingPricingCount)}
              icon={<BadgeDollarSign size={18} />} delta="قد يشمل العدد سجلات ناقصة الكمية"
              deltaDirection={hasCount(snapshot.attention.pendingPricingCount) ? "down" : "up"} />
          </DashboardKpiLink>
          <DashboardKpiLink href="/finance/reconciliation" active={false}>
            <KpiCard label="دفعات مطابقة قابلة للعمل" value={exactCount(snapshot.attention.reconciliationActionableCount)}
              icon={<Scale size={18} />} delta={exactCount(snapshot.queues.reconciliation.ownerWaitingCount) + " تنتظر المالك"}
              deltaDirection={hasCount(snapshot.attention.reconciliationActionableCount) ? "down" : "up"} />
          </DashboardKpiLink>
          <DashboardKpiLink href="/finance/revenue-reports" active={false}>
            <KpiCard label="ذمم بيع مفتوحة" value={exactCount(snapshot.queues.receivables.openCount)}
              icon={<CircleDollarSign size={18} />} delta={exactCount(snapshot.queues.receivables.agedCount) + " متأخرة"}
              deltaDirection={hasCount(snapshot.queues.receivables.openCount) ? "down" : "up"} />
          </DashboardKpiLink>
        </div>
      </section>

      <section aria-labelledby="accountant-state-title" className="border-y py-4" style={{ borderColor: "var(--line)" }}>
        <h2 id="accountant-state-title" className="text-base font-bold">الإقفال والسيولة</h2>
        <div className="mt-3 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold"><CalendarCheck2 size={17} />حالة تاريخ اليوم</div>
            <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>{snapshot.state.period.asOfLocked ? "الفترة التي تشمل اليوم مقفلة" : "الفترة التي تشمل اليوم غير مقفلة"}</p>
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-bold"><Landmark size={17} />العهد النقدية</div>
            <Link href="/custody" className="mt-1 block text-sm underline-offset-4 hover:underline" style={{ color: "var(--ink-muted)" }}>
              {exactCount(snapshot.state.custody.accountCount)} حساب
              {snapshot.moneyAvailable ? " · رصيد " + egpExact(snapshot.state.custody.totalClosingBalance!) : " · الرصيد محجوب"}
            </Link>
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-bold"><ReceiptText size={17} />التزامات التشغيل</div>
            <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>
              {exactCount(snapshot.queues.paymentObligations.operatingUnpaidCount)} مصروف
              {hasCount(snapshot.queues.paymentObligations.operatingUnpaidUnknownCount)
                ? " · " + exactCount(snapshot.queues.paymentObligations.operatingUnpaidUnknownCount) + " بلا مبلغ" : ""}
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-bold"><WalletCards size={17} />التزامات رأسمالية</div>
            <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>
              {exactCount(snapshot.queues.paymentObligations.capexUnpaidCount)} مصروف
              {hasCount(snapshot.queues.paymentObligations.capexUnpaidUnknownCount)
                ? " · " + exactCount(snapshot.queues.paymentObligations.capexUnpaidUnknownCount) + " بلا مبلغ" : ""}
              {hasCount(snapshot.queues.paymentObligations.drawingExcludedCount)
                ? " · " + exactCount(snapshot.queues.paymentObligations.drawingExcludedCount) + " مسحوبات مستبعدة" : ""}
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="accountant-change-title" className="space-y-2">
        <h2 id="accountant-change-title" className="text-base font-bold">ما الذي تغير؟</h2>
        {snapshot.comparison.comparable ? (
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
            قيود مرحلة هذا الشهر: <strong style={{ color: "var(--ink)" }}>{exactCount(snapshot.comparison.currentMonthPostedCount!)}</strong>
            {" "}مقابل <strong style={{ color: "var(--ink)" }}>{exactCount(snapshot.comparison.previousMonthPostedCount!)}</strong> في الشهر السابق.
          </p>
        ) : <p className="text-sm" style={{ color: "var(--ink-muted)" }}>المقارنة الشهرية غير متاحة لأن مصدر دفتر المالية لم يعتمد بعد.</p>}
      </section>

      <section aria-labelledby="accountant-drivers-title" className="space-y-3">
        <div>
          <h2 id="accountant-drivers-title" className="text-base font-bold">بنود العمل</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>عينة محدودة من أعلى القوائم؛ الأعداد أعلاه كاملة.</p>
        </div>
        {!hasDrivers ? <EmptyState title="لا توجد بنود تفصيلية" description="لا تعرض لقطة اليوم بنودا تحتاج فتحا من هنا." /> : (
          <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
            {snapshot.drivers.pendingPricing.length > 0 && <div>
              <h3 className="text-sm font-bold">تسعير المبيعات</h3>
              <ul>{snapshot.drivers.pendingPricing.map((sale) => (
                <DriverLink key={sale.id} href="/record/price" title={sale.crop + " · " + sale.buyerName}
                  detail={fmtDate(sale.saleDate) + " · " + (sale.qty ?? "كمية غير مسجلة") + " " + sale.unit} />
              ))}</ul>
            </div>}
            {snapshot.drivers.receivables.length > 0 && <div>
              <h3 className="text-sm font-bold">الذمم المفتوحة</h3>
              <ul>{snapshot.drivers.receivables.map((sale) => (
                <DriverLink key={sale.id} href="/finance/revenue-reports" title={sale.crop + " · " + sale.buyerName}
                  detail={snapshot.moneyAvailable ? "متبقي " + egpExact(sale.remaining!) : "بيع بتاريخ " + fmtDate(sale.saleDate)} />
              ))}</ul>
            </div>}
            {snapshot.drivers.reconciliation.length > 0 && <div>
              <h3 className="text-sm font-bold">دفعات المطابقة</h3>
              <ul>{snapshot.drivers.reconciliation.map((batch) => (
                <DriverLink key={batch.id} href={"/finance/reconciliation/" + batch.id} title="دفعة قيد المراجعة"
                  detail={exactCount(batch.unreviewedCount) + " صف لم يراجع"} />
              ))}</ul>
            </div>}
            {snapshot.drivers.paymentObligations.length > 0 && <div>
              <h3 className="text-sm font-bold">طلبات الصرف</h3>
              <ul>{snapshot.drivers.paymentObligations.map((request) => (
                <DriverLink key={request.id} href={"/custody/request/" + request.id} title={"طلب رقم " + request.requestNo}
                  detail={paymentRequestNextAction(request.status)} />
              ))}</ul>
            </div>}
          </div>
        )}
      </section>
    </main>
  );
}
