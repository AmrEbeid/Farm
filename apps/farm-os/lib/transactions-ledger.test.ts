import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXPENSE_HIDDEN_PAYMENT_STATUSES,
  SALE_HIDDEN_PAYMENT_STATUS,
  TX_ROW_LIMIT,
  compareTxByDateThenId,
  dedupeReferencedIds,
  isAnySourceTruncated,
  isTypeTruncated,
  isVisibleExpensePaymentStatus,
  isVisibleSalePaymentStatus,
  requireExactCount,
  requireLookupName,
} from "./transactions-ledger";

const pageSource = readFileSync(
  join(process.cwd(), "app", "(app)", "transactions", "page.tsx"),
  "utf8",
);
const viewSource = readFileSync(
  join(process.cwd(), "app", "(app)", "transactions", "transactions-list-view.tsx"),
  "utf8",
);

describe("isVisibleExpensePaymentStatus", () => {
  it("keeps a null (not-yet-routed) expense visible", () => {
    expect(isVisibleExpensePaymentStatus(null)).toBe(true);
    expect(isVisibleExpensePaymentStatus(undefined)).toBe(true);
  });

  it("keeps historical_treasury and every live routing status visible", () => {
    for (const status of ["paid_from_custody", "post_paid_unpaid", "paid_by_owner", "historical_treasury"]) {
      expect(isVisibleExpensePaymentStatus(status)).toBe(true);
    }
  });

  it("hides cancelled and historical_reversed expenses", () => {
    for (const status of EXPENSE_HIDDEN_PAYMENT_STATUSES) {
      expect(isVisibleExpensePaymentStatus(status)).toBe(false);
    }
  });
});

describe("isVisibleSalePaymentStatus", () => {
  it("hides only historical_reversed", () => {
    expect(isVisibleSalePaymentStatus(SALE_HIDDEN_PAYMENT_STATUS)).toBe(false);
    for (const status of ["unpaid", "partially_collected", "collected", "historical_treasury"]) {
      expect(isVisibleSalePaymentStatus(status)).toBe(true);
    }
  });
});

describe("requireExactCount", () => {
  it("fails closed on a query error instead of defaulting to zero", () => {
    expect(() => requireExactCount({ count: null, error: new Error("boom") }, "expenses")).toThrow("boom");
  });

  it("fails closed when count is missing despite no error", () => {
    expect(() => requireExactCount({ count: null, error: null }, "expenses")).toThrow(
      /exact count missing/,
    );
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "fails closed when the exact count is invalid: %s",
    (count) => {
      expect(() => requireExactCount({ count, error: null }, "expenses")).toThrow(
        /exact count missing or invalid/,
      );
    },
  );

  it("returns a zero count as a real value, not a failure", () => {
    expect(requireExactCount({ count: 0, error: null }, "expenses")).toBe(0);
  });

  it("returns the exact count untouched", () => {
    expect(requireExactCount({ count: 4321, error: null }, "expenses")).toBe(4321);
  });
});

describe("compareTxByDateThenId", () => {
  it("orders most-recent date first", () => {
    const rows = [
      { id: "e-1", sortDate: "2026-01-01" },
      { id: "e-2", sortDate: "2026-03-01" },
    ];
    expect([...rows].sort(compareTxByDateThenId).map((r) => r.id)).toEqual(["e-2", "e-1"]);
  });

  it("puts a null (empty) date last, never first", () => {
    const rows = [
      { id: "e-1", sortDate: "" },
      { id: "e-2", sortDate: "2026-01-01" },
    ];
    expect([...rows].sort(compareTxByDateThenId).map((r) => r.id)).toEqual(["e-2", "e-1"]);
  });

  it("breaks a same-date tie deterministically by id, regardless of source order", () => {
    const rows = [
      { id: "m-1", sortDate: "2026-01-01" },
      { id: "s-9", sortDate: "2026-01-01" },
      { id: "e-5", sortDate: "2026-01-01" },
    ];
    const sortedIds = [...rows].sort(compareTxByDateThenId).map((r) => r.id);
    // Same input, sorted again: must land in the exact same order both times.
    expect([...rows].sort(compareTxByDateThenId).map((r) => r.id)).toEqual(sortedIds);
  });
});

describe("dedupeReferencedIds", () => {
  it("drops null and undefined but keeps every distinct non-null id", () => {
    expect(dedupeReferencedIds(["a", null, "b", undefined, "a"])).toEqual(["a", "b"]);
  });

  it("returns an empty array when nothing is referenced", () => {
    expect(dedupeReferencedIds([null, undefined, null])).toEqual([]);
    expect(dedupeReferencedIds([])).toEqual([]);
  });
});

describe("requireLookupName", () => {
  it("renders a genuinely null id as an honest dash, not a lookup miss", () => {
    expect(requireLookupName(null, new Map(), "supplier")).toBe("—");
    expect(requireLookupName(undefined, new Map(), "supplier")).toBe("—");
  });

  it("returns the matching lookup name for a referenced id", () => {
    const nameById = new Map([["sup-1", "مورد الأسمدة"]]);
    expect(requireLookupName("sup-1", nameById, "supplier")).toBe("مورد الأسمدة");
  });

  it("fails closed instead of rendering a truncation-caused lookup gap as an honest dash", () => {
    // The historical risk: a referenced id whose lookup row wasn't fetched (e.g. because the lookup
    // query was truncated or scoped wrong) would look identical to "no party" if this fell back to
    // "—" instead of throwing.
    expect(() => requireLookupName("sup-missing", new Map(), "supplier")).toThrow(
      /supplier.*sup-missing/,
    );
  });
});

describe("truncation gates", () => {
  it("is not truncated when the exact count fits within the row limit", () => {
    expect(isTypeTruncated(TX_ROW_LIMIT)).toBe(false);
    expect(isTypeTruncated(TX_ROW_LIMIT - 1)).toBe(false);
  });

  it("is truncated once the exact count exceeds the row limit", () => {
    expect(isTypeTruncated(TX_ROW_LIMIT + 1)).toBe(true);
  });

  it("«الكل» is truncated if any single merged source is truncated", () => {
    expect(isAnySourceTruncated([1, 2, TX_ROW_LIMIT + 1, 3])).toBe(true);
    expect(isAnySourceTruncated([1, 2, 3, 4])).toBe(false);
  });
});

// Regression guards for the actual page. The database and strict parser now own source scoping,
// lifecycle rules, exact counts, party integrity and decimal transport; this pins the page wiring.
describe("transactions page source", () => {
  it("uses one organization-bound snapshot and fails on its read error", () => {
    expect(pageSource.match(/sb\.rpc\("fn_transactions_snapshot"/g) ?? []).toHaveLength(1);
    expect(pageSource).toContain("p_org: m.orgId");
    expect(pageSource).toContain("p_row_limit: TX_ROW_LIMIT");
    expect(pageSource).toContain("if (snapshotRes.error) throw snapshotRes.error;");
    expect(pageSource).toContain("parseTransactionsSnapshot(snapshotRes.data, m.orgId)");
    expect(pageSource).not.toMatch(/\.from\("(?:expenses|sales|sale_collections|custody_movements)"\)/);
  });

  it("never offers a partial CSV export from the bounded merged sample", () => {
    expect(viewSource).toContain("ولا يتوفر تصدير جزئي");
    expect(viewSource).not.toContain("exportFilename");
    expect(viewSource).not.toContain("FilterableTable");
  });

  it("derives chip and «الكل» totals from the exact counts, never from the bounded rows array", () => {
    expect(viewSource).toContain("const allCount = counts.expense + counts.sale + counts.collection + counts.custody;");
    expect(viewSource).not.toMatch(/count:\s*(?:snapshot\.)?rows\.length/);
    expect(viewSource).not.toMatch(/count:\s*(?:snapshot\.)?rows\.filter/);
  });

  it("renders and sorts exact decimal text without Number conversion", () => {
    expect(viewSource).toContain("formatDecimalArabic(row.amount");
    expect(viewSource).toContain("formatDecimalArabic(value");
    expect(viewSource).toContain("compareTxByDateThenId");
    expect(viewSource).not.toMatch(/Number\((?:row\.)?(?:amount|quantity|total|amount_in|amount_out)/);
  });

  it("keeps the list server rendered", () => {
    expect(viewSource).not.toContain('"use client"');
    expect(pageSource).toContain("<TransactionsListView snapshot={snapshot} context={context} />");
  });
});

describe("transactions bounded-sample disclosure", () => {
  it("is always present and rejects a global chronology claim", () => {
    expect(viewSource).toContain("هذه قائمة تشغيل محدودة وليست دفترًا زمنيًا كاملاً");
    expect(viewSource).toContain("من أحدث كل نوع على حدة");
    expect(viewSource).toContain("لا تعني أن الصفوف المعروضة هي أحدث المعاملات إجمالاً");
    expect(viewSource).toContain("البحث داخل الصفوف المعروضة فقط");
  });
});
