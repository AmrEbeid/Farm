import { describe, expect, it } from "vitest";
import { classifyPr, matchesFilter, parsePrConsoleFilter, remainingQty } from "./pr-console";

const TODAY = "2026-07-02";

function pr(status: string, needed_by: string | null, items: { qty: number | null; received_qty: number | null }[]) {
  return { status, needed_by, items };
}

describe("remainingQty", () => {
  it("sums qty minus received across items, flooring negatives at zero", () => {
    expect(
      remainingQty([
        { qty: 100, received_qty: 40 },
        { qty: 50, received_qty: null },
        // over-receipt on one line must not offset another line's remainder
        { qty: 10, received_qty: 25 },
      ]),
    ).toBe(110);
  });

  it("treats null qty as zero (no fabricated demand)", () => {
    expect(remainingQty([{ qty: null, received_qty: null }])).toBe(0);
  });
});

describe("classifyPr — engine-mirror stale rule", () => {
  it("approved with future needed_by and remaining qty is a live open order, not stale", () => {
    const c = classifyPr(pr("approved", "2026-07-20", [{ qty: 100, received_qty: 0 }]), TODAY);
    expect(c.isOpenOrder).toBe(true);
    expect(c.isStaleForCoverage).toBe(false);
    expect(c.isOverdue).toBe(false);
  });

  it("approved with past needed_by is BOTH overdue and dropped from coverage (the silent-drop case)", () => {
    const c = classifyPr(pr("approved", "2026-06-30", [{ qty: 100, received_qty: 20 }]), TODAY);
    expect(c.isOverdue).toBe(true);
    expect(c.isStaleForCoverage).toBe(true);
    expect(c.remainingQty).toBe(80);
  });

  it("needed_by today still counts for coverage (engine uses >= current_date)", () => {
    const c = classifyPr(pr("approved", TODAY, [{ qty: 10, received_qty: 0 }]), TODAY);
    expect(c.isStaleForCoverage).toBe(false);
    expect(c.isOverdue).toBe(false);
  });

  it("approved with NULL needed_by never counts as supply (engine requires needed_by is not null)", () => {
    const c = classifyPr(pr("approved", null, [{ qty: 10, received_qty: 0 }]), TODAY);
    expect(c.isStaleForCoverage).toBe(true);
    // …but it is not 'overdue' — no date was ever promised.
    expect(c.isOverdue).toBe(false);
  });

  it("fully received order has no remainder: not open order, not overdue, not stale", () => {
    const c = classifyPr(pr("partially_received", "2026-06-01", [{ qty: 10, received_qty: 10 }]), TODAY);
    expect(c.isOpenOrder).toBe(false);
    expect(c.isOverdue).toBe(false);
    expect(c.isStaleForCoverage).toBe(false);
  });

  it("submitted past needed_by is overdue but NOT stale (never counted as supply anyway)", () => {
    const c = classifyPr(pr("submitted", "2026-06-30", [{ qty: 10, received_qty: 0 }]), TODAY);
    expect(c.isAwaitingApproval).toBe(true);
    expect(c.isOverdue).toBe(true);
    expect(c.isStaleForCoverage).toBe(false);
  });

  it("draft past needed_by is neither overdue nor stale (nothing requested yet)", () => {
    const c = classifyPr(pr("draft", "2026-06-30", [{ qty: 10, received_qty: 0 }]), TODAY);
    expect(c.isOverdue).toBe(false);
    expect(c.isStaleForCoverage).toBe(false);
    expect(c.isOpen).toBe(true);
  });

  it("terminal statuses are closed", () => {
    expect(classifyPr(pr("received", null, []), TODAY).isOpen).toBe(false);
    expect(classifyPr(pr("rejected", null, []), TODAY).isOpen).toBe(false);
  });
});

describe("matchesFilter / parsePrConsoleFilter", () => {
  it("filters map to their classification flags", () => {
    const stale = classifyPr(pr("approved", "2026-06-01", [{ qty: 5, received_qty: 0 }]), TODAY);
    expect(matchesFilter(stale, "stale")).toBe(true);
    expect(matchesFilter(stale, "submitted")).toBe(false);
    expect(matchesFilter(stale, "all")).toBe(true);
  });

  it("unknown filter params fall back to all (no crash on hand-edited URLs)", () => {
    expect(parsePrConsoleFilter("nonsense")).toBe("all");
    expect(parsePrConsoleFilter(undefined)).toBe("all");
    expect(parsePrConsoleFilter("stale")).toBe("stale");
  });
});
