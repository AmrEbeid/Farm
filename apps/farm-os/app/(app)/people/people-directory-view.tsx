// SPEC-0033 R4c — the people directory. One bounded, active-organisation snapshot per page view;
// server-rendered throughout, phone-first Arabic RTL.
//
// WHAT REPLACED WHAT. The old page opened with a three-card KPI strip built from `array.length` on
// an unbounded client read, then a collapsible «فريق <المدير>» grouping of a six-column table that
// could not reflow into 390px, then a client CSV export of whatever happened to be loaded. The KPI
// strip is now three compact filter chips carrying the SAME exact counts they filter by; the manager
// grouping is one line on each row (resolved in SQL, so it stays truthful when the manager is on
// another page); the table is one stacked block per colleague; and the export is gone, because
// exporting one bounded page under the name «people» would read as the whole roster.
//
// NO CLIENT COMPONENT EXCEPT THE ONBOARDING FORM. Search is a plain GET form and every filter/page
// control is a link, so the directory works with no JavaScript, keeps its whole state in the URL,
// and can be bookmarked, shared and back-buttoned. Opening a colleague carries that state in a
// `?from=` the person page rebuilds from validated parts (lib/people-directory-context). The
// existing `PersonCreateForm` stays exactly as it is for the people.write roles — it is a form, so
// it needs client state. Its manager options come from the snapshot's OWN full list rather than the
// current page; if that full list exceeds the contract bound, onboarding is hidden without taking
// the readable directory down or presenting a partial roster.
//
// HONESTY (docs/CLAUDE.md #1). «عمل مفتوح» is the NONTERMINAL operation set — never the literal
// `planned`, which is the bug this replaces — counted over both link kinds, de-duplicated in SQL. An
// unrecorded position or employment type is named as unrecorded, never «٠» and never a bare dash.

import type { CSSProperties } from "react";
import Link from "next/link";
import { Search, UserRound, Users } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PersonCreateForm } from "@/components/PersonCreateForm";
import { Alert, EmptyState, StatusPill } from "@/components/ui";
import { isAuthoritative } from "@/lib/data-authority";
import {
  PEOPLE_FILTER_LABEL,
  employmentTypeLabel,
  exactCount,
  plainCount,
  positionLabel,
} from "@/lib/people-display";
import {
  peopleDirectoryHref,
  peoplePageCount,
  personHrefFromDirectory,
  type PeopleDirectoryContext,
} from "@/lib/people-directory-context";
import {
  PEOPLE_DIRECTORY_FILTERS,
  type ExactCountString,
  type PeopleDirectoryFilter,
  type PeopleDirectoryRow,
  type PeopleDirectorySnapshot,
} from "@/lib/people-snapshot-reads";

function filterCount(snapshot: PeopleDirectorySnapshot, filter: PeopleDirectoryFilter): ExactCountString {
  switch (filter) {
    case "active":
      return snapshot.counts.active;
    case "assigned":
      return snapshot.counts.assigned;
    default:
      return snapshot.counts.queryTotal;
  }
}

/** The search box. A plain GET form, so it needs no JavaScript and resets to page one by omission. */
function SearchForm({ context }: { context: PeopleDirectoryContext }) {
  return (
    <form action="/people" method="get" role="search" className="flex flex-wrap items-center gap-2">
      <label htmlFor="people-search" className="sr-only">ابحث في الفريق</label>
      <input
        id="people-search"
        name="q"
        type="search"
        defaultValue={context.query}
        maxLength={60}
        placeholder="ابحث بالاسم أو الوظيفة…"
        className="fos-input fos-input--md min-w-0 flex-1"
        style={{ minHeight: 44 }}
      />
      {context.filter !== "all" && <input type="hidden" name="filter" value={context.filter} />}
      <button type="submit" className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
        <Search size={16} aria-hidden /> ابحث
      </button>
      {context.query !== "" && (
        <Link
          href={peopleDirectoryHref({ filter: context.filter })}
          className="fos-btn fos-btn--ghost fos-btn--md"
          style={{ minHeight: 44 }}
        >
          امسح البحث
        </Link>
      )}
    </form>
  );
}

/** Filter chips. Each carries its own exact count, so choosing one never hides how big the set is. */
function FilterChips({
  snapshot,
  context,
}: {
  snapshot: PeopleDirectorySnapshot;
  context: PeopleDirectoryContext;
}) {
  return (
    <nav aria-label="تصفية الفريق" className="flex flex-wrap gap-2">
      {PEOPLE_DIRECTORY_FILTERS.map((filter) => {
        const active = filter === context.filter;
        return (
          <Link
            key={filter}
            href={peopleDirectoryHref({ query: context.query, filter, page: 1 })}
            aria-current={active ? "page" : undefined}
            className="inline-flex items-center gap-2 rounded-full px-3 text-sm font-semibold"
            style={{
              minHeight: 44,
              color: active ? "var(--brand-contrast)" : "var(--ink)",
              background: active ? "var(--brand)" : "var(--surface)",
              border: "1px solid var(--line)",
            }}
          >
            <span>{PEOPLE_FILTER_LABEL[filter]}</span>
            <span style={{ opacity: 0.85 }}>{exactCount(filterCount(snapshot, filter))}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function PersonRow({ row, context }: { row: PeopleDirectoryRow; context: PeopleDirectoryContext }) {
  const workload = row.openOperations === "0"
    ? "لا عمل مفتوح مسجل الآن"
    : `${exactCount(row.openOperations)} عملية مفتوحة`;

  return (
    <li className="border-b py-3 last:border-b-0" style={{ borderColor: "var(--line)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={personHrefFromDirectory(row.personId, context)}
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
        {positionLabel(row.position)} · {employmentTypeLabel(row.employmentType)} · {workload}
      </p>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>
        {row.managerName === null ? "بلا مدير مباشر مسجل" : `يتبع ${row.managerName}`}
      </p>
    </li>
  );
}

function Pager({
  snapshot,
  context,
}: {
  snapshot: PeopleDirectorySnapshot;
  context: PeopleDirectoryContext;
}) {
  const pages = peoplePageCount(snapshot.counts.matching, snapshot.limit);
  if (pages <= 1) return null;
  const page = Math.min(context.page, pages);
  return (
    <nav aria-label="صفحات الفريق" className="flex items-center justify-between gap-2">
      {page > 1 ? (
        <Link
          href={peopleDirectoryHref({ ...context, page: page - 1 })}
          className="fos-btn fos-btn--secondary fos-btn--md"
          style={{ minHeight: 44 }}
        >
          السابق
        </Link>
      ) : <span />}
      <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
        صفحة {plainCount(page)} من {plainCount(pages)} · {exactCount(snapshot.counts.matching)} زميل مطابق
      </span>
      {page < pages ? (
        <Link
          href={peopleDirectoryHref({ ...context, page: page + 1 })}
          className="fos-btn fos-btn--secondary fos-btn--md"
          style={{ minHeight: 44 }}
        >
          التالي
        </Link>
      ) : <span />}
    </nav>
  );
}

export function PeopleDirectoryView({
  snapshot,
  context,
}: {
  snapshot: PeopleDirectorySnapshot;
  context: PeopleDirectoryContext;
}) {
  const { counts, rows } = snapshot;
  const operationsVerified = isAuthoritative(snapshot.authority.operations);
  const searching = context.query !== "";
  // A page beyond the last one is empty for a different reason than an empty search, and saying so
  // stops «لا يوجد زملاء» from reading as "this organisation has nobody".
  const deepPage = rows.length === 0 && context.page > 1 && counts.matching !== "0";

  return (
    <main
      className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4"
      data-testid="people-directory"
      style={{ "--ink-muted": "#5f7066", "--accent-fg": "#6d45b5" } as CSSProperties}
    >
      <PageHeader
        title="الفريق"
        subtitle="من في المزرعة، ومن لديه عمل مفتوح الآن."
        metadata={(
          <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
            {exactCount(counts.totalPeople)} زميل مسجل
          </span>
        )}
        actions={(
          <Link href="/people/dashboard" className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
            لوحة الفريق
          </Link>
        )}
      />

      {!operationsVerified && (
        <Alert
          tone="warning"
          title="أرقام العمل هنا مسجلة فقط، وتغطية مصدر العمليات غير مؤكدة"
          description="كل عدد في هذه الصفحة عدد دقيق لما هو مسجل في المؤسسة النشطة، وليس تأكيدًا أن كل تكليف جرى تسجيله."
        />
      )}

      <section aria-labelledby="people-find-title" className="flex flex-col gap-3">
        <h2 id="people-find-title" className="sr-only">ابحث وصفِّ الفريق</h2>
        <SearchForm context={context} />
        <FilterChips snapshot={snapshot} context={context} />
      </section>

      <section aria-labelledby="people-state-title" className="flex flex-col gap-1">
        <h2 id="people-state-title" className="flex items-center gap-2 text-sm font-bold">
          <Users size={17} aria-hidden />
          الحالة الآن
        </h2>
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {searching
            ? `${exactCount(counts.queryTotal)} زميل يطابق بحثك من ${exactCount(counts.totalPeople)} زميل مسجل.`
            : `${exactCount(counts.totalPeople)} زميل مسجل.`}
          {" "}
          {exactCount(counts.active)} على رأس العمل · {exactCount(counts.inactive)} خارج الخدمة ·
          {" "}
          {exactCount(counts.assigned)} لديهم عمل مفتوح.
        </p>
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
          «عمل مفتوح» يعني عملية لم تُنفَّذ ولم تُلغَ ولم تُحظر ولم تُتخطَّ، سواء كان الزميل مسؤولًا عنها أو ضمن
          فريقها؛ الارتباطان يُحسبان مرة واحدة.
        </p>
      </section>

      <section aria-labelledby="people-rows-title" className="flex flex-col gap-2">
        <h2 id="people-rows-title" className="text-sm font-bold">
          {PEOPLE_FILTER_LABEL[context.filter]} ({exactCount(counts.matching)})
        </h2>
        {rows.length === 0 ? (
          <EmptyState
            title={
              deepPage
                ? "لا يوجد زملاء في هذه الصفحة"
                : searching
                  ? "لا يوجد زميل مطابق لهذا البحث"
                  : "لا يوجد زملاء في هذه القائمة"
            }
            description={
              deepPage
                ? `هذه القائمة بها ${exactCount(counts.matching)} زميل مطابق فقط، فصفحة ${plainCount(context.page)} خارجها.`
                : searching
                  ? "جرّب كلمة أقصر، أو امسح البحث للعودة إلى كل الفريق."
                  : "غيّر التصفية أو ارجع إلى كل الفريق."
            }
            action={(
              <Link
                href={deepPage ? peopleDirectoryHref({ ...context, page: 1 }) : peopleDirectoryHref()}
                className="fos-btn fos-btn--secondary fos-btn--md"
                style={{ minHeight: 44 }}
              >
                {deepPage ? "أول صفحة" : "كل الفريق"}
              </Link>
            )}
          />
        ) : (
          <>
            <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
              من على رأس العمل أولًا، ثم الباقي بالاسم. هذه صفحة واحدة من الدليل، لا الدليل كله.
            </p>
            <ul>
              {rows.map((row) => (
                <PersonRow key={row.personId} row={row} context={context} />
              ))}
            </ul>
            <Pager snapshot={snapshot} context={context} />
          </>
        )}
      </section>

      {snapshot.managerOptions !== null && (
        // The onboarding form keeps the capability the people.write roles have always had. Its
        // manager list is the snapshot's OWN full list, published separately from the page, so a
        // manager who is not on the current page is still selectable. A partial roster is never
        // handed to the writer: the form is absent when the full option list exceeds its bound.
        <section aria-labelledby="people-onboard-title" className="flex flex-col gap-2">
          <h2 id="people-onboard-title" className="flex items-center gap-2 text-sm font-bold">
            <UserRound size={17} aria-hidden />
            إضافة زميل
          </h2>
          <PersonCreateForm
            managers={snapshot.managerOptions.map((option) => ({ id: option.personId, name: option.name }))}
          />
        </section>
      )}
      {snapshot.canWrite && snapshot.managerOptions === null && (
        <Alert
          tone="warning"
          title="إضافة الزملاء متوقفة مؤقتًا من هذه الصفحة"
          description="دليل الفريق متاح كاملًا، لكن قائمة المديرين أكبر من الحد الآمن للنموذج. استخدم بحثًا مخصصًا للمدير قبل إعادة تفعيل الإضافة."
        />
      )}
    </main>
  );
}
