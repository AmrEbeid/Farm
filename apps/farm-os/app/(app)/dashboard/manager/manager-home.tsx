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

// R3d usability fix: an unverified/partial SOURCE never blanks a count the organisation actually
// recorded — that turned the whole Manager home into dashes in production and hid real overdue work.
// Every item below is labelled مسجل (recorded) so the count is read as "what is recorded", not as
// "everything on the farm"; the completeness claims (the all-clear inbox and the all-clear empty
// state) stay gated on verified authority.
function buildAttention(snapshot: ManagerHomeSnapshot): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (snapshot.attention.overdueOperations > 0) items.push({
    href: "/plans/dashboard", tone: "act", text: `${num(snapshot.attention.overdueOperations)} عملية مسجلة تجاوزت موعدها ولم تنفذ`,
  });
  if (snapshot.attention.blockedPlanChecks > 0) items.push({
    href: "/plans/dashboard", tone: "act", text: `${num(snapshot.attention.blockedPlanChecks)} عائق في آخر فحص مسجل للخطط النشطة`,
  });
  if (snapshot.attention.unassignedOperations > 0) items.push({
    href: "/people/dashboard?filter=unassigned", tone: "watch", text: `${num(snapshot.attention.unassignedOperations)} عملية مفتوحة مسجلة بلا مسؤول`,
  });
  if (snapshot.attention.unscheduledOperations > 0) items.push({
    href: "/plans", tone: "watch", text: `${num(snapshot.attention.unscheduledOperations)} عملية مفتوحة مسجلة بلا موعد`,
  });
  if (snapshot.attention.pendingAgronomySignoffs > 0) items.push({
    href: "/plans", tone: "act", text: `${num(snapshot.attention.pendingAgronomySignoffs)} عملية تسميد أو مكافحة مسجلة تنتظر توقيع المهندس الزراعي`,
  });
  if (snapshot.attention.unknownStockItems > 0) items.push({
    href: "/inventory", tone: "watch", text: `${num(snapshot.attention.unknownStockItems)} صنف بلا رصيد مخزن مسجل؛ حالته غير معروفة`,
  });
  if (snapshot.attention.belowReorderThreshold > 0) items.push({
    href: "/inventory/dashboard?filter=reorder", tone: "watch", text: `${num(snapshot.attention.belowReorderThreshold)} صنف مسجل تحت حد إعادة الطلب الحالي`,
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
  const hasDrivers = snapshot.drivers.priorityOperations.length > 0
    || snapshot.drivers.unassignedOperations.length > 0
    || snapshot.drivers.pendingSignoffs.length > 0
    || snapshot.drivers.blockedChecks.length > 0
    || snapshot.drivers.stockBelowThreshold.length > 0;
  const recordedOnly = operationsVerified && inventoryVerified ? "" : " · المسجل فقط";

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
        <Alert tone="warning" title="الأرقام هنا مسجلة فقط، وتغطية المصدر غير مؤكدة"
          description="كل رقم في هذه الصفحة عدد دقيق لما هو مسجل في المؤسسة النشطة، وليس تأكيدًا أن كل عمل المزرعة ومخزونه مسجل. راجع حالة بيانات التشغيل والمخزون مع المالك قبل أي استنتاج بالاكتمال." />
      )}

      <section aria-labelledby="manager-state-title" className="space-y-3">
        <div>
          <h2 id="manager-state-title" className="text-base font-bold">الحالة الآن</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>أربع إشارات تشغيلية مسجلة فقط لاتخاذ قرار اليوم.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <DashboardKpiLink href="/plans/dashboard" active={false}>
            <KpiCard label="عمليات اليوم المفتوحة" value={num(snapshot.state.operations.todayCount)}
              icon={<ClipboardList size={18} />} delta={`${num(snapshot.state.operations.openCount)} عملية مفتوحة مسجلة${recordedOnly}`}
              deltaDirection={operationsVerified && snapshot.state.operations.todayCount === 0 ? "up" : "none"} />
          </DashboardKpiLink>
          <DashboardKpiLink href="/plans/dashboard" active={false}>
            <KpiCard label="عمليات متأخرة" value={num(snapshot.state.operations.overdueCount)}
              icon={<CalendarClock size={18} />} delta={`بعد نهاية موعد التنفيذ${recordedOnly}`}
              deltaDirection={snapshot.state.operations.overdueCount > 0 ? "down" : operationsVerified ? "up" : "none"} />
          </DashboardKpiLink>
          <DashboardKpiLink href="/plans/dashboard" active={false}>
            <KpiCard label="تنتظر توقيعًا زراعيًا" value={num(snapshot.state.pendingAgronomySignoffs)}
              icon={<ClipboardCheck size={18} />} delta={`تسميد أو مكافحة؛ ليست وصفة معتمدة بعد${recordedOnly}`}
              deltaDirection={snapshot.state.pendingAgronomySignoffs > 0 ? "down" : operationsVerified ? "up" : "none"} />
          </DashboardKpiLink>
          <DashboardKpiLink href="/inventory/dashboard?filter=reorder" active={false}>
            <KpiCard label="تحت حد إعادة الطلب" value={num(snapshot.state.inventory.belowThresholdCount)}
              icon={<PackageSearch size={18} />} delta={`${num(snapshot.state.inventory.outOfStockCount)} نافد فعليا · ${num(snapshot.state.inventory.unknownStockCount)} غير معروف${recordedOnly}`}
              deltaDirection={snapshot.state.inventory.belowThresholdCount > 0 ? "down" : inventoryVerified ? "up" : "none"} />
          </DashboardKpiLink>
        </div>
      </section>

      {!hasDrivers ? (
        <EmptyState
          title={operationsVerified && inventoryVerified ? "لا توجد أعمال أو عوائق تحتاج قرارا الآن" : "لا توجد بنود مسجلة للمتابعة الآن"}
          description={operationsVerified && inventoryVerified ? "ابدأ خطة جديدة أو سجّل نشاطا ميدانيا غير مخطط." : "هذا وصف لما هو مسجل فقط؛ لا يعني أن كل عمل المزرعة ومخزونه مسجل."}
        />
      ) : (
        <section aria-labelledby="manager-drivers-title" className="space-y-3">
          <div>
            <h2 id="manager-drivers-title" className="text-base font-bold">ما الذي يحتاج التحرك؟</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>أعلى البنود المسجلة أولوية فقط؛ القوائم الكاملة داخل صفحاتها.</p>
          </div>
          <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
            {snapshot.drivers.priorityOperations.length > 0 && (
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
            {snapshot.drivers.unassignedOperations.length > 0 && (
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
            {snapshot.drivers.blockedChecks.length > 0 && (
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
            {snapshot.drivers.pendingSignoffs.length > 0 && (
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
            {snapshot.drivers.stockBelowThreshold.length > 0 && (
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
