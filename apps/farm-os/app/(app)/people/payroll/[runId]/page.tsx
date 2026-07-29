// One closed payroll run, as a printable report. Owner/accountant only.
//
// FAIL-CLOSED. A malformed run id never reaches PostgREST. A run that is missing — or belongs to
// another org, which RLS makes indistinguishable from missing — is a 404. A failed read, a run
// larger than the page's bound, and a run whose lines read back empty each render an Arabic refusal
// and NO figures: a payroll report that quietly dropped lines still looks like a complete wage bill.
//
// NOTHING IS TRUSTED FROM THE URL. The only thing taken from the route is the run id, and it is used
// solely as a filter on an org-scoped read. No report payload is ever accepted from a query string —
// the numbers on this page always come back out of the database under RLS.
//
// The snapshot is read as stored: mode, unit, quantity, rate and gross were frozen at close time by
// `fn_close_payroll_run` and are never recomputed here.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { egp, num } from "@/lib/money";
import { PrintButton } from "@/components/print-button";
import { Alert } from "@/components/ui";
import {
  isUuid,
  loadPayrollRunDetail,
  payrollModeLabel,
  payrollQuantityUnitLabel,
} from "@/lib/payroll-report";

export const dynamic = "force-dynamic";

const mutedStyle = { color: "var(--ink-muted)" } as const;
const boxStyle = { border: "1px solid var(--line)", background: "var(--surface)" } as const;
const cellStyle = { borderBottom: "1px solid var(--line)" } as const;
const linkStyle = { border: "1px solid var(--line)", color: "var(--ink)" } as const;
const BACK_HREF = "/people/payroll";

function BackLink() {
  return (
    <Link href={BACK_HREF} className="rounded-md px-3 py-1 text-sm" style={linkStyle}>
      رجوع إلى إقفال الرواتب
    </Link>
  );
}

export default async function PayrollRunReportPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();
  const { runId } = await params;

  if (!isUuid(runId)) notFound();

  const load = await loadPayrollRunDetail(sb, runId, m.orgId);
  if (!load.ok && load.kind === "not_found") notFound();

  if (!load.ok) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold">تقرير إقفال الرواتب</h1>
          <div className="no-print ms-auto">
            <BackLink />
          </div>
        </header>
        <Alert tone="danger" title="لم يصدر التقرير" description={load.error} />
      </div>
    );
  }

  const { run, lines } = load;

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-xl font-bold">تقرير إقفال الرواتب</h1>
        <span className="text-sm" style={mutedStyle}>
          {fmtDate(run.periodStart)} — {fmtDate(run.periodEnd)}
        </span>
        <div className="no-print ms-auto flex flex-wrap items-center gap-2">
          <PrintButton label="طباعة التقرير" />
          <BackLink />
        </div>
      </header>

      <p className="flex items-start gap-2 rounded-md p-3 text-xs" style={boxStyle}>
        <Lock aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
        <span>
          لقطة أجور مجمّدة لا تتغيّر بعد الإقفال، للعرض والتقارير فقط. لا صرف ولا قيد محاسبي.
        </span>
      </p>

      <dl className="grid gap-2 sm:grid-cols-4">
        {[
          { label: "من تاريخ", value: fmtDate(run.periodStart) },
          { label: "إلى تاريخ", value: fmtDate(run.periodEnd) },
          { label: "وقت الإقفال", value: fmtDateTime(run.closedAt) },
          { label: "عدد السطور", value: num(lines.length) },
        ].map((figure) => (
          <div key={figure.label} className="rounded-md px-2 py-1.5" style={boxStyle}>
            <dt className="text-[11px]" style={mutedStyle}>
              {figure.label}
            </dt>
            <dd className="text-sm font-semibold tabular-nums">{figure.value}</dd>
          </div>
        ))}
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[38rem] text-sm" style={boxStyle}>
          <caption className="sr-only">سطور الأجور المجمّدة لهذه الفترة</caption>
          <thead>
            <tr>
              {["العامل", "طريقة الأجر", "الكمية", "الوحدة", "سعر الوحدة", "الإجمالي"].map((header) => (
                <th key={header} scope="col" className="p-2 text-start font-semibold" style={cellStyle}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={`${line.personId}-${line.mode}-${line.unit ?? ""}`}>
                <th scope="row" className="p-2 text-start font-normal" style={cellStyle}>
                  {line.personName}
                </th>
                <td className="p-2" style={cellStyle}>
                  {payrollModeLabel(line.mode)}
                </td>
                <td className="p-2 tabular-nums" style={cellStyle}>
                  {num(line.quantity, 2)}
                </td>
                <td className="p-2" style={cellStyle}>
                  {payrollQuantityUnitLabel(line.mode, line.unit)}
                </td>
                <td className="p-2 tabular-nums" style={cellStyle}>
                  {egp(line.rate)}
                </td>
                <td className="p-2 tabular-nums" style={cellStyle}>
                  {egp(line.gross)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="p-2" colSpan={5}>
                إجمالي الأجور المجمّدة
              </td>
              <td className="p-2 tabular-nums">{egp(run.totalGross)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
