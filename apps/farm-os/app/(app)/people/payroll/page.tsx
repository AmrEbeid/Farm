// «إقفال الرواتب» — the owner/accountant surface for SPEC-0006 slice 3.
//
// WHAT IT IS AND IS NOT. Closing a period freezes an IMMUTABLE gross-pay snapshot for reporting and
// freezes that period's attendance against later edits. It moves NO money and posts NO journal
// entry. That boundary is stated on the page itself, not only in a spec, because "إقفال الرواتب"
// otherwise reads like "pay the workers".
//
// ACCESS. owner/accountant only (`requireRole`), matching the payroll.read RLS on both tables. The
// nav entry carries the same two roles, so the page never appears to anyone who would be redirected.
//
// The history is bounded (PAYROLL_RUN_HISTORY_LIMIT), org-scoped to the SERVER session's active org,
// and reads its line counts in ONE extra query — never one per run.

import type { ReactNode } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { egp, num } from "@/lib/money";
import { PrintButton } from "@/components/print-button";
import { Alert, EmptyState } from "@/components/ui";
import { cairoTodayIso } from "@/lib/payroll-close";
import { PAYROLL_RUN_HISTORY_LIMIT, loadPayrollRunHistory } from "@/lib/payroll-report";
import { PayrollCloseForm } from "./close-form";

export const dynamic = "force-dynamic";

const mutedStyle = { color: "var(--ink-muted)" } as const;
const boxStyle = { border: "1px solid var(--line)", background: "var(--surface)" } as const;
const cellStyle = { borderBottom: "1px solid var(--line)" } as const;

/** The report column carries a visually-hidden header: the cell itself holds only the link. */
const HISTORY_COLUMNS = [
  { key: "period", label: "الفترة", visuallyHidden: false },
  { key: "closed-at", label: "وقت الإقفال", visuallyHidden: false },
  { key: "total", label: "إجمالي الأجور", visuallyHidden: false },
  { key: "lines", label: "عدد السطور", visuallyHidden: false },
  { key: "report", label: "التقرير", visuallyHidden: true },
] as const;

const linkStyle = { border: "1px solid var(--line)", color: "var(--ink)" } as const;

function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="rounded-md px-3 py-1 text-sm" style={linkStyle}>
      {children}
    </Link>
  );
}

export default async function PayrollPage() {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const history = await loadPayrollRunHistory(sb, m.orgId);
  const todayIso = cairoTodayIso();
  const canOpenAttendance = m.role === "owner";

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-xl font-bold">إقفال الرواتب</h1>
        <span className="text-xs" style={mutedStyle}>
          آخر {num(PAYROLL_RUN_HISTORY_LIMIT)} فترة مُقفلة في هذه المؤسسة.
        </span>
        <div className="no-print ms-auto flex flex-wrap items-center gap-2">
          <PrintButton label="طباعة سجل الإقفالات" />
          {/* The close prices against saved rates and recorded attendance; both are one click away,
              and a missing rate is the single most common reason a close is refused. Attendance is a
              labor.write surface, so an accountant would be redirected — only the owner is offered it. */}
          <HeaderLink href="/people/payroll/compensation">أجور الفريق</HeaderLink>
          {canOpenAttendance && <HeaderLink href="/people/attendance">تسجيل الحضور</HeaderLink>}
        </div>
      </header>

      <p className="flex items-start gap-2 rounded-md p-3 text-xs" style={boxStyle}>
        <Lock aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
        <span>
          الإقفال يُجمّد لقطة أجور غير قابلة للتعديل بغرض التقارير فقط — لا يصرف أي مبلغ ولا يُنشئ أي
          قيد محاسبي. الصرف والقيد يبقيان في مسارَيهما المنفصلين.
        </span>
      </p>

      <PayrollCloseForm todayIso={todayIso} />

      <section className="flex flex-col gap-2" aria-labelledby="payroll-history-heading">
        <h2 id="payroll-history-heading" className="text-base font-bold">
          الإقفالات السابقة
        </h2>

        {!history.ok ? (
          <Alert tone="danger" title="لم يُعرض السجل" description={history.error} />
        ) : history.runs.length === 0 ? (
          <EmptyState title="لا توجد فترات مُقفلة بعد" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm" style={boxStyle}>
              <caption className="sr-only">سجل فترات الرواتب المُقفلة</caption>
              <thead>
                <tr>
                  {HISTORY_COLUMNS.map((column) => (
                    <th key={column.key} scope="col" className="p-2 text-start font-semibold" style={cellStyle}>
                      {column.visuallyHidden ? <span className="sr-only">{column.label}</span> : column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.runs.map((run) => (
                  <tr key={run.id}>
                    <td className="p-2" style={cellStyle}>
                      {fmtDate(run.periodStart)} — {fmtDate(run.periodEnd)}
                    </td>
                    <td className="p-2" style={cellStyle}>
                      {fmtDateTime(run.closedAt)}
                    </td>
                    <td className="p-2 tabular-nums" style={cellStyle}>
                      {egp(run.totalGross)}
                    </td>
                    <td className="p-2 tabular-nums" style={cellStyle}>
                      {num(run.lineCount)}
                    </td>
                    <td className="no-print p-2" style={cellStyle}>
                      <Link
                        href={`/people/payroll/${run.id}`}
                        className="font-bold underline underline-offset-4"
                        style={{ color: "var(--brand)" }}
                      >
                        التقرير ←
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
