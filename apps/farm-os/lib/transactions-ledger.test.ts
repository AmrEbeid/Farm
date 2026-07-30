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

// Regression guards for the actual page: the pure helpers above are correct on whatever they're
// given, so only reading the page source can catch the page wiring them up wrong (a query missing
// org scoping, a count query silently dropped, an error swallowed, an export left on for a truncated
// list). Mirrors lib/accounting-recent-entries.test.ts's page-source-regression pattern.
describe("transactions page source", () => {
  it("scopes all seven source/lookup queries to the active org", () => {
    for (const table of [
      "expenses",
      "sales",
      "sale_collections",
      "custody_movements",
      "buyers",
      "suppliers",
      "custody_accounts",
    ]) {
      const start = pageSource.indexOf(`.from("${table}")`);
      expect(start, `${table} query not found`).toBeGreaterThan(-1);
      const chunk = pageSource.slice(start, start + 400);
      expect(chunk, `${table} query missing org_id scoping`).toContain('.eq("org_id", m.orgId)');
    }
  });

  it("requests an exact count on every money-event source query", () => {
    for (const table of ["expenses", "sales", "sale_collections", "custody_movements"]) {
      const start = pageSource.indexOf(`.from("${table}")`);
      expect(start, `${table} query not found`).toBeGreaterThan(-1);
      const chunk = pageSource.slice(start, start + 200);
      expect(chunk, `${table} query missing count: "exact"`).toContain('count: "exact"');
    }
  });

  it("checks every one of the eight query responses for an error before reading its data", () => {
    for (const res of [
      "expensesRes",
      "salesRes",
      "collectionsRes",
      "custodyRes",
      "buyersRes",
      "suppliersRes",
      "custodyAcctRes",
      "pendingPriceRes",
    ]) {
      expect(pageSource, `${res}.error is never checked`).toContain(`if (${res}.error) throw ${res}.error;`);
    }
  });

  it("orders every source query by date null-last then id for a deterministic ledger", () => {
    for (const dateColumn of ["date", "sale_date", "occurred_at"]) {
      const orderCall = `.order("${dateColumn}", { ascending: false, nullsFirst: false })`;
      expect(pageSource, `missing null-last date order on ${dateColumn}`).toContain(orderCall);
    }
    // Every source query's date order is immediately followed by a descending id tiebreak.
    expect(pageSource.match(/\.order\("id", \{ ascending: false \}\)/g) ?? []).toHaveLength(4);
  });

  it("reuses the exact same visible-sale lifecycle filter for the sales row query and the pending-price count", () => {
    const occurrences = pageSource.match(/\.neq\("payment_status", SALE_HIDDEN_PAYMENT_STATUS\)/g) ?? [];
    expect(occurrences).toHaveLength(2);
  });

  it("uses the shared expense lifecycle filter constant, not an inline duplicate", () => {
    expect(pageSource).toContain(".or(EXPENSE_VISIBLE_LIFECYCLE_FILTER)");
  });

  it("computes the pending-price count as a head-only request (no row data)", () => {
    const start = pageSource.indexOf('.eq("price_status", "pending")');
    expect(start, "pending-price query not found").toBeGreaterThan(-1);
    const chunk = pageSource.slice(Math.max(0, start - 300), start);
    expect(chunk).toContain("head: true");
  });

  it("disables CSV export exactly when the list is truncated", () => {
    expect(pageSource).toContain("exportFilename={isTruncated ? undefined : \"transactions\"}");
  });

  it("derives chip and «الكل» totals from the exact counts, never from the bounded rows array", () => {
    expect(pageSource).toContain("const allCount = expenseCount + saleCount + collectionCount + custodyCount;");
    expect(pageSource).not.toMatch(/count:\s*rows\.length/);
    expect(pageSource).not.toMatch(/count:\s*rows\.filter/);
  });
});

// Regression guards for P3: buyers/suppliers/custody_accounts must never be fetched in full — only
// the ids actually referenced by the already-bounded, displayed transaction rows. Mirrors
// accounting/page.tsx's entryIds → journal_lines pattern (accounting-recent-entries.test.ts).
describe("transactions page lookup fetch stays bounded to referenced ids", () => {
  it("derives buyerIds/supplierIds/custodyAccountIds via dedupeReferencedIds from the displayed rows", () => {
    expect(pageSource).toContain(
      "const buyerIds = dedupeReferencedIds((salesRes.data ?? []).map((s) => s.buyer_id));",
    );
    expect(pageSource).toContain(
      "const supplierIds = dedupeReferencedIds((expensesRes.data ?? []).map((e) => e.supplier_id));",
    );
    expect(pageSource).toContain(
      "const custodyAccountIds = dedupeReferencedIds((custodyRes.data ?? []).map((mv) => mv.custody_account_id));",
    );
  });

  it("pins .in(\"id\", referencedIds) plus org scope for every lookup query, never an unconditional full-table fetch", () => {
    for (const { table, idsVar } of [
      { table: "buyers", idsVar: "buyerIds" },
      { table: "suppliers", idsVar: "supplierIds" },
      { table: "custody_accounts", idsVar: "custodyAccountIds" },
    ]) {
      const start = pageSource.indexOf(`.from("${table}")`);
      expect(start, `${table} lookup query not found`).toBeGreaterThan(-1);
      const chunk = pageSource.slice(start, start + 200);
      expect(chunk, `${table} lookup query missing org_id scoping`).toContain('.eq("org_id", m.orgId)');
      expect(chunk, `${table} lookup query missing .in("id", ${idsVar})`).toContain(`.in("id", ${idsVar})`);
    }
  });

  it("guards every lookup query behind an ids.length check with an empty resolved fallback, never a bare unconditional query", () => {
    for (const idsVar of ["buyerIds", "supplierIds", "custodyAccountIds"]) {
      expect(pageSource, `${idsVar}.length guard missing`).toContain(`${idsVar}.length > 0`);
    }
    expect(pageSource.match(/Promise\.resolve\(\{ data: \[\], error: null \}\)/g) ?? []).toHaveLength(3);
  });

  it("checks every lookup query response for an error before building name maps", () => {
    for (const res of ["buyersRes", "suppliersRes", "custodyAcctRes"]) {
      expect(pageSource, `${res}.error is never checked`).toContain(`if (${res}.error) throw ${res}.error;`);
    }
  });

  it("resolves every party field via the fail-closed lookup helper, never the old `|| \"—\"` masking pattern", () => {
    expect(pageSource).toContain('party: requireLookupName(e.supplier_id, supplierName, "supplier"),');
    expect(pageSource).toContain('party: requireLookupName(s.buyer_id, buyerName, "buyer"),');
    expect(pageSource).toContain('party: requireLookupName(mv.custody_account_id, holderName, "custody account"),');
    expect(pageSource).not.toMatch(/supplierName\.get\([^)]*\)\)\s*\|\|\s*"—"/);
    expect(pageSource).not.toMatch(/buyerName\.get\([^)]*\)\)\s*\|\|\s*"—"/);
    expect(pageSource).not.toMatch(/holderName\.get\([^)]*\)\)\s*\|\|\s*"—"/);
  });
});

// Regression guards for P2: the merged «الكل» view must never claim its displayed rows are "the N
// globally latest" — each of the four sources is capped independently, so that framing is false.
describe("transactions page truncation notice wording", () => {
  it("keeps the accurate 'latest N of exact total' framing for a single selected type", () => {
    const start = pageSource.indexOf("const truncationNotice");
    expect(start, "truncationNotice not found").toBeGreaterThan(-1);
    const chunk = pageSource.slice(start, start + 900);
    expect(chunk).toContain("يظهر أحدث ${num(visible.length)} من إجمالي ${num(activeExactCount)} عملية ${TYPE_AR[active]}");
  });

  it("never claims the merged «الكل» view shows the N globally latest rows across all sources", () => {
    const start = pageSource.indexOf("const truncationNotice");
    const chunk = pageSource.slice(start, start + 1200);
    // The all-view branch must explicitly disclose the per-type cap and disclaim a global ranking.
    expect(chunk).toContain("حتى ${num(TX_ROW_LIMIT)} من أحدث كل نوع من العمليات على حدة");
    expect(chunk).toContain("وليس أحدث ${num(visible.length)} عملية إجمالاً");
  });

  it("includes both displayed and exact-total counts honestly in the all-view notice", () => {
    const start = pageSource.indexOf("const truncationNotice");
    const chunk = pageSource.slice(start, start + 1200);
    expect(chunk).toContain("المعروض الآن ${num(visible.length)} عملية من إجمالي ${num(activeExactCount)} عملية مطابقة");
  });

  it("retains the search-scope and CSV-export warnings in both branches", () => {
    expect(pageSource.match(/\$\{searchExportNote\}/g) ?? []).toHaveLength(2);
    expect(pageSource).toContain(
      'const searchExportNote =\n    "البحث أدناه يقتصر على الصفوف المعروضة فقط، وتصدير CSV غير متاح هنا لتفادي ملف يبدو كاملاً بينما هو جزء من السجل.";',
    );
  });
});
