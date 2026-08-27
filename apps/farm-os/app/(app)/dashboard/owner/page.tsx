import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  PackageSearch,
  TreePalm,
  WalletCards,
} from "lucide-react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cairoTodayIso } from "@/lib/payroll-close";
import {
  OWNER_HOME_DETAIL_LIMIT,
  parseOwnerHomeSnapshot,
  type OwnerHomeSnapshot,
} from "@/lib/owner-home-reads";
import { egpExact } from "@/lib/decimal";
import { fmtDate } from "@/lib/dates";
import { num, pct } from "@/lib/money";
import { PR_STATUS_AR } from "@/lib/labels";
import { DATA_NOT_VERIFIED_AR, isAuthoritative } from "@/lib/data-authority";
import { AttentionInbox, type AttentionItem } from "@/components/DashboardHub";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { PageHeader } from "@/components/PageHeader";
import { PrintButton } from "@/components/print-button";
import { Alert, EmptyState, KpiCard } from "@/components/ui";

function withUnknown(value: string, unknownCount: number): string {
  return unknownCount > 0 ? `${value} + غير معروف (${num(unknownCount)})` : value;
}

function buildAttention(snapshot: OwnerHomeSnapshot): AttentionItem[] {
  const { attention, state } = snapshot;
  const items: AttentionItem[] = [];
  const financeVerified = isAuthoritative(snapshot.authority.finance_ledger);
  const inventoryVerified = isAuthoritative(snapshot.authority.inventory);
  const operationsVerified = isAuthoritative(snapshot.authority.operations);
  const palmsVerified = isAuthoritative(snapshot.authority.palm_registry);
  if (attention.pendingPaymentApprovals > 0)
    items.push({ href: "/approvals", tone: "act", text: `${num(attention.pendingPaymentApprovals)} طلب صرف ينتظر اعتمادك` });
  if (attention.pendingAgronomySignoffs > 0)
    items.push({ href: "/approvals", tone: "act", text: `${num(attention.pendingAgronomySignoffs)} عملية تسميد أو مكافحة تنتظر التوقيع` });
  if (attention.pendingPurchaseApprovals > 0)
    items.push({ href: "/approvals", tone: "act", text: `${num(attention.pendingPurchaseApprovals)} طلب شراء ينتظر قرارك` });
  if (inventoryVerified && attention.overduePurchaseRequests > 0)
    items.push({ href: "/purchase-requests?filter=overdue", tone: "act", text: `${num(attention.overduePurchaseRequests)} طلب شراء تجاوز موعد التوريد` });
  if (financeVerified && attention.pendingPriceSales > 0)
    items.push({ href: "/record/price", tone: "act", text: `${num(attention.pendingPriceSales)} بيع لم يسعر بعد` });
  if (financeVerified && attention.unpaidNonDrawingExpenses > 0)
    items.push({
      href: "/custody",
      tone: "act",
      text: `${num(attention.unpaidNonDrawingExpenses)} مصروف تشغيلي آجل بقيمة ${withUnknown(egpExact(state.expenseFollowUp.nonDrawingTotal), state.expenseFollowUp.nonDrawingUnknownCount)}`,
    });
  if (inventoryVerified && attention.reorderItems > 0)
    items.push({ href: "/inventory/dashboard?filter=reorder", tone: "watch", text: `${num(attention.reorderItems)} صنف تحت حد إعادة الطلب` });
  if (operationsVerified && attention.blockedPlanChecks > 0)
    items.push({ href: "/plans/dashboard", tone: "watch", text: `${num(attention.blockedPlanChecks)} فحص يمنع تنفيذ خطة` });
  if (palmsVerified && attention.palmsNeedingAttention > 0)
    items.push({ href: "/farm/dashboard", tone: "watch", text: `${num(attention.palmsNeedingAttention)} نخلة تحتاج متابعة` });
  if (operationsVerified && attention.unassignedOperations > 0)
    items.push({ href: "/plans?filter=unassigned", tone: "watch", text: `${num(attention.unassignedOperations)} عملية بلا مسؤول` });
  return items;
}

function DriverLink({ href, title, detail }: { href: string; title: string; detail: string }) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-11 items-center gap-3 border-b py-2.5 text-sm last:border-b-0"
        style={{ borderColor: "var(--line)", color: "var(--ink)" }}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{title}</span>
          <span className="block truncate text-xs" style={{ color: "var(--ink-muted)" }}>{detail}</span>
        </span>
        <ArrowLeft size={16} aria-hidden style={{ flex: "none", color: "var(--ink-muted)" }} />
      </Link>
    </li>
  );
}

export default async function OwnerDashboard() {
  const membership = await requireRole(["owner"]);
  const supabase = await createClient();
  const asOf = cairoTodayIso(new Date());
  const { data, error } = await supabase.rpc("fn_owner_home_snapshot", {
    p_org: membership.orgId,
    p_as_of: asOf,
    p_detail_limit: OWNER_HOME_DETAIL_LIMIT,
  });
  if (error) throw error;
  const snapshot = parseOwnerHomeSnapshot(data, membership.orgId, asOf);
  const attention = buildAttention(snapshot);
  const budgetVerified = isAuthoritative(snapshot.authority.budgets);
  const financeVerified = isAuthoritative(snapshot.authority.finance_ledger);
  const inventoryVerified = isAuthoritative(snapshot.authority.inventory);
  const operationsVerified = isAuthoritative(snapshot.authority.operations);
  const palmsVerified = isAuthoritative(snapshot.authority.palm_registry);
  const readiness = snapshot.state.operations.activeCount > 0
    ? Math.round((snapshot.state.operations.doneCount / snapshot.state.operations.activeCount) * 100)
    : null;
  const isNewOrg = palmsVerified && operationsVerified
    && snapshot.state.farmRegistry.barhiCount === 0
    && snapshot.state.operations.activeCount === 0;
  const visiblePurchaseRequests = inventoryVerified
    ? snapshot.drivers.purchaseRequests
    : snapshot.drivers.purchaseRequests.filter((request) => request.status === "submitted");
  const hasDrivers = visiblePurchaseRequests.length > 0
    || (inventoryVerified && snapshot.drivers.stockShortages.length > 0)
    || (operationsVerified && snapshot.drivers.dueOperations.length > 0)
    || (financeVerified && snapshot.drivers.costCenters.length > 0);

  return (
    <main className="space-y-6" data-testid="owner-home">
      <PageHeader
        title="ملخص المزرعة اليوم"
        subtitle="القرارات والاستثناءات المهمة، من لقطة واحدة مرتبطة بالمؤسسة النشطة."
        metadata={<span className="text-xs" style={{ color: "var(--ink-muted)" }}>حتى {fmtDate(snapshot.asOf)}</span>}
        actions={(
          <>
            <PrintButton label="طباعة" />
            <Link href="/approvals" className="fos-btn fos-btn--primary fos-btn--md" style={{ minHeight: 44 }}>الاعتمادات</Link>
          </>
        )}
      />

      {isNewOrg && <OnboardingChecklist role="owner" />}
      <AttentionInbox items={attention} />

      <section aria-labelledby="owner-state-title" className="space-y-3">
        <div>
          <h2 id="owner-state-title" className="text-base font-bold">الحالة الآن</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>أربع إشارات فقط لفهم وضع المزرعة بسرعة.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DashboardKpiLink href="/budgets" active={false}>
            <KpiCard
              label="المتاح في لقطة الموازنة"
              value={budgetVerified ? egpExact(snapshot.state.budget.available) : "—"}
              icon={<WalletCards size={18} />}
              delta={budgetVerified ? "ليست رقابة صرف حية" : "الموازنة غير موثقة"}
              deltaDirection="none"
            />
          </DashboardKpiLink>
          <DashboardKpiLink href="/plans/dashboard" active={false}>
            <KpiCard
              label="جاهزية العمليات"
              value={operationsVerified && readiness !== null ? pct(readiness) : "—"}
              icon={readiness === 100 ? <CheckCircle2 size={18} /> : <CalendarClock size={18} />}
              delta={!operationsVerified
                ? "بيانات العمليات غير مكتملة"
                : snapshot.state.operations.activeCount > 0
                ? `${num(snapshot.state.operations.doneCount)} مكتملة من ${num(snapshot.state.operations.activeCount)}`
                : "لا توجد عمليات نشطة"}
              deltaDirection={operationsVerified && readiness === 100 ? "up" : "none"}
            />
          </DashboardKpiLink>
          <DashboardKpiLink href="/inventory/dashboard?filter=reorder" active={false}>
            <KpiCard
              label="مخاطر المخزون"
              value={inventoryVerified ? num(snapshot.state.inventory.reorderCount) : "—"}
              unit={inventoryVerified ? "صنف" : undefined}
              icon={<PackageSearch size={18} />}
              delta={inventoryVerified ? `${num(snapshot.state.inventory.outOfStockCount)} نافد فعليا` : "بيانات المخزون غير مكتملة"}
              deltaDirection={inventoryVerified ? (snapshot.state.inventory.reorderCount > 0 ? "down" : "up") : "none"}
            />
          </DashboardKpiLink>
          <DashboardKpiLink href="/farm/dashboard" active={false}>
            <KpiCard
              label="النخيل الذي يحتاج متابعة"
              value={palmsVerified ? num(snapshot.state.palms.attentionCount) : "—"}
              unit={palmsVerified ? `من ${num(snapshot.state.palms.palmCount)}` : undefined}
              icon={<TreePalm size={18} />}
              delta={palmsVerified
                ? `${num(snapshot.state.farmRegistry.barhiCount)} برحي في ${num(snapshot.state.farmRegistry.hawshaCount)} حوش`
                : "سجل النخيل غير موثق"}
              deltaDirection={palmsVerified ? (snapshot.state.palms.attentionCount > 0 ? "down" : "up") : "none"}
            />
          </DashboardKpiLink>
        </div>
      </section>

      <section aria-labelledby="owner-drivers-title" className="space-y-3">
        <div>
          <h2 id="owner-drivers-title" className="text-base font-bold">لماذا تحتاج هذه البنود للمتابعة؟</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>أعلى البنود تأثيرا فقط؛ القوائم الكاملة داخل صفحاتها.</p>
        </div>
        {!hasDrivers ? (
          <EmptyState title="لا توجد استثناءات تفصيلية" description="لا تعرض اللقطة الحالية بنودا تحتاج تفسيرا إضافيا." />
        ) : (
          <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
            {visiblePurchaseRequests.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold"><ClipboardCheck size={17} aria-hidden />طلبات الشراء</h3>
                <ul className="mt-1">
                  {visiblePurchaseRequests.map((request) => (
                    <DriverLink
                      key={request.id}
                      href={`/purchase-requests/${request.id}`}
                      title={`${request.code} · ${PR_STATUS_AR[request.status] ?? request.status}`}
                      detail={`${request.reason ?? "بدون سبب مسجل"} · مطلوب ${fmtDate(request.neededBy)}`}
                    />
                  ))}
                </ul>
              </div>
            )}
            {inventoryVerified && snapshot.drivers.stockShortages.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold"><PackageSearch size={17} aria-hidden />نقص المخزون</h3>
                <ul className="mt-1">
                  {snapshot.drivers.stockShortages.map((item) => (
                    <DriverLink
                      key={item.id}
                      href="/inventory/dashboard?filter=reorder"
                      title={item.name}
                      detail={`المتاح ${item.available} ${item.unit ?? ""} · الحد ${item.threshold}`}
                    />
                  ))}
                </ul>
              </div>
            )}
            {operationsVerified && snapshot.drivers.dueOperations.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold"><CalendarClock size={17} aria-hidden />عمليات قريبة</h3>
                <ul className="mt-1">
                  {snapshot.drivers.dueOperations.map((operation) => (
                    <DriverLink
                      key={operation.id}
                      href={`/plans/${operation.planId}`}
                      title={operation.subtype ?? "عملية زراعية"}
                      detail={`${fmtDate(operation.plannedAt)} · ${operation.assigned ? "مسندة" : "بلا مسؤول"}`}
                    />
                  ))}
                </ul>
              </div>
            )}
            {financeVerified && snapshot.drivers.costCenters.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold"><WalletCards size={17} aria-hidden />مراكز التكلفة الأعلى</h3>
                <ul className="mt-1">
                  {snapshot.drivers.costCenters.map((center) => (
                    <DriverLink
                      key={center.id}
                      href={`/finance/cost-centers/${center.id}`}
                      title={`${center.code} · ${center.name}`}
                      detail={`مدين ${egpExact(center.debit)} · صافي ${egpExact(center.net)}`}
                    />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      <Alert tone="info" title="فصل مصروفات التشغيل عن المسحوبات">
        <span className="inline-flex items-start gap-2">
          <AlertTriangle size={17} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            {financeVerified
              ? <>مسحوبات المالك منفصلة دائما عن مصروفات التشغيل. الآجل منها الآن {withUnknown(
                  egpExact(snapshot.state.expenseFollowUp.ownerDrawingTotal),
                  snapshot.state.expenseFollowUp.ownerDrawingUnknownCount,
                )} عبر {num(snapshot.state.expenseFollowUp.ownerDrawingCount)} سجل.</>
              : DATA_NOT_VERIFIED_AR}
          </span>
        </span>
      </Alert>
    </main>
  );
}
