// SPEC-0033 R4a — the inventory list / item 360 parsers.
//
// These tests exist to prove the two things a component must never be trusted to do: keep the
// storekeeper's payload free of money and counterparty identity, and refuse a snapshot whose numbers
// do not reconcile. A parser that quietly accepts an incoherent payload is worse than no parser —
// it launders a wrong number into a purchase decision.

import { describe, expect, it } from "vitest";
import {
  INVENTORY_ITEM_SNAPSHOT_VERSION,
  INVENTORY_LIST_SNAPSHOT_VERSION,
  inventoryFiltersForScope,
  inventoryScopeForRole,
  isInventoryListFilter,
  parseInventoryItemSnapshot as parseInventoryItemSnapshotContract,
  parseInventoryListFilter,
  parseInventoryListSnapshot as parseInventoryListSnapshotContract,
  type InventoryListFilter,
  type InventoryScope,
} from "./inventory-snapshot-reads";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const ITEM = "22222222-2222-4222-8222-222222222221";
const ITEM_B = "22222222-2222-4222-8222-222222222222";
const ITEM_C = "22222222-2222-4222-8222-222222222223";
const ITEM_D = "22222222-2222-4222-8222-222222222224";
const MOVE_A = "33333333-3333-4333-8333-333333333331";
const MOVE_B = "33333333-3333-4333-8333-333333333332";
const LINE_A = "44444444-4444-4444-8444-444444444441";
const LINE_B = "44444444-4444-4444-8444-444444444442";
const PR_A = "55555555-5555-4555-8555-555555555551";

type Row = Record<string, unknown>;

// Existing mutation tests derive their expected request from the fixture so each can keep changing
// one payload fact. Dedicated tests below call the real parser directly and prove caller binding.
function parseInventoryListSnapshot(value: unknown, expectedOrgId: string) {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
  return parseInventoryListSnapshotContract(value, {
    orgId: expectedOrgId,
    scope: (row.scope === "finance" ? "finance" : "operational") as InventoryScope,
    query: typeof row.query === "string" ? row.query : null,
    filter: (typeof row.filter === "string" ? row.filter : "all") as InventoryListFilter,
    limit: Number.isInteger(row.limit) ? row.limit as number : 20,
    offset: Number.isInteger(row.offset) ? row.offset as number : 0,
  });
}

function parseInventoryItemSnapshot(value: unknown, expectedOrgId: string, expectedItemId: string) {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
  return parseInventoryItemSnapshotContract(value, {
    orgId: expectedOrgId,
    itemId: expectedItemId,
    scope: (row.scope === "finance" ? "finance" : "operational") as InventoryScope,
    movementLimit: Number.isInteger(row.movement_limit) ? row.movement_limit as number : 10,
    purchaseLimit: Number.isInteger(row.purchase_limit) ? row.purchase_limit as number : 10,
  });
}

/** Clone a payload and replace one value at a dotted/indexed path, so a case edits ONE fact. */
function withPath(base: Row, path: string, value: unknown): Row {
  const clone = structuredClone(base) as Row;
  const keys = path.split(".");
  let node: Record<string, unknown> = clone;
  for (const key of keys.slice(0, -1)) {
    node = node[key] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
  return clone;
}

function withoutKey(base: Row, path: string): Row {
  const clone = structuredClone(base) as Row;
  const keys = path.split(".");
  let node: Record<string, unknown> = clone;
  for (const key of keys.slice(0, -1)) {
    node = node[key] as Record<string, unknown>;
  }
  delete node[keys[keys.length - 1]];
  return clone;
}

// ── list fixtures ─────────────────────────────────────────────────────────────────────────────
// Four items, one per state, so the chips always have something to reconcile against:
//   A below_reorder (2 bins, costed) · B unknown (no bin, costed) · C no_threshold (uncosted) ·
//   D ok (costed).

const SHARED_ROWS = [
  {
    item_id: ITEM, name: "سماد", category: "أسمدة", unit: "كجم", state: "below_reorder",
    bin_count: "2", on_hand: "6", reserved: "1", available: "5",
    threshold: "10", threshold_source: "reorder_point",
  },
  {
    item_id: ITEM_B, name: "مبيد", category: null, unit: "لتر", state: "unknown",
    bin_count: "0", on_hand: null, reserved: null, available: null,
    threshold: "12", threshold_source: "reorder_point",
  },
  {
    item_id: ITEM_C, name: "خيوط", category: "مستهلكات", unit: null, state: "no_threshold",
    bin_count: "1", on_hand: "3", reserved: "0", available: "3",
    threshold: null, threshold_source: null,
  },
  {
    item_id: ITEM_D, name: "أكياس", category: "تعبئة", unit: "كيس", state: "ok",
    bin_count: "1", on_hand: "4", reserved: "0", available: "4",
    threshold: "2", threshold_source: "min_stock",
  },
];

const SHARED_COUNTS = {
  total_items: "4", query_total: "4", matching: "4",
  below_reorder: "1", unknown_stock: "1", no_threshold: "1", ok_stock: "1",
};

function operationalList(): Row {
  return {
    version: INVENTORY_LIST_SNAPSHOT_VERSION,
    org_id: ORG,
    scope: "operational",
    query: null,
    filter: "all",
    limit: 20,
    offset: 0,
    authority: { inventory: "partial" },
    counts: { ...SHARED_COUNTS },
    rows: structuredClone(SHARED_ROWS),
  };
}

function financeList(): Row {
  const costs = [
    { unit_cost: "10", valuation: "60" },
    { unit_cost: "5", valuation: null },
    { unit_cost: null, valuation: null },
    { unit_cost: "2", valuation: "8" },
  ];
  return {
    ...operationalList(),
    scope: "finance",
    counts: { ...SHARED_COUNTS, uncosted: "1" },
    valuation: {
      known_total: "68", valued_items: "2", unknown_cost_items: "1", unknown_stock_items: "1",
    },
    rows: structuredClone(SHARED_ROWS).map((row, index) => ({ ...row, ...costs[index] })),
  };
}

// ── item fixtures ─────────────────────────────────────────────────────────────────────────────

function operationalItem(): Row {
  return {
    version: INVENTORY_ITEM_SNAPSHOT_VERSION,
    org_id: ORG,
    item_id: ITEM,
    scope: "operational",
    movement_limit: 10,
    purchase_limit: 10,
    authority: { inventory: "verified" },
    item: {
      name: "سماد", category: "أسمدة", unit: "كجم", pack_size: "50",
      criticality: "عالية", expiry_tracked: false,
    },
    policy: {
      min_stock: "5", max_stock: "100", safety_stock: "2", reorder_point: "10",
      reorder_qty: "40", lead_time_days: "3", threshold: "10", threshold_source: "reorder_point",
    },
    stock: {
      bin_count: "2", state: "below_reorder", on_hand: "6", reserved: "1",
      available: "5", ordered: "0", projected: "5",
    },
    locations: [
      { location: "main", on_hand: "4", reserved: "1", available: "3", ordered: "0", projected: "3" },
      { location: "store2", on_hand: "2", reserved: "0", available: "2", ordered: "0", projected: "2" },
    ],
    movements: {
      total: "2",
      rows: [
        {
          id: MOVE_A, type: "issue", qty: "2", unit: "كجم", location: "main",
          occurred_on: "2026-08-22", batch_no: null, expiry_date: null,
        },
        {
          id: MOVE_B, type: "receipt", qty: "5", unit: "كجم", location: "main",
          occurred_on: "2026-08-20", batch_no: "B-1", expiry_date: "2027-01-01",
        },
      ],
    },
    purchases: {
      total: "2",
      open_total: "1",
      rows: [
        {
          id: LINE_A, code: "PR-2", status: "approved", needed_by: "2026-08-30",
          ordered: "10", received: "4", remaining: "6", unit: "كجم", item_unit: "كجم",
        },
        {
          id: LINE_B, code: "PR-1", status: "received", needed_by: null,
          ordered: "3", received: "3", remaining: "0", unit: "لتر", item_unit: "كجم",
        },
      ],
    },
  };
}

function financeItem(): Row {
  const base = operationalItem();
  const movements = base.movements as { total: string; rows: Row[] };
  const purchases = base.purchases as { total: string; open_total: string; rows: Row[] };
  return {
    ...base,
    scope: "finance",
    unit_cost: "10",
    valuation: "60",
    supplier: { name: "تبارك للأسمدة", lead_time_days: "4" },
    movements: {
      ...movements,
      rows: movements.rows.map((row, index) => ({ ...row, unit_cost: index === 0 ? null : "9.5" })),
    },
    purchases: {
      ...purchases,
      rows: purchases.rows.map((row, index) => ({
        ...row,
        pr_id: PR_A,
        est_cost: index === 0 ? "120.00" : null,
        reason: index === 0 ? "تجهيز الموسم" : null,
      })),
    },
  };
}

describe("inventory scope selection", () => {
  it("gives the storekeeper the operational scope and every other role the finance scope", () => {
    expect(inventoryScopeForRole("storekeeper")).toBe("operational");
    for (const role of ["owner", "farm_manager", "accountant", "agri_engineer", "supervisor"] as const) {
      expect(inventoryScopeForRole(role)).toBe("finance");
    }
  });

  it("offers «بلا تكلفة» only to the finance scope", () => {
    expect(inventoryFiltersForScope("finance")).toContain("uncosted");
    expect(inventoryFiltersForScope("operational")).not.toContain("uncosted");
    expect(parseInventoryListFilter("uncosted", "operational")).toBe("all");
    expect(parseInventoryListFilter("uncosted", "finance")).toBe("uncosted");
    expect(parseInventoryListFilter("nonsense", "finance")).toBe("all");
    expect(parseInventoryListFilter(undefined, "finance")).toBe("all");
    expect(isInventoryListFilter("below_reorder")).toBe(true);
    expect(isInventoryListFilter("reorder")).toBe(false);
  });
});

describe("inventory list snapshot parser", () => {
  it("binds the payload to the caller's role scope and exact request arguments", () => {
    const expected = {
      orgId: ORG,
      scope: "operational" as const,
      query: null,
      filter: "all" as const,
      limit: 20,
      offset: 0,
    };
    expect(() => parseInventoryListSnapshotContract(financeList(), expected))
      .toThrow(/role scope mismatch/);
    for (const changed of [
      { ...expected, query: "سماد" },
      { ...expected, filter: "unknown" as const },
      { ...expected, limit: 10 },
      { ...expected, offset: 20 },
    ]) {
      expect(() => parseInventoryListSnapshotContract(operationalList(), changed))
        .toThrow(/request arguments mismatch/);
    }
  });

  it("parses the finance payload with its money keys intact", () => {
    const parsed = parseInventoryListSnapshot(financeList(), ORG);
    expect(parsed.scope).toBe("finance");
    if (parsed.scope !== "finance") throw new Error("unreachable");
    expect(parsed.counts.uncosted).toBe("1");
    expect(parsed.valuation.knownTotal).toBe("68");
    expect(parsed.rows[0].unitCost).toBe("10");
    expect(parsed.rows[0].valuation).toBe("60");
    // Unknown cost is null, never zero, and its item is excluded from the total.
    expect(parsed.rows[2].unitCost).toBeNull();
    expect(parsed.rows[2].valuation).toBeNull();
  });

  it("parses the operational payload and gives it no money property at all", () => {
    const parsed = parseInventoryListSnapshot(operationalList(), ORG);
    expect(parsed.scope).toBe("operational");
    expect(Object.keys(parsed)).not.toContain("valuation");
    expect(Object.keys(parsed.counts)).not.toContain("uncosted");
    for (const row of parsed.rows) {
      expect(Object.keys(row)).not.toContain("unitCost");
      expect(Object.keys(row)).not.toContain("valuation");
    }
  });

  it("refuses an operational payload that carries any money or counterparty key", () => {
    for (const [path, value] of [
      ["counts.uncosted", "1"],
      ["rows.0.unit_cost", "10"],
      ["rows.0.valuation", "60"],
    ] as const) {
      expect(() => parseInventoryListSnapshot(withPath(operationalList(), path, value), ORG)).toThrow();
    }
    // A leak inside an object the parser does not otherwise read is still caught by the deep walk.
    const smuggled = operationalList();
    (smuggled.authority as Row).supplier = { name: "مورد" };
    expect(() => parseInventoryListSnapshot(smuggled, ORG)).toThrow(/operational payload carries/);
  });

  it("refuses a finance payload that has stopped sending its money keys", () => {
    expect(() => parseInventoryListSnapshot(withoutKey(financeList(), "rows.0.unit_cost"), ORG)).toThrow();
    expect(() => parseInventoryListSnapshot(withoutKey(financeList(), "counts.uncosted"), ORG)).toThrow();
    expect(() => parseInventoryListSnapshot(withoutKey(financeList(), "valuation"), ORG)).toThrow();
  });

  it("refuses a filter the caller's own scope may not use", () => {
    expect(() => parseInventoryListSnapshot(
      { ...operationalList(), filter: "uncosted" }, ORG,
    )).toThrow(/not valid for this role scope/);
  });

  it("keeps an unknown balance unknown rather than zero", () => {
    const parsed = parseInventoryListSnapshot(operationalList(), ORG);
    expect(parsed.rows[1].state).toBe("unknown");
    expect(parsed.rows[1].available).toBeNull();
    expect(parsed.rows[1].onHand).toBeNull();
    // A zero balance on an item with no bin row would be an invention.
    expect(() => parseInventoryListSnapshot(
      withPath(withPath(withPath(operationalList(), "rows.1.on_hand", "0"), "rows.1.reserved", "0"), "rows.1.available", "0"),
      ORG,
    )).toThrow(/balance presence contradicts its bin count/);
    // And a missing balance on an item that HAS bins would hide real stock.
    expect(() => parseInventoryListSnapshot(
      withPath(operationalList(), "rows.0.available", null), ORG,
    )).toThrow(/balance presence contradicts its bin count/);
  });

  it("refuses a state that contradicts the numbers behind it", () => {
    // At or above the threshold is not below reorder.
    expect(() => parseInventoryListSnapshot(
      withPath(operationalList(), "rows.0.threshold", "5"), ORG,
    )).toThrow(/not below reorder/);
    // Under the threshold cannot read as ok.
    expect(() => parseInventoryListSnapshot(
      withPath(operationalList(), "rows.3.threshold", "9"), ORG,
    )).toThrow(/cannot read as ok/);
    // A positive recorded threshold means there IS something to read against.
    expect(() => parseInventoryListSnapshot(
      withPath(withPath(operationalList(), "rows.2.threshold", "7"), "rows.2.threshold_source", "min_stock"),
      ORG,
    )).toThrow(/positive recorded threshold to read against/);
    // A threshold with no source (or the reverse) is an incoherent policy.
    expect(() => parseInventoryListSnapshot(
      withPath(operationalList(), "rows.0.threshold_source", null), ORG,
    )).toThrow(/threshold and its source disagree/);
    // available must be on_hand − reserved, compared in exact decimal space.
    expect(() => parseInventoryListSnapshot(
      withPath(operationalList(), "rows.0.available", "4"), ORG,
    )).toThrow(/does not reconcile/);
  });

  it("refuses counts that do not partition the searched set exactly", () => {
    expect(() => parseInventoryListSnapshot(
      withPath(financeList(), "counts.ok_stock", "2"), ORG,
    )).toThrow(/do not partition/);
    expect(() => parseInventoryListSnapshot(
      withPath(financeList(), "counts.total_items", "3"), ORG,
    )).toThrow(/more items than the organization has/);
    expect(() => parseInventoryListSnapshot(
      withPath(financeList(), "counts.uncosted", "9"), ORG,
    )).toThrow(/lack a cost than the search matched/);
  });

  it("makes the page total agree with the chip the caller chose", () => {
    const below = {
      ...operationalList(),
      filter: "below_reorder",
      counts: { ...SHARED_COUNTS, matching: "1" },
      rows: [structuredClone(SHARED_ROWS[0])],
    };
    expect(parseInventoryListSnapshot(below, ORG).counts.matching).toBe("1");
    expect(() => parseInventoryListSnapshot(
      { ...below, counts: { ...SHARED_COUNTS, matching: "2" } }, ORG,
    )).toThrow(/contradicts its own filter count/);
    // A filtered page may only contain rows of that state.
    expect(() => parseInventoryListSnapshot(
      { ...below, rows: [structuredClone(SHARED_ROWS[3])] }, ORG,
    )).toThrow();
  });

  it("holds the page to its exact total, limit and offset", () => {
    const page = {
      ...operationalList(),
      limit: 2,
      offset: 2,
      counts: { ...SHARED_COUNTS },
      rows: structuredClone(SHARED_ROWS).slice(2),
    };
    expect(parseInventoryListSnapshot(page, ORG).rows).toHaveLength(2);
    // Only one item remains after an offset of three, so a two-row page is a page that invented one.
    expect(() => parseInventoryListSnapshot({ ...page, offset: 3 }, ORG))
      .toThrow(/does not match its exact total, limit and offset/);
    // A page past the end is empty, not an error.
    expect(parseInventoryListSnapshot({ ...page, offset: 4, rows: [] }, ORG).rows).toHaveLength(0);
  });

  it("refuses rows that are out of order or repeated", () => {
    const reordered = operationalList();
    const rows = reordered.rows as Row[];
    reordered.rows = [rows[3], rows[0], rows[1], rows[2]];
    expect(() => parseInventoryListSnapshot(reordered, ORG)).toThrow(/not ordered exceptions first/);

    const repeated = operationalList();
    (repeated.rows as Row[])[3] = structuredClone((repeated.rows as Row[])[0]);
    expect(() => parseInventoryListSnapshot(repeated, ORG)).toThrow();
  });

  it("refuses a valuation that is not the balance times the recorded cost", () => {
    expect(() => parseInventoryListSnapshot(
      withPath(financeList(), "rows.0.valuation", "61"), ORG,
    )).toThrow(/does not reconcile with balance/);
    // An item with no cost or no balance may not carry a valuation at all.
    expect(() => parseInventoryListSnapshot(
      withPath(financeList(), "rows.2.valuation", "0"), ORG,
    )).toThrow(/valued without a recorded balance and cost/);
    // Valued plus unvaluable must account for every searched item.
    expect(() => parseInventoryListSnapshot(
      withPath(financeList(), "valuation.valued_items", "3"), ORG,
    )).toThrow(/do not reconcile with the searched total/);
  });

  it("refuses a payload from the wrong contract or the wrong organization", () => {
    expect(() => parseInventoryListSnapshot(
      withPath(operationalList(), "version", "farm-os.inventory-list.v2"), ORG,
    )).toThrow(/version mismatch/);
    expect(() => parseInventoryListSnapshot(operationalList(), OTHER_ORG)).toThrow(/organization mismatch/);
    expect(() => parseInventoryListSnapshot(withPath(operationalList(), "scope", "money"), ORG))
      .toThrow(/unknown role scope/);
    expect(() => parseInventoryListSnapshot(null, ORG)).toThrow();
    expect(() => parseInventoryListSnapshot([], ORG)).toThrow();
  });

  it("refuses a count or quantity that is not exact text", () => {
    expect(() => parseInventoryListSnapshot(withPath(operationalList(), "counts.query_total", 4), ORG)).toThrow();
    expect(() => parseInventoryListSnapshot(withPath(operationalList(), "rows.0.on_hand", 6), ORG))
      .toThrow(/must be decimal text/);
    expect(() => parseInventoryListSnapshot(withPath(operationalList(), "rows.0.bin_count", "-1"), ORG))
      .toThrow(/exact count text/);
  });
});

describe("inventory item snapshot parser", () => {
  it("binds the payload to the caller's role scope and exact sample limits", () => {
    const expected = {
      orgId: ORG,
      itemId: ITEM,
      scope: "operational" as const,
      movementLimit: 10,
      purchaseLimit: 10,
    };
    expect(() => parseInventoryItemSnapshotContract(financeItem(), expected))
      .toThrow(/role scope mismatch/);
    expect(() => parseInventoryItemSnapshotContract(operationalItem(), { ...expected, movementLimit: 5 }))
      .toThrow(/request arguments mismatch/);
    expect(() => parseInventoryItemSnapshotContract(operationalItem(), { ...expected, purchaseLimit: 5 }))
      .toThrow(/request arguments mismatch/);
  });

  it("parses the finance payload with cost, valuation and supplier", () => {
    const parsed = parseInventoryItemSnapshot(financeItem(), ORG, ITEM);
    expect(parsed.scope).toBe("finance");
    if (parsed.scope !== "finance") throw new Error("unreachable");
    expect(parsed.unitCost).toBe("10");
    expect(parsed.valuation).toBe("60");
    expect(parsed.supplier?.name).toBe("تبارك للأسمدة");
    expect(parsed.purchases[0].prId).toBe(PR_A);
    expect(parsed.purchases[0].estCost).toBe("120");
    expect(parsed.movements[1].unitCost).toBe("9.5");
  });

  it("parses the operational payload and gives it no money or counterparty property", () => {
    const parsed = parseInventoryItemSnapshot(operationalItem(), ORG, ITEM);
    expect(parsed.scope).toBe("operational");
    for (const forbidden of ["unitCost", "valuation", "supplier"]) {
      expect(Object.keys(parsed)).not.toContain(forbidden);
    }
    for (const row of parsed.purchases) {
      expect(Object.keys(row)).not.toContain("prId");
      expect(Object.keys(row)).not.toContain("estCost");
      expect(Object.keys(row)).not.toContain("reason");
    }
    for (const row of parsed.movements) {
      expect(Object.keys(row)).not.toContain("unitCost");
    }
  });

  it("refuses an operational item payload that carries money, a supplier or a purchase-request id", () => {
    for (const path of ["unit_cost", "purchases.rows.0.est_cost", "purchases.rows.0.pr_id",
      "purchases.rows.0.reason", "movements.rows.0.unit_cost"]) {
      const leaked = withPath(operationalItem(), path, "1");
      expect(() => parseInventoryItemSnapshot(leaked, ORG, ITEM), path).toThrow();
    }
    const supplier = operationalItem();
    supplier.supplier = { name: "مورد", lead_time_days: "2" };
    expect(() => parseInventoryItemSnapshot(supplier, ORG, ITEM)).toThrow(/operational payload carries/);
  });

  it("proves the aggregate is the sum of EVERY published location", () => {
    const parsed = parseInventoryItemSnapshot(operationalItem(), ORG, ITEM);
    expect(parsed.locations).toHaveLength(2);
    expect(parsed.stock.onHand).toBe("6");
    // The first-bin bug this contract exists to fix: an aggregate that is only one location's stock.
    expect(() => parseInventoryItemSnapshot(
      withPath(withPath(withPath(operationalItem(), "stock.on_hand", "4"), "stock.available", "3"), "stock.projected", "3"),
      ORG, ITEM,
    )).toThrow(/does not sum every published location/);
    // A dropped location contradicts the bin count it claims to describe.
    const dropped = operationalItem();
    dropped.locations = [(dropped.locations as Row[])[0]];
    expect(() => parseInventoryItemSnapshot(dropped, ORG, ITEM))
      .toThrow(/do not account for every bin/);
    // A location whose own available does not reconcile is refused too.
    expect(() => parseInventoryItemSnapshot(
      withPath(operationalItem(), "locations.0.available", "4"), ORG, ITEM,
    )).toThrow(/does not reconcile with its balances/);
  });

  it("keeps an item with no bin unknown, with no balance of any kind", () => {
    const empty = operationalItem();
    empty.stock = {
      bin_count: "0", state: "unknown", on_hand: null, reserved: null,
      available: null, ordered: null, projected: null,
    };
    empty.locations = [];
    const parsed = parseInventoryItemSnapshot(empty, ORG, ITEM);
    expect(parsed.stock.state).toBe("unknown");
    expect(parsed.stock.available).toBeNull();
    expect(parsed.stock.ordered).toBeNull();
    // Ordered/projected must follow the same rule as the balances.
    expect(() => parseInventoryItemSnapshot(
      withPath(empty, "stock.ordered", "0"), ORG, ITEM,
    )).toThrow(/ordered\/projected presence contradicts the bin count/);
  });

  it("publishes the threshold the recorded policy actually implies", () => {
    // reorder_point wins over min_stock, and the source must say so.
    expect(() => parseInventoryItemSnapshot(
      withPath(operationalItem(), "policy.threshold_source", "min_stock"), ORG, ITEM,
    )).toThrow(/not the recorded policy value/);
    expect(() => parseInventoryItemSnapshot(
      withPath(operationalItem(), "policy.threshold", "5"), ORG, ITEM,
    )).toThrow(/not the recorded policy value/);
    // With no reorder point the min stock becomes the threshold — and the state is then read
    // against THAT value, so an available of 5 against a min stock of 5 is «ok», not below reorder.
    const minOnly = withPath(
      withPath(
        withPath(
          withPath(operationalItem(), "policy.reorder_point", null),
          "policy.threshold", "5",
        ),
        "policy.threshold_source", "min_stock",
      ),
      "stock.state", "ok",
    );
    expect(parseInventoryItemSnapshot(minOnly, ORG, ITEM).policy.thresholdSource).toBe("min_stock");
    expect(parseInventoryItemSnapshot(minOnly, ORG, ITEM).stock.threshold).toBe("5");
  });

  it("accepts a recorded lead time that is negative rather than blanking the page", () => {
    // The column carries no non-negativity check, so corrupt data must stay visible.
    const negative = withPath(operationalItem(), "policy.lead_time_days", "-2");
    expect(parseInventoryItemSnapshot(negative, ORG, ITEM).policy.leadTimeDays).toBe("-2");
    expect(() => parseInventoryItemSnapshot(
      withPath(operationalItem(), "policy.lead_time_days", "2.5"), ORG, ITEM,
    )).toThrow(/exact whole-number text/);
  });

  it("holds each bounded sample to its own exact total", () => {
    expect(() => parseInventoryItemSnapshot(
      withPath(operationalItem(), "movements.total", "5"), ORG, ITEM,
    )).toThrow(/movement sample does not match its exact total/);
    expect(() => parseInventoryItemSnapshot(
      withPath(operationalItem(), "purchases.total", "5"), ORG, ITEM,
    )).toThrow(/purchase sample does not match its exact total/);
    // A truncated sample is legal exactly when the limit explains it.
    const truncated = withPath(withPath(operationalItem(), "movement_limit", 1), "movements.total", "4");
    (truncated.movements as { rows: Row[] }).rows = [(operationalItem().movements as { rows: Row[] }).rows[0]];
    expect(parseInventoryItemSnapshot(truncated, ORG, ITEM).movements).toHaveLength(1);
    expect(() => parseInventoryItemSnapshot(
      withPath(operationalItem(), "purchases.open_total", "3"), ORG, ITEM,
    )).toThrow(/more purchase lines are open than exist/);
  });

  it("refuses movements out of order and repeated rows", () => {
    const swapped = operationalItem();
    const rows = (swapped.movements as { rows: Row[] }).rows;
    (swapped.movements as { rows: Row[] }).rows = [rows[1], rows[0]];
    expect(() => parseInventoryItemSnapshot(swapped, ORG, ITEM))
      .toThrow(/not ordered most recent first/);

    const repeated = operationalItem();
    (repeated.movements as { rows: Row[] }).rows[1].id = MOVE_A;
    expect(() => parseInventoryItemSnapshot(repeated, ORG, ITEM)).toThrow(/must not repeat a row/);
  });

  it("keeps an unquantified purchase line free of an invented remaining balance", () => {
    const unquantified = withPath(
      withPath(operationalItem(), "purchases.rows.0.ordered", null),
      "purchases.rows.0.remaining", null,
    );
    expect(parseInventoryItemSnapshot(unquantified, ORG, ITEM).purchases[0].ordered).toBeNull();
    expect(() => parseInventoryItemSnapshot(
      withPath(operationalItem(), "purchases.rows.0.ordered", null), ORG, ITEM,
    )).toThrow(/cannot have a remaining balance/);
    expect(() => parseInventoryItemSnapshot(
      withPath(operationalItem(), "purchases.rows.0.remaining", "5"), ORG, ITEM,
    )).toThrow(/purchase line quantities do not reconcile/);
  });

  it("refuses an unknown movement type or purchase status", () => {
    expect(() => parseInventoryItemSnapshot(
      withPath(operationalItem(), "movements.rows.0.type", "invented"), ORG, ITEM,
    )).toThrow(/unknown recorded movement type/);
    expect(() => parseInventoryItemSnapshot(
      withPath(operationalItem(), "purchases.rows.0.status", "invented"), ORG, ITEM,
    )).toThrow(/unknown purchase request status/);
  });

  it("refuses a payload from the wrong contract, organization or item", () => {
    expect(() => parseInventoryItemSnapshot(
      withPath(operationalItem(), "version", "farm-os.inventory-item.v2"), ORG, ITEM,
    )).toThrow(/version mismatch/);
    expect(() => parseInventoryItemSnapshot(operationalItem(), OTHER_ORG, ITEM)).toThrow(/organization mismatch/);
    expect(() => parseInventoryItemSnapshot(operationalItem(), ORG, ITEM_B)).toThrow(/item mismatch/);
  });

  it("refuses an unexpected key at any nesting level", () => {
    const extra = financeItem();
    (extra.item as Row).secret = "x";
    expect(() => parseInventoryItemSnapshot(extra, ORG, ITEM)).toThrow(/unexpected keys/);
    const extraLocation = financeItem();
    ((extraLocation.locations as Row[])[0] as Row).secret = "x";
    expect(() => parseInventoryItemSnapshot(extraLocation, ORG, ITEM)).toThrow(/unexpected keys/);
  });

  it("defaults an absent authority status to unverified rather than assuming verified", () => {
    const blank = withPath(operationalItem(), "authority", {});
    expect(parseInventoryItemSnapshot(blank, ORG, ITEM).authority.inventory).toBe("unverified");
    expect(() => parseInventoryItemSnapshot(
      withPath(operationalItem(), "authority", { inventory: "gold" }), ORG, ITEM,
    )).toThrow(/invalid authority status/);
  });
});

describe("unused fixture ids stay distinct", () => {
  it("keeps the four list item ids distinct so a repeated row is a real failure", () => {
    expect(new Set([ITEM, ITEM_B, ITEM_C, ITEM_D]).size).toBe(4);
  });
});
