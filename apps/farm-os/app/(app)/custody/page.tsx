import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { currentMonthBounds } from "@/lib/expense-register-summary";
import { parseCustodyDailySnapshot } from "@/lib/custody-daily-snapshot";
import { parseCustodyListContext } from "@/lib/custody-workspace";
import { CustodyWorkspaceView } from "./custody-workspace-view";

const MOVEMENT_DISPLAY_CAP = 15;
const REQUEST_DISPLAY_CAP = 200;

// SPEC-0018 / SPEC-0033 R4f — one exact, bounded finance workspace snapshot.
export default async function CustodyDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ requests?: string; q?: string }>;
}) {
  const member = await requireRole(["owner", "accountant"]);
  const context = parseCustodyListContext(await searchParams);
  const monthBounds = currentMonthBounds();
  const sb = await createClient();
  const snapshotRes = await sb.rpc("fn_custody_daily_snapshot", {
    p_org: member.orgId,
    p_request_filter: context.requestFilter,
    p_month_start: monthBounds.start,
    p_month_end: monthBounds.end,
    p_movement_limit: MOVEMENT_DISPLAY_CAP,
    p_request_limit: REQUEST_DISPLAY_CAP,
  });
  if (snapshotRes.error) throw snapshotRes.error;
  const snapshot = parseCustodyDailySnapshot(snapshotRes.data);
  if (
    snapshot.orgId !== member.orgId
    || snapshot.requestFilter !== context.requestFilter
    || snapshot.movementLimit !== MOVEMENT_DISPLAY_CAP
    || snapshot.requestLimit !== REQUEST_DISPLAY_CAP
  ) {
    throw new Error("custody daily snapshot: response scope does not match the request");
  }
  return <CustodyWorkspaceView snapshot={snapshot} context={context} />;
}
