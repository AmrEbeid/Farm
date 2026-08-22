// SPEC-0032 marketing workspace — the legacy calculators, transcribed EXACTLY from the owner-supplied
// source HTML's own <script> functions (never executed — only the reviewed algebra is reimplemented
// here, unit-tested against hand-computed oracle values so it can't silently drift from the source).
//
// Two of the four `MarketingCalculatorId` slots the manifest declares (`campaign-funnel`,
// `availability-mix`) have NO matching formula anywhere in the source — there is no reply/qualify/
// offer-rate function, and no loss%/local-share% function. Rather than invent one, those two slots
// are filled with the real, closest source computation instead: `summarizeCampaignFunnel` reproduces
// `renderFunnelSummary()` (a literal count-by-registry table, not a rate), and
// `summarizeWeeklyAvailability` is a plain arithmetic total over the real `weekly_availability`
// register (the source has no percentage formula for this tab at all).
import type { MarketingCalculatorId } from "../fidelity-manifest";

/* ------------------------------------------------------------------ *
 * calculateExwNet — source function `calculateExwNet()` (EXW area, "حاسبة صافي EXW").
 * netQty = qty*(1-loss/100); revenue = netQty*price; costs = qty*(sort+pack+load); net = revenue-costs
 * ------------------------------------------------------------------ */
export interface ExwNetInput {
  qtyKg: number;
  pricePerKg: number;
  sortCostPerKg: number;
  packCostPerKg: number;
  loadCostPerKg: number;
  lossPct: number;
}

export interface ExwNetResult {
  netQtyKg: number;
  revenue: number;
  costs: number;
  net: number;
  netPerKg: number;
}

export function calculateExwNet(input: ExwNetInput): ExwNetResult {
  const loss = Math.min(100, Math.max(0, input.lossPct || 0));
  const netQtyKg = input.qtyKg * (1 - loss / 100);
  const revenue = netQtyKg * input.pricePerKg;
  const costs = input.qtyKg * (input.sortCostPerKg + input.packCostPerKg + input.loadCostPerKg);
  const net = revenue - costs;
  return { netQtyKg, revenue, costs, net, netPerKg: netQtyKg ? net / netQtyKg : 0 };
}

/* ------------------------------------------------------------------ *
 * calculateLandedCost — source function `logCalc()` (shipping/logistics area, "حاسبة تكلفة الشحن
 * والتعبئة + السعر المقترح للبيع"). Packing assumption from the source: 4.5kg net dates + 0.6kg
 * carton = 5.1kg gross chargeable weight per carton; EGP_PER_USD_LOG = 50.26 is the source's own
 * dated (16 Aug 2026) reference FX rate, not a live rate.
 * ------------------------------------------------------------------ */
export const LOGISTICS_NET_KG_PER_CARTON = 4.5;
export const LOGISTICS_GROSS_KG_PER_CARTON = 5.1;
export const LOGISTICS_EGP_PER_USD_REFERENCE = 50.26;

/** The 12 destinations + published air-freight $/kg rates, transcribed from the source's own
 *  `FREIGHT_RATES` constant (also `MARKETING_SOURCE_DATASETS.FREIGHT_RATES`, rows: 12). */
export const LOGISTICS_FREIGHT_RATES = [
  { label: "السعودية — جدة (JED)", rateUsdPerKg: 0.38 },
  { label: "السعودية — الرياض (RUH)", rateUsdPerKg: 0.4 },
  { label: "الكويت (KWI)", rateUsdPerKg: 0.6 },
  { label: "الصين — شنغهاي (PVG)", rateUsdPerKg: 0.7 },
  { label: "الإمارات — دبي (DWC)", rateUsdPerKg: 0.75 },
  { label: "الإمارات — دبي (DXB)", rateUsdPerKg: 0.8 },
  { label: "بلجيكا — بروكسل (BRU)", rateUsdPerKg: 1.1 },
  { label: "إيطاليا — روما FCO / ميلانو MXP", rateUsdPerKg: 1.2 },
  { label: "هولندا — أمستردام (AMS)", rateUsdPerKg: 1.4 },
  { label: "ألمانيا — فرانكفورت (FRA)", rateUsdPerKg: 1.5 },
  { label: "إسبانيا — مدريد (MAD)", rateUsdPerKg: 1.5 },
  { label: "فرنسا — باريس (CDG)", rateUsdPerKg: 1.6 },
] as const satisfies readonly { label: string; rateUsdPerKg: number }[];

export interface LandedCostInput {
  qtyKg: number;
  destinationRateUsdPerKg: number;
  cartonPriceEgp: number;
  packCostEgpPerCarton: number;
  /** Optional farm-gate production cost per kg — the source leaves this blank by default. */
  prodCostPerKgEgp?: number;
  marginPct: number;
  egpPerUsd?: number;
}

export interface LandedCostResult {
  cartons: number;
  grossWeightKg: number;
  freightUsd: number;
  freightEgp: number;
  cartonsTotalEgp: number;
  packTotalEgp: number;
  logisticsTotalEgp: number;
  logisticsPerKgEgp: number;
  fullPerKgEgp: number;
  suggestedPerKgEgp: number;
  suggestedTotalEgp: number;
}

export function calculateLandedCost(input: LandedCostInput): LandedCostResult {
  const egpPerUsd = input.egpPerUsd ?? LOGISTICS_EGP_PER_USD_REFERENCE;
  const cartons = Math.ceil(input.qtyKg / LOGISTICS_NET_KG_PER_CARTON);
  const grossWeightKg = cartons * LOGISTICS_GROSS_KG_PER_CARTON;
  const freightUsd = grossWeightKg * input.destinationRateUsdPerKg;
  const freightEgp = freightUsd * egpPerUsd;
  const cartonsTotalEgp = cartons * input.cartonPriceEgp;
  const packTotalEgp = cartons * input.packCostEgpPerCarton;
  const logisticsTotalEgp = freightEgp + cartonsTotalEgp + packTotalEgp;
  const logisticsPerKgEgp = input.qtyKg ? logisticsTotalEgp / input.qtyKg : 0;
  const fullPerKgEgp = logisticsPerKgEgp + (input.prodCostPerKgEgp ?? 0);
  const suggestedPerKgEgp = fullPerKgEgp * (1 + input.marginPct / 100);
  const suggestedTotalEgp = suggestedPerKgEgp * input.qtyKg;
  return {
    cartons,
    grossWeightKg,
    freightUsd,
    freightEgp,
    cartonsTotalEgp,
    packTotalEgp,
    logisticsTotalEgp,
    logisticsPerKgEgp,
    fullPerKgEgp,
    suggestedPerKgEgp,
    suggestedTotalEgp,
  };
}

/* ------------------------------------------------------------------ *
 * summarizeCampaignFunnel — source function `renderFunnelSummary()` (dailyreport/campaign area).
 * The source counts contacted-status rows per registry (not a percentage); labels are transcribed
 * verbatim in source order. The workspace supplies the counts from the real database registers
 * instead of the legacy localStorage-backed ones — same 8 rows, same order, same wording.
 * ------------------------------------------------------------------ */
export interface CampaignFunnelCounts {
  exportersContacted: number;
  directoryContacted: number;
  linkedinLeads: number;
  exwBids: number;
  brokersContacted: number;
  offshootLeads: number;
  localLeads: number;
  dailySalesReportDays: number;
}

export function summarizeCampaignFunnel(counts: CampaignFunnelCounts): { label: string; count: number }[] {
  return [
    { label: "الشركات المفلترة (75 جهة) — تم التواصل معها", count: counts.exportersContacted },
    { label: "القاعدة الكاملة (1513 جهة) — تم التواصل معها", count: counts.directoryContacted },
    { label: "عملاء LinkedIn المسجلون", count: counts.linkedinLeads },
    { label: "عروض EXW الموثقة", count: counts.exwBids },
    { label: "وسطاء التصدير — تم التواصل معهم", count: counts.brokersContacted },
    { label: "عملاء الفسائل", count: counts.offshootLeads },
    { label: "عملاء البيع المحلي", count: counts.localLeads },
    { label: "أيام تقرير المبيعات اليومي المسجلة", count: counts.dailySalesReportDays },
  ];
}

/* ------------------------------------------------------------------ *
 * summarizeWeeklyAvailability — the "availability-mix" calculator slot the manifest declares under
 * the farm area has NO source formula (no loss%/local-share% function exists anywhere in the
 * source's <script>). Rather than invent one, this is a plain, honest arithmetic total over the real
 * `weekly_availability` rows the operator has actually saved.
 * ------------------------------------------------------------------ */
export interface WeeklyAvailabilityRow {
  premiumTons: number;
  largeTons: number;
  commercialTons: number;
}

export interface WeeklyAvailabilitySummary {
  weeks: number;
  premiumTons: number;
  largeTons: number;
  commercialTons: number;
  totalTons: number;
}

export function summarizeWeeklyAvailability(rows: readonly WeeklyAvailabilityRow[]): WeeklyAvailabilitySummary {
  const premiumTons = rows.reduce((s, r) => s + (r.premiumTons || 0), 0);
  const largeTons = rows.reduce((s, r) => s + (r.largeTons || 0), 0);
  const commercialTons = rows.reduce((s, r) => s + (r.commercialTons || 0), 0);
  return { weeks: rows.length, premiumTons, largeTons, commercialTons, totalTons: premiumTons + largeTons + commercialTons };
}

export const MARKETING_CALCULATOR_IDS = [
  "exw-net",
  "landed-cost",
  "campaign-funnel",
  "availability-mix",
] as const satisfies readonly MarketingCalculatorId[];
