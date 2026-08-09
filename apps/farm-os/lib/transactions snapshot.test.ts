import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTransactionsSnapshot } from "./transactions snapshot";

const baseRow = {
  id: "expense-a",
  type: "expense",
  event_date: "2026-08-08",
  category: "تشغيل",
  description: null,
  crop: null,
  quantity: null,
  unit: null,
  pending_price: false,
  party_id: "supplier-a",
  party_name: "مورد",
  amount: "100000000000000.01",
  direction: "out",
  collected_by: null,
  movement_type: null,
};

const valid = {
  version: "farm-os.transactions.v1",
  org_id: "org-a",
  row_limit: 400,
  party_mismatch_count: 0,
  counts: { expense: 1, sale: 0, collection: 0, custody: 0, pending_price: 0 },
  rows: [baseRow],
};

describe("transactions snapshot", () => {
  it("preserves money beyond JavaScript precision", () => {
    expect(parseTransactionsSnapshot(valid, "org-a").rows[0].amount).toBe("100000000000000.01");
  });

  it.each([
    null,
    {},
    { ...valid, version: "wrong" },
    { ...valid, org_id: "org-b" },
    { ...valid, row_limit: 0 },
    { ...valid, party_mismatch_count: 1 },
    { ...valid, counts: { ...valid.counts, pending_price: 2 } },
    { ...valid, rows: [{ ...baseRow, amount: 12 }] },
    { ...valid, rows: [{ ...baseRow, pending_price: "no" }] },
    { ...valid, rows: [{ ...baseRow, party_name: null }] },
  ])("rejects malformed, inexact, or tenant-drift payload %#", (payload) => {
    expect(() => parseTransactionsSnapshot(payload, "org-a")).toThrow("transactions snapshot:");
  });

  it("rejects incomplete and duplicate samples", () => {
    expect(() => parseTransactionsSnapshot({ ...valid, counts: { ...valid.counts, expense: 2 } }, "org-a"))
      .toThrow("expense row sample is incomplete");
    expect(() => parseTransactionsSnapshot({ ...valid, counts: { ...valid.counts, expense: 2 }, rows: [baseRow, baseRow] }, "org-a"))
      .toThrow("duplicate row expense:expense-a");
  });

  it("rejects impossible type, direction, and sale-price combinations", () => {
    expect(() => parseTransactionsSnapshot({ ...valid, rows: [{ ...baseRow, type: "other" }] }, "org-a"))
      .toThrow("transaction type is invalid");
    expect(() => parseTransactionsSnapshot({ ...valid, rows: [{ ...baseRow, direction: "in" }] }, "org-a"))
      .toThrow("fixed transaction direction is invalid");
    const sale = { ...baseRow, id: "sale-a", type: "sale", direction: "in", crop: "برحي", party_id: null, party_name: null };
    expect(() => parseTransactionsSnapshot({ ...valid, counts: { ...valid.counts, expense: 0, sale: 1 }, rows: [{ ...sale, pending_price: true }] }, "org-a"))
      .toThrow("sale price state and amount disagree");
    expect(() => parseTransactionsSnapshot({ ...valid, counts: { ...valid.counts, expense: 0, sale: 1 }, rows: [{ ...sale, crop: null }] }, "org-a"))
      .toThrow("sale crop is missing");
    const custody = { ...baseRow, id: "custody-a", type: "custody", direction: "in", movement_type: null };
    expect(() => parseTransactionsSnapshot({ ...valid, counts: { ...valid.counts, expense: 0, custody: 1 }, rows: [custody] }, "org-a"))
      .toThrow("custody movement type is missing");
  });

  it("permits the same source UUID across types because the page key includes the full type", () => {
    const sharedId = "shared-id";
    const collection = {
      ...baseRow,
      id: sharedId,
      type: "collection",
      direction: "in",
      party_id: null,
      party_name: null,
    };
    const custody = {
      ...collection,
      type: "custody",
      movement_type: "استلام عهدة",
    };
    expect(parseTransactionsSnapshot({
      ...valid,
      counts: { ...valid.counts, expense: 0, collection: 1, custody: 1 },
      rows: [collection, custody],
    }, "org-a").rows).toHaveLength(2);

    const source = readFileSync(join(process.cwd(), "app/(app)/transactions/page.tsx"), "utf8");
    expect(source).toContain('id: `${item.type}-${item.id}`');
    expect(source).not.toContain("item.type[0]");
  });

  it("binds the page to one exact RPC and no direct source reads or money Number conversion", () => {
    const source = readFileSync(join(process.cwd(), "app/(app)/transactions/page.tsx"), "utf8");
    expect(source.match(/sb\.rpc\("fn_transactions_snapshot"/g) ?? []).toHaveLength(1);
    expect(source).toContain("parseTransactionsSnapshot(snapshotRes.data, m.orgId)");
    expect(source).not.toMatch(/\.from\("(?:expenses|sales|sale_collections|custody_movements)"\)/);
    expect(source).not.toMatch(/Number\((?:row\.)?(?:amount|amount_in|amount_out|total)/);
    expect(source).toContain('kind: "money-preserve-exact"');
  });
});
