import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ExpenseKind, PnlSummary } from "@/lib/pnl";
import { AccountingView } from "@/components/AccountingView";

function toMoney(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function parsePnlSummary(value: unknown): PnlSummary {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const byCategory = Array.isArray(row.byCategory)
    ? row.byCategory.map((item) => {
        const category = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        return {
          category: typeof category.category === "string" && category.category ? category.category : "غير مصنّف",
          operating: toMoney(category.operating),
        };
      })
    : [];

  return {
    revenue: toMoney(row.revenue),
    operatingExpenses: toMoney(row.operatingExpenses),
    drawings: toMoney(row.drawings),
    capex: toMoney(row.capex),
    netOperating: toMoney(row.netOperating),
    byCategory,
  };
}

/**
 * Accounting / P&L (Stage 7 / SPEC-0004). Owner/accountant only (financial confidentiality). Computes
 * the operating P&L via the pure engine (lib/pnl.ts), which EXCLUDES owner drawings (مسحوبات) + capex
 * from the operating result (#6). SYNTHETIC framework — the authoritative P&L still depends on the gated
 * reconciliation against the real 7-yr Excel.
 */
export default async function AccountingPage() {
  const m = await requireRole(["owner", "accountant"]);
  const sb = await createClient();

  const [
    { data: summary, error: summaryError },
    { data: expenseRows, error: expensesError },
    { data: saleRows, error: salesError },
  ] = await Promise.all([
    sb.rpc("fn_accounting_pnl_summary", { p_org: m.orgId }),
    sb.from("expenses").select("id, category, total, kind, date").order("date", { ascending: false }).limit(200),
    sb.from("sales").select("id, crop, total, date").eq("archived", false).order("date", { ascending: false }).limit(200),
  ]);
  if (summaryError) {
    throw new Error("accounting summary query failed");
  }
  if (expensesError) {
    throw new Error("expenses query failed");
  }
  if (salesError) {
    throw new Error("sales query failed");
  }

  const pnl = parsePnlSummary(summary);

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
