import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import {
  EXPENSE_REGISTER_DISPLAY_CAP,
  currentMonthBounds,
  type ExpenseFilter,
} from "@/lib/expense-register-summary";
import { parseExpenseListContext } from "@/lib/expense-list-context";
import { parseExpenseDailySnapshot } from "@/lib/expense-daily-snapshot";
import { ExpenseListView } from "./expense-list-view";

export const dynamic = "force-dynamic";

export default async function ExpensesListPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  const m = await requireRole(["owner", "accountant", "farm_manager"]);
  const sb = await createClient();
  const context = parseExpenseListContext(await searchParams);
  const canSeeOwnerDrawings = m.role === "owner" || m.role === "accountant";
  const effectiveFilter: ExpenseFilter =
    !canSeeOwnerDrawings && context.filter === "drawing" ? "all" : context.filter;
  const { start: monthStart, end: monthEnd } = currentMonthBounds();

  const snapshotRes = await sb.rpc("fn_expense_daily_snapshot", {
    p_org: m.orgId,
    p_filter: effectiveFilter,
    p_month_start: monthStart,
    p_month_end: monthEnd,
    p_row_limit: EXPENSE_REGISTER_DISPLAY_CAP,
  });
  if (snapshotRes.error) throw snapshotRes.error;
  const snapshot = parseExpenseDailySnapshot(snapshotRes.data);
  if (
    snapshot.orgId !== m.orgId ||
    snapshot.filter !== effectiveFilter ||
    snapshot.monthStart !== monthStart ||
    snapshot.monthEnd !== monthEnd ||
    snapshot.rowLimit !== EXPENSE_REGISTER_DISPLAY_CAP
  ) {
    throw new Error("expense daily snapshot: response scope does not match the request");
  }

  return (
    <ExpenseListView
      snapshot={snapshot}
      context={{ ...context, filter: effectiveFilter }}
      canSeeOwnerDrawings={canSeeOwnerDrawings}
      canWrite={m.role === "owner" || m.role === "accountant"}
    />
  );
}
