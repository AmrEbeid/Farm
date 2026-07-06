import { describe, expect, it } from "vitest";
import { isAgedLiveReceivable, isSaleInLiveEra, saleBusinessDate } from "./month-close";

describe("month-close sale business date", () => {
  it("uses sale date, then delivery date, then created date", () => {
    expect(
      saleBusinessDate({
        sale_date: "2026-07-04",
        delivery_date: "2026-07-03",
        created_at: "2026-07-02T09:00:00.000Z",
      }),
    ).toBe("2026-07-04");
    expect(saleBusinessDate({ sale_date: null, delivery_date: "2026-07-03", created_at: "2026-07-02T09:00:00.000Z" })).toBe("2026-07-03");
    expect(saleBusinessDate({ sale_date: null, delivery_date: null, created_at: "2026-07-02T09:00:00.000Z" })).toBe("2026-07-02");
  });

  it("excludes imported pre-cutover sales even when they were created after cutover", () => {
    expect(
      isSaleInLiveEra(
        { sale_date: null, delivery_date: "2026-06-30", created_at: "2026-07-02T09:00:00.000Z" },
        "2026-07-01",
      ),
    ).toBe(false);
  });

  it("includes null-sale-date live deliveries by delivery date", () => {
    expect(
      isSaleInLiveEra(
        { sale_date: null, delivery_date: "2026-07-01", created_at: "2026-07-02T09:00:00.000Z" },
        "2026-07-01",
      ),
    ).toBe(true);
  });

  it("ages only receivables inside the live era", () => {
    expect(
      isAgedLiveReceivable(
        { sale_date: null, delivery_date: "2026-06-30", created_at: "2026-07-02T09:00:00.000Z" },
        "2026-07-01",
        "2026-07-31",
      ),
    ).toBe(false);
    expect(
      isAgedLiveReceivable(
        { sale_date: null, delivery_date: "2026-07-01", created_at: "2026-07-02T09:00:00.000Z" },
        "2026-07-01",
        "2026-07-31",
      ),
    ).toBe(true);
  });
});
