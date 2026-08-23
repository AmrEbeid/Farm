// R4b — «تقرير إقفال الرواتب» as a real Entity 360. ONE exact, bounded, active-organisation snapshot
// per page view. Nothing on this route reads payroll_runs/payroll_run_lines directly any more.
//
// NOT FOUND MEANS NOT FOUND. `fn_payroll_run_snapshot` returns SQL NULL for a run outside the active
// organisation — deliberately the SAME answer as a run id that does not exist anywhere — so the 404
// below can never be read as "this run exists, but not for you". A malformed uuid never reaches
// PostgREST either: both collapse to the same `notFound()` call.
//
// THE RETURN LINK IS REBUILT, NOT ECHOED. `?from=` is parsed, restricted to the payroll workspace path
// and REBUILT from validated parts before it is ever rendered as a link (lib/payroll-workspace-context)
// — the caller's bytes never reach an href.
//
// FROZEN, NEVER RECOMPUTED. Every figure here — mode, unit, quantity, rate, gross, the run's own
// total — was frozen at close time by `fn_close_payroll_run` and is read exactly as stored.

import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PAYROLL_RUN_LINE_PAGE_SIZE, parsePayrollRunSnapshot } from "@/lib/payroll-snapshot-reads";
import {
  payrollPageCount,
  payrollRunLineHref,
  payrollWorkspaceOffset,
  readPayrollRunLineRequest,
} from "@/lib/payroll-workspace-context";
import { PayrollRunView } from "./payroll-run-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PayrollRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ lines?: string; from?: string; tab?: string }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  const { runId } = await params;
  // A route segment that is not a uuid is a 404, not a database error: `p_run_id uuid` would raise
  // 22P02 and reach the segment error boundary as a server fault instead of a missing page.
  if (!UUID.test(runId)) notFound();

  const resolvedSearchParams = await searchParams;
  const { page, from, redirectTo } = readPayrollRunLineRequest(runId, resolvedSearchParams);
  if (redirectTo) redirect(redirectTo);
  const tab = resolvedSearchParams.tab === "overview" ? "overview" : "lines";

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_payroll_run_snapshot", {
    p_org: m.orgId,
    p_run_id: runId,
    p_limit: PAYROLL_RUN_LINE_PAGE_SIZE,
    p_offset: payrollWorkspaceOffset(page, PAYROLL_RUN_LINE_PAGE_SIZE),
  });
  if (error) throw error;
  if (data === null) notFound();

  const snapshot = parsePayrollRunSnapshot(data, {
    orgId: m.orgId,
    runId,
    limit: PAYROLL_RUN_LINE_PAGE_SIZE,
    offset: payrollWorkspaceOffset(page, PAYROLL_RUN_LINE_PAGE_SIZE),
  });
  if (snapshot === null) notFound();

  const pageCount = payrollPageCount(snapshot.counts.totalLines, PAYROLL_RUN_LINE_PAGE_SIZE);
  if (page > pageCount) {
    redirect(payrollRunLineHref(runId, pageCount, from));
  }

  return <PayrollRunView snapshot={snapshot} page={page} returnTo={from} tab={tab} />;
}
