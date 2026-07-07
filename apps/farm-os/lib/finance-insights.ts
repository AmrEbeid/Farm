import { egp, num } from "./money";

export type CostCenterInsightRollup = {
  cost_center_id: string;
  parent_id: string | null;
  code: string;
  name_ar: string;
  enterprise: string | null;
  area_feddan: number | null;
  active: boolean;
  is_system: boolean;
  debit: number;
  credit: number;
  net: number;
  net_per_feddan: number | null;
};

export type CostCenterInsightFlag = {
  cost_center_id: string;
  flag_code: string;
  message_ar: string;
};

export type FinanceInsightTone = "ok" | "warning" | "danger";

export type FinanceInsightCard = {
  id: string;
  title: string;
  value: string;
  description: string;
  tone: FinanceInsightTone;
  href: string;
};

export type CenterEconomicsInsight = {
  id: string;
  code: string;
  name: string;
  enterprise: string;
  areaFeddan: number | null;
  expense: number;
  revenue: number;
  net: number;
  netPerFeddan: number | null;
};

export type FinanceInsightSummary = {
  activeCenterCount: number;
  postedCenterCount: number;
  flagCount: number;
  totalExpense: number;
  totalRevenue: number;
  operatingNet: number;
  unallocatedCost: number;
  centerRows: CenterEconomicsInsight[];
  topExpenseCenters: CenterEconomicsInsight[];
  topPerFeddanCenters: CenterEconomicsInsight[];
  cards: FinanceInsightCard[];
  score: {
    label: string;
    tone: FinanceInsightTone;
    message: string;
  };
};

export function buildFinanceInsightSummary({
  rollup,
  flags,
}: {
  rollup: CostCenterInsightRollup[];
  flags: CostCenterInsightFlag[];
}): FinanceInsightSummary {
  const childParentIds = new Set(rollup.flatMap((row) => (row.parent_id ? [row.parent_id] : [])));
  const leafRows = rollup.filter((row) => row.code === "CC-UNALLOC" || !childParentIds.has(row.cost_center_id));
  const centerRows = leafRows
    .filter((row) => !row.is_system)
    .map((row) => toCenterEconomics(row))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const unallocated = rollup.find((row) => row.code === "CC-UNALLOC");
  const totalExpense = leafRows.reduce((sum, row) => sum + Number(row.debit ?? 0), 0);
  const totalRevenue = leafRows.reduce((sum, row) => sum + Number(row.credit ?? 0), 0);
  const operatingNet = totalRevenue - totalExpense;
  const unallocatedCost = Number(unallocated?.debit ?? 0); // untagged EXPENSE (.net is revenue-contaminated — see entity-pnl contract)
  const activeCenterCount = rollup.filter((row) => row.active && !row.is_system).length;
  const postedCenterCount = centerRows.filter((row) => row.expense !== 0 || row.revenue !== 0 || row.net !== 0).length;
  const topExpenseCenters = [...centerRows].filter((row) => row.expense > 0).sort((a, b) => b.expense - a.expense).slice(0, 5);
  const topPerFeddanCenters = [...centerRows]
    .filter((row) => row.netPerFeddan != null)
    .sort((a, b) => Number(b.netPerFeddan ?? 0) - Number(a.netPerFeddan ?? 0))
    .slice(0, 5);

  const cards = buildCards({
    flagCount: flags.length,
    unallocatedCost,
    topExpenseCenter: topExpenseCenters[0],
    topPerFeddanCenter: topPerFeddanCenters[0],
    totalRevenue,
  });
  const score = buildScore(flags.length, unallocatedCost);

  return {
    activeCenterCount,
    postedCenterCount,
    flagCount: flags.length,
    totalExpense,
    totalRevenue,
    operatingNet,
    unallocatedCost,
    centerRows,
    topExpenseCenters,
    topPerFeddanCenters,
    cards,
    score,
  };
}

function toCenterEconomics(row: CostCenterInsightRollup): CenterEconomicsInsight {
  return {
    id: row.cost_center_id,
    code: row.code,
    name: row.name_ar,
    enterprise: row.enterprise ?? "غير متوفر",
    areaFeddan: row.area_feddan,
    expense: Number(row.debit ?? 0),
    revenue: Number(row.credit ?? 0),
    net: Number(row.net ?? 0),
    netPerFeddan: row.net_per_feddan == null ? null : Number(row.net_per_feddan),
  };
}

function buildCards({
  flagCount,
  unallocatedCost,
  topExpenseCenter,
  topPerFeddanCenter,
  totalRevenue,
}: {
  flagCount: number;
  unallocatedCost: number;
  topExpenseCenter: CenterEconomicsInsight | undefined;
  topPerFeddanCenter: CenterEconomicsInsight | undefined;
  totalRevenue: number;
}): FinanceInsightCard[] {
  const cards: FinanceInsightCard[] = [];
  if (flagCount > 0) {
    cards.push({
      id: "flags",
      title: "مراجعة الربط",
      value: num(flagCount),
      description: "توجد مراكز تكلفة تحتاج ربط قطاع أو مراجعة مساحة قبل الاعتماد الكامل للتقارير.",
      tone: "warning",
      href: "/finance/reports?focus=flags",
    });
  }
  if (Math.abs(unallocatedCost) > 0) {
    cards.push({
      id: "unallocated",
      title: "مصروفات غير موزّعة",
      value: egp(unallocatedCost),
      description: "يوجد أثر مالي على مركز غير موزع؛ يحتاج المحاسب لتحديد مركز التكلفة الصحيح.",
      tone: "warning",
      href: "/finance/reports?center=CC-UNALLOC",
    });
  }
  if (topExpenseCenter) {
    cards.push({
      id: "top-expense",
      title: "أكبر مركز تكلفة",
      value: topExpenseCenter.name,
      description: "هذا المركز يحمل أعلى مصروفات مرحّلة ضمن مراكز التكلفة الحالية.",
      tone: "ok",
      href: "/finance/reports?focus=posted",
    });
  }
  if (topPerFeddanCenter) {
    cards.push({
      id: "per-feddan",
      title: "أعلى صافي/فدان",
      value: topPerFeddanCenter.name,
      description: "هذا المركز يحتاج متابعة تكلفة لكل فدان مقارنة بباقي المراكز ذات المساحة المسجلة.",
      tone: "warning",
      href: "/finance/reports?focus=posted",
    });
  }
  if (totalRevenue === 0) {
    cards.push({
      id: "revenue-pending",
      title: "الإيرادات",
      value: "غير مفعلة",
      description: "تحليل الهوامش ومزيج الإيراد ينتظر S-10 حتى لا يظهر أي رقم إيراد مفترض.",
      tone: "ok",
      href: "/finance/reports",
    });
  }
  return cards.slice(0, 5);
}

function buildScore(flagCount: number, unallocatedCost: number): FinanceInsightSummary["score"] {
  if (flagCount > 0 || Math.abs(unallocatedCost) > 0) {
    return {
      label: "مختلط",
      tone: "warning",
      message: "التقارير تعمل من القيود المرحّلة، لكن توجد بنود مراجعة قبل الاعتماد الكامل على التوزيع.",
    };
  }
  return {
    label: "جيد",
    tone: "ok",
    message: "لا توجد بنود مراجعة ظاهرة في مراكز التكلفة الحالية.",
  };
}
