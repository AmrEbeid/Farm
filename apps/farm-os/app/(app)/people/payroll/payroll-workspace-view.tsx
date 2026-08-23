// R4b — the payroll workspace. One bounded, active-organisation snapshot per page view;
// server-rendered throughout, mobile-first Arabic RTL. Mirrors app/(app)/inventory/inventory-list-view.tsx.
//
// NO CLIENT COMPONENT, ON PURPOSE (except the close form's own two-step confirm, which stays a small
// island). Pagination is a plain link, so the history works with no JavaScript, keeps its whole state
// in the URL, and can be bookmarked, shared and back-buttoned.
//
// NO TABLE, ON PURPOSE. Each closed run is one record block that stacks on a small screen, so there is no
// axis to overflow on.
//
// HONESTY (docs/CLAUDE.md #1). The exact run count and the exact all-runs gross total are published
// separately from the bounded page below them, and the page never claims to be the whole history.

import type { ReactNode } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Alert, EmptyState } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { isAuthoritative } from "@/lib/data-authority";
import { exactCount, moneyText, plainCount } from "@/lib/payroll-display";
import {
  payrollPageCount,
  payrollRunHref,
  payrollWorkspaceHref,
  type PayrollWorkspaceContext,
} from "@/lib/payroll-workspace-context";
import type { PayrollWorkspaceRun, PayrollWorkspaceSnapshot } from "@/lib/payroll-snapshot-reads";

const PAYROLL_FREEZE_BOUNDARY_AR =
  "الإقفال يُجمّد لقطة أجور غير قابلة للتعديل بغرض التقارير فقط — لا يصرف أي مبلغ ولا يُنشئ أي قيد محاسبي. الصرف والقيد يبقيان في مسارَيهما المنفصلين.";

function RunRow({ run, context }: { run: PayrollWorkspaceRun; context: PayrollWorkspaceContext }) {
  return (
    <li className="border-b py-3 last:border-b-0" style={{ borderColor: "var(--line)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={payrollRunHref(run.runId, context)}
          className="text-sm font-semibold underline underline-offset-4"
          style={{ color: "var(--brand)", minHeight: 44, display: "inline-flex", alignItems: "center" }}
        >
          {fmtDate(run.periodStart)} — {fmtDate(run.periodEnd)}
        </Link>
      </div>
      <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>
        أُقفلت {fmtDateTime(run.closedAt)} · إجمالي {moneyText(run.totalGross)} · {exactCount(run.lineCount)} سطر أجر
      </p>
    </li>
  );
}

function Pager({ snapshot, context }: { snapshot: PayrollWorkspaceSnapshot; context: PayrollWorkspaceContext }) {
  const pages = payrollPageCount(snapshot.counts.totalRuns, snapshot.limit);
  if (pages <= 1) return null;
  const page = Math.min(context.page, pages);
  return (
    <nav aria-label="صفحات الإقفالات" className="flex items-center justify-between gap-2">
      {page > 1 ? (
        <Link href={payrollWorkspaceHref({ page: page - 1 })} className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
          السابق
        </Link>
      ) : <span />}
      <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
        صفحة {plainCount(page)} من {plainCount(pages)} · {exactCount(snapshot.counts.totalRuns)} فترة مُقفلة
      </span>
      {page < pages ? (
        <Link href={payrollWorkspaceHref({ page: page + 1 })} className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
          التالي
        </Link>
      ) : <span />}
    </nav>
  );
}

/** The compact story line: never closed, has history, and what the legal next action is. */
function WorkspaceStory({ snapshot }: { snapshot: PayrollWorkspaceSnapshot }) {
  const neverClosed = snapshot.counts.totalRuns === "0";
  return (
    <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
      {neverClosed
        ? "لم تُقفل أي فترة رواتب في هذه المؤسسة بعد. سجّل أجور الفريق، تأكد من جاهزية البيانات، ثم أقفل أول فترة."
        : `تحتوي هذه المؤسسة على ${exactCount(snapshot.counts.totalRuns)} فترة رواتب مُقفلة، بإجمالي ${moneyText(snapshot.totals.totalGross)} عبر كل الفترات. يمكن إقفال فترة جديدة متى اكتمل تسجيل حضورها.`}
    </p>
  );
}

export function PayrollWorkspaceView({
  snapshot,
  context,
  canOpenAttendance,
  closeForm,
}: {
  snapshot: PayrollWorkspaceSnapshot;
  context: PayrollWorkspaceContext;
  canOpenAttendance: boolean;
  closeForm: ReactNode;
}) {
  const payrollVerified = isAuthoritative(snapshot.authority.payroll);
  const { rows } = snapshot;
  const deepPage = rows.length === 0 && context.page > 1 && snapshot.counts.totalRuns !== "0";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4" data-testid="payroll-workspace">
      <PageHeader
        title="إقفال الرواتب"
        subtitle="فترات الرواتب المُقفلة في هذه المؤسسة، ولقطة كل فترة المجمّدة."
        metadata={(
          <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
            {exactCount(snapshot.counts.totalRuns)} فترة مُقفلة
          </span>
        )}
        actions={(
          <div className="no-print flex flex-wrap gap-2">
            <Link href="/people/payroll/compensation" className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
              أجور الفريق
            </Link>
            <Link href="/people/payroll/readiness" className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
              جاهزية الرواتب
            </Link>
            {canOpenAttendance && (
              <Link href="/people/attendance" className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
                تسجيل الحضور
              </Link>
            )}
          </div>
        )}
      />

      {!payrollVerified && (
        <Alert
          tone="warning"
          title="الأرقام هنا مسجلة فقط، وتغطية مصدر الرواتب غير مؤكدة"
          description="كل عدد ومبلغ في هذه الصفحة قراءة دقيقة لما هو مسجل ومقفل فعلًا في المؤسسة النشطة، وليس تأكيدًا أن كل حضور أو أجر جرى تسجيله."
        />
      )}

      <p className="flex items-start gap-2 rounded-md p-3 text-xs" style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
        <Lock aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
        <span>{PAYROLL_FREEZE_BOUNDARY_AR}</span>
      </p>

      <WorkspaceStory snapshot={snapshot} />

      {closeForm}

      <section aria-labelledby="payroll-history-title" className="flex flex-col gap-2">
        <h2 id="payroll-history-title" className="text-sm font-bold">
          الإقفالات السابقة ({exactCount(snapshot.counts.totalRuns)})
        </h2>
        {rows.length === 0 ? (
          <EmptyState
            title={deepPage ? "لا توجد فترات في هذه الصفحة" : "لا توجد فترات مُقفلة بعد"}
            description={
              deepPage
                ? `هذا السجل به ${exactCount(snapshot.counts.totalRuns)} فترة مُقفلة فقط، فصفحة ${plainCount(context.page)} خارجه.`
                : "لم تُقفل أي فترة رواتب حتى الآن. استخدم النموذج أعلاه لإقفال أول فترة."
            }
            action={deepPage ? (
              <Link href={payrollWorkspaceHref()} className="fos-btn fos-btn--secondary fos-btn--md" style={{ minHeight: 44 }}>
                أول صفحة
              </Link>
            ) : undefined}
          />
        ) : (
          <>
            <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
              أحدث فترة أولًا. هذه صفحة واحدة من السجل، لا السجل كله.
            </p>
            <ul>
              {rows.map((run) => (
                <RunRow key={run.runId} run={run} context={context} />
              ))}
            </ul>
            <Pager snapshot={snapshot} context={context} />
          </>
        )}
      </section>
    </main>
  );
}
