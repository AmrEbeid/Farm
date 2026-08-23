import { describe, expect, it } from "vitest";
import {
  STOREKEEPER_HOME_SNAPSHOT_VERSION,
  parseStorekeeperHomeSnapshot,
} from "./storekeeper-home-reads";

const orgId = "11111111-1111-1111-1111-111111111111";
const prId = "22222222-2222-2222-2222-222222222222";
const prId2 = "33333333-3333-3333-3333-333333333333";
const itemId = "44444444-4444-4444-4444-444444444444";
const itemId2 = "55555555-5555-5555-5555-555555555555";
const moveId = "66666666-6666-6666-6666-666666666666";
const moveId2 = "77777777-7777-7777-7777-777777777777";
const asOf = "2026-08-23";

function line(overrides: Record<string, unknown> = {}) {
  return {
    item_id: itemId, item_name: "سماد اختبار", unit: "كجم", item_unit: "كجم",
    ordered: "10", received: "4", remaining: "6",
    ...overrides,
  };
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    id: prId, code: "PR-001", status: "approved", needed_by: "2026-08-20", urgency: "overdue",
    receivable: true, blockers: [] as string[], open_line_count: "1", lines: [line()],
    ...overrides,
  };
}

function fixture() {
  return {
    version: STOREKEEPER_HOME_SNAPSHOT_VERSION, org_id: orgId, as_of: asOf,
    detail_limit: 1, evidence_window_days: 7,
    authority: { inventory: "partial" },
    recorded: {
      open_receipts: "2", receivable_now: "1", blocked_receipts: "1",
      overdue_receipts: "1", due_today_receipts: "1", upcoming_receipts: "0", undated_receipts: "0",
      open_receipt_lines: "2",
      issued_today: "1", below_reorder: "1", unknown_stock: "1", recent_shrink: "1",
    },
    drivers: {
      receivable: [receipt()],
      blocked: [receipt({
        id: prId2, code: "PR-002", status: "partially_received", needed_by: asOf, urgency: "today",
        receivable: false, blockers: ["unquantified_line"],
        lines: [line({ unit: "لتر" })],
      })],
      below_reorder: [{
        item_id: itemId, name: "سماد اختبار", unit: "كجم",
        available: "3", threshold: "10", bin_count: "2",
      }],
      unknown_stock: [{ item_id: itemId2, name: "مادة بلا رصيد", unit: "كجم" }],
      issued_today: [{
        id: moveId, item_id: itemId, item_name: "سماد اختبار",
        qty: "2.50", unit: "كجم", location: "main", occurred_on: asOf,
      }],
      recent_shrink: [{
        id: moveId2, item_id: itemId, item_name: "سماد اختبار",
        type: "loss", qty: "1", unit: "كجم", occurred_on: "2026-08-21",
      }],
    },
  };
}

const parse = (value: unknown) => parseStorekeeperHomeSnapshot(value, orgId, asOf);

describe("storekeeper home snapshot parser", () => {
  it("parses a bounded snapshot", () => {
    const snapshot = parse(fixture());
    expect(snapshot.recorded.openReceipts).toBe("2");
    expect(snapshot.evidenceWindowDays).toBe(7);
    expect(snapshot.authority.inventory).toBe("partial");
    expect(snapshot.drivers.receivable[0].lines[0].remaining).toBe("6");
    expect(snapshot.drivers.blocked[0].blockers).toEqual(["unquantified_line"]);
    expect(snapshot.drivers.belowReorder[0].available).toBe("3");
    expect(snapshot.drivers.unknownStock[0].available).toBeNull();
    expect(snapshot.drivers.issuedToday[0].qty).toBe("2.5");
    expect(snapshot.drivers.recentShrink[0].type).toBe("loss");
  });

  it("keeps exact counts as text rather than widening them to numbers", () => {
    const value = fixture();
    value.recorded.open_receipt_lines = "9007199254740993";
    expect(parse(value).recorded.openReceiptLines).toBe("9007199254740993");
  });

  it("rejects an integer-looking count that JS would coerce before it is read", () => {
    const value = fixture() as Record<string, unknown>;
    (value.recorded as Record<string, unknown>).issued_today = 1;
    expect(() => parse(value)).toThrow(/issued_today must be text/);
  });

  it("rejects a count with leading zeros or a sign", () => {
    for (const bad of ["01", "+1", "-1", "1.0", " 1"]) {
      const value = fixture();
      value.recorded.issued_today = bad;
      expect(() => parse(value)).toThrow(/exact count text/);
    }
  });

  it("rejects extra keys on the root and nested rows", () => {
    const rootValue = fixture() as Record<string, unknown>;
    rootValue.finance = { total: "100" };
    expect(() => parse(rootValue)).toThrow(/root has unexpected keys: finance/);

    const receiptValue = fixture();
    receiptValue.drivers.receivable[0] = { ...receipt(), est_cost: "500" } as never;
    expect(() => parse(receiptValue)).toThrow(/receipt has unexpected keys: est_cost/);

    const lineValue = fixture();
    lineValue.drivers.receivable[0].lines[0] = { ...line(), unit_cost: "20" } as never;
    expect(() => parse(lineValue)).toThrow(/receipt line has unexpected keys: unit_cost/);
  });

  // ── count / list / bound coherence ────────────────────────────────────────────────────────────
  it("rejects receivable plus blocked that does not reconcile with the open total", () => {
    const value = fixture();
    value.recorded.blocked_receipts = "2";
    expect(() => parse(value)).toThrow(/do not reconcile with the open total/);
  });

  it("rejects urgency buckets that do not reconcile with the open total", () => {
    const value = fixture();
    value.recorded.due_today_receipts = "0";
    value.recorded.upcoming_receipts = "0";
    expect(() => parse(value)).toThrow(/urgency buckets do not reconcile/);
  });

  it("rejects a receipt urgency that contradicts its needed-by date", () => {
    const value = fixture();
    value.drivers.receivable[0].urgency = "upcoming";
    expect(() => parse(value)).toThrow(/urgency contradicts its needed-by date/);
  });

  it("rejects fewer open lines than open receipts", () => {
    const value = fixture();
    value.recorded.open_receipt_lines = "1";
    expect(() => parse(value)).toThrow(/open receipt lines cannot be fewer/);
  });

  it("rejects a driver array longer than the snapshot's own bound", () => {
    const value = fixture();
    value.drivers.issued_today = [
      value.drivers.issued_today[0],
      { ...value.drivers.issued_today[0], id: moveId2 },
    ];
    expect(() => parse(value)).toThrow(/drivers.issued_today must be a bounded array/);
  });

  it("rejects a driver list shorter than its exact count allows", () => {
    const value = fixture();
    value.recorded.below_reorder = "3";
    value.drivers.below_reorder = [];
    expect(() => parse(value)).toThrow(/below_reorder rows do not match their bounded count/);
  });

  it("rejects nested lines that do not match their bounded open-line count", () => {
    const value = fixture();
    value.drivers.receivable[0].lines = [];
    expect(() => parse(value)).toThrow(/receipt lines do not match their bounded count/);
  });

  it("rejects an overdue count with no visible overdue receipt", () => {
    // Both visible rows are due today, so the recorded overdue receipt is claimed by the count
    // alone. With one slot free in each bucket it could not have been pushed out of sight.
    const value = fixture();
    value.drivers.receivable = [receipt({ needed_by: asOf, urgency: "today" })];
    expect(() => parse(value)).toThrow(/visible overdue receipts contradict/);
  });

  it("rejects more visible overdue receipts than the recorded overdue count", () => {
    const value = fixture();
    value.drivers.blocked[0].needed_by = "2026-08-19";
    value.drivers.blocked[0].urgency = "overdue";
    expect(() => parse(value)).toThrow(/visible overdue receipts contradict/);
  });

  it("rejects receipts ordered with an overdue row after a later bucket", () => {
    const value = fixture();
    value.detail_limit = 2;
    value.recorded.open_receipts = "2";
    value.recorded.receivable_now = "2";
    value.recorded.blocked_receipts = "0";
    value.recorded.overdue_receipts = "1";
    value.recorded.due_today_receipts = "1";
    value.recorded.open_receipt_lines = "2";
    value.drivers.blocked = [];
    value.drivers.receivable = [
      receipt({ id: prId2, code: "PR-002", needed_by: asOf, urgency: "today" }),
      receipt(),
    ];
    expect(() => parse(value)).toThrow(/not ordered by urgency/);
  });

  // ── duplicates ───────────────────────────────────────────────────────────────────────────────
  it("rejects the same receipt appearing in both receivability buckets", () => {
    const value = fixture();
    value.drivers.blocked[0].id = prId;
    expect(() => parse(value)).toThrow(/receipts must not repeat a row/);
  });

  it("rejects a repeated movement row", () => {
    const value = fixture();
    value.detail_limit = 2;
    value.recorded.recent_shrink = "2";
    value.drivers.recent_shrink = [
      value.drivers.recent_shrink[0],
      { ...value.drivers.recent_shrink[0] },
    ];
    expect(() => parse(value)).toThrow(/recent_shrink must not repeat a row/);
  });

  it("rejects an item that is both a threshold reading and unknown", () => {
    const value = fixture();
    value.drivers.unknown_stock[0].item_id = itemId;
    expect(() => parse(value)).toThrow(/stock buckets must not repeat a row/);
  });

  // ── dates, statuses and types ────────────────────────────────────────────────────────────────
  it("rejects a snapshot for another organization or another date", () => {
    const other = fixture();
    other.org_id = itemId;
    expect(() => parse(other)).toThrow(/organization mismatch/);
    const stale = fixture();
    stale.as_of = "2026-08-22";
    expect(() => parse(stale)).toThrow(/as-of mismatch/);
  });

  it("rejects a version other than the one this parser was written against", () => {
    const value = fixture();
    value.version = "farm-os.storekeeper-home.v2";
    expect(() => parse(value)).toThrow(/version mismatch/);
  });

  it("rejects a calendar date that does not exist", () => {
    const value = fixture();
    value.drivers.receivable[0].needed_by = "2026-02-30";
    expect(() => parse(value)).toThrow(/needed_by must be a calendar date/);
  });

  it("rejects an undated receipt that still carries a needed-by date", () => {
    const value = fixture();
    value.drivers.receivable[0].urgency = "undated";
    expect(() => parse(value)).toThrow(/urgency contradicts its needed-by date/);
  });

  it("rejects a purchase-request status fn_post_receipt cannot claim", () => {
    for (const bad of ["draft", "submitted", "received", "rejected"]) {
      const value = fixture();
      value.drivers.receivable[0].status = bad;
      expect(() => parse(value)).toThrow(/status fn_post_receipt cannot claim/);
    }
  });

  it("rejects an issue movement recorded on any day but the business date", () => {
    const value = fixture();
    value.drivers.issued_today[0].occurred_on = "2026-08-22";
    expect(() => parse(value)).toThrow(/must all be recorded on the business date/);
  });

  it("rejects movement evidence outside the stated window", () => {
    const value = fixture();
    value.drivers.recent_shrink[0].occurred_on = "2026-08-16";
    expect(() => parse(value)).toThrow(/outside its stated window/);
  });

  it("rejects a movement type outside the recorded shrink set", () => {
    for (const bad of ["receipt", "issue", "reserve", "stock_take"]) {
      const value = fixture();
      value.drivers.recent_shrink[0].type = bad;
      expect(() => parse(value)).toThrow(/unknown recorded movement type/);
    }
  });

  it("rejects a non-positive recorded movement quantity", () => {
    const value = fixture();
    value.drivers.issued_today[0].qty = "0";
    expect(() => parse(value)).toThrow(/movement quantity must be positive/);
  });

  it("rejects an evidence window that is not a sane integer", () => {
    for (const bad of [0, 7.5, 91, "7"]) {
      const value = fixture() as Record<string, unknown>;
      value.evidence_window_days = bad;
      expect(() => parse(value)).toThrow(/evidence window is invalid/);
    }
  });

  it("rejects a detail limit outside the snapshot's own contract", () => {
    for (const bad of [0, 21, 1.5, "6"]) {
      const value = fixture() as Record<string, unknown>;
      value.detail_limit = bad;
      expect(() => parse(value)).toThrow(/detail limit is invalid/);
    }
  });

  // ── receivability mirrors the RPC ────────────────────────────────────────────────────────────
  it("rejects a receivable receipt that still carries a blocker", () => {
    const value = fixture();
    value.drivers.receivable[0].blockers = ["unquantified_line"];
    expect(() => parse(value)).toThrow(/receivable disagrees with the recorded blockers/);
  });

  it("rejects a blocked receipt with no recorded blocker", () => {
    const value = fixture();
    value.drivers.blocked[0].blockers = [];
    expect(() => parse(value)).toThrow(/receivable disagrees with the recorded blockers/);
  });

  it("rejects a receipt sitting in the wrong receivability bucket", () => {
    const value = fixture();
    value.drivers.blocked[0].receivable = true;
    expect(() => parse(value)).toThrow(/wrong receivability bucket/);
  });

  it("rejects an unknown or repeated blocker code", () => {
    // `unit_mismatch` is deliberately NOT a blocker: fn_post_receipt passes NULL as the movement unit
    // so fn_post_movement defaults to the item's own unit and can never raise it on this path.
    for (const bad of ["unit_mismatch", "stock_take_missing", "over_receipt"]) {
      const unknown = fixture();
      unknown.drivers.blocked[0].blockers = [bad];
      expect(() => parse(unknown)).toThrow(/unknown blocker code/);
    }
    // With exactly one legal code today, a repeated blocker is caught by the bound first; the
    // distinctness guard behind it stays for when a second code is added.
    const repeated = fixture();
    repeated.drivers.blocked[0].blockers = ["unquantified_line", "unquantified_line"];
    expect(() => parse(repeated)).toThrow(/blockers must be a bounded array/);
  });

  it("keeps the item unit a line carries, because that is the unit the receipt records", () => {
    const value = fixture();
    value.drivers.receivable[0].lines = [line({ unit: "لتر", item_unit: "كجم" })];
    const parsed = parse(value).drivers.receivable[0].lines[0];
    expect(parsed.unit).toBe("لتر");
    expect(parsed.itemUnit).toBe("كجم");
  });

  it("rejects a shown receipt with no open line", () => {
    const value = fixture();
    value.drivers.receivable[0].open_line_count = "0";
    expect(() => parse(value)).toThrow(/must have at least one open line/);
  });

  it("rejects a shown line that no longer owes stock", () => {
    const value = fixture();
    value.drivers.receivable[0].lines = [line({ ordered: "10", received: "10", remaining: "0" })];
    expect(() => parse(value)).toThrow(/must still owe stock/);
  });

  it("rejects line quantities that do not reconcile in exact decimal space", () => {
    const value = fixture();
    value.drivers.receivable[0].lines = [line({ ordered: "10.1", received: "0.2", remaining: "9.8" })];
    expect(() => parse(value)).toThrow(/receipt line quantities do not reconcile/);
  });

  it("accepts line quantities a JS double would misjudge", () => {
    const value = fixture();
    value.drivers.receivable[0].lines = [line({ ordered: "0.3", received: "0.1", remaining: "0.2" })];
    expect(parse(value).drivers.receivable[0].lines[0].remaining).toBe("0.2");
  });

  // ── stock readings ───────────────────────────────────────────────────────────────────────────
  it("rejects a reorder reading without a positive recorded threshold", () => {
    const value = fixture();
    value.drivers.below_reorder[0].threshold = "0";
    expect(() => parse(value)).toThrow(/positive recorded threshold/);
  });

  it("rejects a reorder reading that is not actually below its threshold", () => {
    const value = fixture();
    value.drivers.below_reorder[0].available = "10";
    expect(() => parse(value)).toThrow(/not below reorder/);
  });

  it("rejects a reorder reading with no bin behind it", () => {
    const value = fixture();
    value.drivers.below_reorder[0].bin_count = "0";
    expect(() => parse(value)).toThrow(/no bin is unknown, never a reorder reading/);
  });

  it("rejects an unknown-stock item that smuggles in a balance", () => {
    for (const key of ["available", "threshold"]) {
      const value = fixture() as Record<string, unknown>;
      (value.drivers as { unknown_stock: Record<string, unknown>[] }).unknown_stock[0][key] = "0";
      expect(() => parse(value)).toThrow(/must carry no balance at all/);
    }
  });

  // ── no finance keys, ever ────────────────────────────────────────────────────────────────────
  it("exposes no finance field on any parsed row", () => {
    const snapshot = parse(fixture());
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of ["est_cost", "unitCost", "unit_cost", "amount", "price", "total", "egp"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("exposes no completed-stock-take claim on the parsed snapshot", () => {
    const snapshot = parse(fixture()) as unknown as Record<string, unknown>;
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of ["stockTake", "stock_take", "counted", "جرد"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(Object.keys(snapshot.recorded as Record<string, unknown>)).toEqual([
      "openReceipts", "receivableNow", "blockedReceipts", "overdueReceipts", "dueTodayReceipts",
      "upcomingReceipts", "undatedReceipts", "openReceiptLines", "issuedToday", "belowReorder",
      "unknownStock", "recentShrink",
    ]);
  });

  it("rejects an authority status outside the known set", () => {
    const value = fixture() as Record<string, unknown>;
    value.authority = { inventory: "great" };
    expect(() => parse(value)).toThrow(/invalid authority status for inventory/);
  });

  it("falls back to unverified when no inventory authority is recorded", () => {
    const value = fixture() as Record<string, unknown>;
    value.authority = {};
    expect(parse(value).authority.inventory).toBe("unverified");
  });

  it("rejects a root, recorded or drivers branch that is not an object", () => {
    expect(() => parse(null)).toThrow(/root must be an object/);
    const noRecorded = fixture() as Record<string, unknown>;
    noRecorded.recorded = null;
    expect(() => parse(noRecorded)).toThrow(/recorded must be an object/);
    const noDrivers = fixture() as Record<string, unknown>;
    noDrivers.drivers = null;
    expect(() => parse(noDrivers)).toThrow(/drivers must be an object/);
  });
});
