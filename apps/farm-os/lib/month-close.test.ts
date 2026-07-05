import { describe, expect, it } from "vitest";
import { isSaleOnOrAfterReportDate, saleReportDate, summarizeAgedReceivables } from "./month-close";

describe("saleReportDate", () => {
  it("uses sale_date, then delivery_date, then created_at", () => {
    expect(saleReportDate({ id: "sale", sale_date: "2026-07-05", delivery_date: "2026-07-01", created_at: "2026-07-09T10:00:00Z" })).toBe("2026-07-05");
    expect(saleReportDate({ id: "delivery", sale_date: null, delivery_date: "2026-07-01", created_at: "2026-07-09T10:00:00Z" })).toBe("2026-07-01");
    expect(saleReportDate({ id: "created", sale_date: null, delivery_date: null, created_at: "2026-07-09T10:00:00Z" })).toBe("2026-07-09");
  });
});

describe("summarizeAgedReceivables", () => {
  it("counts null-sale-date receivables by report date and subtracts collections", () => {
    const summary = summarizeAgedReceivables(
      [
        { id: "old-delivery", total: 1000, sale_date: null, delivery_date: "2026-07-01", created_at: "2026-07-09T10:00:00Z" },
        { id: "old-created", total: "700", sale_date: null, delivery_date: null, created_at: "2026-07-02T10:00:00Z" },
        { id: "new-sale", total: 500, sale_date: "2026-07-20", delivery_date: "2026-07-01", created_at: "2026-07-02T10:00:00Z" },
      ],
      [
        { sale_id: "old-delivery", amount: 250 },
        { sale_id: "old-created", amount: "700" },
      ],
      "2026-07-10",
    );

    expect(summary).toEqual({ count: 1, amount: 750 });
  });

  it("does not count fully collected aged sales", () => {
    expect(
      summarizeAgedReceivables(
        [{ id: "sale", total: 100, sale_date: "2026-07-01" }],
        [{ sale_id: "sale", amount: 100 }],
        "2026-07-10",
      ),
    ).toEqual({ count: 0, amount: 0 });
  });

  it("excludes pre-cutover report dates even when created_at is after cutover", () => {
    expect(
      summarizeAgedReceivables(
        [
          { id: "archive", total: 1000, sale_date: null, delivery_date: "2026-06-30", created_at: "2026-07-02T10:00:00Z" },
          { id: "live", total: 500, sale_date: null, delivery_date: "2026-07-01", created_at: "2026-07-02T10:00:00Z" },
        ],
        [],
        "2026-07-10",
        "2026-07-01",
      ),
    ).toEqual({ count: 1, amount: 500 });
  });
});

describe("isSaleOnOrAfterReportDate", () => {
  it("filters pending sales by report date, not just created_at", () => {
    expect(isSaleOnOrAfterReportDate({ id: "archive", sale_date: null, delivery_date: "2026-06-30", created_at: "2026-07-02T10:00:00Z" }, "2026-07-01")).toBe(false);
    expect(isSaleOnOrAfterReportDate({ id: "live", sale_date: null, delivery_date: "2026-07-01", created_at: "2026-07-02T10:00:00Z" }, "2026-07-01")).toBe(true);
  });
});
