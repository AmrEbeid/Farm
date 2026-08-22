import Link from "next/link";
import { AlertOctagon, ArrowLeft, CalendarClock, ClipboardCheck, ClipboardList, PackageSearch, UserRoundX } from "lucide-react";
import { AttentionInbox, type AttentionItem } from "@/components/DashboardHub";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { PageHeader } from "@/components/PageHeader";
import { Alert, EmptyState, KpiCard } from "@/components/ui";
import { cairoTodayIso } from "@/lib/payroll-close";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/dates";
import { num } from "@/lib/money";
import { OP_STATUS_AR, PLAN_TYPE_AR, SUBTYPE_AR } from "@/lib/labels";
import { isAuthoritative } from "@/lib/data-authority";
import {
  MANAGER_HOME_DETAIL_LIMIT,
  parseManagerHomeSnapshot,
  type ManagerHomeSnapshot,
  type ManagerOperationDriver,
} from "@/lib/manager-home-reads";

const CHECK_KIND_AR: Record<string, string> = {
  weather: "الطقس",
  stock: "المخزون",
  budget: "الموازنة",
  labor: "العمالة",
  responsibility: "المسؤولية",
};

function buildAttention(snapshot: ManagerHomeSnapshot): AttentionItem[] {
  const items: AttentionItem[] = [];
  const operationsVerified = isAuthoritative(snapshot.authority.operations);
  const inventoryVerified = isAuthoritative(snapshot.authority.inventory);
  if (operationsVerified && snapshot.attention.overdueOperations > 0) items.push({
    href: "/plans/dashboard", tone: "act", text: `${num(snapshot.attention.overdueOperations)} عملية تجاوزت موعدها ولم تنفذ`,
  });
  if (operationsVerified && snapshot.attention.blockedPlanChecks > 0) items.push({
    href: "/plans/dashboard", tone: "act", text: `${num(snapshot.attention.blockedPlanChecks)} عائق في آخر فحص مسجل للخطط النشطة`,
  });
  if (operationsVerified && snapshot.attention.unassignedOperations > 0) items.push({
    href: "/people/dashboard?filter=unassigned", tone: "watch", text: `${num(snapshot.attention.unassignedOperations)} عملية مفتوحة بلا مسؤول`,
  });
  if (operationsVerified && snapshot.attention.unscheduledOperations > 0) items.push({
    href: "/plans", tone: "watch", text: `${num(snapshot.attention.unscheduledOperations)} عملية مفتوحة بلا موعد`,
  });
  if (operationsVerified && snapshot.attention.pendingAgronomySignoffs > 0) items.push({
    href: "/plans", tone: "act", text: `${num(snapshot.attention.pendingAgronomySignoffs)} عملية تسميد أو مكافحة تنتظر توقيع المهندس الزراعي`,
  });
  if (inventoryVerified && snapshot.attention.unknownStockItems > 0) items.push({
    href: "/inventory", tone: "watch", text: `${num(snapshot.attention.unknownStockItems)} صنف بلا رصيد مخزن مسجل؛ حالته غير معروفة`,
  });
  if (inventoryVerified && snapshot.attention.belowReorderThreshold > 0) items.push({
    href: "/inventory/dashboard?filter=reorder", tone: "watch", text: `${num(snapshot.attention.belowReorderThreshold)} صنف تحت حد إعادة الطلب الحالي`,
  });
  return items;
}

function planLabel(row: Pick<ManagerOperationDriver, "planType" | "periodStart">): string {
  const type = PLAN_TYPE_AR[row.planType ?? ""] ?? "خطة";
  return row.periodStart ? `${type} · ${fmtDate(row.periodStart)}` : type;
}

function operationDate(row: Pick<ManagerOperationDriver, "plannedAt" | "endsOn">): string {
  if (!row.plannedAt) return "بلا موعد";
  return row.endsOn && row.endsOn !== row.plannedAt
    ? `${fmtDate(row.plannedAt)} إلى ${fmtDate(row.endsOn)}`
    : fmtDate(row.plannedAt);
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

export async function ManagerHome({ orgId }: { orgId: string }) {
  const supabase = await createClient();
  const asOf = cairoTodayIso(new Date());
  const { data, error } = await supabase.rpc("fn_manager_home_snapshot", {
    p_org: orgId, p_as_of: asOf, p_detail_limit: MANAGER_HOME_DETAIL_LIMIT,
  });
  if (error) throw error;
  return <ManagerHomeView snapshot={parseManagerHomeSnapshot(data, orgId, asOf)} />;
}

export function ManagerHomeView({ snapshot }: { snapshot: ManagerHomeSnapshot }) {
  const attention = buildAttention(snapshot);
  const operationsVerified = isAuthoritative(snapshot.authority.operations);
  const inventoryVerified = isAuthoritative(snapshot.authority.inventory);
  const hasDrivers = (operationsVerified && (
    snapshot.drivers.priorityOperations.length > 0
    || snapshot.drivers.unassignedOperations.length > 0
    || snapshot.drivers.pendingSignoffs.length > 0
    || snapshot.drivers.blockedChecks.length > 0
  )) || (inventoryVerified && snapshot.drivers.stockBelowThreshold.length > 0);

  return (
    <main className="space-y-6" data-testid="manager-home">
      <PageHeader
        title="تشغيل المزرعة اليوم"
        subtitle="الأعمال المستحقة والعوائق والتكليفات، من لقطة واحدة للمؤسسة النشطة."
        metadata={<span className="text-xs" style={{ color: "var(--ink-muted)" }}>حتى {fmtDate(snapshot.asOf)}</span>}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Link href="/record/activity" className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>نشاط غير مخطط</Link>
            <Link href="/record/plan" className="fos-btn fos-btn--primary fos-btn--md" style={{ minHeight: 44 }}>خطة جديدة</Link>
          </div>
        )}
      />

      {attention.length > 0 || (operationsVerified && inventoryVerified)
        ? <AttentionInbox items={attention} />
        : null}

      {(!operationsVerified || !inventoryVerified) && (
        <Alert tone="warning" title="بعض مؤشرات التشغيل غير موثقة بالكامل"
          description="ستظهر شرطة بدل أي رقم يعتمد على مصدر غير موثق؛ راجع حالة بيانات التشغيل والمخزون مع المالك." />
      )}

      <section aria-labelledby="manager-state-title" className="space-y-3">
        <div>
          <h2 id="manager-state-title" className="text-base font-bold">الحالة الآن</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>أربع إشارات تشغيلية فقط لاتخاذ قرار اليوم.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <DashboardKpiLink href="/plans/dashboard" active={false}>
            <KpiCard label="عمليات اليوم المفتوحة" value={operationsVerified ? num(snapshot.state.operations.todayCount) : "—"}
              icon={<ClipboardList size={18} />} delta={operationsVerified ? `${num(snapshot.state.operations.openCount)} عملية مفتوحة إجمالا` : "بيانات التشغيل غير موثقة"}
              deltaDirection={operationsVerified && snapshot.state.operations.todayCount === 0 ? "up" : "none"} />
          </DashboardKpiLink>
          <DashboardKpiLink href="/plans/dashboard" active={false}>
            <KpiCard label="عمليات متأخرة" value={operationsVerified ? num(snapshot.state.operations.overdueCount) : "—"}
              icon={<CalendarClock size={18} />} delta={operationsVerified ? "بعد نهاية موعد التنفيذ" : "بيانات التشغيل غير موثقة"}
              deltaDirection={operationsVerified ? (snapshot.state.operations.overdueCount > 0 ? "down" : "up") : "none"} />
          </DashboardKpiLink>
          <DashboardKpiLink href="/plans/dashboard" active={false}>
            <KpiCard label="تنتظر توقيعًا زراعيًا" value={operationsVerified ? num(snapshot.state.pendingAgronomySignoffs) : "—"}
              icon={<ClipboardCheck size={18} />} delta={operationsVerified ? "تسميد أو مكافحة؛ ليست وصفة معتمدة بعد" : "بيانات التشغيل غير موثقة"}
              deltaDirection={operationsVerified ? (snapshot.state.pendingAgronomySignoffs > 0 ? "down" : "up") : "none"} />
          </DashboardKpiLink>
          <DashboardKpiLink href="/inventory/dashboard?filter=reorder" active={false}>
            <KpiCard label="تحت حد إعادة الطلب" value={inventoryVerified ? num(snapshot.state.inventory.belowThresholdCount) : "—"}
              icon={<PackageSearch size={18} />} delta={inventoryVerified ? `${num(snapshot.state.inventory.outOfStockCount)} نافد فعليا · ${num(snapshot.state.inventory.unknownStockCount)} غير معروف` : "بيانات المخزون غير موثقة"}
              deltaDirection={inventoryVerified ? (snapshot.state.inventory.belowThresholdCount > 0 ? "down" : "up") : "none"} />
          </DashboardKpiLink>
        </div>
      </section>

      {!hasDrivers ? (
        <EmptyState
          title={operationsVerified && inventoryVerified ? "لا توجد أعمال أو عوائق تحتاج قرارا الآن" : "لا يمكن تأكيد تفاصيل المتابعة من المصادر الحالية"}
          description={operationsVerified && inventoryVerified ? "ابدأ خطة جديدة أو سجّل نشاطا ميدانيا غير مخطط." : "تظهر التفاصيل بعد توثيق بيانات التشغيل والمخزون."}
        />
      ) : (
        <section aria-labelledby="manager-drivers-title" className="space-y-3">
          <div>
            <h2 id="manager-drivers-title" className="text-base font-bold">ما الذي يحتاج التحرك؟</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>أعلى البنود أولوية فقط؛ القوائم الكاملة داخل صفحاتها.</p>
          </div>
          <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
            {operationsVerified && snapshot.drivers.priorityOperations.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold"><CalendarClock size={17} aria-hidden />أولوية التنفيذ</h3>
                <ul className="mt-1">
                  {snapshot.drivers.priorityOperations.map((operation) => (
                    <DriverLink key={operation.id} href={`/plans/${operation.planId}`}
                      title={SUBTYPE_AR[operation.subtype ?? ""] ?? "عملية"}
                      detail={`${operation.urgency === "overdue" ? "متأخرة" : operation.urgency === "unscheduled" ? "بلا موعد" : "مستحقة اليوم"} · ${planLabel(operation)} · ${operation.assigned ? "مسندة" : "بلا مسؤول"}`} />
                  ))}
                </ul>
              </div>
            )}
            {operationsVerified && snapshot.drivers.unassignedOperations.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold"><UserRoundX size={17} aria-hidden />توزيع الفريق</h3>
                <ul className="mt-1">
                  {snapshot.drivers.unassignedOperations.map((operation) => (
                    <DriverLink key={operation.id} href={`/plans/${operation.planId}`}
                      title={SUBTYPE_AR[operation.subtype ?? ""] ?? "عملية"}
                      detail={`${operationDate(operation)} · ${planLabel(operation)} · ${OP_STATUS_AR[operation.status] ?? operation.status}`} />
                  ))}
                </ul>
              </div>
            )}
            {operationsVerified && snapshot.drivers.blockedChecks.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold"><AlertOctagon size={17} aria-hidden />عوائق آخر فحص مسجل</h3>
                <ul className="mt-1">
                  {snapshot.drivers.blockedChecks.map((check) => (
                    <DriverLink key={check.id} href={`/plans/${check.planId}`}
                      title={`فحص ${CHECK_KIND_AR[check.kind] ?? check.kind}`}
                      detail={planLabel(check)} />
                  ))}
                </ul>
              </div>
            )}
            {operationsVerified && snapshot.drivers.pendingSignoffs.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold"><ClipboardCheck size={17} aria-hidden />توقيع المهندس الزراعي</h3>
                <ul className="mt-1">
                  {snapshot.drivers.pendingSignoffs.map((operation) => (
                    <DriverLink key={operation.id} href={`/plans/${operation.planId}`}
                      title={SUBTYPE_AR[operation.subtype ?? ""] ?? "عملية"}
                      detail={`${operationDate(operation)} · ${planLabel(operation)} · لم تعتمد كوصفة بعد`} />
                  ))}
                </ul>
              </div>
            )}
            {inventoryVerified && snapshot.drivers.stockBelowThreshold.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold"><PackageSearch size={17} aria-hidden />المخزون الآن</h3>
                <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>إشارة لحظية مقابل حد إعادة الطلب؛ افتح التغطية لرؤية الطلب المتوقع.</p>
                <ul>
                  {snapshot.drivers.stockBelowThreshold.map((item) => (
                    <DriverLink key={item.id} href={`/inventory/${item.id}/coverage`} title={item.name}
                      detail={`المتاح ${item.available} ${item.unit ?? ""} · الحد ${item.threshold}`} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
