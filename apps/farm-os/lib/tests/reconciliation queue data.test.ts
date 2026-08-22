import { describe, expect, it } from "vitest";
import {
  parseReconciliationQueuePage,
  RECONCILIATION_QUEUE_PAGE_VERSION,
} from "../reconciliation queue data";

const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
];

function row(id: string, overrides: Record<string, unknown> = {}) {
  const evidenceId = id.replace(/000([12])$/, "100$1");
  return {
    id,
    evidence_item_id: evidenceId,
    review_state: "unreviewed",
    review_version: 0,
    disposition: "hold",
    review_reason: null,
    target_table: null,
    frozen: false,
    execution_result: "pending",
    expense_category: null,
    expense_description: null,
    expense_kind: null,
    expense_account_id: null,
    expense_cost_center_id: null,
    expense_supplier_id: null,
    expense_payment_decision: null,
    sale_crop: null,
    sale_quantity: null,
    sale_unit: null,
    sale_unit_price: null,
    sale_recorded_total: null,
    sale_buyer_id: null,
    sale_cost_center_id: null,
    sale_farm_id: null,
    sale_sector_id: null,
    sale_hawsha_id: null,
    sale_season: null,
    sale_delivery_date: null,
    sale_notes: null,
    sale_historical_date_decision: null,
    sale_effective_date: null,
    corrects_expense_id: null,
    corrects_sale_id: null,
    expense_account: null,
    expense_cost_center: null,
    expense_supplier: null,
    sale_buyer: null,
    sale_cost_center: null,
    sale_farm: null,
    sale_sector: null,
    sale_hawsha: null,
    correction_expense: null,
    correction_sale: null,
    evidence: {
      id: evidenceId,
      origin_kind: "source_workbook_row",
      sheet_name: "المصروفات",
      row_locator: "2",
      snapshot_target_table: null,
      snapshot_target_id: null,
      source_amount: 10,
      source_date_text: "2026-08-07",
      source_date_parsed: "2026-08-07",
      classification: "source_addition_candidate",
      invalid_calendar_quality_flag: false,
      evidence_label: "مصروف",
    },
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    version: RECONCILIATION_QUEUE_PAGE_VERSION,
    status: "ok",
    total: 2,
    page: 1,
    page_size: 50,
    counts: {
      total: 2,
      unreviewed: 2,
      included: 0,
      held: 0,
      rejected: 0,
      frozen: 0,
      executed: 0,
    },
    rows: ids.map((id) => row(id)),
    ...overrides,
  };
}

describe("parseReconciliationQueuePage", () => {
  it("accepts a complete first page", () => {
    expect(parseReconciliationQueuePage(payload(), 1, 50)).toEqual({
      total: 2,
      page: 1,
      pageSize: 50,
      counts: {
        total: 2,
        unreviewed: 2,
        reviewed: 0,
        rejected: 0,
        frozen: 0,
        executed: 0,
        included: 0,
        held: 0,
        decided: 0,
        allDecided: false,
      },
      rows: ids.map((id) => row(id)),
    });
  });

  it("validates whole-batch counts independently of the filtered page and derives gate totals", () => {
    expect(
      parseReconciliationQueuePage(
        payload({
          total: 0,
          rows: [],
          counts: {
            total: 8,
            unreviewed: 0,
            included: 2,
            held: 3,
            rejected: 2,
            frozen: 4,
            executed: 1,
          },
        }),
        1,
        50,
      ),
    ).toMatchObject({
      total: 0,
      counts: {
        total: 8,
        unreviewed: 0,
        reviewed: 8,
        included: 2,
        held: 3,
        rejected: 2,
        frozen: 4,
        executed: 1,
        decided: 8,
        allDecided: true,
      },
    });
  });

  it.each(["unreviewed", "reviewed", "rejected", "frozen", "executed"])(
    "accepts the database review state %s",
    (reviewState) => {
      expect(
        parseReconciliationQueuePage(
          payload({ total: 1, rows: [row(ids[0], { review_state: reviewState })] }),
          1,
          50,
        ).rows[0].review_state,
      ).toBe(reviewState);
    },
  );

  it("accepts a correction summary only when it matches the referenced target", () => {
    const correctionId = "00000000-0000-4000-8000-000000000099";
    const correctionRow = row(ids[0], {
      corrects_expense_id: correctionId,
      correction_expense: {
        id: correctionId,
        date: "2026-08-01",
        category: "عمالة",
        description: null,
        total: 125,
      },
    });
    expect(
      parseReconciliationQueuePage(payload({ total: 1, rows: [correctionRow] }), 1, 50),
    ).toMatchObject({ rows: [{ correction_expense: { id: correctionId, total: 125 } }] });
    expect(() =>
      parseReconciliationQueuePage(
        payload({ total: 1, rows: [row(ids[0], { corrects_expense_id: correctionId })] }),
        1,
        50,
      ),
    ).toThrow();
  });

  it("preserves correction targets whose stored total is not available yet", () => {
    const expenseId = "00000000-0000-4000-8000-000000000097";
    const saleId = "00000000-0000-4000-8000-000000000098";
    const rows = [
      row(ids[0], {
        corrects_expense_id: expenseId,
        correction_expense: {
          id: expenseId,
          date: "2026-08-01",
          category: "عمالة",
          description: null,
          total: null,
        },
      }),
      row(ids[1], {
        corrects_sale_id: saleId,
        correction_sale: {
          id: saleId,
          sale_date: "2026-08-02",
          crop: "برحي",
          notes: "السعر لم يحدد بعد",
          total: null,
        },
      }),
    ];

    expect(parseReconciliationQueuePage(payload({ rows }), 1, 50)).toMatchObject({
      rows: [
        { correction_expense: { id: expenseId, total: null } },
        { correction_sale: { id: saleId, total: null } },
      ],
    });
  });

  it("accepts an empty result and a server-clamped final page", () => {
    expect(
      parseReconciliationQueuePage(payload({ total: 0, rows: [] }), 9, 50),
    ).toMatchObject({ total: 0, page: 1, rows: [] });
    expect(
      parseReconciliationQueuePage(
        payload({ total: 51, page: 2, rows: [row(ids[0])] }),
        99,
        50,
      ),
    ).toMatchObject({ total: 51, page: 2, rows: [{ id: ids[0] }] });
  });

  it.each([
    null,
    [],
    payload({ version: "future" }),
    payload({ status: "mystery" }),
    payload({ total: -1 }),
    payload({ total: 1.5 }),
    payload({ page: 0 }),
    payload({ page_size: 51 }),
    payload({ page_size: 25 }),
    payload({ counts: null }),
    payload({ counts: { total: 2 } }),
    payload({ counts: { total: 2, unreviewed: -1, included: 0, held: 0, rejected: 0, frozen: 0, executed: 0 } }),
    payload({ counts: { total: 2, unreviewed: 1.5, included: 0, held: 0, rejected: 0, frozen: 0, executed: 0 } }),
    payload({ counts: { total: 2, unreviewed: 3, included: 0, held: 0, rejected: 0, frozen: 0, executed: 0 } }),
    payload({ total: 3 }),
    payload({ rows: [row("not-a-uuid"), row(ids[1])] }),
    payload({ rows: [row(ids[0]), row(ids[0])] }),
    payload({ rows: [row(ids[0], { review_version: "0" }), row(ids[1])] }),
    payload({ rows: [row(ids[0], { review_state: "mystery" }), row(ids[1])] }),
    payload({ rows: [row(ids[0], { evidence: null }), row(ids[1])] }),
    payload({ rows: [row(ids[0], { sale_quantity: "10" }), row(ids[1])] }),
  ])("rejects malformed or internally inconsistent payloads", (value) => {
    expect(() => parseReconciliationQueuePage(value, 1, 50)).toThrow();
  });

  it.each(["not_found", "incomplete"])("refuses the %s verdict", (status) => {
    expect(() => parseReconciliationQueuePage(payload({ status }), 1, 50)).toThrow();
  });
});
