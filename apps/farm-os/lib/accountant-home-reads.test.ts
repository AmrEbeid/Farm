import { describe, expect, it } from "vitest";
import { ACCOUNTANT_HOME_SNAPSHOT_VERSION, parseAccountantHomeSnapshot } from "./accountant-home-reads";

const orgId = "22400000-0000-4000-8000-0000000000a0";
const asOf = "2026-08-23";
const cutover = "2026-07-01";
const id = "22400000-0000-4000-8000-000000000001";

function fixture(verified = false) {
  const money = (value: string) => verified ? value : null;
  return {
    version: ACCOUNTANT_HOME_SNAPSHOT_VERSION,
    org_id: orgId,
    as_of: asOf,
    cutover,
    month_start: "2026-08-01",
    month_end: "2026-09-01",
    previous_month_start: "2026-07-01",
    previous_month_end: "2026-08-01",
    detail_limit: 2,
    authority: verified ? "verified" : "partial",
    money_available: verified,
    state: {
      period: { open_count: "1", locked_count: "2", as_of_locked: false },
      custody: { account_count: "1", total_target_float: money("1000.25"), total_closing_balance: money("-20.5") },
    },
    queues: {
      close_blockers: {
        pending_price_count: "3", undated_expense_count: "1", undated_expense_known_total: money("10"),
        undated_expense_unknown_count: "1", unrouted_count: "2", unrouted_known_total: money("20"),
        unrouted_unknown_count: "0", unclassified_count: "3", unclassified_known_total: money("30"),
        unclassified_unknown_count: "0", unallocated_count: "4", unallocated_known_total: money("40"),
        unallocated_unknown_count: "0",
      },
      pending_pricing: { count: "3" },
      receivables: { aged_count: "1", aged_total: money("50"), open_count: "2", open_total: money("60") },
      reconciliation: { batch_count: "4", staged_batch_count: "1", owner_waiting_count: "1", failed_batch_count: "1" },
      payment_obligations: {
        accountant_actionable_count: "2", owner_blocked_count: "1",
        operating_unpaid_count: "2", operating_unpaid_total: money("70"), operating_unpaid_unknown_count: "1",
        capex_unpaid_count: "1", capex_unpaid_total: money("80"), capex_unpaid_unknown_count: "0",
        drawing_excluded_count: "1",
      },
    },
    attention: {
      close_blocker_count: "13", ledger_gap_count: "10", pending_pricing_count: "3",
      aged_receivables_count: "1", reconciliation_actionable_count: "1",
      payment_obligations_actionable_count: "2", payment_obligations_owner_blocked_count: "1",
    },
    comparison: verified
      ? { comparable: true, current_month_posted_count: "9", previous_month_posted_count: "8", reason: null }
      : { comparable: false, current_month_posted_count: null, previous_month_posted_count: null, reason: "not verified" },
    drivers: {
      pending_pricing: [{ id, sale_date: asOf, crop: "برحي", qty: null, unit: "", buyer_name: "عميل", delivery_note_no: null }],
      receivables: [{ id, sale_date: asOf, crop: "برحي", buyer_name: "عميل", total: money("100"), collected: money("40"), remaining: money("60") }],
      reconciliation: [{ id, status: "staged", unreviewed_count: "2" }],
      payment_obligations: [{
        id, request_no: "12", status: "approved_operational", period_start: "2026-08-01",
        period_end: "2026-08-31", approved_net_request: money("90"), owner_blocked: true,
      }],
      custody_accounts: [{ id, holder_label: "عهدة", target_float: money("1000"), closing_balance: money("-20.5") }],
    },
  };
}

describe("parseAccountantHomeSnapshot", () => {
  it("preserves exact count and decimal strings in both authority states", () => {
    const hidden = parseAccountantHomeSnapshot(fixture(), orgId, asOf, cutover);
    expect(hidden.attention.ledgerGapCount).toBe("10");
    expect(hidden.queues.receivables.openTotal).toBeNull();
    expect(hidden.drivers.pendingPricing[0].qty).toBeNull();

    const verified = parseAccountantHomeSnapshot(fixture(true), orgId, asOf, cutover);
    expect(verified.state.custody.totalTargetFloat).toBe("1000.25");
    expect(verified.drivers.receivables[0].remaining).toBe("60");
    expect(verified.comparison.currentMonthPostedCount).toBe("9");
  });

  it("fails closed on identity, calendar, month, count, and array corruption", () => {
    expect(() => parseAccountantHomeSnapshot({ ...fixture(), org_id: id }, orgId, asOf, cutover)).toThrow(/organization mismatch/);
    expect(() => parseAccountantHomeSnapshot({ ...fixture(), as_of: "2026-02-30" }, orgId, asOf, cutover)).toThrow(/calendar date/);
    expect(() => parseAccountantHomeSnapshot({ ...fixture(), month_end: "2026-10-01" }, orgId, asOf, cutover)).toThrow(/month boundaries/);
    const badCount = fixture();
    badCount.attention.ledger_gap_count = "1.5";
    expect(() => parseAccountantHomeSnapshot(badCount, orgId, asOf, cutover)).toThrow(/exact count text/);
    const unbounded = fixture();
    unbounded.drivers.reconciliation = Array.from({ length: 3 }, () => ({ id, status: "staged", unreviewed_count: "1" }));
    expect(() => parseAccountantHomeSnapshot(unbounded, orgId, asOf, cutover)).toThrow(/bounded array/);
  });

  it("fails closed on authority, money, comparison, and workflow contradictions", () => {
    expect(() => parseAccountantHomeSnapshot({ ...fixture(), authority: "trusted" }, orgId, asOf, cutover)).toThrow(/authority/);
    const leakedMoney = fixture();
    leakedMoney.state.custody.total_target_float = "1";
    expect(() => parseAccountantHomeSnapshot(leakedMoney, orgId, asOf, cutover)).toThrow(/must be null/);
    const missingMoney = fixture(true);
    missingMoney.queues.receivables.open_total = null;
    expect(() => parseAccountantHomeSnapshot(missingMoney, orgId, asOf, cutover)).toThrow(/required/);
    const badComparison = fixture();
    badComparison.comparison.current_month_posted_count = "1";
    expect(() => parseAccountantHomeSnapshot(badComparison, orgId, asOf, cutover)).toThrow(/comparison null/);
    const badPayment = fixture();
    badPayment.drivers.payment_obligations[0].owner_blocked = false;
    expect(() => parseAccountantHomeSnapshot(badPayment, orgId, asOf, cutover)).toThrow(/owner-blocked/);
  });
});
