import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { computePnl, type ExpenseEntry, type ExpenseKind } from "@/lib/pnl";
import { AccountingView } from "@/components/AccountingView";

/**
 * Accounting / P&L (Stage 7 / SPEC-0004). Owner/accountant only (financial confidentiality). Computes
 * the operating P&L via the pure engine (lib/pnl.ts), which EXCLUDES owner drawings (مسحوبات) + capex
 * from the operating result (#6). SYNTHETIC framework — the authoritative P&L still depends on the gated
 * reconciliation against the real 7-yr Excel.
 */
export default async function AccountingPage() {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();

  const [{ data: expenseRows, error: expensesError }, { data: saleRows, error: salesError }] = await Promise.all([
    sb.from("expenses").select("id, category, total, kind, date").order("date", { ascending: false }).limit(200),
    sb.from("sales").select("id, crop, total, date").eq("archived", false).order("date", { ascending: false }).limit(200),
  ]);
  if (expensesError) {
    throw new Error("expenses query failed");
  }
  if (salesError) {
    throw new Error("sales query failed");
  }

  const expenses: ExpenseEntry[] = (expenseRows ?? []).map((e) => ({
    category: e.category ?? "",
    amount: Number(e.total ?? 0),
    kind: (e.kind as ExpenseKind) ?? "operating",
  }));
  const sales = (saleRows ?? []).map((s) => ({ amount: Number(s.total ?? 0), crop: s.crop ?? undefined }));

  const pnl = computePnl(expenses, sales);

  return (
    <AccountingView
      orgId={m.orgId}
      pnl={pnl}
      expenses={(expenseRows ?? []).map((e) => ({
        id: e.id,
        category: e.category ?? "—",
        total: Number(e.total ?? 0),
        kind: (e.kind as ExpenseKind) ?? "operating",
      }))}
      sales={(saleRows ?? []).map((s) => ({
        id: s.id,
        crop: s.crop ?? "—",
        total: Number(s.total ?? 0),
        date: s.date,
      }))}
    />
  );
}
