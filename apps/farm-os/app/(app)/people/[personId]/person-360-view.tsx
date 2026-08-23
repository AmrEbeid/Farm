// SPEC-0033 R4c — the person 360. One bounded, active-organisation snapshot per page view;
// server-rendered throughout except the shared tab strip, phone-first Arabic RTL.
//
// ENTITY 360 CONVENTIONS. Uses the same `Entity360Header` + `EntityTabs` the rest of the app's 360
// pages share. Tabs are URL-driven (`?tab=`) so the active one survives refresh and is shareable —
// the server renders only the matching panel.
//
// WHAT REPLACED WHAT. The old page opened with a four-card KPI strip whose numbers were the LENGTHS
// of four capped reads, then four `<table>`s that could not reflow into 390px. Every figure here is
// an exact recorded total published by the database, and every sample states — in words — how much
// of its own total it is showing. Nothing on this page is a length pretending to be a count.
//
// THE STORY, IN ORDER. Who they are and whether they are on the job → the work that is open on them
// right now → what they have actually been recorded doing → who reports to them. No fabricated
// insight: this page never scores a person, never infers productivity from event counts, and never
// says an operation is late — it knows a planned date, not a commitment.

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, ClipboardList, Users } from "lucide-react";
import { Entity360Header } from "@/components/Entity360Header";
import { EntityTabs } from "@/components/EntityTabs";
import { Alert, Breadcrumbs, EmptyState, StatusPill } from "@/components/ui";
import { tabId, tabPanelId } from "@/lib/tab-ids";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { isAuthoritative } from "@/lib/data-authority";
import {
  employmentTypeLabel,
  eventLabel,
  exactCount,
  operationLinkLabel,
  operationSubtypeLabel,
  positionLabel,
  statusLabel,
  statusPill,
} from "@/lib/people-display";
import { personHref, type PersonTab } from "@/lib/people-directory-context";
import type {
  ExactCountString,
  PersonDirectReportRow,
  PersonEventRow,
  PersonOperationRow,
  PersonSnapshot,
} from "@/lib/people-snapshot-reads";

/**
 * The one place a bounded sample says how much of its own total it is showing. It is rendered
 * whenever the sample is short of the total — never suppressed, and never phrased as if the sample
 * were the whole set.
 */
function SampleNote({
  shown,
  total,
  noun,
}: {
  shown: number;
  total: ExactCountString;
  noun: string;
}) {
  if (BigInt(total) <= BigInt(shown)) return null;
  return (
    <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
      هذه عيّنة من {exactCount(String(shown))} فقط من إجمالي {exactCount(total)} {noun} مسجلة — وليست القائمة كلها.
    </p>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs" style={{ color: "var(--ink-muted)" }}>{term}</dt>
      <dd className="text-sm font-semibold" style={{ overflowWrap: "anywhere" }}>{children}</dd>
    </div>
  );
}

function OperationRow({ row }: { row: PersonOperationRow }) {
  return (
    <li className="border-b py-3 last:border-b-0" style={{ borderColor: "var(--line)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/plans/${row.planId}`}
          className="text-sm font-semibold underline underline-offset-4"
          style={{ color: "var(--brand)", minHeight: 44, display: "inline-flex", alignItems: "center" }}
        >
          {operationSubtypeLabel(row.subtype)}
        </Link>
        <StatusPill status={statusPill(row.status)}>{statusLabel(row.status)}</StatusPill>
      </div>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>
        {row.plannedAt === null ? "بلا تاريخ مخطط مسجل" : `مخططة ${fmtDate(row.plannedAt)}`}
        {row.endsOn !== null && ` · تنتهي ${fmtDate(row.endsOn)}`}
        {" · "}
        {operationLinkLabel(row.isLead, row.isResponsible)}
      </p>
    </li>
  );
}

function EventRow({ row }: { row: PersonEventRow }) {
  return (
    <li className="border-b py-3 last:border-b-0" style={{ borderColor: "var(--line)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{eventLabel(row.subtype, row.type)}</span>
        <StatusPill status={statusPill(row.status)}>{statusLabel(row.status)}</StatusPill>
      </div>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>
        {fmtDateTime(row.occurredAt)}
        {row.notes !== null && ` · ${row.notes}`}
      </p>
    </li>
  );
}

function ReportRow({ row, returnTo }: { row: PersonDirectReportRow; returnTo: string }) {
  return (
    <li className="border-b py-3 last:border-b-0" style={{ borderColor: "var(--line)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={personHref(row.personId, "overview", returnTo)}
          className="text-sm font-semibold underline underline-offset-4"
          style={{ color: "var(--brand)", minHeight: 44, display: "inline-flex", alignItems: "center" }}
        >
          {row.name}
        </Link>
        <StatusPill status={row.active ? "active" : "warning"}>
          {row.active ? "على رأس العمل" : "خارج الخدمة"}
        </StatusPill>
      </div>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>
        {positionLabel(row.position)} · {employmentTypeLabel(row.employmentType)}
      </p>
    </li>
  );
}

export function Person360View({
  snapshot,
  tab,
  returnTo,
}: {
  snapshot: PersonSnapshot;
  tab: PersonTab;
  /** A validated internal directory path. Never the caller's own bytes — see lib/people-directory-context. */
  returnTo: string;
}) {
  const { person, operations, performedEvents, assignedEvents, directReports } = snapshot;
  const operationsVerified = isAuthoritative(snapshot.authority.operations);

  return (
    <main
      className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4"
      data-testid="person-360"
      style={{ "--ink-muted": "#5f7066", "--accent-fg": "#6d45b5" } as CSSProperties}
    >
      <Breadcrumbs
        ariaLabel="المسار"
        className="[&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center"
        items={[
          { id: "people", label: "الفريق", href: returnTo },
          { id: "person", label: person.name },
        ]}
      />

      <Entity360Header
        title={person.name}
        subtitle={`${positionLabel(person.position)} · ${employmentTypeLabel(person.employmentType)}`}
        pills={[{
          status: person.active ? "active" : "warning",
          label: person.active ? "على رأس العمل" : "خارج الخدمة",
        }]}
        actions={(
          <Link href={returnTo} className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
            <ArrowRight size={16} aria-hidden /> رجوع إلى الفريق
          </Link>
        )}
      />

      {!person.active && (
        <Alert
          tone="warning"
          title="هذا الزميل خارج الخدمة في السجل"
          description="ما يظهر أدناه هو ما هو مسجل باسمه بالفعل، ولا يعني أن العمل المفتوح أُعيد توزيعه."
        />
      )}
      {!operationsVerified && (
        <Alert
          tone="warning"
          title="أرقام العمل هنا مسجلة فقط، وتغطية مصدر العمليات غير مؤكدة"
          description="كل عدد في هذه الصفحة عدد دقيق لما هو مسجل في المؤسسة النشطة، وليس تأكيدًا أن كل تكليف أو نشاط جرى تسجيله."
        />
      )}

      <EntityTabs
        items={[
          { id: "overview", label: "نظرة عامة" },
          { id: "work", label: `العمل المفتوح (${exactCount(operations.openTotal)})` },
          { id: "activity", label: `النشاط المسجل (${exactCount(performedEvents.total)})` },
          { id: "team", label: `الفريق المباشر (${exactCount(directReports.total)})` },
        ]}
        value={tab}
        ariaLabel="أقسام ملف الزميل"
      />

      {tab === "overview" && (
        <section
          role="tabpanel"
          id={tabPanelId("overview")}
          aria-labelledby={tabId("overview")}
          tabIndex={0}
          className="flex flex-col gap-3"
        >
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
            <Fact term="الوظيفة">{positionLabel(person.position)}</Fact>
            <Fact term="نوع التوظيف">{employmentTypeLabel(person.employmentType)}</Fact>
            <Fact term="المدير المباشر">
              {person.managerId === null ? "بلا مدير مباشر مسجل" : (
                <Link
                  href={personHref(person.managerId, "overview", returnTo)}
                  className="inline-flex min-h-11 items-center underline underline-offset-4"
                  style={{ color: "var(--brand)" }}
                >
                  {person.managerName}
                </Link>
              )}
            </Fact>
            <Fact term="عمل مفتوح">{exactCount(operations.openTotal)} عملية</Fact>
            <Fact term="عمليات مسجلة إجمالًا">{exactCount(operations.total)} عملية</Fact>
            <Fact term="مرؤوسون مباشرون">
              {exactCount(directReports.total)} ({exactCount(directReports.activeTotal)} على رأس العمل)
            </Fact>
          </dl>
          <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
            «عمل مفتوح» يعني عملية لم تُنفَّذ ولم تُلغَ ولم تُحظر ولم تُتخطَّ، سواء كان الزميل مسؤولًا عنها أو
            ضمن فريقها؛ الارتباطان يُحسبان مرة واحدة. الأنشطة أدناه سجلّ لما جرى تسجيله، وليست تقييمًا لأداء.
          </p>
        </section>
      )}

      {tab === "work" && (
        <section
          role="tabpanel"
          id={tabPanelId("work")}
          aria-labelledby={tabId("work")}
          tabIndex={0}
          className="flex flex-col gap-2"
        >
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <ClipboardList size={17} aria-hidden />
            العمل المفتوح ({exactCount(operations.openTotal)})
          </h2>
          {operations.rows.length === 0 ? (
            <EmptyState
              title="لا يوجد عمل مفتوح مسجل على هذا الزميل"
              description={`إجمالي ما سُجّل باسمه من عمليات: ${exactCount(operations.total)}.`}
            />
          ) : (
            <>
              <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                الأقرب موعدًا أولًا، وما بلا تاريخ مخطط في الآخر. من إجمالي {exactCount(operations.total)} عملية
                مسجلة باسمه.
              </p>
              <ul>
                {operations.rows.map((row) => (
                  <OperationRow key={row.planOpId} row={row} />
                ))}
              </ul>
              <SampleNote shown={operations.rows.length} total={operations.openTotal} noun="عملية مفتوحة" />
            </>
          )}
        </section>
      )}

      {tab === "activity" && (
        <section
          role="tabpanel"
          id={tabPanelId("activity")}
          aria-labelledby={tabId("activity")}
          tabIndex={0}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <CalendarClock size={17} aria-hidden />
              أنشطة نفّذها ({exactCount(performedEvents.total)})
            </h2>
            {performedEvents.rows.length === 0 ? (
              <EmptyState title="لا توجد أنشطة مسجلة باسمه كمنفّذ" />
            ) : (
              <>
                <ul>
                  {performedEvents.rows.map((row) => <EventRow key={row.eventId} row={row} />)}
                </ul>
                <SampleNote shown={performedEvents.rows.length} total={performedEvents.total} noun="نشاطًا" />
              </>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-bold">
              أنشطة مسندة إليه ({exactCount(assignedEvents.total)})
            </h2>
            {assignedEvents.rows.length === 0 ? (
              <EmptyState title="لا توجد أنشطة مسندة إليه" />
            ) : (
              <>
                <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                  منها {exactCount(assignedEvents.openTotal)} ما زالت مفتوحة.
                </p>
                <ul>
                  {assignedEvents.rows.map((row) => <EventRow key={row.eventId} row={row} />)}
                </ul>
                <SampleNote shown={assignedEvents.rows.length} total={assignedEvents.total} noun="نشاطًا مسندًا" />
              </>
            )}
          </div>
        </section>
      )}

      {tab === "team" && (
        <section
          role="tabpanel"
          id={tabPanelId("team")}
          aria-labelledby={tabId("team")}
          tabIndex={0}
          className="flex flex-col gap-2"
        >
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Users size={17} aria-hidden />
            الفريق المباشر ({exactCount(directReports.total)})
          </h2>
          {directReports.rows.length === 0 ? (
            <EmptyState title="لا يتبعه أحد مباشرة في السجل" />
          ) : (
            <>
              <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                {exactCount(directReports.activeTotal)} منهم على رأس العمل. من على رأس العمل أولًا، ثم الباقي
                بالاسم.
              </p>
              <ul>
                {directReports.rows.map((row) => (
                  <ReportRow key={row.personId} row={row} returnTo={returnTo} />
                ))}
              </ul>
              <SampleNote shown={directReports.rows.length} total={directReports.total} noun="مرؤوسًا مباشرًا" />
            </>
          )}
        </section>
      )}
    </main>
  );
}
