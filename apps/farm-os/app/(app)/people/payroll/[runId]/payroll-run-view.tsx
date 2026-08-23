// R4b — the payroll run 360. One bounded, active-organisation snapshot per page view; server-rendered
// throughout except the tab strip, mobile-first Arabic RTL.
//
// ENTITY 360 CONVENTIONS. Uses the same Entity360Header + EntityTabs the rest of the app's 360 pages
// share. Tabs are URL-driven (`?tab=`) so the active one survives refresh and is shareable/bookmarkable
// — the server renders only the matching panel; EntityTabs itself renders nothing else.
//
// NO TABLE, ON PURPOSE. Each frozen wage line is one record block that stacks on a small screen.
//
// HONESTY (docs/CLAUDE.md #1). The exact line count is published separately from the bounded page of
// lines below it, and the page never claims to be the whole run when it is not.

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";
import { Entity360Header } from "@/components/Entity360Header";
import { EntityTabs } from "@/components/EntityTabs";
import { Breadcrumbs, EmptyState } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { decimalText, exactCount, moneyText, payrollModeLabel, payrollQuantityUnitLabel, plainCount } from "@/lib/payroll-display";
import { payrollPageCount, payrollRunLineHref } from "@/lib/payroll-workspace-context";
import type { PayrollRunLine, PayrollRunSnapshot } from "@/lib/payroll-snapshot-reads";

const PAYROLL_FREEZE_BOUNDARY_AR =
  "لقطة أجور مجمّدة لا تتغيّر بعد الإقفال، للعرض والتقارير فقط. لا صرف ولا قيد محاسبي.";

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs" style={{ color: "var(--ink-muted)" }}>{term}</dt>
      <dd className="text-sm font-semibold" style={{ overflowWrap: "anywhere" }}>{children}</dd>
    </div>
  );
}

function LineRow({ line }: { line: PayrollRunLine }) {
  return (
    <li className="border-b py-3 last:border-b-0" style={{ borderColor: "var(--line)" }}>
      <p className="text-sm font-semibold">{line.personName}</p>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>
        {payrollModeLabel(line.mode)} · {decimalText(line.quantity)} {payrollQuantityUnitLabel(line.mode, line.unit)}
        {" "}· سعر الوحدة {moneyText(line.rate)} · الإجمالي {moneyText(line.gross)}
      </p>
    </li>
  );
}

function LinesPager({ runId, snapshot, page, returnTo }: {
  runId: string;
  snapshot: PayrollRunSnapshot;
  page: number;
  returnTo: string;
}) {
  const pages = payrollPageCount(snapshot.counts.totalLines, snapshot.limit);
  if (pages <= 1) return null;
  const current = Math.min(page, pages);
  return (
    <nav aria-label="صفحات سطور الأجور" className="no-print flex items-center justify-between gap-2">
      {current > 1 ? (
        <Link href={payrollRunLineHref(runId, current - 1, returnTo)} className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
          السابق
        </Link>
      ) : <span />}
      <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
        صفحة {plainCount(current)} من {plainCount(pages)} · {exactCount(snapshot.counts.totalLines)} سطر أجر
      </span>
      {current < pages ? (
        <Link href={payrollRunLineHref(runId, current + 1, returnTo)} className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
          التالي
        </Link>
      ) : <span />}
    </nav>
  );
}

export function PayrollRunView({
  snapshot,
  page,
  returnTo,
  tab,
}: {
  snapshot: PayrollRunSnapshot;
  page: number;
  /** A validated internal workspace path. Never the caller's own bytes — see lib/payroll-workspace-context. */
  returnTo: string;
  tab: "overview" | "lines";
}) {
  const periodLabel = `${fmtDate(snapshot.periodStart)} — ${fmtDate(snapshot.periodEnd)}`;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4" data-testid="payroll-run-360">
      <Breadcrumbs
        ariaLabel="المسار"
        items={[
          { id: "payroll", label: "إقفال الرواتب", href: returnTo },
          { id: "run", label: periodLabel },
        ]}
      />

      <Entity360Header
        title={periodLabel}
        subtitle={`أُقفلت ${fmtDateTime(snapshot.closedAt)} · إجمالي مجمّد ${moneyText(snapshot.totalGross)}`}
        pills={[{ status: "done", label: "لقطة مجمّدة" }]}
        actions={(
          <div className="no-print flex flex-wrap gap-2">
            <Link href={returnTo} className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
              <ArrowRight size={16} aria-hidden /> رجوع إلى إقفال الرواتب
            </Link>
          </div>
        )}
      />

      <p className="flex items-start gap-2 rounded-md p-3 text-xs" style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
        <Lock aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
        <span>{PAYROLL_FREEZE_BOUNDARY_AR}</span>
      </p>

      <EntityTabs
        items={[
          { id: "overview", label: "نظرة عامة" },
          { id: "lines", label: "سطور الأجور" },
        ]}
        value={tab}
        ariaLabel="أقسام تقرير الإقفال"
      />

      {tab === "overview" ? (
        <section aria-labelledby="run-overview-title" className="flex flex-col gap-2">
          <h2 id="run-overview-title" className="sr-only">نظرة عامة على الإقفال</h2>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
            <Fact term="من تاريخ">{fmtDate(snapshot.periodStart)}</Fact>
            <Fact term="إلى تاريخ">{fmtDate(snapshot.periodEnd)}</Fact>
            <Fact term="وقت الإقفال">{fmtDateTime(snapshot.closedAt)}</Fact>
            <Fact term="إجمالي الأجور المجمّد">{moneyText(snapshot.totalGross)}</Fact>
            <Fact term="عدد سطور الأجر">{exactCount(snapshot.counts.totalLines)}</Fact>
          </dl>
        </section>
      ) : (
        <section aria-labelledby="run-lines-title" className="flex flex-col gap-2">
          <h2 id="run-lines-title" className="text-sm font-bold">
            سطور الأجور المجمّدة ({exactCount(snapshot.counts.totalLines)})
          </h2>
          {snapshot.rows.length === 0 ? (
            <EmptyState
              title="لا توجد سطور في هذه الصفحة"
              description={`هذا الإقفال به ${exactCount(snapshot.counts.totalLines)} سطر أجر فقط، فصفحة ${plainCount(page)} خارجه.`}
            />
          ) : (
            <>
              <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                مرتبة بالاسم. هذه صفحة واحدة من سطور هذا الإقفال، لا الإقفال كله.
              </p>
              <ul>
                {snapshot.rows.map((line) => (
                  <LineRow key={line.lineId} line={line} />
                ))}
              </ul>
              <LinesPager runId={snapshot.runId} snapshot={snapshot} page={page} returnTo={returnTo} />
            </>
          )}
        </section>
      )}
    </main>
  );
}
