import { describe, expect, it } from "vitest";
import { fmtDate } from "./dates";
import {
  custodyAccountSummary,
  custodyListHref,
  custodyMovementState,
  custodyRequestSearchMatches,
  custodyRequestWorkCounts,
  parseCustodyListContext,
} from "./custody-workspace";

const request = {
  id: "request-a",
  requestNo: 17,
  status: "submitted",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  createdAt: "2026-08-23T08:00:00Z",
};

describe("custody workspace", () => {
  it("normalizes filter and bounded query state", () => {
    expect(parseCustodyListContext({ requests: "awaiting", q: "  طلب\u0000 أغسطس  " })).toEqual({
      requestFilter: "awaiting",
      query: "طلب  أغسطس",
    });
    expect(parseCustodyListContext({ requests: "unknown", q: "x".repeat(80) })).toEqual({
      requestFilter: "all",
      query: "x".repeat(60),
    });
  });

  it("rebuilds only legal list state", () => {
    expect(custodyListHref()).toBe("/custody");
    expect(custodyListHref({ requestFilter: "settled", query: "طلب 17" }))
      .toBe("/custody?q=%D8%B7%D9%84%D8%A8+17&requests=settled");
  });

  it("searches the bounded request sample", () => {
    expect(custodyRequestSearchMatches(request, "مُرسل", "17")).toBe(true);
    expect(custodyRequestSearchMatches(request, "مُرسل", "١٧")).toBe(true);
    expect(custodyRequestSearchMatches(request, "مُرسل", "مُرسل")).toBe(true);
    expect(custodyRequestSearchMatches(request, "مُرسل", "2026-08")).toBe(true);
    expect(custodyRequestSearchMatches(request, "مُرسل", fmtDate(request.periodStart))).toBe(true);
    expect(custodyRequestSearchMatches(request, "مُرسل", "مغلق")).toBe(false);
  });

  it("makes reversals explicit without changing movement data", () => {
    expect(custodyMovementState({ movementType: "صرف نقدي", reversalOf: null, reversedBy: null }))
      .toEqual({ label: "صرف نقدي", status: "done" });
    expect(custodyMovementState({ movementType: "عكس تمويل المالك", reversalOf: "a", reversedBy: null }).status)
      .toBe("warning");
    expect(custodyMovementState({ movementType: "استلام عهدة", reversalOf: null, reversedBy: "b" }).status)
      .toBe("blocked");
  });

  it("includes unfinished drafts in the work count", () => {
    expect(custodyRequestWorkCounts({ all: 9, awaiting: 3, settled: 4 })).toEqual({ draft: 2, work: 5 });
  });

  it("keeps all cash visible while active accounts alone drive target, top-up and writes", () => {
    const summary = custodyAccountSummary([
      { id: "active", holderLabel: "نشط", holderUserId: null, targetFloat: "100", active: true, balance: "40" },
      { id: "inactive", holderLabel: "متوقف", holderUserId: null, targetFloat: "500", active: false, balance: "25" },
    ]);
    expect(summary.activeAccounts.map((account) => account.id)).toEqual(["active"]);
    expect(summary.topUps).toEqual(["60", "0"]);
    expect(summary.totalBalance).toBe("65");
    expect(summary.totalTarget).toBe("100");
    expect(summary.totalTopUp).toBe("60");
    expect(summary.inactiveCashCount).toBe(1);
  });
});
