import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSeasonDashboardSnapshot } from "./season dashboard snapshot";

const row = {
  id: "sale-a",
  event_date: "2026-08-08",
  crop: "برحي",
  quantity: "100000000000000.123456789",
  unit: "كجم",
  amount: "900000000000000.02",
  price_status: "finalized",
  payment_status: "partially_collected",
  revenue_posted: true,
  buyer_id: "buyer-a",
  buyer_name: "تاجر",
  cost_center_id: "center-a",
  delivery_note_no: 7,
  crates: "10.5",
};

const summary = {
  delivery_count: 1,
  trader_count: 1,
  unnamed_count: 0,
  unknown_qty_count: 0,
  pending_count: 0,
  pending_unknown_qty_count: 0,
  invalid_revenue_count: 0,
  delivered_qty: "100000000000000.123456789",
  delivered_tons: "100000000000.000123456789",
  pending_qty: "0",
  pending_tons: "0",
  finalized_total: "900000000000000.02",
  collected_total: "0.02",
  outstanding_total: "900000000000000",
  collection_percent: "0.00000000000000222222222222222217",
  picked_crates: "10.5",
  delivered_crates: "10.5",
};

const center = {
  id: "center-a",
  name: "حوش أ",
  area_feddan: "2.5",
  delivery_count: 1,
  unknown_qty_count: 0,
  pending_count: 0,
  quantity: "100000000000000.123456789",
  quantity_per_feddan: "40000000000000.0493827156",
  finalized_total: "900000000000000.02",
};

const valid = {
  version: "farm-os.season-dashboard.v1",
  org_id: "org-a",
  from: "2026-01-01",
  as_of: "2026-08-08",
  row_limit: 400,
  party_mismatch_count: 0,
  summary,
  rows: [row],
  centers: [center],
};

describe("season dashboard snapshot", () => {
  it("preserves exact quantity, money, area, and per-feddan decimals", () => {
    const parsed = parseSeasonDashboardSnapshot(valid, "org-a", "2026-01-01", "2026-08-08");
    expect(parsed.summary.finalizedTotal).toBe("900000000000000.02");
    expect(parsed.rows[0]?.quantity).toBe("100000000000000.123456789");
    expect(parsed.centers[0]?.areaFeddan).toBe("2.5");
    expect(parsed.centers[0]?.quantityPerFeddan).toBe("40000000000000.0493827156");
  });

  it.each([
    null,
    {},
    { ...valid, version: "wrong" },
    { ...valid, org_id: "org-b" },
    { ...valid, from: "2026-02-30" },
    { ...valid, as_of: "2025-12-31" },
    { ...valid, row_limit: 0 },
    { ...valid, party_mismatch_count: 1 },
    { ...valid, summary: { ...summary, finalized_total: 10 } },
    { ...valid, summary: { ...summary, pending_count: 2 } },
    { ...valid, summary: { ...summary, collection_percent: "100.01" } },
    { ...valid, summary: { ...summary, outstanding_total: "1" } },
    { ...valid, summary: { ...summary, delivered_tons: "1" } },
  ])("rejects malformed, inexact, or tenant-drift payload %#", (payload) => {
    expect(() => parseSeasonDashboardSnapshot(payload, "org-a", "2026-01-01", "2026-08-08"))
      .toThrow("season snapshot:");
  });

  it("rejects incomplete delivery samples and duplicate rows", () => {
    expect(() => parseSeasonDashboardSnapshot({ ...valid, summary: { ...summary, delivery_count: 2 } }, "org-a", "2026-01-01", "2026-08-08"))
      .toThrow("delivery sample is incomplete");
    expect(() => parseSeasonDashboardSnapshot({
      ...valid,
      summary: { ...summary, delivery_count: 2 },
      rows: [row, row],
    }, "org-a", "2026-01-01", "2026-08-08")).toThrow("duplicate row sale-a");
  });

  it("rejects impossible row and center combinations", () => {
    expect(() => parseSeasonDashboardSnapshot({ ...valid, rows: [{ ...row, buyer_name: null }] }, "org-a", "2026-01-01", "2026-08-08"))
      .toThrow("buyer id and name must be present together");
    expect(() => parseSeasonDashboardSnapshot({ ...valid, rows: [{ ...row, price_status: "pending" }] }, "org-a", "2026-01-01", "2026-08-08"))
      .toThrow("sale price state and amount disagree");
    expect(() => parseSeasonDashboardSnapshot({ ...valid, rows: [{ ...row, revenue_posted: false }] }, "org-a", "2026-01-01", "2026-08-08"))
      .toThrow("sale price state and amount disagree");
    expect(() => parseSeasonDashboardSnapshot({ ...valid, rows: [{ ...row, event_date: "2025-12-31" }] }, "org-a", "2026-01-01", "2026-08-08"))
      .toThrow("delivery date is outside the requested window");
    expect(() => parseSeasonDashboardSnapshot({ ...valid, centers: [{ ...center, quantity_per_feddan: "1", area_feddan: null }] }, "org-a", "2026-01-01", "2026-08-08"))
      .toThrow("center invariants are invalid");
  });

  it("binds the page to one exact RPC, exact table primitives, and honest truncation", () => {
    const source = readFileSync(join(process.cwd(), "app/(app)/finance/season/page.tsx"), "utf8");
    expect(source.match(/sb\.rpc\("fn_season_dashboard_snapshot"/g) ?? []).toHaveLength(1);
    expect(source).not.toMatch(/\.from\("(?:sales|sale_collections|buyers|cost_centers|harvest_days)"\)/);
    expect(source).not.toMatch(/Number\((?:row|summary|center|s|c)\./);
    expect(source).toContain('kind: "money-preserve-exact"');
    expect(source).toContain('kind: "decimal-exact"');
    expect(source).toContain('exportFilename={isTruncated ? undefined : "season-deliveries"}');
    expect(source).toContain("summary.deliveryCount > snapshot.rowLimit");
    expect(source).toContain("isCalendarDate(from) && from <= asOf");
  });
});
