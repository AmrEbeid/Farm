import { egp, pct } from "@/lib/money";

export interface PlanCostInput {
  est_cost: number | string | null | undefined;
  status?: string | null;
  subtype?: string | null;
}

export interface PlannedCostSummary {
  knownCost: number;
  unknownCostCount: number;
  hasUnknownCost: boolean;
}

/**
 * subtype → budget_lines.category. Only fertilization and irrigation have a dedicated
 * category configured today (أسمدة / ري ووقود — supabase/seed.sql); the operation-vocabulary
 * expansion (pruning, offshoots, pollination, bunch work, harvest, pest scouting, …) added
 * ~10 subtypes that had NO budget check at all before (the check was hardcoded to
 * subtype === "fertilization"). Rather than invent per-subtype categories the Owner/finance
 * hasn't defined, unmapped subtypes roll up into GENERAL_OPS_BUDGET_CATEGORY so every
 * operation contributes to SOME budget signal instead of silently counting as free.
 */
export const SUBTYPE_BUDGET_CATEGORY: Record<string, string> = {
  fertilization: "أسمدة",
  irrigation: "ري ووقود",
};

export const GENERAL_OPS_BUDGET_CATEGORY = "عمليات أخرى";

export function budgetCategoryForSubtype(subtype: string | null | undefined): string {
  return (subtype && SUBTYPE_BUDGET_CATEGORY[subtype]) || GENERAL_OPS_BUDGET_CATEGORY;
}

function addCost(summary: PlannedCostSummary, estCost: PlanCostInput["est_cost"]): PlannedCostSummary {
  if (estCost == null) {
    return { ...summary, unknownCostCount: summary.unknownCostCount + 1, hasUnknownCost: true };
  }
  const cost = Number(estCost);
  if (!Number.isFinite(cost)) {
    return { ...summary, unknownCostCount: summary.unknownCostCount + 1, hasUnknownCost: true };
  }
  return { ...summary, knownCost: summary.knownCost + cost };
}

/**
 * Sum planned-status operation costs GROUPED by the budget category their subtype maps to
 * (budgetCategoryForSubtype). Generalizes the old fertilization-only check to every operation
 * type, so a plan full of pruning/harvest/pollination ops gets a real budget signal instead of
 * contributing nothing.
 */
export function summarizePlannedCostByCategory(ops: PlanCostInput[]): Map<string, PlannedCostSummary> {
  const byCategory = new Map<string, PlannedCostSummary>();
  for (const op of ops) {
    if (op.status !== "planned") continue;
    const category = budgetCategoryForSubtype(op.subtype);
    const prev = byCategory.get(category) ?? { knownCost: 0, unknownCostCount: 0, hasUnknownCost: false };
    byCategory.set(category, addCost(prev, op.est_cost));
  }
  return byCategory;
}

/**
 * @deprecated single-category (أسمدة) shim kept for back-compat call sites and their existing
 * tests. New code should use summarizePlannedCostByCategory, which covers every subtype.
 */
export function summarizePlannedFertilizationCost(ops: PlanCostInput[]): PlannedCostSummary {
  const fertilizationOps = ops.filter((op) => op.subtype === "fertilization");
  return (
    summarizePlannedCostByCategory(fertilizationOps).get("أسمدة") ?? {
      knownCost: 0,
      unknownCostCount: 0,
      hasUnknownCost: false,
    }
  );
}

export function budgetCheckResultForKnownCost(
  available: number,
  knownCost: number,
  hasUnknownCost: boolean,
): "ok" | "warn" | "block" {
  const after = available - knownCost;
  if (after < 0) return "block";
  if (hasUnknownCost) return "warn";
  return after < available * 0.2 ? "warn" : "ok";
}

/** Worst-of verdict across several per-category checks — block > warn > ok. */
export function worstBudgetVerdict(results: Array<"ok" | "warn" | "block">): "ok" | "warn" | "block" {
  if (results.includes("block")) return "block";
  if (results.includes("warn")) return "warn";
  return "ok";
}

export interface BudgetLineRow {
  budget_id?: string | null;
  category?: string | null;
  planned?: number | string | null;
  approved?: number | string | null;
  committed?: number | string | null;
  actual?: number | string | null;
  lineCount?: number;
  budgetScopeCount?: number;
  hasMultipleBudgetScopes?: boolean;
  maxPlanned?: number;
  maxApproved?: number;
  maxCommitted?: number;
  maxActual?: number;
}

export interface BudgetLineAggregate extends BudgetLineRow {
  lineCount: number;
  budgetScopeCount: number;
  hasMultipleBudgetScopes: boolean;
  maxPlanned: number;
  maxApproved: number;
  maxCommitted: number;
  maxActual: number;
}

export function aggregateBudgetLinesByCategory(lines: BudgetLineRow[]): Map<string, BudgetLineAggregate> {
  const byCategory = new Map<string, BudgetLineAggregate>();
  const budgetIdsByCategory = new Map<string, Set<string>>();
  for (const line of lines) {
    const category = line.category;
    if (!category) continue;
    const planned = Number(line.planned ?? 0);
    const approved = Number(line.approved ?? 0);
    const committed = Number(line.committed ?? 0);
    const actual = Number(line.actual ?? 0);
    const prev = byCategory.get(category) ?? {
      category,
      planned: 0,
      approved: 0,
      committed: 0,
      actual: 0,
      lineCount: 0,
      budgetScopeCount: 0,
      hasMultipleBudgetScopes: false,
      maxPlanned: 0,
      maxApproved: 0,
      maxCommitted: 0,
      maxActual: 0,
    };
    const budgetIds = budgetIdsByCategory.get(category) ?? new Set<string>();
    if (line.budget_id) budgetIds.add(line.budget_id);
    budgetIdsByCategory.set(category, budgetIds);
    const lineCount = prev.lineCount + 1;
    // If the query did not select budget_id, duplicate rows are still ambiguous scopes.
    const budgetScopeCount = budgetIds.size || lineCount;
    byCategory.set(category, {
      category,
      planned: Number(prev.planned ?? 0) + planned,
      approved: Number(prev.approved ?? 0) + approved,
      committed: Number(prev.committed ?? 0) + committed,
      actual: Number(prev.actual ?? 0) + actual,
      lineCount,
      budgetScopeCount,
      hasMultipleBudgetScopes: budgetScopeCount > 1,
      maxPlanned: Math.max(prev.maxPlanned, planned),
      maxApproved: Math.max(prev.maxApproved, approved),
      maxCommitted: Math.max(prev.maxCommitted, committed),
      maxActual: Math.max(prev.maxActual, actual),
    });
  }
  return byCategory;
}

export type BudgetActualSource = "live" | "static" | "unavailable";
export type BudgetCommittedSource = "live" | "static";

export interface BudgetStateBasis {
  actual?: number | string | null;
  actualSource?: BudgetActualSource;
  committedSource?: BudgetCommittedSource;
}

export interface CategoryBudgetView {
  category: string;
  planned: number;
  approved: number;
  committed: number;
  budgetLineCount: number;
  budgetScopeCount: number;
  hasMultipleBudgetScopes: boolean;
  committedSource: BudgetCommittedSource;
  actual: number | null;
  actualSource: BudgetActualSource;
  available: number;
  thisOp: number;
  after: number;
  utilization: number;
  utilizationAfter: number;
  verdict: "block" | "approval-needed" | "ok";
  hasUnknownCost: boolean;
  unknownCostCount: number;
  needsFinanceReview: boolean;
}

/**
 * Build the richer PR-approval-routing view (ok/approval-needed/block — distinct from the
 * plan_checks ok/warn/block vocabulary) used by /budget/[planId]/check. A missing budget_lines
 * row is shown as planned=approved=committed=actual=0, but it is not treated as an explicit
 * zero-approved ceiling; costed work with no configured line needs finance review instead. When
 * several budget scopes are returned for one category, the hard-block ceiling uses the highest
 * single approved candidate, not the sum, so duplicate periods/budgets cannot dilute a block.
 *
 * Until Decision-0157 lands a canonical plan→budget scope and live committed/actual basis, plan
 * budget checks must not claim a clean green pass from frozen budget_lines.committed/actual values.
 * The safe current behaviour is: hard-block only when this plan's own known cost exceeds the
 * approved ceiling by itself; otherwise require finance review for costed operations.
 */
export function buildCategoryBudgetView(
  category: string,
  line: BudgetLineRow | null | undefined,
  costSummary: PlannedCostSummary,
  basis: BudgetStateBasis = {},
): CategoryBudgetView {
  const hasMultipleBudgetScopes = Boolean(line?.hasMultipleBudgetScopes);
  const budgetLineCount = line?.lineCount ?? (line ? 1 : 0);
  const budgetScopeCount = line?.budgetScopeCount ?? (line ? 1 : 0);
  const planned = Number(hasMultipleBudgetScopes ? (line?.maxPlanned ?? 0) : (line?.planned ?? 0));
  const approved = Number(hasMultipleBudgetScopes ? (line?.maxApproved ?? 0) : (line?.approved ?? 0));
  const hasApprovedCeiling = line?.approved != null;
  const committed = Number(hasMultipleBudgetScopes ? (line?.maxCommitted ?? 0) : (line?.committed ?? 0));
  const committedSource = basis.committedSource ?? "static";
  const actualSource = basis.actualSource ?? "static";
  const actual =
    actualSource === "unavailable"
      ? null
      : Number(actualSource === "live" ? (basis.actual ?? 0) : (hasMultipleBudgetScopes ? (line?.maxActual ?? 0) : (line?.actual ?? 0)));
  const actualForMath = actual ?? 0;
  const committedForMath = committedSource === "live" ? committed : 0;
  const available = approved - committedForMath - actualForMath;
  const thisOp = costSummary.knownCost;
  const after = available - thisOp;
  const utilization = approved > 0 ? Math.round(((committedForMath + actualForMath) / approved) * 100) : 0;
  // Utilization AFTER committing this category's planned cost — the same "would this push us
  // past the comfort threshold" question the old أسمدة-only page asked, now per category.
  const utilizationAfter =
    approved > 0 ? Math.round(((committedForMath + thisOp + actualForMath) / approved) * 100) : 0;
  const needsFinanceReview =
    thisOp > 0 && (actualSource !== "live" || committedSource !== "live");
  const verdict: CategoryBudgetView["verdict"] =
    hasApprovedCeiling && after < 0
      ? "block"
      : costSummary.hasUnknownCost || needsFinanceReview || utilizationAfter > 90
        ? "approval-needed"
        : "ok";

  return {
    category,
    planned,
    approved,
    committed,
    budgetLineCount,
    budgetScopeCount,
    hasMultipleBudgetScopes,
    committedSource,
    actual,
    actualSource,
    available,
    thisOp,
    after,
    utilization,
    utilizationAfter,
    verdict,
    hasUnknownCost: costSummary.hasUnknownCost,
    unknownCostCount: costSummary.unknownCostCount,
    needsFinanceReview,
  };
}

/** Arabic verdict text for a single category's view — mirrors the wording the أسمدة-only page
 * used, generalized to name the actual category instead of assuming fertilizer. */
export function budgetVerdictTextAr(v: CategoryBudgetView): string {
  if (v.verdict === "block") {
    return `⛔ تجاوز للموازنة: المتاح ${egp(v.available)} لا يغطي ${egp(v.thisOp)} — يتطلب اعتماد المالك.`;
  }
  if (v.hasUnknownCost) {
    return `⚠️ توجد ${v.unknownCostCount} عملية (بند ${v.category}) بلا تكلفة تقديرية — لا يمكن اعتبارها مجانية، ويتطلب ذلك مراجعة المالك/المحاسب.`;
  }
  if (v.needsFinanceReview) {
    return `⚠️ فحص بند ${v.category} يحتاج مراجعة مالية لأن الالتزامات الحية غير مربوطة هنا بعد.`;
  }
  if (v.verdict === "approval-needed") {
    return `⚠️ الموازنة منخفضة (${pct(v.utilizationAfter)} بعد هذه العملية) — يتطلب اعتماد المالك.`;
  }
  return `✓ الموازنة كافية: سيتبقى ${egp(v.after)}.`;
}

/** Arabic PR-routing text for a single category's view. */
export function budgetRoutingTextAr(v: CategoryBudgetView): string {
  if (v.verdict === "block") {
    return `تتجاوز هذه العملية حدود بند ${v.category}، لذا يجب توجيه طلب الشراء إلى المالك للاعتماد (فصل الواجبات: لا يعتمد مقدّم الطلب طلبه).`;
  }
  if (v.needsFinanceReview) {
    return `لا يمكن اعتبار فحص بند ${v.category} تمريرًا نهائيًا لأن الالتزامات/الفعلي الحي غير مثبتين في بوابة الخطة بعد، لذلك يجب مراجعة الطلب قبل الاعتماد.`;
  }
  return v.hasUnknownCost
    ? `لا يمكن تأكيد كفاية الموازنة لأن تكلفة بعض عمليات بند ${v.category} غير معروفة، لذلك يجب مراجعة الطلب قبل الاعتماد.`
    : `تحتاج موازنة بند ${v.category} إلى مراجعة قبل الاعتماد.`;
}
