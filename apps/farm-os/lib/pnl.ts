// Stage 7 (SPEC-0004 §3) — P&L aggregation engine. PURE + figure-free: it aggregates whatever entries
// it's given, so it never fabricates a number (non-negotiable #1) and carries no real financials itself.
// It enforces non-negotiable #6 STRUCTURALLY: owner drawings (مسحوبات) and capex are classified by
// `kind` and EXCLUDED from operating expenses and the operating P&L — never silently mixed in.
//
// The gated remainder (NOT here): the transactional voucher-posting RPC + the REQUIRED independent
// review, and the **finance oracle** — the dual-run reconciliation of one closed season against the
// real 7-yr Excel (real financials → Stage M / privacy review).

export type ExpenseKind = "operating" | "drawing" | "capex";

export interface ExpenseEntry {
  category: string;
  amount: number;
  kind: ExpenseKind;
}

export interface SaleEntry {
  amount: number;
  crop?: string;
}

export interface CategoryTotal {
  category: string;
  operating: number;
}

export interface PnlSummary {
  revenue: number;
  operatingExpenses: number; // operating only — the P&L cost base
  drawings: number; // مسحوبات — reported separately, EXCLUDED from opex + net (#6)
  capex: number; // capital — excluded from the operating P&L too
  netOperating: number; // revenue − operatingExpenses
  byCategory: CategoryTotal[]; // operating expenses by category (sorted)
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const valid = (a: unknown): a is number => typeof a === "number" && Number.isFinite(a) && a >= 0;

/**
 * Compute the operating P&L: revenue − operating expenses. Drawings (مسحوبات) and capex are summed
 * separately and NEVER counted as operating expense or netted into the result (#6). Invalid/negative
 * amounts are ignored (no fabrication, #1). Deterministic: category order is stable (sorted).
 */
export function computePnl(expenses: ExpenseEntry[], sales: SaleEntry[]): PnlSummary {
  const opByCategory = new Map<string, number>();
  let operatingExpenses = 0;
  let drawings = 0;
  let capex = 0;

  for (const e of expenses) {
    if (!e || !valid(e.amount)) continue;
    if (e.kind === "drawing") {
      drawings += e.amount;
    } else if (e.kind === "capex") {
      capex += e.amount;
    } else {
      // operating (the only kind that hits the P&L)
      operatingExpenses += e.amount;
      const cat = typeof e.category === "string" && e.category ? e.category : "غير مصنّف";
      opByCategory.set(cat, (opByCategory.get(cat) ?? 0) + e.amount);
    }
  }

  let revenue = 0;
  for (const s of sales) {
    if (s && valid(s.amount)) revenue += s.amount;
  }

  const byCategory: CategoryTotal[] = [...opByCategory.keys()]
    .sort()
    .map((category) => ({ category, operating: r2(opByCategory.get(category)!) }));

  operatingExpenses = r2(operatingExpenses);
  revenue = r2(revenue);

  return {
    revenue,
    operatingExpenses,
    drawings: r2(drawings),
    capex: r2(capex),
    netOperating: r2(revenue - operatingExpenses),
    byCategory,
  };
}
