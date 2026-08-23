// R4b — «إقفال الرواتب» workspace. ONE exact, bounded, active-organisation snapshot per page view.
// Nothing on this route reads payroll_runs/payroll_run_lines directly any more.
//
// WHAT REPLACED WHAT. The old page read `payroll_runs` and `payroll_run_lines` directly via
// PostgREST (lib/payroll-report.ts's `loadPayrollRunHistory`), re-implementing its own bounded read,
// its own auth re-check, and its own reconciliation-free line count. `fn_payroll_workspace_snapshot`
// (migration 20260823150000) now decides all three in PostgreSQL: an exact run count and an exact
// all-runs gross total, published separately from one deterministically ordered limit/offset page,
// with every run's `total_gross` re-verified against its own stored lines before any of it is served.
//
// WHAT IT IS AND IS NOT. Closing a period freezes an IMMUTABLE gross-pay snapshot for reporting and
// freezes that period's attendance against later edits. It moves NO money and posts NO journal entry.
//
// ACCESS. owner/accountant only (`requireRole`), matching the payroll.read RLS on both tables and the
// snapshot RPC's own re-check of the same permission.

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cairoTodayIso } from "@/lib/payroll-close";
import { PAYROLL_WORKSPACE_PAGE_SIZE, parsePayrollWorkspaceSnapshot } from "@/lib/payroll-snapshot-reads";
import {
  payrollPageCount,
  payrollWorkspaceHref,
  payrollWorkspaceOffset,
  readPayrollWorkspaceRequest,
} from "@/lib/payroll-workspace-context";
import { PayrollCloseForm } from "./close-form";
import { PayrollWorkspaceView } from "./payroll-workspace-view";

export const dynamic = "force-dynamic";

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const m = await requireRole(["owner", "accountant"]);
  // The url is normalised to exactly one spelling of this workspace state before anything is read —
  // a stale or hostile `?page=` can never be echoed back into a link. `redirect` throws, so nothing
  // below this line runs on the discarded spelling.
  const { context, redirectTo } = readPayrollWorkspaceRequest(await searchParams);
  if (redirectTo) redirect(redirectTo);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_payroll_workspace_snapshot", {
    p_org: m.orgId,
    p_limit: PAYROLL_WORKSPACE_PAGE_SIZE,
    p_offset: payrollWorkspaceOffset(context.page, PAYROLL_WORKSPACE_PAGE_SIZE),
  });
  // A read failure reaches the segment error boundary rather than rendering an empty workspace.
  if (error) throw error;
  const snapshot = parsePayrollWorkspaceSnapshot(data, {
    orgId: m.orgId,
    limit: PAYROLL_WORKSPACE_PAGE_SIZE,
    offset: payrollWorkspaceOffset(context.page, PAYROLL_WORKSPACE_PAGE_SIZE),
  });
  const pageCount = payrollPageCount(snapshot.counts.totalRuns, snapshot.limit);
  // A stale bookmark can point beyond the now-smaller exact run count. Canonicalize to the last real
  // page instead of showing an empty history while claiming closed runs exist.
  if (context.page > pageCount) {
    redirect(payrollWorkspaceHref({ page: pageCount }));
  }

  const todayIso = cairoTodayIso();
  return (
    <PayrollWorkspaceView
      snapshot={snapshot}
      context={context}
      canOpenAttendance={m.role === "owner"}
      closeForm={<PayrollCloseForm todayIso={todayIso} />}
    />
  );
}
