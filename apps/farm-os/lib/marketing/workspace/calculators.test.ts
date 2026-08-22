import { describe, expect, it } from "vitest";
import {
  calculateExwNet,
  calculateLandedCost,
  LOGISTICS_EGP_PER_USD_REFERENCE,
  LOGISTICS_FREIGHT_RATES,
  summarizeCampaignFunnel,
  summarizeWeeklyAvailability,
} from "./calculators";

describe("calculateExwNet — oracle-matches the source's calculateExwNet()", () => {
  // Source (transcribed, reviewed):
  //   netQty=qty*(1-loss/100); revenue=netQty*price; costs=qty*(sort+pack+ld); net=revenue-costs
  it("matches the exact source algebra for a representative input", () => {
    const r = calculateExwNet({ qtyKg: 1000, pricePerKg: 20, sortCostPerKg: 0.5, packCostPerKg: 0.3, loadCostPerKg: 0.2, lossPct: 2 });
    // netQty = 1000*0.98 = 980
    expect(r.netQtyKg).toBeCloseTo(980, 6);
    // revenue = 980*20 = 19600
    expect(r.revenue).toBeCloseTo(19600, 6);
    // costs = 1000*(0.5+0.3+0.2) = 1000
    expect(r.costs).toBeCloseTo(1000, 6);
    // net = 19600-1000 = 18600
    expect(r.net).toBeCloseTo(18600, 6);
    // per kg net = 18600/980
    expect(r.netPerKg).toBeCloseTo(18600 / 980, 6);
  });

  it("clamps loss% to [0,100] exactly like the source's Math.min(100,Math.max(0,...))", () => {
    expect(calculateExwNet({ qtyKg: 100, pricePerKg: 10, sortCostPerKg: 0, packCostPerKg: 0, loadCostPerKg: 0, lossPct: 150 }).netQtyKg).toBe(0);
    expect(calculateExwNet({ qtyKg: 100, pricePerKg: 10, sortCostPerKg: 0, packCostPerKg: 0, loadCostPerKg: 0, lossPct: -20 }).netQtyKg).toBe(100);
  });

  it("costs are charged on the GROSS qty, not the net qty, exactly like the source (`costs=qty*(...)`)", () => {
    const r = calculateExwNet({ qtyKg: 1000, pricePerKg: 10, sortCostPerKg: 1, packCostPerKg: 0, loadCostPerKg: 0, lossPct: 50 });
    expect(r.costs).toBe(1000); // NOT 500 — a common invented-formula mistake this guards against
  });

  it("returns 0 per-kg (not NaN/Infinity) when net qty is 0", () => {
    expect(calculateExwNet({ qtyKg: 100, pricePerKg: 10, sortCostPerKg: 0, packCostPerKg: 0, loadCostPerKg: 0, lossPct: 100 }).netPerKg).toBe(0);
  });
});

describe("calculateLandedCost — oracle-matches the source's logCalc()", () => {
  // Source (transcribed, reviewed): cartons=ceil(qty/4.5); grossWeight=cartons*5.1;
  // freightUSD=grossWeight*rate; freightEGP=freightUSD*EGP_PER_USD_LOG(50.26);
  // logisticsTotal=freightEGP+cartons*cartonPrice+cartons*packCost; perKg=total/qty;
  // fullPerKg=perKg+prodCost; suggestedPerKg=fullPerKg*(1+margin/100); suggestedTotal=suggestedPerKg*qty
  it("has the exact 12 destinations/rates transcribed from the source's FREIGHT_RATES constant", () => {
    expect(LOGISTICS_FREIGHT_RATES).toHaveLength(12);
    expect(LOGISTICS_FREIGHT_RATES[0]).toEqual({ label: "السعودية — جدة (JED)", rateUsdPerKg: 0.38 });
    expect(LOGISTICS_FREIGHT_RATES[LOGISTICS_FREIGHT_RATES.length - 1]).toEqual({ label: "فرنسا — باريس (CDG)", rateUsdPerKg: 1.6 });
  });

  it("matches the exact source algebra for a representative input (Jeddah, 1000kg)", () => {
    const jed = LOGISTICS_FREIGHT_RATES[0];
    const r = calculateLandedCost({
      qtyKg: 1000,
      destinationRateUsdPerKg: jed.rateUsdPerKg,
      cartonPriceEgp: 15,
      packCostEgpPerCarton: 8,
      marginPct: 25,
    });
    // cartons = ceil(1000/4.5) = 223
    expect(r.cartons).toBe(223);
    // grossWeight = 223*5.1 = 1137.3
    expect(r.grossWeightKg).toBeCloseTo(1137.3, 6);
    // freightUSD = 1137.3*0.38 = 432.174
    expect(r.freightUsd).toBeCloseTo(432.174, 6);
    const freightEgp = 432.174 * LOGISTICS_EGP_PER_USD_REFERENCE;
    expect(r.freightEgp).toBeCloseTo(freightEgp, 4);
    expect(r.cartonsTotalEgp).toBe(223 * 15);
    expect(r.packTotalEgp).toBe(223 * 8);
    const logisticsTotal = freightEgp + 223 * 15 + 223 * 8;
    expect(r.logisticsTotalEgp).toBeCloseTo(logisticsTotal, 4);
    const perKg = logisticsTotal / 1000;
    expect(r.logisticsPerKgEgp).toBeCloseTo(perKg, 6);
    expect(r.fullPerKgEgp).toBeCloseTo(perKg, 6); // no production cost supplied
    const suggested = perKg * 1.25;
    expect(r.suggestedPerKgEgp).toBeCloseTo(suggested, 6);
    expect(r.suggestedTotalEgp).toBeCloseTo(suggested * 1000, 4);
  });

  it("adds optional farm-gate production cost per kg before applying margin", () => {
    const r = calculateLandedCost({
      qtyKg: 100,
      destinationRateUsdPerKg: 1,
      cartonPriceEgp: 0,
      packCostEgpPerCarton: 0,
      prodCostPerKgEgp: 5,
      marginPct: 0,
    });
    expect(r.fullPerKgEgp).toBeCloseTo(r.logisticsPerKgEgp + 5, 6);
    expect(r.suggestedPerKgEgp).toBeCloseTo(r.fullPerKgEgp, 6); // margin 0% => suggested == full
  });
});

describe("summarizeCampaignFunnel — oracle-matches the source's renderFunnelSummary() row labels/order", () => {
  it("returns the exact 8 labels in the exact source order", () => {
    const rows = summarizeCampaignFunnel({
      exportersContacted: 10,
      directoryContacted: 20,
      linkedinLeads: 3,
      exwBids: 4,
      brokersContacted: 1,
      offshootLeads: 2,
      localLeads: 5,
      dailySalesReportDays: 6,
    });
    expect(rows.map((r) => r.label)).toEqual([
      "الشركات المفلترة (75 جهة) — تم التواصل معها",
      "القاعدة الكاملة (1513 جهة) — تم التواصل معها",
      "عملاء LinkedIn المسجلون",
      "عروض EXW الموثقة",
      "وسطاء التصدير — تم التواصل معهم",
      "عملاء الفسائل",
      "عملاء البيع المحلي",
      "أيام تقرير المبيعات اليومي المسجلة",
    ]);
    expect(rows.map((r) => r.count)).toEqual([10, 20, 3, 4, 1, 2, 5, 6]);
  });
});

describe("summarizeWeeklyAvailability — honest arithmetic total (no source loss%/local-share formula exists)", () => {
  it("sums premium/large/commercial tonnage across every saved week", () => {
    const r = summarizeWeeklyAvailability([
      { premiumTons: 2, largeTons: 3, commercialTons: 1 },
      { premiumTons: 4, largeTons: 0, commercialTons: 2 },
    ]);
    expect(r).toEqual({ weeks: 2, premiumTons: 6, largeTons: 3, commercialTons: 3, totalTons: 12 });
  });

  it("returns all zeros for an empty register, never NaN", () => {
    expect(summarizeWeeklyAvailability([])).toEqual({ weeks: 0, premiumTons: 0, largeTons: 0, commercialTons: 0, totalTons: 0 });
  });
});
