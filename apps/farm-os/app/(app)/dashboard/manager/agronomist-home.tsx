// SPEC-0033 R3d — the Agronomist home. One bounded, agronomist-only snapshot of RECORDED agronomy
// workflow for the active organisation and the current Cairo business date.
//
// HONESTY (docs/CLAUDE.md #1 and #4). Every number is labelled المسجل — an exact count of recorded
// rows, not a claim that the farm is fully covered. No finance value appears. Nothing here is a
// recommendation or a prescription: dose and spray content stays an editable template until a NAMED
// agronomist signs it off, and a recorded APC reference is only a reference, never proof of a valid
// or current Egyptian registration. "All clear" is only ever said when the operations source is verified.

import Link from "next/link";
import { AlertOctagon, ArrowLeft, BugPlay, CalendarClock, ClipboardCheck, CalendarX2 } from "lucide-react";
import { AttentionInbox, type AttentionItem } from "@/components/DashboardHub";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { PageHeader } from "@/components/PageHeader";
import { Alert, EmptyState, KpiCard } from "@/components/ui";
import { cairoTodayIso } from "@/lib/payroll-close";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/dates";
import { formatDecimalArabic } from "@/lib/decimal";
import { PLAN_TYPE_AR, SUBTYPE_AR } from "@/lib/labels";
import { isAuthoritative } from "@/lib/data-authority";
import {
  AGRONOMIST_HOME_DETAIL_LIMIT,
  parseAgronomistHomeSnapshot,
  type AgronomistHomeSnapshot,
  type AgronomyOperationDriver,
  type ExactCountString,
} from "@/lib/agronomist-home-reads";

const CHECK_KIND_AR: Record<string, string> = {
  weather: "الطقس",
  stock: "المخزون",
  budget: "الموازنة",
  labor: "العمالة",
  responsibility: "المسؤولية",
};

const TARGET_ZONE_AR: Record<string, string> = {
  bunch: "العذوق",
  crown: "قمة النخلة",
  trunk: "الجذع",
  offshoot: "الفسيلة",
  whole_palm: "النخلة كاملة",
};

function exactCount(value: ExactCountString): string {
  return new Intl.NumberFormat("ar-EG").format(BigInt(value));
}

function hasCount(value: ExactCountString): boolean {
  return value !== "0";
}

function days(value: number): string {
  return new Intl.NumberFormat("ar-EG").format(value);
}

function decimal(value: string): string {
  const scale = value.includes(".") ? value.split(".")[1].length : 0;
  return formatDecimalArabic(value, scale);
}

function buildAttention(snapshot: AgronomistHomeSnapshot): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (hasCount(snapshot.recorded.pendingSignoffs)) items.push({
    href: "/approvals", tone: "act",
    text: `${exactCount(snapshot.recorded.pendingSignoffs)} عملية جرعة أو رش مسجلة تنتظر توقيعك`,
  });
  if (hasCount(snapshot.recorded.overdue)) items.push({
    href: "/m?scope=agronomy&mine=0", tone: "act",
    text: `${exactCount(snapshot.recorded.overdue)} عملية زراعية مسجلة تجاوزت موعدها`,
  });
  if (hasCount(snapshot.recorded.trapFollowups)) items.push({
    href: "/farm/pest-scouting", tone: "act",
    text: `${exactCount(snapshot.recorded.trapFollowups)} مصيدة نشطة مسجلة تحتاج فحصًا أو تغيير فرمون`,
  });
  if (hasCount(snapshot.recorded.dueToday)) items.push({
    href: "/m?scope=agronomy&mine=0", tone: "watch",
    text: `${exactCount(snapshot.recorded.dueToday)} عملية زراعية مسجلة قائمة اليوم`,
  });
  return items;
}

function planLabel(row: Pick<AgronomyOperationDriver, "planType" | "periodStart">): string {
  const type = PLAN_TYPE_AR[row.planType ?? ""] ?? "خطة";
  return row.periodStart ? `${type} · ${fmtDate(row.periodStart)}` : type;
}

function operationDate(row: Pick<AgronomyOperationDriver, "plannedAt" | "endsOn">): string {
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

export async function AgronomistHome({ orgId }: { orgId: string }) {
  const supabase = await createClient();
  const asOf = cairoTodayIso(new Date());
  const { data, error } = await supabase.rpc("fn_agronomist_home_snapshot", {
    p_org: orgId, p_as_of: asOf, p_detail_limit: AGRONOMIST_HOME_DETAIL_LIMIT,
  });
  if (error) throw error;
  return <AgronomistHomeView snapshot={parseAgronomistHomeSnapshot(data, orgId, asOf)} />;
}

export function AgronomistHomeView({ snapshot }: { snapshot: AgronomistHomeSnapshot }) {
  const attention = buildAttention(snapshot);
  const operationsVerified = isAuthoritative(snapshot.authority.operations);
  const hasDrivers = snapshot.drivers.pendingSignoffs.length > 0
    || snapshot.drivers.dueOperations.length > 0
    || snapshot.drivers.trapFollowups.length > 0
    || snapshot.drivers.blockedChecks.length > 0;

  return (
    <main className="space-y-6" data-testid="agronomist-home">
      <PageHeader
        title="العمل الزراعي اليوم"
        subtitle="التوقيعات والأعمال المستحقة والمصائد، من لقطة واحدة للمؤسسة النشطة."
        metadata={<span className="text-xs" style={{ color: "var(--ink-muted)" }}>حتى {fmtDate(snapshot.asOf)}</span>}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Link href="/farm/pest-scouting" className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>سجل المصائد</Link>
            <Link href="/approvals" className="fos-btn fos-btn--primary fos-btn--md" style={{ minHeight: 44 }}>راجع ووقّع</Link>
          </div>
        )}
      />

      {attention.length > 0 || operationsVerified ? <AttentionInbox items={attention} /> : null}

      {!operationsVerified && (
        <Alert tone="warning" title="الأرقام هنا مسجلة فقط، وتغطية مصدر التشغيل غير مؤكدة"
          description="كل رقم في هذه الصفحة عدد دقيق لما هو مسجل في المؤسسة النشطة، وليس تأكيدًا أن كل عمل المزرعة مسجل. راجع حالة بيانات التشغيل مع المالك قبل الاعتماد على أي استنتاج بالاكتمال." />
      )}

      <Alert tone="info" title="محتوى التسميد والرش قالب قابل للتعديل، وليس وصفة"
        description="تبقى الجرعات والمواد المسجلة قالبًا حتى توقيع مهندس زراعي باسمه. وجود مرجع تسجيل زراعي مسجل لا يعني أن التسجيل ساري أو معتمد." />

      <section aria-labelledby="agronomist-state-title" className="space-y-3">
        <div>
          <h2 id="agronomist-state-title" className="text-base font-bold">المسجل الآن</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>أربعة أعداد مسجلة فقط لاتخاذ قرار اليوم.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <DashboardKpiLink href="/approvals" active={false}>
            <KpiCard label="جرعات ورش تنتظر توقيعك" value={exactCount(snapshot.recorded.pendingSignoffs)}
              icon={<ClipboardCheck size={18} />}
              delta={operationsVerified ? "المسجل من خطط نشطة" : "المسجل فقط · المصدر غير مؤكد"}
              deltaDirection={operationsVerified && !hasCount(snapshot.recorded.pendingSignoffs) ? "up" : hasCount(snapshot.recorded.pendingSignoffs) ? "down" : "none"} />
          </DashboardKpiLink>
          <DashboardKpiLink href="/m?scope=agronomy&mine=0" active={false}>
            <KpiCard label="أعمال زراعية اليوم" value={exactCount(snapshot.recorded.dueToday)}
              icon={<CalendarClock size={18} />}
              delta={operationsVerified ? "المسجل ضمن مدى التنفيذ اليوم" : "المسجل فقط · المصدر غير مؤكد"}
              deltaDirection="none" />
          </DashboardKpiLink>
          <DashboardKpiLink href="/m?scope=agronomy&mine=0" active={false}>
            <KpiCard label="أعمال زراعية متأخرة" value={exactCount(snapshot.recorded.overdue)}
              icon={<CalendarX2 size={18} />}
              delta={operationsVerified ? "المسجل بعد نهاية موعد التنفيذ" : "المسجل فقط · المصدر غير مؤكد"}
              deltaDirection={operationsVerified && !hasCount(snapshot.recorded.overdue) ? "up" : hasCount(snapshot.recorded.overdue) ? "down" : "none"} />
          </DashboardKpiLink>
          <DashboardKpiLink href="/farm/pest-scouting" active={false}>
            <KpiCard label="مصائد تحتاج متابعة" value={exactCount(snapshot.recorded.trapFollowups)}
              icon={<BugPlay size={18} />}
              delta={operationsVerified ? "فحص متأخر أو فرمون تجاوز عمره" : "المسجل فقط · المصدر غير مؤكد"}
              deltaDirection={operationsVerified && !hasCount(snapshot.recorded.trapFollowups) ? "up" : hasCount(snapshot.recorded.trapFollowups) ? "down" : "none"} />
          </DashboardKpiLink>
        </div>
      </section>

      {!hasDrivers ? (
        <EmptyState
          title={operationsVerified ? "لا توجد أعمال زراعية أو توقيعات تحتاج قرارا الآن" : "لا توجد بنود مسجلة للمتابعة الآن"}
          description={operationsVerified
            ? "افتح سجل المصائد أو الميدان لمتابعة العمل اليومي."
            : "هذا وصف لما هو مسجل فقط؛ لا يعني أن كل عمل المزرعة مسجل."} />
      ) : (
        <section aria-labelledby="agronomist-drivers-title" className="space-y-3">
          <div>
            <h2 id="agronomist-drivers-title" className="text-base font-bold">ما الذي يحتاج التحرك؟</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>أعلى البنود المسجلة أولوية فقط؛ القوائم الكاملة داخل صفحاتها.</p>
          </div>
          <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
            {snapshot.drivers.pendingSignoffs.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold"><ClipboardCheck size={17} aria-hidden />توقيع الجرعات والرش</h3>
                <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>التوقيع نفسه يتم في «راجع»؛ القالب هنا غير معتمد بعد.</p>
                <ul>
                  {snapshot.drivers.pendingSignoffs.map((operation) => {
                    const isSpray = operation.subtype === "spraying";
                    const shown = operation.materials
                      .map((material) => [
                        material.qty ? `${decimal(material.qty)} ${material.unit ?? ""}`.trim() : null,
                        material.itemName,
                        isSpray ? (material.targetPest ? `الآفة المسجلة ${material.targetPest}` : "بلا آفة مستهدفة مسجلة") : null,
                        isSpray ? (material.apcRegistrationRef ? `مرجع تسجيل مسجل ${material.apcRegistrationRef}` : "بلا مرجع تسجيل مسجل") : null,
                        isSpray ? (material.reiHours ? `إعادة الدخول المسجلة ${decimal(material.reiHours)} ساعة` : "بلا فترة إعادة دخول مسجلة") : null,
                        isSpray ? (material.phiDays ? `ما قبل الحصاد المسجل ${decimal(material.phiDays)} يوم` : "بلا فترة ما قبل الحصاد مسجلة") : null,
                        isSpray && material.targetZone ? `منطقة الاستهداف المسجلة ${TARGET_ZONE_AR[material.targetZone] ?? material.targetZone}` : null,
                        material.applicatorName ? `المنفذ ${material.applicatorName}` : null,
                      ].filter(Boolean).join(" · "))
                      .join(" | ");
                    const hidden = BigInt(operation.materialCount) - BigInt(operation.materials.length);
                    return (
                      <DriverLink key={operation.id} href="/approvals"
                        title={SUBTYPE_AR[operation.subtype ?? ""] ?? "عملية"}
                        detail={[
                          operationDate(operation),
                          planLabel(operation),
                          shown || "بلا مواد مسجلة",
                          hidden > BigInt(0) ? `و${new Intl.NumberFormat("ar-EG").format(hidden)} مادة مسجلة أخرى` : null,
                        ].filter(Boolean).join(" · ")} />
                    );
                  })}
                </ul>
              </div>
            )}
            {snapshot.drivers.dueOperations.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold"><CalendarClock size={17} aria-hidden />أعمال اليوم والمتأخرة</h3>
                <ul className="mt-1">
                  {snapshot.drivers.dueOperations.map((operation) => (
                    <DriverLink key={operation.id} href="/m?scope=agronomy&mine=0"
                      title={SUBTYPE_AR[operation.subtype ?? ""] ?? "عملية"}
                      detail={`${operation.urgency === "overdue" ? "متأخرة" : "قائمة اليوم"} · ${operationDate(operation)} · ${planLabel(operation)}`} />
                  ))}
                </ul>
              </div>
            )}
            {snapshot.drivers.trapFollowups.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold"><BugPlay size={17} aria-hidden />مصائد تحتاج متابعة</h3>
                <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>يحسب العمر من آخر فحص مسجل أو من تاريخ التركيب إن لم يسجل فحص.</p>
                <ul>
                  {snapshot.drivers.trapFollowups.map((trap) => (
                    <DriverLink key={trap.id} href="/farm/pest-scouting"
                      title={`${trap.code} · ${trap.label}`}
                      detail={[
                        trap.overdueCheck ? `فحص متأخر ${days(trap.daysSinceCheck)} يوم` : null,
                        trap.needsLureChange ? `عمر الفرمون ${days(trap.daysSinceLureChange)} يوم` : null,
                        trap.lastCheckedAt ? `آخر فحص ${fmtDate(trap.lastCheckedAt)}` : `بلا فحص مسجل منذ التركيب ${fmtDate(trap.installedAt)}`,
                      ].filter(Boolean).join(" · ")} />
                  ))}
                </ul>
              </div>
            )}
            {snapshot.drivers.blockedChecks.length > 0 && (
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold"><AlertOctagon size={17} aria-hidden />عوائق آخر فحص مسجل</h3>
                <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>لا يحمل سجل الفحص وقتًا، لذلك يعرض كآخر فحص مسجل لا كحالة لحظية.</p>
                <ul>
                  {snapshot.drivers.blockedChecks.map((check) => (
                    <DriverLink key={check.id} href={`/plans/${check.planId}`}
                      title={`فحص ${CHECK_KIND_AR[check.kind] ?? check.kind}`}
                      detail={planLabel(check)} />
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
