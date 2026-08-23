// SPEC-0033 R3e — the Supervisor home on «الميدان». One bounded, supervisor-only snapshot of the
// work RECORDED AS ASSIGNED TO THIS PERSON in the active organisation, for the current Cairo date.
//
// HONESTY (docs/CLAUDE.md #1 and #4). Every number is labelled المسجل — an exact count of rows
// assigned to this supervisor, never a claim that the farm is fully covered. No finance value
// appears anywhere: no cost, no rate, no wage, no budget. When the account is not linked to a
// person record, the page says so explicitly and shows NO counts — a zero would read as an
// all-clear. "Nothing left" is only ever said when the operations source is verified.
//
// «سجّل التنفيذ» is offered only for work with no recorded blocker (see lib/supervisor-home-reads).
// It is a shortcut, not a promise: fn_execute_operation remains the enforcement, and stock
// sufficiency can only be settled at execution time.

import Link from "next/link";
import {
  AlertOctagon,
  CalendarClock,
  CalendarOff,
  CalendarX2,
  ClipboardList,
  ListChecks,
  Users,
} from "lucide-react";
import { AttentionInbox, type AttentionItem } from "@/components/DashboardHub";
import { DashboardKpiLink } from "@/components/DashboardKpiLink";
import { PageHeader } from "@/components/PageHeader";
import { PendingExecutions } from "@/components/PendingExecutions";
import { Alert, EmptyState, KpiCard } from "@/components/ui";
import { cairoTodayIso } from "@/lib/payroll-close";
import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/dates";
import { formatDecimalArabic } from "@/lib/decimal";
import { PLAN_TYPE_AR, SUBTYPE_AR } from "@/lib/labels";
import { isAuthoritative } from "@/lib/data-authority";
import {
  SUPERVISOR_HOME_DETAIL_LIMIT,
  parseSupervisorHomeSnapshot,
  type ExactCountString,
  type SupervisorBlocker,
  type SupervisorHomeSnapshot,
  type SupervisorWorkRow,
} from "@/lib/supervisor-home-reads";

/** Plain field Arabic for each recorded blocker — what is wrong and who unblocks it. */
const BLOCKER_AR: Record<SupervisorBlocker, string> = {
  signoff_missing: "بانتظار توقيع المهندس الزراعي على الجرعة",
  target_unresolved: "الموقع المسجل للعملية غير صالح — أبلغ مدير المزرعة",
  unit_mismatch: "وحدة المادة المسجلة تخالف وحدة الصنف",
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

function planLabel(row: SupervisorWorkRow): string {
  const type = PLAN_TYPE_AR[row.planType ?? ""] ?? "خطة";
  return row.periodStart ? `${type} · ${fmtDate(row.periodStart)}` : type;
}

function whenLabel(row: SupervisorWorkRow): string {
  if (!row.plannedAt) return "بلا موعد مسجل";
  return row.endsOn && row.endsOn !== row.plannedAt
    ? `${fmtDate(row.plannedAt)} إلى ${fmtDate(row.endsOn)}`
    : fmtDate(row.plannedAt);
}

/** أين — the recorded operation target, falling back to the plan scope; never invented. */
function whereLabel(row: SupervisorWorkRow): string | null {
  return row.targetLabel ?? row.scopeLabel ?? null;
}

/** بماذا — quantities only, with the exact recorded total when the sample is truncated. */
function materialsLabel(row: SupervisorWorkRow): string | null {
  if (row.materialCount === "0") return null;
  const shown = row.materials
    .map((material) =>
      material.qty ? `${material.itemName} ${decimal(material.qty)} ${material.unit ?? ""}`.trim() : material.itemName,
    )
    .join("، ");
  const hidden = BigInt(row.materialCount) - BigInt(row.materials.length);
  return hidden > BigInt(0)
    ? `${shown} و${ARABIC_INTEGER.format(hidden)} مادة مسجلة أخرى`
    : shown;
}

/** مع من — the recorded crew, with the exact recorded total when the sample is truncated. */
function crewLabel(row: SupervisorWorkRow): string | null {
  if (row.crewCount === "0") return null;
  const shown = row.crew.map((member) => member.name).join("، ");
  const hidden = BigInt(row.crewCount) - BigInt(row.crew.length);
  return hidden > BigInt(0)
    ? `${shown} و${ARABIC_INTEGER.format(hidden)} زميل مسجل آخر`
    : shown;
}

function detailLine(row: SupervisorWorkRow): string {
  return [
    row.urgency === "overdue" ? "متأخرة" : null,
    whenLabel(row),
    whereLabel(row),
    planLabel(row),
    crewLabel(row),
    materialsLabel(row),
  ]
    .filter(Boolean)
    .join(" · ");
}

function buildAttention(snapshot: SupervisorHomeSnapshot): AttentionItem[] {
  const items: AttentionItem[] = [];
  const recorded = snapshot.recorded;
  if (!recorded) return items;
  const overdueHref = snapshot.drivers?.readyNow.some((row) => row.urgency === "overdue")
    ? "#supervisor-ready"
    : "#supervisor-blocked";
  const dueTodayHref = snapshot.drivers?.readyNow.some((row) => row.urgency === "today")
    ? "#supervisor-ready"
    : snapshot.drivers?.blockedNow.some((row) => row.urgency === "today")
      ? "#supervisor-blocked"
      : snapshot.drivers?.readyNow.length
        ? "#supervisor-ready"
        : "#supervisor-blocked";
  if (hasCount(recorded.overdue)) items.push({
    href: overdueHref, tone: "act",
    text: `${exactCount(recorded.overdue)} مهمة مسندة إليك تجاوزت موعدها`,
  });
  if (hasCount(recorded.blockedNow)) items.push({
    href: "#supervisor-blocked", tone: "act",
    text: `${exactCount(recorded.blockedNow)} مهمة اليوم موقوفة حتى يُحل سببها`,
  });
  if (hasCount(recorded.dueToday)) items.push({
    href: dueTodayHref, tone: "watch",
    text: `${exactCount(recorded.dueToday)} مهمة مسندة إليك قائمة اليوم`,
  });
  if (hasCount(recorded.unscheduled)) items.push({
    href: "#supervisor-unscheduled", tone: "watch",
    text: `${exactCount(recorded.unscheduled)} مهمة مسندة إليك بلا موعد مسجل`,
  });
  return items;
}

function WorkRow({ row, action }: { row: SupervisorWorkRow; action: "execute" | "none" }) {
  const title = SUBTYPE_AR[row.subtype ?? ""] ?? "عملية";
  return (
    <li className="border-b py-3 last:border-b-0" style={{ borderColor: "var(--line)" }}>
      <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{title}</div>
      <div className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>{detailLine(row)}</div>
      {row.blockers.length > 0 && (
        <ul className="mt-1 text-xs" style={{ color: "var(--danger, #b23b3b)" }}>
          {row.blockers.map((blocker) => (
            <li key={blocker}>{BLOCKER_AR[blocker]}</li>
          ))}
        </ul>
      )}
      {/* SECURITY: no drill-down link here. The plan detail route is the only operation record a
          supervisor could reach, and it renders an estimated-cost KPI and a per-operation cost
          column to any member — money this role must never be shown. Blocked work escalates to a
          human instead; unscheduled and upcoming work is informational. */}
      {action === "execute" && (
        <div className="mt-2">
          <Link
            href={`/m/execute/${row.id}`}
            className="fos-btn fos-btn--primary fos-btn--md inline-flex w-full items-center justify-center"
            style={{ minHeight: 44 }}
          >
            سجّل التنفيذ
          </Link>
        </div>
      )}
    </li>
  );
}

function WorkSection({
  id, title, note, icon, rows, action,
}: {
  id: string;
  title: string;
  note?: string;
  icon: React.ReactNode;
  rows: SupervisorWorkRow[];
  action: "execute" | "none";
}) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-1">
      <h3 id={`${id}-title`} className="flex items-center gap-2 text-sm font-bold">{icon}{title}</h3>
      {note && <p className="text-xs" style={{ color: "var(--ink-muted)" }}>{note}</p>}
      <ul id={id}>
        {rows.map((row) => <WorkRow key={row.id} row={row} action={action} />)}
      </ul>
    </section>
  );
}

export async function SupervisorHome({ orgId, saved }: { orgId: string; saved: boolean }) {
  const supabase = await createClient();
  const asOf = cairoTodayIso(new Date());
  const { data, error } = await supabase.rpc("fn_supervisor_home_snapshot", {
    p_org: orgId, p_as_of: asOf, p_detail_limit: SUPERVISOR_HOME_DETAIL_LIMIT,
  });
  if (error) throw error;
  return <SupervisorHomeView snapshot={parseSupervisorHomeSnapshot(data, orgId, asOf)} saved={saved} />;
}

export function SupervisorHomeView({
  snapshot, saved,
}: {
  snapshot: SupervisorHomeSnapshot;
  saved: boolean;
}) {
  const { recorded, drivers } = snapshot;
  const attention = buildAttention(snapshot);
  const operationsVerified = isAuthoritative(snapshot.authority.operations);
  const hasWork = drivers != null && (
    drivers.readyNow.length > 0 || drivers.blockedNow.length > 0
    || drivers.unscheduled.length > 0 || drivers.upcoming.length > 0
  );

  return (
    <main className="mx-auto flex max-w-md flex-col gap-5 p-4" data-testid="supervisor-home">
      <PageHeader
        title="شغل اليوم"
        subtitle="المهام المسندة إليك، وما يمكن تسجيله الآن."
        metadata={<span className="text-xs" style={{ color: "var(--ink-muted)" }}>حتى {fmtDate(snapshot.asOf)}</span>}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Link href="/record/activity" className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
              سجّل نشاطًا غير مخطط
            </Link>
            <Link href="/people/attendance" className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
              سجّل حضور عمالة
            </Link>
          </div>
        )}
      />

      {saved && <Alert tone="ok" title="تم تسجيل العملية بنجاح." />}

      {/* F1: the on-device outbox of executions that failed to send. Kept on the supervisor home so
          offline recovery never depends on which home the role lands on. */}
      <PendingExecutions />

      {recorded == null || drivers == null ? (
        <>
          <Alert
            tone="warning"
            title={snapshot.link.state === "ambiguous"
              ? "حسابك مرتبط بأكثر من سجل موظف في هذه المؤسسة"
              : "حسابك غير مرتبط بسجل موظف في هذه المؤسسة"}
            description={snapshot.link.state === "ambiguous"
              ? "لا يمكن تحديد «مهامي» بدقة عندما يرتبط الحساب بأكثر من سجل، ولن تُعرض أي أعداد حتى يصحّح مدير المزرعة السجلات."
              : "لا تُعرض أي أعداد هنا لأن المهام تُسند إلى سجل الموظف لا إلى الحساب. اطلب من مدير المزرعة ربط حسابك بسجلك."} />
          <EmptyState
            title="لا يمكن عرض المهام المسندة إليك"
            description="هذه ليست حالة «لا يوجد عمل»؛ لم يتمكن النظام من تحديد سجلك بعد. يمكنك مع ذلك تسجيل نشاط غير مخطط أو حضور عمالة من الأزرار أعلاه." />
        </>
      ) : (
        <>
          {attention.length > 0 || operationsVerified ? <AttentionInbox items={attention} /> : null}

          {!operationsVerified && (
            <Alert tone="warning" title="الأرقام هنا مسجلة فقط، وتغطية مصدر التشغيل غير مؤكدة"
              description="كل رقم في هذه الصفحة عدد دقيق لما هو مسجل ومسند إليك في المؤسسة النشطة، وليس تأكيدًا أن كل عمل المزرعة مسجل." />
          )}

          <section aria-labelledby="supervisor-state-title" className="space-y-3">
            <div>
              <h2 id="supervisor-state-title" className="text-base font-bold">المسجل الآن</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--ink-muted)" }}>
                أربعة أعداد مسندة إليك فقط{snapshot.link.personName ? ` — ${snapshot.link.personName}` : ""}.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DashboardKpiLink href="#supervisor-ready" active={false}>
                <KpiCard label="مهامي اليوم" value={exactCount(recorded.dueToday)}
                  icon={<CalendarClock size={18} />}
                  delta={operationsVerified ? "المسجل ضمن مدى التنفيذ اليوم" : "المسجل فقط · المصدر غير مؤكد"}
                  deltaDirection="none" />
              </DashboardKpiLink>
              <DashboardKpiLink href="#supervisor-ready" active={false}>
                <KpiCard label="متأخر عن موعده" value={exactCount(recorded.overdue)}
                  icon={<CalendarX2 size={18} />}
                  delta={operationsVerified ? "المسجل بعد نهاية موعد التنفيذ" : "المسجل فقط · المصدر غير مؤكد"}
                  deltaDirection={operationsVerified && !hasCount(recorded.overdue) ? "up" : hasCount(recorded.overdue) ? "down" : "none"} />
              </DashboardKpiLink>
              <DashboardKpiLink href="#supervisor-blocked" active={false}>
                <KpiCard label="موقوف حتى يُحل" value={exactCount(recorded.blockedNow)}
                  icon={<AlertOctagon size={18} />}
                  delta={operationsVerified ? "المسجل من عمل اليوم غير القابل للتسجيل" : "المسجل فقط · المصدر غير مؤكد"}
                  deltaDirection={operationsVerified && !hasCount(recorded.blockedNow) ? "up" : hasCount(recorded.blockedNow) ? "down" : "none"} />
              </DashboardKpiLink>
              <DashboardKpiLink href="#supervisor-unscheduled" active={false}>
                <KpiCard label="بلا موعد مسجل" value={exactCount(recorded.unscheduled)}
                  icon={<CalendarOff size={18} />}
                  delta={operationsVerified ? "المسجل بلا تاريخ تنفيذ" : "المسجل فقط · المصدر غير مؤكد"}
                  deltaDirection="none" />
              </DashboardKpiLink>
            </div>
          </section>

          {!hasWork ? (
            <EmptyState
              title={operationsVerified ? "لا توجد مهام مسندة إليك الآن" : "لا توجد مهام مسجلة مسندة إليك الآن"}
              description={operationsVerified
                ? "سجّل نشاطًا غير مخطط أو حضور عمالة إن عملت شيئًا خارج الخطة."
                : "هذا وصف لما هو مسجل ومسند إليك فقط؛ لا يعني أن كل عمل المزرعة مسجل."} />
          ) : (
            <div className="space-y-5">
              <WorkSection
                id="supervisor-ready"
                title={`جاهز للتسجيل الآن (${exactCount(recorded.readyNow)})`}
                note="المتأخر أولًا. التسجيل نفسه يتحقق على الخادم، وقد يرفضه النظام إن لم يكفِ المخزون وقت التنفيذ."
                icon={<ListChecks size={17} aria-hidden />}
                rows={drivers.readyNow}
                action="execute" />
              <WorkSection
                id="supervisor-blocked"
                title={`موقوف حتى يُحل (${exactCount(recorded.blockedNow)})`}
                note="عمل اليوم الذي لا يمكن تسجيله الآن لسبب مسجل. أبلغ مدير المزرعة أو المهندس الزراعي؛ لا يمكن تجاوزه من هنا."
                icon={<AlertOctagon size={17} aria-hidden />}
                rows={drivers.blockedNow}
                action="none" />
              <WorkSection
                id="supervisor-unscheduled"
                title={`بلا موعد مسجل (${exactCount(recorded.unscheduled)})`}
                note="مهام مسندة إليك لم يُسجَّل لها تاريخ تنفيذ، فلا تُحسب ضمن اليوم ولا ضمن المتأخر."
                icon={<CalendarOff size={17} aria-hidden />}
                rows={drivers.unscheduled}
                action="none" />
              <WorkSection
                id="supervisor-upcoming"
                title={`قادم (${exactCount(recorded.upcoming)})`}
                icon={<ClipboardList size={17} aria-hidden />}
                rows={drivers.upcoming}
                action="none" />
            </div>
          )}

          {snapshot.link.personName && (
            <p className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-muted)" }}>
              <Users size={14} aria-hidden />
              تعرض هذه الصفحة العمل المسند إليك وحدك، لا عمل الفريق كله.
            </p>
          )}
        </>
      )}
    </main>
  );
}
