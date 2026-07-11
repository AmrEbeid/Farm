// Per-entity (sector / enterprise-crop) P&L attribution from the cost-center rollup + sales — the ONE place
// this subtle logic lives (it produced three review-caught bugs while duplicated inside page components).
//
// The invariant everything rests on: revenue is NOT posted to cost-center journal lines — it is a reporting
// dimension on `sales`, tagged to an active LEAF center (fn_save_sale). So `v_cost_center_rollup.net` is a
// center's EXPENSES only, and for a LEAF center net = its own expenses (subtree = self). Therefore:
//   sector profit     = Σ finalized sales.total by leaf center − that leaf's rollup net
//   enterprise (crop) = group leaf expenses (net) + sales revenue (via center→enterprise) by `enterprise`
// Untagged cost = CC-UNALLOC's DEBIT (never its `net` — net = debit − credit and every revenue credit is
// null-center → lands in CC-UNALLOC, so its net is contaminated by ALL farm revenue). Untagged revenue/expense
// are returned as honest «غير موزّع» buckets, never spread onto an entity (#1). Drawings never enter (equity,
// excluded from the view's expense/revenue account filter).

import type { CostCenterInsightRollup } from "./finance-insights";
import type { CenterPerf, EnterprisePerf } from "./pnl-insights";

export interface SaleLite {
  cost_center_id: string | null;
  total: number | null;
  price_status: string;
}

export interface SectorPnl {
  sectors: CenterPerf[]; // leaf centers with area; `net` = real profit (revenue − expenses)
  unallocRevenue: number; // finalized revenue not on a scorecard sector
  unallocExpense: number; // untagged expense: CC-UNALLOC debit + leaf centers that aren't reported sectors (#759)
}

export interface EnterprisePnl {
  enterprises: EnterprisePerf[]; // grouped by enterprise label; revenue & expenses
  unallocRevenue: number;
  unallocExpense: number;
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};

function leafPredicate(rollup: CostCenterInsightRollup[]) {
  const parentIds = new Set(rollup.map((r) => r.parent_id).filter(Boolean) as string[]);
  return (r: CostCenterInsightRollup) => r.active && !r.is_system && !parentIds.has(r.cost_center_id);
}

const ccUnallocDebit = (rollup: CostCenterInsightRollup[]): number =>
  num(rollup.find((r) => r.code === "CC-UNALLOC")?.debit);

/** Per-sector P&L: profit = leaf-tagged sales revenue − the leaf sector's own expenses (rollup net). */
export function computeSectorPnl(rollup: CostCenterInsightRollup[], finalizedSales: SaleLite[]): SectorPnl {
  const isLeaf = leafPredicate(rollup);
  const sectorRows = rollup.filter((r) => isLeaf(r) && (r.area_feddan ?? 0) > 0);
  const sectorIds = new Set(sectorRows.map((r) => r.cost_center_id));

  const revenueByCenter = new Map<string, number>();
  let unallocRevenue = 0;
  for (const s of finalizedSales) {
    const v = num(s.total);
    if (s.cost_center_id && sectorIds.has(s.cost_center_id)) {
      revenueByCenter.set(s.cost_center_id, (revenueByCenter.get(s.cost_center_id) ?? 0) + v);
    } else {
      unallocRevenue += v;
    }
  }

  const sectors: CenterPerf[] = sectorRows.map((r) => ({
    id: r.cost_center_id,
    name: r.name_ar,
    net: (revenueByCenter.get(r.cost_center_id) ?? 0) - num(r.net),
    areaFeddan: num(r.area_feddan),
  }));

  // Untagged expense = CC-UNALLOC's debit PLUS every leaf center that is NOT a reported sector — i.e. a leaf
  // with no area (e.g. a general «عام» center carrying real cost). Mirrors computeEnterprisePnl so EVERY leaf
  // expense lands somewhere and sector-vs-total reconciles/foots; without this such a center's cost was counted
  // NOWHERE and the «مصروفات غير موزّعة» banner understated (#759). isLeaf excludes CC-UNALLOC (is_system) and
  // parents, so there is no double-count of ccUnallocDebit.
  let unallocExpense = ccUnallocDebit(rollup);
  for (const r of rollup) {
    if (!isLeaf(r) || sectorIds.has(r.cost_center_id)) continue;
    unallocExpense += num(r.net);
  }

  return { sectors, unallocRevenue, unallocExpense };
}

/** Per-enterprise (crop) P&L: expenses = Σ leaf net by enterprise; revenue = finalized sales via center→enterprise. */
export function computeEnterprisePnl(rollup: CostCenterInsightRollup[], finalizedSales: SaleLite[]): EnterprisePnl {
  const isLeaf = leafPredicate(rollup);
  const centerEnterprise = new Map<string, string>();
  for (const r of rollup) {
    if (isLeaf(r) && r.enterprise) centerEnterprise.set(r.cost_center_id, r.enterprise);
  }

  const expByEnt = new Map<string, number>();
  let unallocExpense = ccUnallocDebit(rollup);
  for (const r of rollup) {
    if (!isLeaf(r)) continue;
    if (r.enterprise) expByEnt.set(r.enterprise, (expByEnt.get(r.enterprise) ?? 0) + num(r.net));
    else unallocExpense += num(r.net); // a leaf center with no enterprise label → untagged-to-crop cost
  }

  const revByEnt = new Map<string, number>();
  let unallocRevenue = 0;
  for (const s of finalizedSales) {
    const v = num(s.total);
    const ent = s.cost_center_id ? centerEnterprise.get(s.cost_center_id) : undefined;
    if (ent) revByEnt.set(ent, (revByEnt.get(ent) ?? 0) + v);
    else unallocRevenue += v;
  }

  const keys = [...new Set([...expByEnt.keys(), ...revByEnt.keys()])];
  const enterprises: EnterprisePerf[] = keys.map((key) => ({
    key,
    revenue: revByEnt.get(key) ?? 0,
    expenses: expByEnt.get(key) ?? 0,
  }));

  return { enterprises, unallocRevenue, unallocExpense };
}
