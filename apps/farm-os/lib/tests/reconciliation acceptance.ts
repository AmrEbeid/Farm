import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// The report loader and the CSV endpoint are server modules; `server-only` is provided by the Next
// bundler, not by node_modules, so it is stubbed here to let the real behaviour be tested.
vi.mock("server-only", () => ({}));
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types.ext";
import { sumDecimals } from "../decimal";
import { rowsToCsv } from "../export-csv";
import { num } from "../money";
import {
  ACCEPTANCE_ASSERTION_FIELDS,
  ACCEPTANCE_ASSERTION_PROHIBITION_AR,
  ACCEPTANCE_CLASSIFICATION_ORDER,
  ACCEPTANCE_CONTROL_TOTALS_CAVEAT_AR,
  ACCEPTANCE_CONTENT_COLUMNS,
  ACCEPTANCE_COUNT_MISMATCH_AR,
  ACCEPTANCE_CSV_COLUMNS,
  ACCEPTANCE_DATASET_AR,
  ACCEPTANCE_DIGEST_COLUMN,
  ACCEPTANCE_DIGEST_NOTE_AR,
  ACCEPTANCE_DIGEST_VERSION,
  ACCEPTANCE_EMPTY_AR,
  ACCEPTANCE_INCOMPLETE_AR,
  ACCEPTANCE_MAX_ROWS,
  ACCEPTANCE_NO_DUAL_RUN_AR,
  ACCEPTANCE_OVERFLOW_AR,
  ACCEPTANCE_PHASE_COPY,
  ACCEPTANCE_READ_FAILED_AR,
  ACCEPTANCE_SIGNATORIES_AR,
  ACCEPTANCE_SIGNATURE_LINES_AR,
  acceptanceCsvFilename,
  acceptanceCsvHref,
  acceptanceCsvRows,
  acceptanceDestinationLabels,
  acceptanceHashLines,
  acceptanceHref,
  acceptanceOutcome,
  acceptancePayloadDocument,
  acceptancePhase,
  acceptanceStagedCounts,
  buildAcceptancePackage,
  buildAcceptanceReport,
  canonicalJson,
  compareAcceptanceRows,
  compareControlSheetNames,
  compareLocatorText,
  destinationOf,
  orderByEvidenceLocator,
  type AcceptanceBatchIdentity,
  type AcceptanceEvidence,
  type AcceptancePhase,
  type AcceptanceRow,
} from "../reconciliation acceptance";
import {
  ACCEPTANCE_SNAPSHOT_RPC,
  ACCEPTANCE_SNAPSHOT_VERSION,
  loadAcceptanceBatch,
  parseAcceptanceSnapshot,
  type AcceptanceLoad,
} from "../reconciliation acceptance data";

/** The refusal kinds, named so a test cannot silently expect one this build cannot produce. */
type AcceptanceLoadKind = Extract<AcceptanceLoad, { ok: false }>["kind"];
import { CLASSIFICATION_AR, RECONCILIATION_MAX_ROWS } from "../reconciliation review";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "99999999-9999-4999-8999-999999999999";

let seq = 0;
/** Deterministic-but-distinct evidence ids, so a tiebreak is exercised without hand-writing uuids. */
function nextId(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

function evidence(overrides: Partial<AcceptanceEvidence> = {}): AcceptanceEvidence {
  return {
    id: nextId(),
    origin_kind: "source_workbook_row",
    sheet_name: "المصروفات",
    row_locator: "1",
    snapshot_target_table: null,
    snapshot_target_id: null,
    source_workbook_sha256: SHA_A,
    production_snapshot_sha256: null,
    source_identity_fingerprint: "fp",
    source_amount: "100",
    source_date_text: "2024-01-05",
    source_date_parsed: "2024-01-05",
    classification: "source_addition_candidate",
    invalid_calendar_quality_flag: false,
    evidence_label: "سماد",
    ...overrides,
  };
}

function row(overrides: Partial<AcceptanceRow> = {}): AcceptanceRow {
  const ev = overrides.evidence === undefined ? evidence() : overrides.evidence;
  return {
    id: nextId(),
    evidence_item_id: ev?.id ?? nextId(),
    review_state: "unreviewed",
    disposition: "hold",
    reviewer_id: null,
    reviewed_at: null,
    review_reason: null,
    target_table: null,
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
    payload_hash: null,
    frozen: false,
    frozen_at: null,
    execution_result: "pending",
    execution_error: null,
    expense_account: null,
    expense_cost_center: null,
    expense_supplier: null,
    sale_buyer: null,
    sale_cost_center: null,
    sale_farm: null,
    sale_sector: null,
    sale_hawsha: null,
    ...overrides,
    evidence: ev,
  };
}

/** A fully reviewed expense row — every posting-payload field populated. */
function includedExpenseRow(overrides: Partial<AcceptanceRow> = {}): AcceptanceRow {
  return row({
    review_state: "frozen",
    disposition: "include",
    target_table: "expenses",
    expense_category: "أسمدة",
    expense_description: "سماد يوريا",
    expense_kind: "operating",
    expense_account_id: "aaaa1111-1111-4111-8111-111111111111",
    expense_cost_center_id: "bbbb1111-1111-4111-8111-111111111111",
    expense_supplier_id: "cccc1111-1111-4111-8111-111111111111",
    expense_payment_decision: "routed_now",
    payload_hash: SHA_B,
    frozen: true,
    frozen_at: "2026-07-01T10:00:00.000Z",
    expense_account: { code: "5100", name_ar: "مصروفات أسمدة" },
    expense_cost_center: { code: "CC-1", name_ar: "قطاع أ" },
    expense_supplier: { name: "شركة الأسمدة" },
    ...overrides,
  });
}

/** A fully reviewed sale row — every posting-payload field populated. */
function includedSaleRow(overrides: Partial<AcceptanceRow> = {}): AcceptanceRow {
  return row({
    review_state: "frozen",
    disposition: "include",
    target_table: "sales",
    sale_crop: "برحي",
    sale_quantity: "12.500",
    sale_unit: "طن",
    sale_unit_price: "1500.25",
    sale_recorded_total: "18753.125",
    sale_buyer_id: "dddd1111-1111-4111-8111-111111111111",
    sale_cost_center_id: "eeee1111-1111-4111-8111-111111111111",
    sale_farm_id: "ffff1111-1111-4111-8111-111111111111",
    sale_sector_id: "aaaa2222-2222-4222-8222-222222222222",
    sale_hawsha_id: "bbbb2222-2222-4222-8222-222222222222",
    sale_season: "2024",
    sale_delivery_date: "2024-02-01",
    sale_notes: "تسليم بالمزرعة",
    sale_historical_date_decision: "use_source_text_date",
    sale_effective_date: "2024-01-05",
    payload_hash: SHA_C,
    frozen: true,
    frozen_at: "2026-07-01T10:00:00.000Z",
    sale_buyer: { name: "تاجر التمور" },
    sale_cost_center: { code: "CC-2", name_ar: "قطاع ب" },
    sale_farm: { name: "المزرعة الرئيسية" },
    sale_sector: { name: "قطاع ١" },
    sale_hawsha: { code: "H-1", name: "حوش ١" },
    ...overrides,
  });
}

// Every posting label is worded for the batch's own lifecycle phase. Most cases below describe a
// not-yet-executed batch, so these wrappers default to "planned"; the phase-specific expectations get
// their own describe block.
const buildReport = (rows: AcceptanceRow[], phase: AcceptancePhase = "planned") =>
  buildAcceptanceReport(rows, phase);
const csvRowsOf = (rows: AcceptanceRow[], phase: AcceptancePhase = "planned") =>
  acceptanceCsvRows(rows, phase);
const PLANNED_LABELS = acceptanceDestinationLabels("planned");

function batchIdentity(overrides: Partial<AcceptanceBatchIdentity> = {}): AcceptanceBatchIdentity {
  return {
    id: BATCH_ID,
    source_label: "دفتر ٢٠٢٤",
    source_workbook_sha256: SHA_A,
    status: "reviewed",
    created_at: "2026-07-01T09:00:00.000Z",
    created_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    approved_at: null,
    approved_by: null,
    result_summary: {
      evidence_item_count: 2,
      batch_row_count: 2,
      staging_manifest_sha256: SHA_B,
      tool_metadata: { production_snapshot_sha256: SHA_C, exception_evidence_sha256: SHA_D },
    },
    ...overrides,
  };
}

describe("reconciliation acceptance — deterministic evidence-locator order", () => {
  it("compares digit runs by value, not by code point", () => {
    expect(compareLocatorText("2", "10")).toBeLessThan(0);
    expect(compareLocatorText("10", "2")).toBeGreaterThan(0);
    expect(compareLocatorText("صف 2", "صف 10")).toBeLessThan(0);
    expect(compareLocatorText("A9", "A10")).toBeLessThan(0);
  });

  it("stays a total order for equal values with different padding and for plain text", () => {
    expect(compareLocatorText("007", "7")).toBeGreaterThan(0);
    expect(compareLocatorText("7", "007")).toBeLessThan(0);
    expect(compareLocatorText("7", "7")).toBe(0);
    expect(compareLocatorText("ألف", "باء")).toBeLessThan(0);
    expect(compareLocatorText("", "أ")).toBeLessThan(0);
  });

  it("compares long digit runs exactly (no Number precision cliff)", () => {
    const a = `${"9".repeat(20)}1`;
    const b = `${"9".repeat(20)}2`;
    expect(compareLocatorText(a, b)).toBeLessThan(0);
  });

  it("orders workbook cells before production snapshots, then by sheet and row number", () => {
    const snapshot = row({
      evidence: evidence({
        origin_kind: "production_snapshot_row",
        sheet_name: null,
        row_locator: null,
        source_workbook_sha256: null,
        production_snapshot_sha256: SHA_B,
        snapshot_target_table: "expenses",
        snapshot_target_id: "11111111-1111-4111-8111-111111111111",
        source_amount: null,
        source_date_text: null,
        source_date_parsed: null,
      }),
    });
    // Sheets compare by code point: «المبيعات» sorts before «المصروفات» (ب < ص).
    const salesRow2 = row({ evidence: evidence({ sheet_name: "المبيعات", row_locator: "2" }) });
    const expensesRow10 = row({ evidence: evidence({ sheet_name: "المصروفات", row_locator: "10" }) });
    const expensesRow2 = row({ evidence: evidence({ sheet_name: "المصروفات", row_locator: "2" }) });

    const ordered = orderByEvidenceLocator([snapshot, expensesRow10, salesRow2, expensesRow2]);
    expect(ordered.map((r) => r.id)).toEqual([
      salesRow2.id,
      expensesRow2.id, // row 2 before row 10 — numeric, not lexical
      expensesRow10.id,
      snapshot.id, // every workbook cell precedes every production snapshot
    ]);
  });

  it("produces the same order from any input permutation and never mutates the input", () => {
    const rows = [
      row({ evidence: evidence({ sheet_name: "ب", row_locator: "3" }) }),
      row({ evidence: evidence({ sheet_name: "أ", row_locator: "12" }) }),
      row({ evidence: evidence({ sheet_name: "أ", row_locator: "2" }) }),
      row({
        evidence: evidence({
          origin_kind: "production_snapshot_row",
          sheet_name: null,
          row_locator: null,
          snapshot_target_table: "sales",
          snapshot_target_id: "22222222-2222-4222-9222-222222222222",
        }),
      }),
    ];
    const original = rows.map((r) => r.id);
    const expected = orderByEvidenceLocator(rows).map((r) => r.id);
    const permutations = [
      [3, 2, 1, 0],
      [1, 3, 0, 2],
      [2, 0, 3, 1],
    ];
    for (const order of permutations) {
      expect(orderByEvidenceLocator(order.map((i) => rows[i])).map((r) => r.id)).toEqual(expected);
    }
    expect(rows.map((r) => r.id)).toEqual(original);
    expect(orderByEvidenceLocator(rows)).not.toBe(rows);
  });

  it("falls back to the unique evidence id when two rows share a locator", () => {
    const shared = { sheet_name: "أ", row_locator: "5" };
    const a = row({ evidence: evidence(shared), evidence_item_id: "aaaaaaaa-0000-4000-8000-000000000001" });
    const b = row({ evidence: evidence(shared), evidence_item_id: "aaaaaaaa-0000-4000-8000-000000000002" });
    expect(compareAcceptanceRows(a, b)).toBeLessThan(0);
    expect(compareAcceptanceRows(b, a)).toBeGreaterThan(0);
    expect(compareAcceptanceRows(a, a)).toBe(0);
  });

  it("sorts a row with no readable evidence last instead of dropping it", () => {
    const orphan = row({ evidence: null, evidence_item_id: "00000000-0000-4000-8000-999999999999" });
    const normal = row();
    expect(orderByEvidenceLocator([orphan, normal]).map((r) => r.id)).toEqual([normal.id, orphan.id]);
  });
});

describe("reconciliation acceptance — whole-batch summary", () => {
  it("keeps the classification display order in lockstep with the label map", () => {
    expect([...ACCEPTANCE_CLASSIFICATION_ORDER].sort()).toEqual(Object.keys(CLASSIFICATION_AR).sort());
  });

  it("counts decisions across the whole batch", () => {
    const report = buildReport([
      row(),
      row({ review_state: "reviewed", disposition: "include" }),
      row({ review_state: "reviewed", disposition: "hold" }),
      row({ review_state: "rejected", disposition: "hold" }),
    ]);
    expect(report.rowCount).toBe(4);
    expect(report.counts.total).toBe(4);
    expect(report.counts.unreviewed).toBe(1);
    expect(report.counts.included).toBe(1);
    expect(report.counts.held).toBe(1);
    expect(report.counts.rejected).toBe(1);
    expect(report.readiness.decided).toBe(3);
    expect(report.readiness.undecided).toBe(1);
    expect(report.readiness.allDecided).toBe(false);
  });

  it("counts frozen from the frozen column, not from review_state", () => {
    // A held/rejected row keeps its own review_state and carries frozen=true — the batch page counts
    // the flag, so the acceptance report must agree with it exactly.
    const report = buildReport([
      row({ review_state: "frozen", disposition: "include", frozen: true, payload_hash: SHA_B }),
      row({ review_state: "reviewed", disposition: "hold", frozen: true, payload_hash: SHA_B }),
      row({ review_state: "rejected", disposition: "hold", frozen: true, payload_hash: SHA_B }),
      row({ review_state: "reviewed", disposition: "include", frozen: false }),
    ]);
    expect(report.counts.frozen).toBe(3);
    expect(report.readiness.notFrozen).toBe(1);
    expect(report.readiness.allFrozen).toBe(false);
    expect(report.quality.frozenWithoutPayloadHash).toBe(0);
  });

  it("flags a frozen row that carries no payload hash", () => {
    const report = buildReport([
      row({ review_state: "frozen", disposition: "include", frozen: true, payload_hash: null }),
      row({ review_state: "frozen", disposition: "include", frozen: true, payload_hash: SHA_B }),
    ]);
    expect(report.quality.frozenWithoutPayloadHash).toBe(1);
  });

  it("counts as executed only the results that actually moved money", () => {
    const report = buildReport([
      row({ execution_result: "posted" }),
      row({ execution_result: "reversed" }),
      row({ execution_result: "skipped" }),
      row({ execution_result: "failed" }),
      row({ execution_result: "pending" }),
    ]);
    expect(report.counts.executed).toBe(2);
    expect(report.readiness.executed).toBe(2);
    expect(report.readiness.notExecuted).toBe(3);
  });

  it("sums source amounts exactly, never treating a gap as zero", () => {
    const report = buildReport([
      row({ evidence: evidence({ source_amount: "0.1" }) }),
      row({ evidence: evidence({ source_amount: "0.2" }) }),
      row({ evidence: evidence({ source_amount: null }) }),
      row({ evidence: evidence({ source_amount: null }) }),
    ]);
    // A float sum would be 0.30000000000000004 — the signed total must be exactly 0.3.
    expect(report.sourceTotal.total).toBe("0.3");
    expect(report.sourceTotal.knownCount).toBe(2);
    expect(report.sourceTotal.unknownCount).toBe(2);
    expect(report.sourceTotal.hasUnknown).toBe(true);
    expect(report.quality.missingSourceAmount).toBe(2);
  });

  it("reports every classification in a fixed order, appending an unknown one instead of dropping it", () => {
    const report = buildReport([
      row({ evidence: evidence({ classification: "amount_correction_candidate", source_amount: "40" }) }),
      row({ evidence: evidence({ classification: "future_unknown_kind", source_amount: "7" }) }),
      row({ evidence: evidence({ classification: "source_addition_candidate", source_amount: null }) }),
    ]);
    expect(report.byClassification.map((t) => t.key)).toEqual([
      ...ACCEPTANCE_CLASSIFICATION_ORDER,
      "future_unknown_kind",
    ]);
    const addition = report.byClassification.find((t) => t.key === "source_addition_candidate")!;
    expect(addition.rowCount).toBe(1);
    expect(addition.withSourceAmount).toBe(0);
    expect(addition.amount.total).toBe("0");
    expect(addition.amount.unknownCount).toBe(1);
    const correction = report.byClassification.find((t) => t.key === "amount_correction_candidate")!;
    expect(correction.amount.total).toBe("40");
    expect(correction.withSourceAmount).toBe(1);
    const unknown = report.byClassification.find((t) => t.key === "future_unknown_kind")!;
    expect(unknown.rowCount).toBe(1);
    expect(unknown.label).toBe("future_unknown_kind");
    // Every row is accounted for in exactly one classification group.
    expect(report.byClassification.reduce((sum, t) => sum + t.rowCount, 0)).toBe(report.rowCount);
  });

  it("counts the quality exceptions an acceptance decision hinges on", () => {
    const report = buildReport([
      row({ evidence: evidence({ invalid_calendar_quality_flag: true }) }),
      row({
        evidence: evidence({ classification: "amount_correction_candidate" }),
        corrects_expense_id: "33333333-3333-4333-8333-333333333333",
      }),
      row({ evidence: evidence({ classification: "amount_correction_candidate" }) }),
      row({ evidence: null }),
    ]);
    expect(report.quality.invalidDate).toBe(1);
    expect(report.quality.correctionCandidates).toBe(2);
    expect(report.quality.correctionLinked).toBe(1);
    expect(report.quality.correctionUnlinked).toBe(1);
    expect(report.quality.missingEvidence).toBe(1);
  });

  it("does not invent readiness for a row-less input — which never reaches a report anyway", () => {
    // ARITHMETIC ONLY. A zero-row batch is REFUSED before this summariser is ever reached (the RPC
    // answers 'empty' and parseAcceptanceSnapshot refuses it a second time), so this pins that the
    // pure function fabricates nothing — NOT that an empty batch is a valid, signable report.
    const report = buildReport([]);
    expect(report.rowCount).toBe(0);
    expect(report.counts.allDecided).toBe(false);
    expect(report.readiness.allFrozen).toBe(false);
    expect(report.sourceTotal.total).toBe("0");
    expect(report.sourceTotal.hasUnknown).toBe(false);
    expect(report.plannedPostingRowCount).toBe(0);
    expect(report.byClassification).toHaveLength(ACCEPTANCE_CLASSIFICATION_ORDER.length);
  });
});

describe("reconciliation acceptance — destination totals mean what they say", () => {
  it("puts every row in exactly one destination", () => {
    expect(destinationOf(includedExpenseRow())).toBe("included_expenses");
    expect(destinationOf(includedSaleRow())).toBe("included_sales");
    expect(destinationOf(row({ review_state: "reviewed", disposition: "hold" }))).toBe("held");
    expect(destinationOf(row({ review_state: "rejected", disposition: "hold" }))).toBe("rejected");
    expect(destinationOf(row())).toBe("undecided");
    // A rejection is final even if the row still carries an include disposition and a target.
    expect(
      destinationOf(row({ review_state: "rejected", disposition: "include", target_table: "expenses" })),
    ).toBe("rejected");
    // Impossible in the DB (reconciliation_batch_rows_target_required), still never silently dropped.
    expect(destinationOf(row({ review_state: "reviewed", disposition: "include" }))).toBe(
      "included_no_target",
    );
  });

  it("never counts a held, rejected or undecided amount as a planned posting", () => {
    const report = buildReport([
      includedExpenseRow({ evidence: evidence({ source_amount: "100.10" }) }),
      includedExpenseRow({ evidence: evidence({ source_amount: "0.20" }) }),
      includedSaleRow({ evidence: evidence({ source_amount: "50.30" }) }),
      row({ review_state: "reviewed", disposition: "hold", evidence: evidence({ source_amount: "999" }) }),
      row({ review_state: "rejected", disposition: "hold", evidence: evidence({ source_amount: "888" }) }),
      row({ evidence: evidence({ source_amount: "777" }) }),
    ]);
    const byKey = Object.fromEntries(report.byDestination.map((total) => [total.key, total]));
    expect(byKey.included_expenses.rowCount).toBe(2);
    expect(byKey.included_expenses.amount.total).toBe("100.3");
    expect(byKey.included_sales.amount.total).toBe("50.3");
    expect(byKey.held.amount.total).toBe("999");
    expect(byKey.rejected.amount.total).toBe("888");
    expect(byKey.undecided.amount.total).toBe("777");
    expect(report.plannedPostingRowCount).toBe(3);
    expect(report.plannedPostingTotal.total).toBe("150.6");
    expect(report.sourceTotal.total).toBe("2814.6");
  });

  it("accounts for every row: the groups add up to the batch", () => {
    const rows = [
      includedExpenseRow(),
      includedSaleRow(),
      row({ review_state: "reviewed", disposition: "hold" }),
      row({ review_state: "rejected" }),
      row(),
      row({ review_state: "reviewed", disposition: "include" }), // no target — still counted
    ];
    const report = buildReport(rows);
    expect(report.byDestination.reduce((sum, total) => sum + total.rowCount, 0)).toBe(rows.length);
    expect(report.byDestination.map((total) => total.key)).toEqual([
      "included_expenses",
      "included_sales",
      "held",
      "rejected",
      "undecided",
      "included_no_target",
    ]);
    for (const total of report.byDestination) {
      expect(total.label).toBe(PLANNED_LABELS[total.key as keyof typeof PLANNED_LABELS]);
    }
  });

  it("hides the impossible group when the batch is well formed", () => {
    const report = buildReport([includedExpenseRow(), row()]);
    expect(report.byDestination.map((total) => total.key)).toEqual([
      "included_expenses",
      "included_sales",
      "held",
      "rejected",
      "undecided",
    ]);
  });

  it("labels each group in Arabic and never calls a held row a posting", () => {
    expect(PLANNED_LABELS.included_expenses).toContain("ستُسجَّل");
    expect(PLANNED_LABELS.included_sales).toContain("ستُسجَّل");
    for (const key of ["held", "rejected", "undecided"] as const) {
      // Present tense: "does not get recorded" is true before, during and after execution.
      expect(PLANNED_LABELS[key]).toContain("لا تُسجَّل");
    }
  });
});

// ── Control totals: the SAME rows re-grouped for dual-run preparation. Two exact partitions, no new
//    read, no decision — so every test here is about closure, order, and refusing to guess a date.
describe("reconciliation acceptance — source control totals by calendar period", () => {
  /** A workbook row whose evidence carries exactly this parsed source date. */
  const dated = (date: string | null, overrides: Partial<AcceptanceEvidence> = {}) =>
    row({ evidence: evidence({ source_date_parsed: date, ...overrides }) });

  it("keys a period as YYYY-MM from the parsed source date, ascending, grouped by year", () => {
    const report = buildReport([
      dated("2025-01-31"),
      dated("2024-03-02"),
      dated("2024-01-05"),
      dated("2024-01-28"),
      dated("2024-10-09"),
    ]);
    const { years } = report.controlTotals;
    expect(years.map((year) => year.key)).toEqual(["year:2024", "year:2025"]);
    expect(years[0].periods.map((period) => period.label)).toEqual([
      "2024-01",
      "2024-03",
      "2024-10",
    ]);
    expect(years[1].periods.map((period) => period.label)).toEqual(["2025-01"]);
    // Two rows share 2024-01; the month row counts them once each and the year subtotal adds up.
    expect(years[0].periods[0].rowCount).toBe(2);
    expect(years[0].subtotal.rowCount).toBe(4);
    expect(years[0].subtotal.amount.total).toBe("400");
    expect(years[1].subtotal.rowCount).toBe(1);
  });

  it("prints the same breakdown from any input permutation", () => {
    const rows = [dated("2024-05-01"), dated("2023-12-31"), dated("2024-01-01"), dated(null)];
    const expected = buildReport(rows).controlTotals;
    for (const order of [
      [3, 2, 1, 0],
      [1, 3, 0, 2],
      [2, 0, 3, 1],
    ]) {
      expect(buildReport(order.map((index) => rows[index])).controlTotals).toEqual(expected);
    }
  });

  it("never reads a period from the raw source-date text", () => {
    // A readable-looking raw cell with NO parsed date is «بلا تاريخ مصدر مسجَّل», never 2024-07.
    const report = buildReport([
      row({ evidence: evidence({ source_date_parsed: null, source_date_text: "2024-07-14" }) }),
    ]);
    expect(report.controlTotals.years).toEqual([]);
    const byKey = Object.fromEntries(report.controlTotals.undated.map((total) => [total.key, total]));
    expect(byKey["undated:no_source_date"].rowCount).toBe(1);
  });

  it("keeps a flagged or unreadable calendar date OUT of every month", () => {
    const report = buildReport([
      dated("2024-01-05"),
      // Flagged by the staging tool: its parsed value is not to be trusted as a calendar date.
      dated("2024-02-05", { invalid_calendar_quality_flag: true }),
      // Impossible days and non-dates can only arrive from a damaged payload — still never a month.
      dated("2026-02-30"),
      dated("not-a-date"),
      dated("   "),
    ]);
    expect(report.controlTotals.years.map((year) => year.key)).toEqual(["year:2024"]);
    expect(report.controlTotals.years[0].periods.map((period) => period.label)).toEqual(["2024-01"]);
    const byKey = Object.fromEntries(report.controlTotals.undated.map((total) => [total.key, total]));
    expect(byKey["undated:invalid_source_date"].rowCount).toBe(3);
    // A blank string records no date at all; it is not an unreadable one.
    expect(byKey["undated:no_source_date"].rowCount).toBe(1);
  });

  it("keeps the three non-period groups fixed, ordered, and never merged", () => {
    const report = buildReport([
      dated("2024-01-05"),
      dated("2024-02-05", { invalid_calendar_quality_flag: true }),
      dated(null, { origin_kind: "production_snapshot_row", sheet_name: null }),
      row({ evidence: null }),
    ]);
    expect(report.controlTotals.undated.map((total) => total.key)).toEqual([
      "undated:invalid_source_date",
      "undated:no_source_date",
      "undated:no_evidence",
    ]);
    expect(report.controlTotals.undated.map((total) => total.rowCount)).toEqual([1, 1, 1]);
    for (const total of report.controlTotals.undated) {
      expect(total.label).toContain("بلا فترة");
    }
  });

  it("prints all three non-period groups even when the batch has none of them", () => {
    const report = buildReport([dated("2024-01-05")]);
    expect(report.controlTotals.undated.map((total) => total.rowCount)).toEqual([0, 0, 0]);
    expect(report.controlTotals.undated.map((total) => total.amount.total)).toEqual(["0", "0", "0"]);
    expect(report.controlTotals.undated.map((total) => total.amount.hasUnknown)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("counts a row with no recorded amount instead of calling it zero", () => {
    const report = buildReport([
      dated("2024-01-05"),
      row({ evidence: evidence({ source_date_parsed: "2024-01-09", source_amount: null }) }),
      row({ evidence: null }),
    ]);
    const january = report.controlTotals.years[0].periods[0];
    expect(january.rowCount).toBe(2);
    expect(january.withSourceAmount).toBe(1);
    expect(january.unknownCount).toBe(1);
    expect(january.amount.total).toBe("100");
    expect(january.amount.hasUnknown).toBe(true);
    const noEvidence = report.controlTotals.undated[2];
    expect(noEvidence.rowCount).toBe(1);
    expect(noEvidence.unknownCount).toBe(1);
    expect(noEvidence.withSourceAmount).toBe(0);
    // The unknown count is exactly the amount summary's own — one number, never two.
    for (const total of [january, noEvidence, report.controlTotals.total]) {
      expect(total.unknownCount).toBe(total.amount.unknownCount);
    }
  });
});

describe("reconciliation acceptance — source control totals by workbook sheet", () => {
  it("orders named sheets naturally, then the two fixed fallbacks", () => {
    const report = buildReport([
      row({ evidence: evidence({ sheet_name: "ورقة 10" }) }),
      row({ evidence: evidence({ sheet_name: "ورقة 2" }) }),
      row({ evidence: evidence({ sheet_name: "المبيعات" }) }),
      row({ evidence: evidence({ sheet_name: null, origin_kind: "production_snapshot_row" }) }),
      row({ evidence: evidence({ sheet_name: "  " }) }),
      row({ evidence: null }),
    ]);
    expect(report.controlTotals.sheets.map((sheet) => sheet.key)).toEqual([
      "sheet:المبيعات",
      "sheet:ورقة 2", // row 2 before row 10 — the same natural order the report's rows use
      "sheet:ورقة 10",
      "sheet-fallback:no_sheet_name",
      "sheet-fallback:no_evidence",
    ]);
    expect(report.controlTotals.sheets.map((sheet) => sheet.rowCount)).toEqual([1, 1, 1, 2, 1]);
    expect(report.controlTotals.sheets[0].label).toBe("المبيعات");
  });

  it("keeps a row whose sheet name is missing rather than dropping it", () => {
    const rows = [
      row({ evidence: evidence({ sheet_name: null }) }),
      row({ evidence: evidence({ sheet_name: "" }) }),
      row({ evidence: null }),
    ];
    const report = buildReport(rows);
    expect(report.controlTotals.sheets).toHaveLength(2);
    expect(report.controlTotals.sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0)).toBe(
      rows.length,
    );
    // The unreadable-evidence row carries no amount, so its group sums nothing and says so.
    expect(report.controlTotals.sheets.map((sheet) => sheet.amount.total)).toEqual(["200", "0"]);
    expect(report.controlTotals.sheets.map((sheet) => sheet.unknownCount)).toEqual([0, 1]);
  });

  it("orders numbered sheets by VALUE in Arabic-Indic and Persian digits too", () => {
    // «ورقة ١٠» must follow «ورقة ٢» exactly as «ورقة 10» follows «ورقة 2» — an Arabic workbook is
    // the normal case here, so code-point order would put every ١٠..١٩ sheet before ٢.
    for (const [two, ten] of [
      ["ورقة 2", "ورقة 10"],
      ["ورقة ٢", "ورقة ١٠"], // Arabic-Indic U+0660..U+0669
      ["ورقة ۲", "ورقة ۱۰"], // Persian/Urdu U+06F0..U+06F9
    ]) {
      expect(compareControlSheetNames(two, ten)).toBeLessThan(0);
      expect(compareControlSheetNames(ten, two)).toBeGreaterThan(0);
      expect(compareControlSheetNames(two, two)).toBe(0);
    }
  });

  it("keeps two sheets that differ only in digit SCRIPT apart, deterministically", () => {
    // Same value, two recorded names: never merged, and never order-dependent.
    expect(compareControlSheetNames("ورقة ٢", "ورقة 2")).not.toBe(0);
    expect(compareControlSheetNames("ورقة ٢", "ورقة 2")).toBe(
      -compareControlSheetNames("ورقة 2", "ورقة ٢"),
    );
    const rows = [
      row({ evidence: evidence({ sheet_name: "ورقة ١٠" }) }),
      row({ evidence: evidence({ sheet_name: "ورقة 2" }) }),
      row({ evidence: evidence({ sheet_name: "ورقة ٢" }) }),
      row({ evidence: evidence({ sheet_name: "ورقة ۱۰" }) }),
    ];
    const expected = buildReport(rows).controlTotals.sheets.map((sheet) => sheet.key);
    expect(expected.slice(0, 4)).toEqual([
      "sheet:ورقة 2",
      "sheet:ورقة ٢",
      "sheet:ورقة ١٠",
      "sheet:ورقة ۱۰",
    ]);
    for (const order of [
      [3, 2, 1, 0],
      [1, 3, 0, 2],
      [2, 0, 3, 1],
    ]) {
      expect(
        buildReport(order.map((index) => rows[index])).controlTotals.sheets.map((sheet) => sheet.key),
      ).toEqual(expected);
    }
  });

  it("leaves the shared locator comparator — the signed row order — untouched", () => {
    // compareLocatorText orders the report AND the CSV annex. The sheet breakdown widens digits in
    // its OWN comparator instead, so this stays exactly as the signed order has always been.
    expect(compareLocatorText("ورقة ٢", "ورقة ١٠")).toBeGreaterThan(0);
    expect(compareControlSheetNames("ورقة ٢", "ورقة ١٠")).toBeLessThan(0);
  });

  it("uses the recorded sheet name verbatim — it never normalises two names into one", () => {
    const report = buildReport([
      row({ evidence: evidence({ sheet_name: "المصروفات" }) }),
      row({ evidence: evidence({ sheet_name: "المصروفات " }) }),
    ]);
    expect(report.controlTotals.sheets.map((sheet) => sheet.rowCount)).toEqual([1, 1, 0, 0]);
  });
});

describe("reconciliation acceptance — control totals close on the batch", () => {
  const rows = () => [
    includedExpenseRow({ evidence: evidence({ source_amount: "100.10", sheet_name: "المصروفات" }) }),
    includedSaleRow({
      evidence: evidence({
        source_amount: "50.30",
        sheet_name: "المبيعات",
        source_date_parsed: "2025-02-11",
      }),
    }),
    row({
      review_state: "reviewed",
      disposition: "hold",
      evidence: evidence({ source_amount: "999", sheet_name: "المصروفات" }),
    }),
    row({ evidence: evidence({ source_amount: null, source_date_parsed: null }) }),
    row({ evidence: null }),
  ];

  it("partitions the batch exactly once per breakdown, and both close on the source total", () => {
    const report = buildReport(rows());
    const { years, undated, sheets, total } = report.controlTotals;
    const periodGroups = [...years.flatMap((year) => year.periods), ...undated];

    for (const groups of [periodGroups, sheets]) {
      expect(groups.reduce((sum, group) => sum + group.rowCount, 0)).toBe(report.rowCount);
      expect(groups.reduce((sum, group) => sum + group.withSourceAmount, 0)).toBe(
        report.sourceTotal.knownCount,
      );
      expect(groups.reduce((sum, group) => sum + group.unknownCount, 0)).toBe(
        report.sourceTotal.unknownCount,
      );
      expect(sumDecimals(groups.map((group) => group.amount.total)).total).toBe(
        report.sourceTotal.total,
      );
    }
    // The printed footer IS the report's own batch-wide total, so the table closes visibly.
    expect(total.rowCount).toBe(report.rowCount);
    expect(total.amount).toEqual(report.sourceTotal);
    expect(total.withSourceAmount).toBe(report.sourceTotal.knownCount);
    // Year subtotals close on their own months.
    for (const year of years) {
      expect(year.subtotal.rowCount).toBe(
        year.periods.reduce((sum, period) => sum + period.rowCount, 0),
      );
      expect(sumDecimals(year.periods.map((period) => period.amount.total)).total).toBe(
        year.subtotal.amount.total,
      );
    }
  });

  it("subtotals ONLY the amounts whose reported destination is a posting", () => {
    const report = buildReport(rows());
    const posting = report.byDestination
      .filter((total) => total.key === "included_expenses" || total.key === "included_sales")
      .map((total) => total.amount.total);
    // Same basis as the «مآل الصفوف» table: held / rejected / undecided never enter it.
    expect(report.controlTotals.total.postingAmount.total).toBe(sumDecimals(posting).total);
    expect(report.controlTotals.total.postingAmount.total).toBe("150.4");
    expect(report.controlTotals.total.postingRowCount).toBe(2);

    const sheets = Object.fromEntries(
      report.controlTotals.sheets.map((sheet) => [sheet.key, sheet]),
    );
    // The expenses sheet holds an included row AND a held one: only the included amount posts.
    expect(sheets["sheet:المصروفات"].amount.total).toBe("1099.1");
    expect(sheets["sheet:المصروفات"].postingAmount.total).toBe("100.1");
    expect(sheets["sheet:المصروفات"].postingRowCount).toBe(1);
    expect(sheets["sheet:المبيعات"].postingAmount.total).toBe("50.3");
  });

  it("drops a skipped row out of the posted subtotal once the batch has executed", () => {
    const included = [
      includedExpenseRow({
        execution_result: "posted",
        evidence: evidence({ source_amount: "100", source_date_parsed: "2024-01-05" }),
      }),
      includedExpenseRow({
        execution_result: "skipped",
        evidence: evidence({ source_amount: "70", source_date_parsed: "2024-01-06" }),
      }),
    ];
    const report = buildReport(included, "executed");
    const january = report.controlTotals.years[0].periods[0];
    expect(january.rowCount).toBe(2);
    expect(january.amount.total).toBe("170");
    // The skipped row is still a row of this batch and still a source amount — it is simply not
    // something this batch recorded.
    expect(january.postingRowCount).toBe(1);
    expect(january.postingAmount.total).toBe("100");
  });

  it("states the calendar caveat unconditionally, and claims no fiscal mapping", () => {
    expect(ACCEPTANCE_CONTROL_TOTALS_CAVEAT_AR).toContain("YYYY-MM");
    expect(ACCEPTANCE_CONTROL_TOTALS_CAVEAT_AR).toContain("ليس فترة محاسبية");
    expect(ACCEPTANCE_CONTROL_TOTALS_CAVEAT_AR).toContain("قرار المحاسب");
    expect(ACCEPTANCE_CONTROL_TOTALS_CAVEAT_AR).toContain("لا يخزّنه النظام");
  });
});

// ── The one thing a signed report must never get wrong about a batch it did not observe executing.
describe("reconciliation acceptance — destination wording follows the batch's own status", () => {
  it("maps each batch status to a phase, and an unknown status to the claim-nothing one", () => {
    expect(acceptancePhase("staged")).toBe("planned");
    expect(acceptancePhase("reviewed")).toBe("planned");
    expect(acceptancePhase("approved")).toBe("planned");
    expect(acceptancePhase("executed")).toBe("executed");
    expect(acceptancePhase("rolled_back")).toBe("reverted");
    expect(acceptancePhase("executing")).toBe("unsettled");
    expect(acceptancePhase("failed")).toBe("unsettled");
    // A status this build has never heard of must NOT inherit "will post".
    expect(acceptancePhase("some_future_status")).toBe("unsettled");
    expect(acceptancePhase("")).toBe("unsettled");
  });

  it("says «will be recorded» ONLY for a batch that has not executed", () => {
    for (const phase of ["executed", "reverted", "unsettled"] as const) {
      const labels = acceptanceDestinationLabels(phase);
      const copy = ACCEPTANCE_PHASE_COPY[phase];
      for (const text of [
        labels.included_expenses,
        labels.included_sales,
        copy.postingRowsLabel,
        copy.postingTotalLabel,
        copy.postingNote,
      ]) {
        expect(text).not.toContain("ستُسجَّل");
        expect(text).not.toContain("سيُسجَّل");
      }
    }
  });

  it("states the settled outcome for an executed and a rolled-back batch", () => {
    const executed = acceptanceDestinationLabels("executed");
    expect(executed.included_expenses).toContain("سُجِّلت");
    expect(executed.included_sales).toContain("سُجِّلت");
    const reverted = acceptanceDestinationLabels("reverted");
    expect(reverted.included_expenses).toContain("عُكِست");
    expect(ACCEPTANCE_PHASE_COPY.reverted.postingNote).toContain("عُكِس");
    // An interrupted batch claims neither outcome and points at the per-row execution result.
    expect(ACCEPTANCE_PHASE_COPY.unsettled.postingNote).toContain("نتيجة التنفيذ");
  });

  it("carries the phase into the report and the annex from the batch status alone", () => {
    const rows = [
      includedExpenseRow({ execution_result: "posted" }),
      includedSaleRow({ execution_result: "posted" }),
    ];
    const pkg = buildAcceptancePackage(batchIdentity({ status: "executed" }), rows);
    expect(pkg.report.phase).toBe("executed");
    expect(pkg.report.copy).toEqual(ACCEPTANCE_PHASE_COPY.executed);

    const posting = pkg.report.byDestination.find((total) => total.key === "included_expenses");
    expect(posting?.label).toBe(acceptanceDestinationLabels("executed").included_expenses);
    // The annex describes the same row in the same tense — never one artifact per wording.
    for (const csvRow of pkg.csvRows) {
      if (csvRow.destination === "included_expenses") {
        expect(csvRow.destination_ar).toBe(acceptanceDestinationLabels("executed").included_expenses);
      }
    }
  });

  it("changes the digest when the status changes, so the two tenses cannot share one signature", () => {
    const rows = [includedExpenseRow()];
    const staged = buildAcceptancePackage(batchIdentity({ status: "staged" }), rows).digest;
    const executed = buildAcceptancePackage(batchIdentity({ status: "executed" }), rows).digest;
    expect(staged).not.toBe(executed);
  });

  it("counts posted and reversed money actions while excluding skipped rows from settled totals", () => {
    const posted = includedExpenseRow({
      execution_result: "posted",
      evidence: evidence({ source_amount: "100" }),
    });
    const reversedDuringExecution = includedExpenseRow({
      execution_result: "reversed",
      evidence: evidence({ source_amount: "50" }),
    });
    const skipped = includedSaleRow({
      execution_result: "skipped",
      evidence: evidence({ source_amount: "900" }),
    });
    const executed = buildAcceptanceReport([posted, reversedDuringExecution, skipped], "executed");
    expect(executed.plannedPostingRowCount).toBe(2);
    expect(executed.plannedPostingTotal.total).toBe("150");
    expect(executed.byDestination.find((total) => total.key === "execution_skipped")).toMatchObject({
      rowCount: 1,
      amount: { total: "900" },
    });
    expect(
      acceptanceCsvRows([posted, reversedDuringExecution, skipped], "executed").find(
        (csvRow) => csvRow.execution_result === "skipped",
      ),
    ).toMatchObject({
      destination: "execution_skipped",
      destination_ar: expect.stringContaining("لم تُسجَّل بهذه الدفعة"),
    });

    const reversed = includedExpenseRow({
      execution_result: "reversed",
      evidence: evidence({ source_amount: "100" }),
    });
    const reverted = buildAcceptanceReport([reversed, skipped], "reverted");
    expect(reverted.plannedPostingRowCount).toBe(1);
    expect(reverted.plannedPostingTotal.total).toBe("100");
  });
});

describe("reconciliation acceptance — provenance hashes and staged counts", () => {
  const summary = {
    evidence_item_count: 698,
    batch_row_count: 698,
    staging_manifest_sha256: SHA_B,
    tool_metadata: { production_snapshot_sha256: SHA_C, exception_evidence_sha256: SHA_D },
  };

  it("reads the workbook hash from the batch and the tool hashes from result_summary", () => {
    const lines = acceptanceHashLines({ source_workbook_sha256: SHA_A, result_summary: summary });
    expect(lines.map((l) => l.key)).toEqual([
      "source_workbook_sha256",
      "staging_manifest_sha256",
      "production_snapshot_sha256",
      "exception_evidence_sha256",
    ]);
    expect(lines.map((l) => l.value)).toEqual([SHA_A, SHA_B, SHA_C, SHA_D]);
  });

  it("reports an absent or malformed hash as not recorded instead of echoing it", () => {
    const lines = acceptanceHashLines({
      source_workbook_sha256: "not-a-hash",
      result_summary: {
        staging_manifest_sha256: SHA_B.toUpperCase(),
        tool_metadata: { production_snapshot_sha256: 12345, exception_evidence_sha256: `${SHA_C}extra` },
      },
    });
    expect(lines.every((line) => line.value === null)).toBe(true);
  });

  it("reports the tool hashes as not recorded once execution replaced result_summary", () => {
    // fn_execute_reconciliation_batch overwrites result_summary with its own verdict.
    const lines = acceptanceHashLines({
      source_workbook_sha256: SHA_A,
      result_summary: { executed_rows: 3, skipped_rows: 1 },
    });
    expect(lines[0].value).toBe(SHA_A);
    expect(lines.slice(1).every((line) => line.value === null)).toBe(true);
  });

  it("survives a null / non-object / array result_summary", () => {
    for (const value of [null, undefined, 7, "x", [SHA_B]]) {
      const lines = acceptanceHashLines({ source_workbook_sha256: null, result_summary: value });
      expect(lines).toHaveLength(4);
      expect(lines.every((line) => line.value === null)).toBe(true);
    }
  });

  it("distinguishes recorded staged counts from their absence and from damage", () => {
    // Damage must NOT read as absence — that is the whole point of the three-state result. The
    // exhaustive state table lives in the staging-cross-check suite below.
    expect(acceptanceStagedCounts("staged", summary)).toEqual({
      kind: "recorded",
      counts: { evidenceItemCount: 698, batchRowCount: 698 },
    });
    expect(acceptanceStagedCounts("executed", { executed_rows: 3, skipped_rows: 0 })).toEqual({
      kind: "absent",
    });
    expect(acceptanceStagedCounts("staged", null)).toEqual({ kind: "malformed" });
    for (const damaged of [
      { evidence_item_count: 1.5, batch_row_count: 2 },
      { evidence_item_count: -1, batch_row_count: 2 },
      { evidence_item_count: "5", batch_row_count: 5 },
    ]) {
      expect(acceptanceStagedCounts("staged", damaged)).toEqual({ kind: "malformed" });
    }
  });
});

describe("reconciliation acceptance — truthful fixed messages", () => {
  it("states that neither a dual run nor an acceptance signature is recorded", () => {
    expect(ACCEPTANCE_NO_DUAL_RUN_AR).toContain("dual run");
    expect(ACCEPTANCE_NO_DUAL_RUN_AR).toContain("توقيع قبول");
    expect(ACCEPTANCE_NO_DUAL_RUN_AR).toContain("لا يوجد في قاعدة البيانات حقل يحفظ");
    // Owner approval must not be presented as accountant acceptance.
    expect(ACCEPTANCE_NO_DUAL_RUN_AR).toContain("وليس قبولًا محاسبيًا");
  });

  it("explains the digest as same-content proof, never as immutability", () => {
    expect(ACCEPTANCE_DIGEST_NOTE_AR).toContain("SHA-256");
    expect(ACCEPTANCE_DIGEST_NOTE_AR).toContain("يصفان المحتوى نفسه");
    expect(ACCEPTANCE_DIGEST_NOTE_AR).toContain("أي تعديل لاحق على الدفعة يُنتج بصمة جديدة");
    expect(ACCEPTANCE_DIGEST_NOTE_AR).toContain("ولا يعني أن البيانات مُحصَّنة ضد التغيير");
  });

  it("says plainly that a refused report shows no figures at all", () => {
    for (const message of [ACCEPTANCE_OVERFLOW_AR, ACCEPTANCE_READ_FAILED_AR, ACCEPTANCE_INCOMPLETE_AR]) {
      expect(message).toMatch(/لم يُعرض أي رقم|لم يصدر تقرير قبول/);
    }
  });

  it("renders the row bound in Arabic-Indic digits (no Western digit leak)", () => {
    expect(ACCEPTANCE_MAX_ROWS).toBe(RECONCILIATION_MAX_ROWS);
    expect(ACCEPTANCE_OVERFLOW_AR).toContain(num(ACCEPTANCE_MAX_ROWS));
    expect(ACCEPTANCE_OVERFLOW_AR).not.toMatch(/[0-9]/);
  });
});

describe("reconciliation acceptance — CSV annex", () => {
  it("declares unique column ids and emits exactly those keys on every row", () => {
    const ids = ACCEPTANCE_CSV_COLUMNS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(ACCEPTANCE_DIGEST_COLUMN.id);
    const [contentRow] = csvRowsOf([row()]);
    expect(Object.keys(contentRow).sort()).toEqual(ACCEPTANCE_CONTENT_COLUMNS.map((c) => c.id).sort());
    const [packagedRow] = buildAcceptancePackage(batchIdentity(), [row()]).csvRows;
    expect(Object.keys(packagedRow).sort()).toEqual([...ids].sort());
  });

  it("orders its own rows, so a download can never differ from the signed report", () => {
    const rows = [
      row({ evidence: evidence({ sheet_name: "أ", row_locator: "10" }) }),
      row({ evidence: evidence({ sheet_name: "أ", row_locator: "2" }) }),
      row({ evidence: evidence({ sheet_name: "أ", row_locator: "1" }) }),
    ];
    const expected = orderByEvidenceLocator(rows).map((r) => r.evidence_item_id);
    expect(csvRowsOf(rows).map((r) => r.evidence_item_id)).toEqual(expected);
    expect(csvRowsOf([...rows].reverse()).map((r) => r.evidence_item_id)).toEqual(expected);
    expect(csvRowsOf(rows).map((r) => r.sequence)).toEqual([1, 2, 3]);
  });

  it("includes EVERY row of a full-size batch — no cap, no truncation", () => {
    const rows = Array.from({ length: ACCEPTANCE_MAX_ROWS }, (_, i) =>
      row({ evidence: evidence({ row_locator: String(i + 1) }) }),
    );
    const csvRows = csvRowsOf(rows);
    expect(csvRows).toHaveLength(ACCEPTANCE_MAX_ROWS);
    expect(csvRows[csvRows.length - 1].sequence).toBe(ACCEPTANCE_MAX_ROWS);
    expect(rowsToCsv(csvRows, ACCEPTANCE_CONTENT_COLUMNS).split("\r\n")).toHaveLength(
      ACCEPTANCE_MAX_ROWS + 1,
    );
  });

  it("preserves provenance and the decision on each row", () => {
    const [csvRow] = csvRowsOf([
      row({
        review_state: "reviewed",
        disposition: "include",
        reviewer_id: "22222222-2222-4222-8222-222222222222",
        reviewed_at: "2026-07-01T09:30:00.000Z",
        review_reason: "مطابق للدفتر",
        target_table: "expenses",
        frozen: true,
        execution_result: "posted",
        corrects_expense_id: "44444444-4444-4444-8444-444444444444",
        evidence: evidence({
          sheet_name: "المصروفات",
          row_locator: "12",
          source_amount: "125.5",
          source_date_text: "٥/١/٢٠٢٤",
          source_date_parsed: "2024-01-05",
          classification: "amount_correction_candidate",
          invalid_calendar_quality_flag: true,
          evidence_label: "سماد",
        }),
      }),
    ]);
    expect(csvRow).toMatchObject({
      origin_kind: "source_workbook_row",
      origin_kind_ar: "دفتر مصدر",
      sheet_name: "المصروفات",
      row_locator: "12",
      source_workbook_sha256: SHA_A,
      classification: "amount_correction_candidate",
      classification_ar: CLASSIFICATION_AR.amount_correction_candidate,
      source_amount: "125.5",
      source_amount_recorded: "نعم",
      source_date_text: "٥/١/٢٠٢٤",
      source_date_parsed: "2024-01-05",
      invalid_calendar_quality_flag: "نعم",
      review_state: "reviewed",
      review_state_ar: "تمت المراجعة",
      disposition: "include",
      disposition_ar: "تضمين",
      reviewer_id: "22222222-2222-4222-8222-222222222222",
      reviewed_at: "2026-07-01T09:30:00.000Z",
      review_reason: "مطابق للدفتر",
      target_table: "expenses",
      target_table_ar: ACCEPTANCE_DATASET_AR.expenses,
      destination: "included_expenses",
      destination_ar: PLANNED_LABELS.included_expenses,
      frozen: "نعم",
      execution_result: "posted",
      execution_result_ar: "مُرحَّل",
      corrects_expense_id: "44444444-4444-4444-8444-444444444444",
    });
  });

  it("exports the COMPLETE expense posting payload, with ids and readable labels", () => {
    const [csvRow] = csvRowsOf([includedExpenseRow()]);
    expect(csvRow).toMatchObject({
      expense_category: "أسمدة",
      expense_description: "سماد يوريا",
      expense_kind: "operating",
      expense_kind_ar: "تشغيلي",
      expense_account_id: "aaaa1111-1111-4111-8111-111111111111",
      expense_account_label: "5100 · مصروفات أسمدة",
      expense_cost_center_id: "bbbb1111-1111-4111-8111-111111111111",
      expense_cost_center_label: "CC-1 · قطاع أ",
      expense_supplier_id: "cccc1111-1111-4111-8111-111111111111",
      expense_supplier_label: "شركة الأسمدة",
      expense_payment_decision: "routed_now",
      expense_payment_decision_ar: "ترحيل تاريخي على خزينة المزرعة",
      payload_hash: SHA_B,
      frozen: "نعم",
      frozen_at: "2026-07-01T10:00:00.000Z",
    });
  });

  it("exports the COMPLETE sale posting payload, with exact quantities and prices", () => {
    const [csvRow] = csvRowsOf([includedSaleRow()]);
    expect(csvRow).toMatchObject({
      sale_crop: "برحي",
      sale_quantity: "12.5",
      sale_unit: "طن",
      sale_unit_price: "1500.25",
      sale_recorded_total: "18753.125",
      sale_buyer_id: "dddd1111-1111-4111-8111-111111111111",
      sale_buyer_label: "تاجر التمور",
      sale_cost_center_label: "CC-2 · قطاع ب",
      sale_farm_label: "المزرعة الرئيسية",
      sale_sector_label: "قطاع ١",
      sale_hawsha_label: "H-1 · حوش ١",
      sale_season: "2024",
      sale_delivery_date: "2024-02-01",
      sale_notes: "تسليم بالمزرعة",
      sale_historical_date_decision: "use_source_text_date",
      sale_historical_date_decision_ar: "استخدام تاريخ نص المصدر",
      sale_effective_date: "2024-01-05",
      payload_hash: SHA_C,
    });
  });

  it("carries the execution outcome, including the failure text", () => {
    const [csvRow] = csvRowsOf([
      includedExpenseRow({ execution_result: "failed", execution_error: "source amount is not executable" }),
    ]);
    expect(csvRow.execution_result).toBe("failed");
    expect(csvRow.execution_result_ar).toBe("فشل");
    expect(csvRow.execution_error).toBe("source amount is not executable");
  });

  it("keeps the exact decimal string, so no digit is lost to a float", () => {
    const [csvRow] = csvRowsOf([
      row({
        sale_unit_price: "0.10",
        evidence: evidence({ source_amount: "12345678901234567890.12" }),
      }),
    ]);
    expect(csvRow.source_amount).toBe("12345678901234567890.12");
    expect(typeof csvRow.source_amount).toBe("string");
    expect(csvRow.sale_unit_price).toBe("0.1");
    const csv = rowsToCsv([csvRow], ACCEPTANCE_CONTENT_COLUMNS);
    expect(csv).toContain("12345678901234567890.12");
    expect(csv).not.toContain("1.2345678901234568e+19");
  });

  it("leaves an unrecorded amount empty and says so, so a blank is never read as zero", () => {
    const [csvRow] = csvRowsOf([row({ evidence: evidence({ source_amount: null }) })]);
    expect(csvRow.source_amount).toBe("");
    expect(csvRow.source_amount_recorded).toBe("لا");
    const [unreadable] = csvRowsOf([row({ evidence: evidence({ source_amount: "غير معروف" }) })]);
    expect(unreadable.source_amount).toBe("");
    expect(unreadable.source_amount_recorded).toBe("لا");
  });

  it("keeps a production-snapshot row's empty source columns empty", () => {
    const [csvRow] = csvRowsOf([
      row({
        evidence: evidence({
          origin_kind: "production_snapshot_row",
          sheet_name: null,
          row_locator: null,
          source_workbook_sha256: null,
          production_snapshot_sha256: SHA_B,
          snapshot_target_table: "sales",
          snapshot_target_id: "55555555-5555-4555-8555-555555555555",
          source_amount: null,
          source_date_text: null,
          source_date_parsed: null,
          classification: "production_orphan_candidate",
        }),
      }),
    ]);
    expect(csvRow).toMatchObject({
      origin_kind_ar: "لقطة إنتاج",
      sheet_name: "",
      row_locator: "",
      source_workbook_sha256: "",
      production_snapshot_sha256: SHA_B,
      snapshot_target_table: "sales",
      source_amount: "",
      source_amount_recorded: "لا",
    });
  });

  it("neutralises spreadsheet formulas in text while keeping amounts raw", () => {
    const csv = rowsToCsv(
      csvRowsOf([
        row({
          review_reason: "+1+1",
          expense_description: "-1-1",
          evidence: evidence({
            sheet_name: "=cmd|' /C calc'!A0",
            evidence_label: "@SUM(A1:A2)",
            source_amount: "250.75",
          }),
        }),
      ]),
      ACCEPTANCE_CONTENT_COLUMNS,
    );
    // Every leading =, @, + or - on TEXT is neutralised with a single quote before Excel evaluates it.
    expect(csv).toContain("'=cmd|' /C calc'!A0");
    expect(csv).toContain("'@SUM(A1:A2)");
    expect(csv).toContain("'+1+1");
    expect(csv).toContain("'-1-1");
    expect(csv).not.toMatch(/(^|,)=cmd/);
    // The amount stays a plain decimal so the annex still sums in a spreadsheet.
    expect(csv).toContain(",250.75,");
  });

  it("emits a BOM + header even for an empty row set", () => {
    const csv = rowsToCsv(csvRowsOf([]), ACCEPTANCE_CSV_COLUMNS);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("الترتيب");
    expect(csv).not.toContain("\r\n");
  });

  it("builds header-safe filenames and the two hrefs", () => {
    expect(acceptanceCsvFilename(BATCH_ID)).toBe(`reconciliation-acceptance-${BATCH_ID}.csv`);
    expect(acceptanceCsvFilename(BATCH_ID, "abc123def456789")).toBe(
      `reconciliation-acceptance-${BATCH_ID}-abc123def456.csv`,
    );
    expect(acceptanceCsvFilename('a"b\r\n c/../d', 'x"y')).toBe("reconciliation-acceptance-abcd.csv");
    expect(acceptanceHref("b1")).toBe("/finance/reconciliation/b1/acceptance");
    expect(acceptanceCsvHref("b1")).toBe("/api/finance/reconciliation/b1/acceptance.csv");
  });
});

describe("reconciliation acceptance — the package digest binds the report to its annex", () => {
  const rows = [includedExpenseRow(), includedSaleRow(), row({ review_state: "rejected" })];

  it("is a 64-char lowercase sha-256 stamped on every annex row and in the filename", () => {
    const pkg = buildAcceptancePackage(batchIdentity(), rows);
    expect(pkg.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(pkg.digestShort).toBe(pkg.digest.slice(0, 12));
    expect(pkg.csvRows).toHaveLength(rows.length);
    for (const csvRow of pkg.csvRows) {
      expect(csvRow[ACCEPTANCE_DIGEST_COLUMN.id]).toBe(pkg.digest);
    }
    expect(pkg.csvFilename).toBe(`reconciliation-acceptance-${BATCH_ID}-${pkg.digestShort}.csv`);
    expect(rowsToCsv(pkg.csvRows, ACCEPTANCE_CSV_COLUMNS).split("\r\n").slice(1)).toHaveLength(
      rows.length,
    );
  });

  it("is stable for the same content, whatever order the rows arrive in", () => {
    const first = buildAcceptancePackage(batchIdentity(), rows).digest;
    const shuffled = buildAcceptancePackage(batchIdentity(), [...rows].reverse()).digest;
    const rebuilt = buildAcceptancePackage(batchIdentity(), rows.map((r) => ({ ...r }))).digest;
    expect(shuffled).toBe(first);
    expect(rebuilt).toBe(first);
  });

  it("changes when the batch identity, status or provenance changes", () => {
    const base = buildAcceptancePackage(batchIdentity(), rows).digest;
    const variants: Partial<AcceptanceBatchIdentity>[] = [
      { id: "22222222-2222-4222-8222-222222222222" },
      { status: "approved" },
      { source_label: "دفتر آخر" },
      { created_at: "2026-07-02T09:00:00.000Z" },
      { created_by: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      { approved_at: "2026-07-02T09:00:00.000Z" },
      { approved_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
      { source_workbook_sha256: SHA_B },
      { result_summary: { evidence_item_count: 3, batch_row_count: 3 } },
    ];
    for (const variant of variants) {
      expect(buildAcceptancePackage(batchIdentity(variant), rows).digest).not.toBe(base);
    }
  });

  it("changes when ANY evidence, decision, posting-payload or execution field changes", () => {
    const base = buildAcceptancePackage(batchIdentity(), rows).digest;
    const originalEvidence = rows[0].evidence as AcceptanceEvidence;
    const changedEvidence = (
      overrides: Partial<AcceptanceEvidence>,
    ): Partial<AcceptanceRow> => ({
      evidence: { ...originalEvidence, ...overrides },
    });
    const mutations: Partial<AcceptanceRow>[] = [
      { review_state: "reviewed" },
      { disposition: "hold" },
      { reviewer_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
      { reviewed_at: "2026-07-02T09:00:00.000Z" },
      { review_reason: "سبب جديد" },
      { target_table: "sales" },
      { expense_category: "وقود" },
      { expense_description: "وصف آخر" },
      { expense_kind: "capex" },
      { expense_account_id: "aaaa9999-9999-4999-8999-999999999999" },
      { expense_cost_center_id: "bbbb9999-9999-4999-8999-999999999999" },
      { expense_supplier_id: "cccc9999-9999-4999-8999-999999999999" },
      { expense_payment_decision: null },
      { sale_crop: "مجدول" },
      { sale_quantity: "12.6" },
      { sale_unit: "كيلو" },
      { sale_unit_price: "1500.26" },
      { sale_recorded_total: "18753.13" },
      { sale_buyer_id: "dddd9999-9999-4999-8999-999999999999" },
      { sale_cost_center_id: "eeee9999-9999-4999-8999-999999999999" },
      { sale_farm_id: "ffff9999-9999-4999-8999-999999999999" },
      { sale_sector_id: "aaaa8888-8888-4888-8888-888888888888" },
      { sale_hawsha_id: "bbbb8888-8888-4888-8888-888888888888" },
      { sale_season: "2025" },
      { sale_delivery_date: "2024-03-01" },
      { sale_notes: "ملاحظة أخرى" },
      { sale_historical_date_decision: "manual_override" },
      { sale_effective_date: "2024-01-06" },
      { corrects_expense_id: "44444444-4444-4444-8444-444444444444" },
      { corrects_sale_id: "55555555-5555-4555-8555-555555555555" },
      { payload_hash: SHA_D },
      { frozen: false },
      { frozen_at: "2026-07-02T10:00:00.000Z" },
      { execution_result: "posted" },
      { execution_error: "فشل" },
      { expense_account: { code: "5200", name_ar: "مصروف آخر" } },
      { expense_cost_center: { code: "CC-9", name_ar: "قطاع ي" } },
      { expense_supplier: { name: "مورّد آخر" } },
      { sale_buyer: { name: "مشترٍ آخر" } },
      { sale_farm: { name: "مزرعة أخرى" } },
      { sale_sector: { name: "قطاع ٢" } },
      { sale_hawsha: { code: "H-9", name: "حوش ٩" } },
      changedEvidence({ origin_kind: "production_snapshot_row" }),
      changedEvidence({ sheet_name: "ورقة أخرى" }),
      changedEvidence({ row_locator: "99" }),
      changedEvidence({ snapshot_target_table: "sales" }),
      changedEvidence({ snapshot_target_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" }),
      changedEvidence({ source_workbook_sha256: SHA_D }),
      changedEvidence({ production_snapshot_sha256: SHA_D }),
      changedEvidence({ source_identity_fingerprint: "بصمة أخرى" }),
      changedEvidence({ source_amount: "100.01" }),
      changedEvidence({ source_date_text: "06/01/2024" }),
      changedEvidence({ source_date_parsed: "2024-01-06" }),
      changedEvidence({ classification: "ambiguous_identity_group" }),
      changedEvidence({ invalid_calendar_quality_flag: true }),
      changedEvidence({ evidence_label: "وصف آخر" }),
      { evidence: null },
    ];
    for (const mutation of mutations) {
      const mutated = [{ ...rows[0], ...mutation }, ...rows.slice(1)];
      expect(
        buildAcceptancePackage(batchIdentity(), mutated).digest,
        `mutating ${Object.keys(mutation).join(",")} must change the digest`,
      ).not.toBe(base);
    }
  });

  it("changes when a row is added, removed, or its amount is emptied", () => {
    const base = buildAcceptancePackage(batchIdentity(), rows).digest;
    expect(buildAcceptancePackage(batchIdentity(), rows.slice(1)).digest).not.toBe(base);
    expect(buildAcceptancePackage(batchIdentity(), [...rows, row()]).digest).not.toBe(base);
  });

  it("reads one VALUE the same way however PostgreSQL wrote its scale", () => {
    // `numeric` keeps its declared scale, so the same amount can arrive as "125.5" or "125.50". The
    // digest must depend on the VALUE, not on the scale the column happened to carry.
    const withId = (amount: string) =>
      [row({ evidence: evidence({ id: "fixed", source_amount: amount }) })].map((r) => ({
        ...r,
        id: "row",
        evidence_item_id: "fixed",
      }));
    expect(buildAcceptancePackage(batchIdentity(), withId("125.50")).digest).toBe(
      buildAcceptancePackage(batchIdentity(), withId("125.5")).digest,
    );
    // …but a different value is a different digest, so this is canonicalisation, not blindness.
    expect(buildAcceptancePackage(batchIdentity(), withId("125.51")).digest).not.toBe(
      buildAcceptancePackage(batchIdentity(), withId("125.5")).digest,
    );
  });

  it("hashes a document that names its format version and every content column", () => {
    const document = acceptancePayloadDocument(batchIdentity(), csvRowsOf(rows));
    expect(document).toContain("farm-os.reconciliation-acceptance.v1");
    for (const column of ACCEPTANCE_CONTENT_COLUMNS) {
      expect(document).toContain(`"${column.id}"`);
    }
    expect(JSON.parse(document)).toHaveLength(4);
  });

  it("reports the same figures the annex rows describe", () => {
    const pkg = buildAcceptancePackage(batchIdentity(), rows);
    expect(pkg.report.rowCount).toBe(pkg.csvRows.length);
    expect(pkg.rows.map((r) => r.id)).toEqual(orderByEvidenceLocator(rows).map((r) => r.id));
    expect(pkg.staged).toEqual({ kind: "recorded", counts: { evidenceItemCount: 2, batchRowCount: 2 } });
    expect(pkg.hashes.map((h) => h.value)).toEqual([SHA_A, SHA_B, SHA_C, SHA_D]);
  });
});

// ── PINNED BYTES. A signed acceptance is a signature on a digest, and every already-signed report was
//    signed on the bytes this format produces TODAY. Any later change to the annex columns, the
//    payload document, or the digest recipe would silently invalidate those signatures — so the exact
//    bytes of one fixed fixture are pinned here. These figures are not a preference: they were taken
//    from the format as it shipped, and a diff in any of them is a versioning decision
//    (ACCEPTANCE_DIGEST_VERSION), never an incidental edit.
describe("reconciliation acceptance — the annex/digest bytes are pinned to the shipped format", () => {
  /** Fixed ids, so the fixture is byte-identical on every machine and in any test order. */
  const pinnedEvidence = (n: number, overrides: Partial<AcceptanceEvidence> = {}) =>
    evidence({
      id: `eeeeeeee-0000-4000-8000-${String(n).padStart(12, "0")}`,
      row_locator: String(n),
      ...overrides,
    });
  const pinnedRow = (n: number, overrides: Partial<AcceptanceRow> = {}) =>
    row({
      id: `11111111-0000-4000-8000-${String(n).padStart(12, "0")}`,
      evidence: pinnedEvidence(n),
      ...overrides,
    });

  const pinnedBatch = () =>
    batchIdentity({
      result_summary: {
        evidence_item_count: 3,
        batch_row_count: 3,
        staging_manifest_sha256: SHA_B,
        tool_metadata: {
          production_snapshot_sha256: SHA_C,
          exception_evidence_sha256: SHA_D,
        },
      },
    });

  /** An included expense, an included sale on another sheet and in another year, and a rejected row
   *  whose source date is flagged unreadable — one row for each shape the breakdowns treat apart. */
  const pinnedRows = (): AcceptanceRow[] => [
    pinnedRow(1, {
      review_state: "frozen",
      disposition: "include",
      target_table: "expenses",
      expense_category: "أسمدة",
      expense_kind: "operating",
      payload_hash: SHA_B,
      frozen: true,
      frozen_at: "2026-07-01T10:00:00.000Z",
      expense_account: { code: "5100", name_ar: "مصروفات أسمدة" },
    }),
    pinnedRow(2, {
      review_state: "frozen",
      disposition: "include",
      target_table: "sales",
      sale_crop: "برحي",
      sale_quantity: "12.500",
      sale_unit_price: "1500.25",
      sale_recorded_total: "18753.125",
      frozen: true,
      evidence: pinnedEvidence(2, {
        sheet_name: "المبيعات",
        source_amount: "18753.125",
        source_date_parsed: "2025-02-11",
        source_date_text: "11/02/2025",
      }),
    }),
    pinnedRow(3, {
      review_state: "rejected",
      evidence: pinnedEvidence(3, {
        source_amount: null,
        source_date_parsed: null,
        source_date_text: "غير مقروء",
        invalid_calendar_quality_flag: true,
      }),
    }),
  ];

  const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

  it("keeps the digest recipe and its version exactly as signed reports assume", () => {
    expect(ACCEPTANCE_DIGEST_VERSION).toBe("farm-os.reconciliation-acceptance.v1");
    const document = acceptancePayloadDocument(pinnedBatch(), csvRowsOf(pinnedRows()));
    expect(sha256(document)).toBe(
      "961c74b63917c71706c0dc8e049ed95f16bbf1e99a0ce4e707128c9c0ebf5925",
    );
    expect(buildAcceptancePackage(pinnedBatch(), pinnedRows()).digest).toBe(sha256(document));
  });

  it("keeps the annex columns and the CSV bytes exactly as signed annexes assume", () => {
    // Every id AND every header, in order — one hash so a single changed word fails loudly.
    expect(ACCEPTANCE_CSV_COLUMNS).toHaveLength(73);
    expect(ACCEPTANCE_CSV_COLUMNS[0]).toBe(ACCEPTANCE_DIGEST_COLUMN);
    expect(sha256(JSON.stringify(ACCEPTANCE_CSV_COLUMNS))).toBe(
      "1b69d94c6dc085b1060ba165c5a3bae5e11203898a1f7d8107408757ea2aca49",
    );
    const csv = rowsToCsv(
      buildAcceptancePackage(pinnedBatch(), pinnedRows()).csvRows,
      ACCEPTANCE_CSV_COLUMNS,
    );
    expect(csv).toHaveLength(2675);
    expect(sha256(csv)).toBe(
      "4339720ad99e525809429de67ea64edef9ae618904e2f4ee206cfca59e647733",
    );
  });

  it("re-grouping the same rows changes NOTHING the signature covers", () => {
    // The control totals are a view over rows the package already contains: they are computed from
    // the report, never fed into the payload document, so the digest cannot depend on them.
    const pkg = buildAcceptancePackage(pinnedBatch(), pinnedRows());
    expect(pkg.report.controlTotals.years.map((year) => year.key)).toEqual([
      "year:2024",
      "year:2025",
    ]);
    expect(pkg.report.controlTotals.total.amount).toEqual(pkg.report.sourceTotal);
    // The annex rows are the content rows plus the digest stamp — no new cell, no reordering.
    const content = csvRowsOf(pinnedRows());
    expect(pkg.csvRows).toEqual(
      content.map((row) => ({ [ACCEPTANCE_DIGEST_COLUMN.id]: pkg.digest, ...row })),
    );
  });
});

// ── Behavioural tests for the ONE read: a single read RPC, against a recording Supabase stub. ──────
//
// The loader used to issue three PostgREST statements (batch, rows, count) at three snapshots. It now
// makes one call to `fn_reconciliation_acceptance_snapshot`, so the stub below records the RPC and
// THROWS on `.from(...)` — a reader that goes back to table reads fails here, loudly.

function rpcStub(result: { data?: unknown; error?: unknown }) {
  const calls: { fn: string; args: unknown }[] = [];
  const client = {
    rpc(fn: string, args: unknown) {
      calls.push({ fn, args });
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    },
    from() {
      throw new Error("the acceptance loader must read through the snapshot RPC only");
    },
  };
  // The stub implements exactly the surface the loader uses; the cast keeps that surface honest by
  // failing at runtime if the loader starts calling something else.
  return { sb: client as unknown as SupabaseClient<Database>, calls };
}

/** The staging record a healthy batch of `rows` carries — counts that agree with what is stored. */
function stagedSummary(rows: AcceptanceRow[], overrides: Record<string, unknown> = {}) {
  return {
    evidence_item_count: new Set(rows.map((r) => r.evidence_item_id)).size,
    batch_row_count: rows.length,
    staging_manifest_sha256: SHA_B,
    tool_metadata: { production_snapshot_sha256: SHA_C, exception_evidence_sha256: SHA_D },
    ...overrides,
  };
}

/**
 * A well-formed snapshot payload. The RPC emits every contract key explicitly, and the fixture rows
 * already carry exactly the row/evidence key set — so `{...row}` IS the wire shape, and a test that
 * deletes a key is testing the real "server stopped sending this field" case.
 */
function snapshot(rows: AcceptanceRow[], overrides: Record<string, unknown> = {}) {
  return {
    version: ACCEPTANCE_SNAPSHOT_VERSION,
    status: "ok",
    max_rows: ACCEPTANCE_MAX_ROWS,
    row_count: rows.length,
    evidence_item_count: new Set(rows.map((r) => r.evidence_item_id)).size,
    batch: { ...batchIdentity({ result_summary: stagedSummary(rows) }) },
    rows: rows.map((r) => ({ ...r })),
    ...overrides,
  };
}

/** Two rows is the smallest batch that exercises both posting destinations. */
function twoRows(): AcceptanceRow[] {
  return [includedExpenseRow(), includedSaleRow()];
}

describe("loadAcceptanceBatch — one bounded, org-scoped, single-snapshot read", () => {
  it("calls the snapshot RPC once, with the active org and the batch, and reads no table", async () => {
    const rows = twoRows();
    const { sb, calls } = rpcStub({ data: snapshot(rows) });

    const load = await loadAcceptanceBatch(sb, BATCH_ID, ORG_ID);

    expect(load.ok).toBe(true);
    if (!load.ok) return;
    expect(load.batch.id).toBe(BATCH_ID);
    expect(load.rows).toHaveLength(2);
    expect(calls).toEqual([
      { fn: ACCEPTANCE_SNAPSHOT_RPC, args: { p_org: ORG_ID, p_batch_id: BATCH_ID } },
    ]);
  });

  it("keeps every posting-payload field and readable label the annex prints", async () => {
    const rows = twoRows();
    const { sb } = rpcStub({ data: snapshot(rows) });
    const load = await loadAcceptanceBatch(sb, BATCH_ID, ORG_ID);
    expect(load.ok).toBe(true);
    if (!load.ok) return;

    const expense = load.rows.find((r) => r.target_table === "expenses");
    const sale = load.rows.find((r) => r.target_table === "sales");
    expect(expense?.expense_account).toEqual({ code: "5100", name_ar: "مصروفات أسمدة" });
    expect(expense?.expense_supplier).toEqual({ name: "شركة الأسمدة" });
    expect(expense?.payload_hash).toBe(SHA_B);
    expect(sale?.sale_hawsha).toEqual({ code: "H-1", name: "حوش ١" });
    expect(sale?.sale_unit_price).toBe("1500.25");
    expect(sale?.evidence?.classification).toBe("source_addition_candidate");
  });

  it("maps every server refusal to its own fail-closed outcome", async () => {
    const cases: [string, AcceptanceLoadKind, string][] = [
      ["not_found", "not_found", ""],
      ["overflow", "overflow", ACCEPTANCE_OVERFLOW_AR],
      ["incomplete", "incomplete", ACCEPTANCE_INCOMPLETE_AR],
      ["count_mismatch", "count_mismatch", ACCEPTANCE_COUNT_MISMATCH_AR],
      ["empty", "empty", ACCEPTANCE_EMPTY_AR],
    ];
    for (const [status, kind, error] of cases) {
      const { sb } = rpcStub({
        data: { version: ACCEPTANCE_SNAPSHOT_VERSION, status, row_count: 0 },
      });
      const load = await loadAcceptanceBatch(sb, BATCH_ID, ORG_ID);
      expect(load.ok).toBe(false);
      expect(load).toMatchObject(error ? { kind, error } : { kind });
    }
  });

  it("refuses an RPC error, and any status it does not recognise", async () => {
    const failures: unknown[] = [
      undefined,
      null,
      "ok",
      [],
      { status: "ok" }, // no version
      { version: "farm-os.reconciliation-acceptance-snapshot.v2", status: "ok" },
      { version: ACCEPTANCE_SNAPSHOT_VERSION, status: "" },
      { version: ACCEPTANCE_SNAPSHOT_VERSION, status: "partially_ok" },
    ];
    for (const data of failures) {
      const { sb } = rpcStub({ data });
      expect(await loadAcceptanceBatch(sb, BATCH_ID, ORG_ID)).toEqual({
        ok: false,
        kind: "read_failed",
        error: ACCEPTANCE_READ_FAILED_AR,
      });
    }
    const { sb } = rpcStub({ error: { message: "boom" } });
    expect(await loadAcceptanceBatch(sb, BATCH_ID, ORG_ID)).toEqual({
      ok: false,
      kind: "read_failed",
      error: ACCEPTANCE_READ_FAILED_AR,
    });
  });

  it("is not_found for a malformed batch id, and read_failed for a malformed org, before any call", async () => {
    const { sb, calls } = rpcStub({ data: snapshot(twoRows()) });
    for (const bad of ["", "not-a-uuid", "11111111-1111-4111-8111", `${BATCH_ID}' or 1=1--`]) {
      expect(await loadAcceptanceBatch(sb, bad, ORG_ID)).toEqual({ ok: false, kind: "not_found" });
    }
    // A malformed org is a caller bug — it must not read as "no such batch".
    expect(await loadAcceptanceBatch(sb, BATCH_ID, "nope")).toMatchObject({ kind: "read_failed" });
    expect(calls).toHaveLength(0);
  });

  it("accepts a batch exactly at the bound and refuses one past it", async () => {
    const atBound = Array.from({ length: ACCEPTANCE_MAX_ROWS }, () => row());
    const { sb } = rpcStub({ data: snapshot(atBound) });
    expect((await loadAcceptanceBatch(sb, BATCH_ID, ORG_ID)).ok).toBe(true);

    const past = Array.from({ length: ACCEPTANCE_MAX_ROWS + 1 }, () => row());
    const { sb: sb2 } = rpcStub({ data: snapshot(past) });
    expect(await loadAcceptanceBatch(sb2, BATCH_ID, ORG_ID)).toMatchObject({ kind: "overflow" });
  });
});

// ── The parser is where a signature is actually protected: everything below is a payload that LOOKS
//    like a report and must not become one.
describe("parseAcceptanceSnapshot — a payload it does not fully recognise is never a report", () => {
  it("REFUSES a batch with zero rows — a report of zeros is not an acceptance", () => {
    // Both locks are pinned: the server says 'empty', and an 'ok' payload carrying no rows is refused
    // here too, so no code path can render a complete, signable page whose every total is 0.
    expect(parseAcceptanceSnapshot(snapshot([]))).toEqual({
      ok: false,
      kind: "empty",
      error: ACCEPTANCE_EMPTY_AR,
    });
    expect(
      parseAcceptanceSnapshot({ version: ACCEPTANCE_SNAPSHOT_VERSION, status: "empty" }),
    ).toMatchObject({ kind: "empty" });
  });

  it("refuses a declared count that does not match the rows actually sent", () => {
    const rows = twoRows();
    expect(parseAcceptanceSnapshot(snapshot(rows, { row_count: 3 }))).toMatchObject({
      kind: "read_failed",
    });
    expect(parseAcceptanceSnapshot(snapshot(rows, { row_count: null }))).toMatchObject({
      kind: "read_failed",
    });
    // …and an evidence count that disagrees with the distinct evidence items in the rows.
    expect(parseAcceptanceSnapshot(snapshot(rows, { evidence_item_count: 1 }))).toMatchObject({
      kind: "read_failed",
    });
    const noEvidenceCount = snapshot(rows) as Record<string, unknown>;
    delete noEvidenceCount.evidence_item_count;
    expect(parseAcceptanceSnapshot(noEvidenceCount)).toMatchObject({ kind: "read_failed" });
  });

  it("refuses two rows that share one evidence item", () => {
    const shared = evidence();
    const rows = [row({ evidence: shared }), row({ evidence: shared })];
    // The batch/evidence unique index makes this impossible in the DB; a payload that shows it is not
    // the batch it claims to be.
    expect(parseAcceptanceSnapshot(snapshot(rows))).toMatchObject({ kind: "incomplete" });
  });

  it("refuses a bound that is not the one this build enforces", () => {
    expect(parseAcceptanceSnapshot(snapshot(twoRows(), { max_rows: 500 }))).toMatchObject({
      kind: "read_failed",
    });
  });

  it("refuses an accounting amount that arrived as a JSON number", () => {
    // This is the whole point of the RPC's ::text serialisation: a number here already went through a
    // binary double inside JSON.parse, before lib/decimal.ts could read a digit.
    for (const mutate of [
      (r: Record<string, unknown>) => {
        (r.evidence as Record<string, unknown>).source_amount = 125.5;
      },
      (r: Record<string, unknown>) => {
        r.sale_unit_price = 1500.25;
      },
      (r: Record<string, unknown>) => {
        r.sale_quantity = 12.5;
      },
      (r: Record<string, unknown>) => {
        r.sale_recorded_total = 0;
      },
    ]) {
      const payload = snapshot([includedSaleRow()]);
      const target = payload.rows[0] as Record<string, unknown>;
      target.evidence = { ...(target.evidence as Record<string, unknown>) };
      mutate(target);
      expect(parseAcceptanceSnapshot(payload)).toMatchObject({ kind: "read_failed" });
    }
  });

  it("refuses decimal TEXT outside the grammar and bounds lib/decimal.ts can read exactly", () => {
    for (const bad of [
      "١٢٥",
      "125,5",
      "1.2.3",
      "abc",
      "",
      "  ",
      "NaN",
      "Infinity",
      `0.${"1".repeat(101)}`, // past MAX_SCALE
      "1".repeat(1001), // past MAX_INTEGER_DIGITS
    ]) {
      const payload = snapshot([includedSaleRow()]);
      const target = payload.rows[0] as Record<string, unknown>;
      target.evidence = { ...(target.evidence as Record<string, unknown>), source_amount: bad };
      expect(parseAcceptanceSnapshot(payload)).toMatchObject({ kind: "read_failed" });
    }
    // …and accepts the exact ones, including a value no double could hold.
    for (const good of ["0", "-0.01", "12345678901234567890.12345678901234567890", "1e3"]) {
      const payload = snapshot([includedSaleRow()]);
      const target = payload.rows[0] as Record<string, unknown>;
      target.evidence = { ...(target.evidence as Record<string, unknown>), source_amount: good };
      expect(parseAcceptanceSnapshot(payload).ok).toBe(true);
    }
  });

  it("refuses a MISSING key, while accepting an explicit null where the contract allows one", () => {
    // A field the server silently stopped sending must never read as "not recorded".
    for (const key of [
      "review_reason",
      "expense_account_id",
      "sale_notes",
      "payload_hash",
      "frozen_at",
      "execution_error",
      "sale_quantity",
      "expense_supplier",
      "sale_hawsha",
      "evidence",
    ]) {
      const payload = snapshot([includedSaleRow()]);
      const target = payload.rows[0] as Record<string, unknown>;
      delete target[key];
      expect(parseAcceptanceSnapshot(payload)).toMatchObject({ kind: "read_failed" });
    }
    // Explicit nulls in the same places are the contract's "not recorded" and are accepted.
    const nulled = snapshot([includedSaleRow()]);
    const target = nulled.rows[0] as Record<string, unknown>;
    for (const key of ["review_reason", "sale_notes", "execution_error", "expense_supplier"]) {
      target[key] = null;
    }
    expect(parseAcceptanceSnapshot(nulled).ok).toBe(true);
  });

  it("refuses a label ref that is missing one of its own keys", () => {
    const payload = snapshot([includedSaleRow()]);
    const target = payload.rows[0] as Record<string, unknown>;
    target.sale_hawsha = { code: "H-1" }; // no `name`
    expect(parseAcceptanceSnapshot(payload)).toMatchObject({ kind: "read_failed" });
  });

  it("refuses a row whose evidence is null, or belongs to a different evidence item", () => {
    const nullEvidence = snapshot([includedSaleRow()]);
    (nullEvidence.rows[0] as Record<string, unknown>).evidence = null;
    expect(parseAcceptanceSnapshot(nullEvidence)).toMatchObject({ kind: "read_failed" });

    const mismatched = snapshot([includedSaleRow()]);
    const target = mismatched.rows[0] as Record<string, unknown>;
    target.evidence = {
      ...(target.evidence as Record<string, unknown>),
      id: "00000000-0000-4000-8000-999999999999",
    };
    expect(parseAcceptanceSnapshot(mismatched)).toMatchObject({ kind: "read_failed" });
  });

  it("refuses a batch object missing a required key, including result_summary", () => {
    for (const key of ["id", "status", "created_at", "source_label", "approved_by", "result_summary"]) {
      const payload = snapshot(twoRows());
      delete (payload.batch as Record<string, unknown>)[key];
      expect(parseAcceptanceSnapshot(payload)).toMatchObject({ kind: "read_failed" });
    }
    // A null result_summary has no staging proof and no final outcome, so it is never signable.
    const nulled = snapshot(twoRows());
    (nulled.batch as Record<string, unknown>).result_summary = null;
    expect(parseAcceptanceSnapshot(nulled)).toMatchObject({ kind: "count_mismatch" });
  });

  it("refuses unknown database decision states instead of counting them as decided", () => {
    for (const [field, value] of [
      ["review_state", "future_review_state"],
      ["disposition", "future_disposition"],
      ["execution_result", "future_execution_result"],
    ] as const) {
      const payload = snapshot(twoRows());
      (payload.rows as Record<string, unknown>[])[0][field] = value;
      expect(parseAcceptanceSnapshot(payload)).toMatchObject({ kind: "read_failed" });
    }
    const unknownBatchStatus = snapshot(twoRows());
    (unknownBatchStatus.batch as Record<string, unknown>).status = "future_batch_status";
    expect(parseAcceptanceSnapshot(unknownBatchStatus)).toMatchObject({ kind: "read_failed" });
  });

  it("binds a valid snapshot back to the batch id that was requested", () => {
    const payload = snapshot(twoRows());
    expect(parseAcceptanceSnapshot(payload, BATCH_ID).ok).toBe(true);
    expect(
      parseAcceptanceSnapshot(payload, "22222222-2222-4222-8222-222222222222"),
    ).toMatchObject({ kind: "read_failed" });
  });
});

// ── The staging counts: three states, and conflating two of them is the defect.
describe("acceptanceStagedCounts + the parser's staging cross-check", () => {
  it("reads both keys, or reports their joint absence, or reports damage", () => {
    expect(acceptanceStagedCounts("staged", { evidence_item_count: 2, batch_row_count: 2 })).toEqual({
      kind: "recorded",
      counts: { evidenceItemCount: 2, batchRowCount: 2 },
    });
    expect(acceptanceStagedCounts("executed", { executed_rows: 3, skipped_rows: 0 })).toEqual({
      kind: "absent",
    });
    expect(
      acceptanceStagedCounts("failed", { failure_code: "integrity_check", safe_locator: null }),
    ).toEqual({ kind: "absent" });
    expect(
      acceptanceStagedCounts("rolled_back", {
        rolled_back_at: "2026-07-28T10:00:00Z",
        rollback_reason: "test",
        reversed_journals: 1,
        reinstated_journals: 0,
        zero_value_rows: 0,
        ledger_rows_reversed: 2,
        rows_marked_reversed: 2,
      }),
    ).toEqual({ kind: "absent" });
    // Malformed — NOT absent. One key without the other, a wrong type, or an impossible value.
    for (const summary of [
      { batch_row_count: 2 },
      { evidence_item_count: 2 },
      { evidence_item_count: 2, batch_row_count: "2" },
      { evidence_item_count: 2, batch_row_count: 2.5 },
      { evidence_item_count: 2, batch_row_count: -1 },
      { evidence_item_count: 2, batch_row_count: null },
      { evidence_item_count: 2, batch_row_count: 2_147_483_648 },
      { evidence_item_count: Number.NaN, batch_row_count: 2 },
    ]) {
      expect(acceptanceStagedCounts("staged", summary)).toEqual({ kind: "malformed" });
    }
    for (const [status, summary] of [
      ["staged", null],
      ["staged", { executed_rows: 2, skipped_rows: 0 }],
      ["executing", null],
      ["executed", { executed_rows: 2, skipped_rows: 0, unexpected: true }],
      ["failed", { failure_code: "integrity_check" }],
      ["rolled_back", {}],
    ] as const) {
      expect(acceptanceStagedCounts(status, summary)).toEqual({ kind: "malformed" });
    }
  });

  it("refuses the report when the staging record is damaged — never skips the check", () => {
    const rows = twoRows();
    for (const summary of [
      { batch_row_count: 2 },
      { evidence_item_count: 2, batch_row_count: "2" },
      { evidence_item_count: 2, batch_row_count: -2 },
    ]) {
      const payload = snapshot(rows);
      (payload.batch as Record<string, unknown>).result_summary = summary;
      expect(parseAcceptanceSnapshot(payload)).toEqual({
        ok: false,
        kind: "count_mismatch",
        error: ACCEPTANCE_COUNT_MISMATCH_AR,
      });
    }
  });

  it("refuses the report when a recorded count disagrees with what is stored", () => {
    const rows = twoRows();
    for (const summary of [
      stagedSummary(rows, { batch_row_count: 3 }),
      stagedSummary(rows, { evidence_item_count: 3 }),
    ]) {
      const payload = snapshot(rows);
      (payload.batch as Record<string, unknown>).result_summary = summary;
      expect(parseAcceptanceSnapshot(payload)).toMatchObject({ kind: "count_mismatch" });
    }
  });

  it("allows only a status-matched, exact terminal outcome to replace staged counts", () => {
    const payload = snapshot(twoRows());
    (payload.batch as Record<string, unknown>).status = "executed";
    for (const row of payload.rows as Record<string, unknown>[]) row.execution_result = "posted";
    (payload.batch as Record<string, unknown>).result_summary = {
      executed_rows: 2,
      skipped_rows: 0,
    };
    expect(parseAcceptanceSnapshot(payload).ok).toBe(true);

    for (const executionResult of ["pending", "failed"] as const) {
      const unsettledRow = structuredClone(payload);
      (unsettledRow.rows as Record<string, unknown>[])[0].execution_result = executionResult;
      expect(parseAcceptanceSnapshot(unsettledRow)).toMatchObject({ kind: "count_mismatch" });
    }

    const wrongOutcomeCounts = structuredClone(payload);
    (wrongOutcomeCounts.batch as Record<string, unknown>).result_summary = {
      executed_rows: 1,
      skipped_rows: 1,
    };
    expect(parseAcceptanceSnapshot(wrongOutcomeCounts)).toMatchObject({ kind: "count_mismatch" });

    for (const [status, summary] of [
      ["staged", { executed_rows: 2, skipped_rows: 0 }],
      ["executing", null],
      ["executed", null],
      ["executed", { executed_rows: 2, skipped_rows: 0, unexpected: true }],
      ["failed", { failure_code: "integrity_check" }],
    ] as const) {
      const invalid = snapshot(twoRows());
      (invalid.batch as Record<string, unknown>).status = status;
      (invalid.batch as Record<string, unknown>).result_summary = summary;
      expect(parseAcceptanceSnapshot(invalid)).toMatchObject({ kind: "count_mismatch" });
    }
  });
});

// ── The whole lifecycle record, canonically bound into the digest and readably displayed.
describe("reconciliation acceptance — the batch's lifecycle record", () => {
  it("canonicalises independently of object key order, at any depth", () => {
    const a = { z: 1, a: { d: [1, 2], c: "x" } };
    const b = { a: { c: "x", d: [1, 2] }, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    // Array ORDER is meaning and is preserved.
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
    // Scalar TYPES are tagged, so these can never collide.
    const distinct = [1, "1", true, null, [], {}].map((value) => canonicalJson({ v: value }));
    expect(new Set(distinct).size).toBe(distinct.length);
  });

  it("changes the digest for a change ANYWHERE in result_summary, however deep", () => {
    const rows = twoRows();
    const digestFor = (summary: unknown) =>
      buildAcceptancePackage(batchIdentity({ result_summary: summary }), rows).digest;
    const base = stagedSummary(rows);
    const baseDigest = digestFor(base);

    for (const changed of [
      // a nested tool hash — two levels down
      { ...base, tool_metadata: { ...base.tool_metadata, exception_evidence_sha256: SHA_A } },
      // a field the page never prints at all
      { ...base, by_dataset: { expense: { exception_row_count: 1 } } },
      // an execution verdict replacing the staging record
      { executed_rows: 2, skipped_rows: 0 },
      { executed_rows: 2, skipped_rows: 1 },
      // a row-level field that is deliberately never displayed
      { failure_code: "x", safe_locator: "row-1" },
      { failure_code: "x", safe_locator: "row-2" },
      null,
    ]) {
      expect(digestFor(changed)).not.toBe(baseDigest);
    }
  });

  it("does NOT change the digest when the same record is serialised in another key order", () => {
    const rows = twoRows();
    const ordered = {
      evidence_item_count: 2,
      batch_row_count: 2,
      staging_manifest_sha256: SHA_B,
      tool_metadata: { production_snapshot_sha256: SHA_C, exception_evidence_sha256: SHA_D },
    };
    const shuffled = {
      tool_metadata: { exception_evidence_sha256: SHA_D, production_snapshot_sha256: SHA_C },
      staging_manifest_sha256: SHA_B,
      batch_row_count: 2,
      evidence_item_count: 2,
    };
    expect(buildAcceptancePackage(batchIdentity({ result_summary: ordered }), rows).digest).toBe(
      buildAcceptancePackage(batchIdentity({ result_summary: shuffled }), rows).digest,
    );
  });

  it("renders the recorded outcome readably and WITHHOLDS row-level identifiers", () => {
    const staged = acceptanceOutcome({
      evidence_item_count: 2,
      batch_row_count: 2,
      staging_manifest_sha256: SHA_B,
      tool_metadata: { production_snapshot_sha256: SHA_C },
    });
    expect(staged.lines.map((line) => line.key)).toEqual([
      "evidence_item_count",
      "batch_row_count",
      "staging_manifest_sha256",
    ]);
    // `tool_metadata` is a structure, not a figure: counted, not dumped.
    expect(staged.withheldCount).toBe(1);

    const executed = acceptanceOutcome({ executed_rows: 2, skipped_rows: 0 });
    expect(executed.lines.map((line) => line.value)).toEqual([num(2), num(0)]);

    // §2.7 redaction: `safe_locator` is a ROW-LEVEL locator and must never reach a printed document.
    const failed = acceptanceOutcome({ failure_code: "amount_not_executable", safe_locator: "r-1" });
    expect(failed.lines.map((line) => line.key)).toEqual(["failure_code"]);
    expect(failed.withheldCount).toBe(1);
    expect(JSON.stringify(failed)).not.toContain("r-1");

    const rolledBack = acceptanceOutcome({
      rolled_back_at: "2026-07-02T10:00:00+00:00",
      rollback_reason: "خطأ في التصنيف",
      reversed_journals: 4,
    });
    expect(rolledBack.lines).toHaveLength(3);
    expect(rolledBack.empty).toBe(false);

    for (const summary of [null, {}, "x", []]) {
      expect(acceptanceOutcome(summary)).toEqual({ lines: [], withheldCount: 0, empty: true });
    }
  });

  it("carries the outcome on the package the page renders", () => {
    const pkg = buildAcceptancePackage(
      batchIdentity({ status: "executed", result_summary: { executed_rows: 2, skipped_rows: 0 } }),
      twoRows(),
    );
    expect(pkg.outcome.lines).toHaveLength(2);
    expect(pkg.staged).toEqual({ kind: "absent" });
  });
});

// ── The printed acceptance assertion: what the signer is actually asked to certify.
describe("reconciliation acceptance — the printed assertion asks for every certified fact", () => {
  it("names the dual run, the source, the period, both control totals and the difference", () => {
    const keys = ACCEPTANCE_ASSERTION_FIELDS.map((field) => field.key);
    expect(keys).toEqual([
      "dual_run_completed",
      "source_reference",
      "period",
      "source_control_total",
      "system_control_total",
      "difference",
      "difference_explanation",
      "exception_outcome",
      "accepted_outcome",
    ]);
    for (const field of ACCEPTANCE_ASSERTION_FIELDS) {
      expect(field.label.length).toBeGreaterThan(0);
      expect(field.hint.length).toBeGreaterThan(0);
      // Blanks, not figures: the schema stores none of these, so none may be pre-filled.
      expect(field.label).not.toMatch(/[0-9٠-٩]/);
    }
  });

  it("prohibits signing until every blank is filled and the difference is reconciled", () => {
    expect(ACCEPTANCE_ASSERTION_PROHIBITION_AR).toContain("لا يُوقَّع");
    expect(ACCEPTANCE_ASSERTION_PROHIBITION_AR).toContain("التشغيل المزدوج");
    expect(ACCEPTANCE_ASSERTION_PROHIBITION_AR).toContain("الفرق");
    expect(ACCEPTANCE_ASSERTION_PROHIBITION_AR).toContain("خانة فارغة");
    expect(ACCEPTANCE_ASSERTION_PROHIBITION_AR).toContain("CSV");
  });

  it("asks BOTH signatories for a name, a signature and a date", () => {
    expect(ACCEPTANCE_SIGNATORIES_AR).toEqual(["المحاسب", "المالك"]);
    expect(ACCEPTANCE_SIGNATURE_LINES_AR).toEqual(["الاسم", "التوقيع", "التاريخ"]);
  });
});

// ── The CSV endpoint, exercised through its real handler. ──────────────────────────────────────────
//
// `vi.doMock` (NOT the hoisted `vi.mock`) is used on purpose: the loader above must stay REAL for the
// tests that exercise it, and only the route's own dynamic import — evaluated after these calls —
// receives the stubs.

const routeState: { membership: unknown; load: unknown } = { membership: null, load: null };

vi.doMock("@/lib/auth", () => ({ getActiveMembership: async () => routeState.membership }));
vi.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.doMock("@/lib/reconciliation acceptance data", () => ({
  loadAcceptanceBatch: async () => routeState.load,
}));

async function callCsvRoute(batchId = BATCH_ID): Promise<Response> {
  const { GET } = await import("@/app/api/finance/reconciliation/[batchId]/acceptance.csv/route");
  return GET(new Request(`http://localhost/api/x/${batchId}`), {
    params: Promise.resolve({ batchId }),
  });
}

describe("acceptance CSV endpoint — behaviour", () => {
  const owner = { userId: "u", orgId: ORG_ID, role: "owner", personId: null, name: null };

  it("answers 401 with no membership and 403 for a role that may not sign", async () => {
    routeState.membership = null;
    expect((await callCsvRoute()).status).toBe(401);

    routeState.membership = { ...owner, role: "storekeeper" };
    const forbidden = await callCsvRoute();
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "ليست لديك صلاحية تنزيل تقرير القبول" });
  });

  it("answers 400 for a malformed id before any read", async () => {
    routeState.membership = owner;
    expect((await callCsvRoute("not-a-uuid")).status).toBe(400);
  });

  it("maps every fail-closed load outcome to its status, with no CSV body", async () => {
    routeState.membership = owner;
    const cases: [unknown, number][] = [
      [{ ok: false, kind: "not_found" }, 404],
      [{ ok: false, kind: "overflow", error: ACCEPTANCE_OVERFLOW_AR }, 413],
      [{ ok: false, kind: "read_failed", error: ACCEPTANCE_READ_FAILED_AR }, 500],
      [{ ok: false, kind: "incomplete", error: ACCEPTANCE_INCOMPLETE_AR }, 500],
      // Both are states of the batch itself, not server faults.
      [{ ok: false, kind: "count_mismatch", error: ACCEPTANCE_COUNT_MISMATCH_AR }, 409],
      [{ ok: false, kind: "empty", error: ACCEPTANCE_EMPTY_AR }, 409],
    ];
    for (const [load, status] of cases) {
      routeState.load = load;
      const response = await callCsvRoute();
      expect(response.status).toBe(status);
      expect(response.headers.get("Content-Type")).toContain("application/json");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.text()).not.toContain("الترتيب");
    }
  });

  it("serves the annex with the package digest in every row and in the filename", async () => {
    routeState.membership = { ...owner, role: "accountant" };
    const rows = [includedExpenseRow(), includedSaleRow()];
    routeState.load = { ok: true, batch: batchIdentity(), rows };

    const response = await callCsvRoute();
    // Read the raw bytes: Response.text() would swallow the UTF-8 BOM that makes Excel render Arabic.
    const bytes = new Uint8Array(await response.arrayBuffer());
    const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    const expected = buildAcceptancePackage(batchIdentity(), rows);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="${expected.csvFilename}"`,
    );
    expect(expected.csvFilename).toContain(expected.digestShort);

    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = body.split("\r\n");
    expect(lines).toHaveLength(rows.length + 1);
    expect(lines[0].startsWith(`﻿${ACCEPTANCE_DIGEST_COLUMN.header}`)).toBe(true);
    for (const line of lines.slice(1)) {
      expect(line.startsWith(`${expected.digest},`)).toBe(true);
    }
    expect(body).toBe(rowsToCsv(expected.csvRows, ACCEPTANCE_CSV_COLUMNS));
  });
});

// ── Source contracts. Auth, tenant scope, the LIMIT+1 bound and the read-only guarantee are
//    properties of the SERVER source, not of any value a unit test can observe — so they are pinned
//    here as defence in depth alongside the behavioural tests above: an edit that widens the scope,
//    truncates the batch, or adds a write path fails this suite.
const DATA_SOURCE = readFileSync(join(process.cwd(), "lib/reconciliation acceptance data.ts"), "utf8");
const PAGE_SOURCE = readFileSync(
  join(process.cwd(), "app/(app)/finance/reconciliation/[batchId]/acceptance/page.tsx"),
  "utf8",
);
const ROUTE_SOURCE = readFileSync(
  join(process.cwd(), "app/api/finance/reconciliation/[batchId]/acceptance.csv/route.ts"),
  "utf8",
);
const BATCH_PAGE_SOURCE = readFileSync(
  join(process.cwd(), "app/(app)/finance/reconciliation/[batchId]/page.tsx"),
  "utf8",
);
const GLOBALS_CSS = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const MIGRATION_SOURCE = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260728120000 accounting reconciliation acceptance snapshot.sql",
  ),
  "utf8",
);
/** Any client-side write. The acceptance path performs exactly one READ rpc and nothing else. */
const MUTATION = /\.(insert|update|upsert|delete)\(/;

describe("reconciliation acceptance — read source contract", () => {
  it("reads through ONE snapshot RPC and never through a table read", () => {
    expect(DATA_SOURCE).toContain("sb.rpc(ACCEPTANCE_SNAPSHOT_RPC, {");
    expect(DATA_SOURCE).toContain("p_org: orgId");
    expect(DATA_SOURCE).toContain("p_batch_id: batchId");
    // Exactly one call, and no PostgREST table access at all — the three-statement read that could
    // return a hybrid of two snapshots is gone, not merely discouraged.
    expect(DATA_SOURCE.match(/sb\.rpc\(/g)).toHaveLength(1);
    expect(DATA_SOURCE).not.toMatch(/\.from\(/);
    expect(DATA_SOURCE).not.toMatch(/\.eq\(/);
    expect(DATA_SOURCE).not.toMatch(/count: "exact"/);
  });

  it("names the DB function and the contract version the migration declares", () => {
    expect(MIGRATION_SOURCE).toContain(
      "create or replace function public.fn_reconciliation_acceptance_snapshot(p_org uuid, p_batch_id uuid)",
    );
    expect(DATA_SOURCE).toContain(
      'export const ACCEPTANCE_SNAPSHOT_RPC = "fn_reconciliation_acceptance_snapshot" as const',
    );
    expect(MIGRATION_SOURCE).toContain(`c_version constant text := '${ACCEPTANCE_SNAPSHOT_VERSION}'`);
    expect(DATA_SOURCE).toContain("snapshot.version !== ACCEPTANCE_SNAPSHOT_VERSION");
  });

  it("performs no mutation of any kind and stays server-only", () => {
    expect(DATA_SOURCE).not.toMatch(MUTATION);
    expect(DATA_SOURCE).toContain('import "server-only"');
    // No silent narrowing of the loaded rows anywhere in the reader.
    expect(DATA_SOURCE).not.toMatch(/\.slice\(|\.splice\(/);
  });

  it("fails closed on a malformed id, on an RPC error, and on an unrecognised payload", () => {
    expect(DATA_SOURCE).toContain('if (!isUuid(batchId)) return { ok: false, kind: "not_found" };');
    expect(DATA_SOURCE).toContain("if (!isUuid(orgId)) return READ_FAILED;");
    expect(DATA_SOURCE).toContain("if (error) return READ_FAILED;");
    expect(DATA_SOURCE).toContain('if (status !== "ok") return REFUSALS[status] ?? READ_FAILED;');
  });

  it("re-checks the bound, the counts, the emptiness and the staging record app-side too", () => {
    expect(DATA_SOURCE).toContain("snapshot.max_rows !== ACCEPTANCE_MAX_ROWS");
    expect(DATA_SOURCE).toContain("declared !== snapshot.rows.length");
    expect(DATA_SOURCE).toContain("if (snapshot.rows.length > ACCEPTANCE_MAX_ROWS) return REFUSALS.overflow;");
    expect(DATA_SOURCE).toContain("if (snapshot.rows.length === 0) return REFUSALS.empty;");
    expect(DATA_SOURCE).toContain('if (staged.kind === "malformed") return REFUSALS.count_mismatch;');
    expect(DATA_SOURCE).toContain("declaredEvidence !== evidenceIds.size");
  });

  it("requires exact decimal TEXT on every numeric accounting field", () => {
    expect(DATA_SOURCE).toContain('import { isDecimalText } from "./decimal"');
    expect(DATA_SOURCE).toContain("isDecimalText(text) ? text : undefined");
    expect(DATA_SOURCE).toContain(
      'const ROW_DECIMAL_FIELDS = ["sale_quantity", "sale_unit_price", "sale_recorded_total"] as const;',
    );
    expect(DATA_SOURCE).toContain('readDecimalText(source, "source_amount")');
  });
});

describe("reconciliation acceptance — the read RPC migration contract", () => {
  it("is SECURITY INVOKER, STABLE, search_path-locked and granted to authenticated only", () => {
    expect(MIGRATION_SOURCE).toContain("security invoker");
    expect(MIGRATION_SOURCE).not.toContain("security definer");
    expect(MIGRATION_SOURCE).toContain("stable");
    expect(MIGRATION_SOURCE).toContain("set search_path = ''");
    expect(MIGRATION_SOURCE).toContain(
      "revoke execute on function public.fn_reconciliation_acceptance_snapshot(uuid, uuid) from public, anon;",
    );
    expect(MIGRATION_SOURCE).toContain(
      "grant execute on function public.fn_reconciliation_acceptance_snapshot(uuid, uuid) to authenticated;",
    );
  });

  it("gates on the ACTIVE org and the owner/accountant permission before reading anything", () => {
    // Anchored on the executable lines, not on the header comment that also names them.
    const membership = MIGRATION_SOURCE.indexOf("public.user_org_ids() as scoped(org_id)");
    const role = MIGRATION_SOURCE.indexOf("if not public.authorize('finance.read', p_org) then");
    const read = MIGRATION_SOURCE.indexOf("from public.reconciliation_batches b");
    expect(membership).toBeGreaterThan(-1);
    expect(membership).toBeLessThan(role);
    expect(role).toBeLessThan(read);
    expect(MIGRATION_SOURCE).toContain("errcode = '42501'");
  });

  it("writes nothing, and adds no permission or table grant", () => {
    for (const forbidden of [
      /\binsert\s+into\b/i,
      /\bupdate\s+public\./i,
      /\bdelete\s+from\b/i,
      /\bcreate\s+table\b/i,
      /\bcreate\s+policy\b/i,
      /\bcreate\s+trigger\b/i,
      /\bgrant\s+(select|insert|update|delete)\b/i,
      /create or replace function public\.authorize/i,
    ]) {
      expect(MIGRATION_SOURCE).not.toMatch(forbidden);
    }
  });

  it("serialises every numeric accounting field as canonical decimal TEXT", () => {
    for (const field of [
      "r.sale_quantity::text",
      "r.sale_unit_price::text",
      "r.sale_recorded_total::text",
      "e.source_amount::text",
    ]) {
      expect(MIGRATION_SOURCE).toContain(field);
    }
    // Every numeric column of these two tables is covered — none may leave as a JSON number.
    expect(MIGRATION_SOURCE.match(/::text/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("renders timestamps as explicit UTC, so two reads cannot differ by session timezone", () => {
    expect(MIGRATION_SOURCE).toContain(
      `c_ts_format constant text := 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`,
    );
    for (const column of ["b.created_at", "b.approved_at", "r.reviewed_at", "r.frozen_at"]) {
      expect(MIGRATION_SOURCE).toContain(`to_char(${column} at time zone 'UTC', c_ts_format)`);
    }
  });

  it("bounds with MAX+1 and refuses every unsafe state instead of truncating", () => {
    expect(MIGRATION_SOURCE).toContain("limit c_max_rows + 1");
    expect(MIGRATION_SOURCE).toContain("c_max_rows constant int := 1000;");
    for (const status of ["'not_found'", "'empty'", "'overflow'", "'incomplete'", "'count_mismatch'"]) {
      expect(MIGRATION_SOURCE).toContain(`'status', ${status}`);
    }
    // Zero rows is refused, never answered with an ok payload of no rows.
    expect(MIGRATION_SOURCE).toContain("if v_declared = 0 then");
  });

  it("treats a damaged staging record as a refusal, not as an absent one", () => {
    expect(MIGRATION_SOURCE).toContain("v_has_staged_rows := v_summary is not null and v_summary ? 'batch_row_count';");
    expect(MIGRATION_SOURCE).toContain("not (v_has_staged_rows and v_has_staged_evidence)");
    expect(MIGRATION_SOURCE).toContain("'staged_counts_state', 'malformed'");
    expect(MIGRATION_SOURCE).toContain("^[0-9]{1,9}$");
  });

  it("left-joins evidence so an unreadable one is COUNTED, never dropped", () => {
    expect(MIGRATION_SOURCE).toContain("left join public.reconciliation_evidence_items e");
    expect(MIGRATION_SOURCE).not.toMatch(/inner join public\.reconciliation_evidence_items/);
    expect(MIGRATION_SOURCE).toContain("count(*) filter (where not x.evidence_present)");
    expect(MIGRATION_SOURCE).toContain("v_missing_evidence > 0");
  });

  it("joins every readable dimension label same-org, left-outer", () => {
    for (const table of [
      "public.accounts ea",
      "public.cost_centers ecc",
      "public.suppliers sup",
      "public.buyers buy",
      "public.cost_centers scc",
      "public.farms frm",
      "public.sectors sec",
      "public.hawshat haw",
    ]) {
      expect(MIGRATION_SOURCE).toContain(`left join ${table}`);
    }
    // Eight label joins + the evidence join, each narrowed to the row's own org (the alignment
    // whitespace in the migration is why this is not a single-space match).
    expect(MIGRATION_SOURCE.match(/and +\w+\.org_id += +r\.org_id/g)?.length).toBe(9);
  });
});

describe("reconciliation acceptance — page source contract", () => {
  it("requires the finance roles before creating a client", () => {
    expect(PAGE_SOURCE.indexOf('requireRole(["owner", "accountant"])')).toBeGreaterThan(-1);
    expect(PAGE_SOURCE.indexOf('requireRole(["owner", "accountant"])')).toBeLessThan(
      PAGE_SOURCE.indexOf("createClient()"),
    );
    expect(PAGE_SOURCE).toContain("if (!isUuid(batchId)) notFound();");
    expect(PAGE_SOURCE).toContain('load.kind === "not_found") notFound()');
  });

  it("reads through the one shared bounded loader and never queries or writes on its own", () => {
    expect(PAGE_SOURCE).toContain("loadAcceptanceBatch(sb, batchId, m.orgId)");
    // EXACTLY one snapshot read per render — every figure on the page, the breakdowns included, is
    // derived from that single load and never from a second one.
    expect(PAGE_SOURCE.match(/loadAcceptanceBatch\(/g)).toHaveLength(1);
    expect(PAGE_SOURCE.match(/buildAcceptancePackage\(/g)).toHaveLength(1);
    expect(PAGE_SOURCE).not.toMatch(/\.rpc\(/);
    expect(PAGE_SOURCE).not.toMatch(/\.from\(/);
    expect(PAGE_SOURCE).not.toMatch(MUTATION);
  });

  it("prints both control-total breakdowns, with the calendar caveat unconditional", () => {
    expect(PAGE_SOURCE).toContain("report.controlTotals.years.map((year) => ({");
    expect(PAGE_SOURCE).toContain("totals: report.controlTotals.undated");
    expect(PAGE_SOURCE).toContain("totals: report.controlTotals.sheets");
    // Both tables close on the SAME batch-wide footer, so neither can appear to add up on its own.
    expect(PAGE_SOURCE.match(/footer=\{report\.controlTotals\.total\}/g)).toHaveLength(2);
    // Rendered as a bare expression: no `&&`, no ternary, nothing the data can switch off.
    expect(
      PAGE_SOURCE.split("\n").filter(
        (line) => line.trim() === "{ACCEPTANCE_CONTROL_TOTALS_CAVEAT_AR}",
      ),
    ).toHaveLength(1);
  });

  it("renders the refusal BEFORE any figure is computed", () => {
    const refusal = PAGE_SOURCE.indexOf("لم يصدر تقرير قبول");
    const firstFigure = PAGE_SOURCE.indexOf("buildAcceptancePackage(batch, rows)");
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(firstFigure);
  });

  it("prints the package digest on the page and on the signature sheet", () => {
    expect(PAGE_SOURCE).toContain("ACCEPTANCE_DIGEST_NOTE_AR");
    expect(PAGE_SOURCE.match(/\{digest\}/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("carries the truthful no-dual-run statement and the full print-only assertion", () => {
    expect(PAGE_SOURCE).toContain("ACCEPTANCE_NO_DUAL_RUN_AR");
    expect(PAGE_SOURCE).toContain('<section className="print-only">');
    // Every certified fact is asked for by name, and both signatories are rendered from the shared
    // lists — so adding a field to the contract cannot leave the printed page behind.
    expect(PAGE_SOURCE).toContain("ACCEPTANCE_ASSERTION_PROHIBITION_AR");
    expect(PAGE_SOURCE).toContain("ACCEPTANCE_ASSERTION_FIELDS.map((field) => (");
    expect(PAGE_SOURCE).toContain("ACCEPTANCE_SIGNATORIES_AR.map((role) => (");
    expect(PAGE_SOURCE).toContain("ACCEPTANCE_SIGNATURE_LINES_AR.map((field) => (");
    expect(PAGE_SOURCE).toContain("ملاحظات وتحفظات");
    // Controls are hidden on paper; the report body and the statement are not.
    expect(PAGE_SOURCE).toContain('className="no-print ms-auto');
  });

  it("shows the batch's own lifecycle record without printing a row-level identifier", () => {
    expect(PAGE_SOURCE).toContain("ما سجّلته الدفعة عن نفسها");
    expect(PAGE_SOURCE).toContain("outcome.lines.map((line) => (");
    expect(PAGE_SOURCE).toContain("outcome.withheldCount");
    // The page never reaches into result_summary itself; acceptanceOutcome's allow-list is the only
    // path, and safe_locator is not on it.
    expect(PAGE_SOURCE).not.toContain("safe_locator");
    expect(PAGE_SOURCE).not.toMatch(/batch\.result_summary/);
  });

  it("formats acceptance money through the exact-decimal path only", () => {
    expect(PAGE_SOURCE).toContain("egpDecimalSummary");
    expect(PAGE_SOURCE).not.toContain("egpSummary(");
    expect(PAGE_SOURCE).not.toMatch(/\begp\(/);
  });
});

// ── The report is a PRINTED artifact: a column that scrolls on screen is a column that is CUT OFF on
//    paper, and a cut-off control total is a wrong figure on a signed page. The print behaviour is
//    therefore pinned as a contract, extracted by brace-matching so a reordered stylesheet still
//    passes and a moved-out-of-@media-print rule still fails.
/** The body of the stylesheet's `@media print { … }` block. */
function printMediaBlock(css: string): string {
  const start = css.indexOf("@media print");
  if (start < 0) return "";
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  return "";
}

/** The declarations of one rule, found by its selector (the last selector of a list is enough). */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return "";
  const open = start + selector.length + 2;
  const close = css.indexOf("}", open);
  return close < 0 ? "" : css.slice(open, close);
}

describe("reconciliation acceptance — the control totals fit the printed page", () => {
  const printBlock = printMediaBlock(GLOBALS_CSS);

  it("routes both breakdowns through the print-fit wrapper, screen behaviour unchanged", () => {
    expect(PAGE_SOURCE).toContain('<div className="print-fit-table overflow-x-auto">');
    // One shared component renders both breakdown tables, so one wrapper covers both.
    expect(PAGE_SOURCE.match(/className="print-fit-table/g)).toHaveLength(1);
    expect(PAGE_SOURCE.match(/<ControlTotalsTable/g)).toHaveLength(2);
    // On SCREEN the table still scrolls inside its wrapper exactly as before.
    expect(PAGE_SOURCE).toContain('<table className="w-full min-w-[44rem] text-xs"');
  });

  it("keeps every print-fit rule inside @media print — and nothing of it on screen", () => {
    expect(printBlock).not.toBe("");
    expect(printBlock).toContain(".print-fit-table {");
    // Removing the print block must remove every trace of the class: it is paper-only by construction.
    expect(GLOBALS_CSS.replace(printBlock, "")).not.toContain("print-fit-table");
  });

  it("pins each behaviour a clipped column would need: no scroll, no min-width, wrapping cells", () => {
    // The wrapper stops scrolling — a horizontal scrollbar is what prints as a cut-off column.
    expect(ruleBody(printBlock, ".print-fit-table")).toContain("overflow: visible !important");
    const table = ruleBody(printBlock, ".print-fit-table > table");
    expect(table).toContain("min-width: 0 !important"); // the 44rem screen floor is dropped
    expect(table).toContain("width: 100% !important"); // …and replaced by the page width
    expect(table).toContain("table-layout: fixed"); // columns share that width by declared ratio
    expect(table).toMatch(/font-size: \d+(?:\.\d+)?pt/); // an absolute print size, not a screen rem
    expect(table).toContain("break-inside: auto"); // a long breakdown may span pages…
    expect(ruleBody(printBlock, ".print-fit-table thead")).toContain("display: table-header-group"); // …with its header repeated
    const cell = ruleBody(printBlock, ".print-fit-table td");
    expect(cell).toContain("white-space: normal"); // a long Arabic label wraps…
    expect(cell).toContain("overflow-wrap: anywhere"); // …instead of pushing a column off the page
  });

  it("gives the label and money columns a bigger share, and still leaves room for the counts", () => {
    const share = (selector: string) =>
      Number(ruleBody(printBlock, selector).match(/width: (\d+(?:\.\d+)?)%/)?.[1]);
    const label = share(".print-fit-table td:nth-child(1)");
    const amount = share(".print-fit-table td:nth-child(5)");
    const posting = share(".print-fit-table td:nth-child(6)");
    // The label wraps Arabic phrases and the money columns carry an exact amount plus «+ غير معروف».
    expect(label).toBeGreaterThan(20);
    expect(amount).toBeGreaterThan(10);
    expect(posting).toBeGreaterThan(10);
    // The three remaining count columns must still get a positive share of the page.
    expect(label + amount + posting).toBeLessThan(100);
  });
});

describe("reconciliation acceptance — CSV endpoint source contract", () => {
  it("authenticates and role-gates before touching the database", () => {
    const membership = ROUTE_SOURCE.indexOf("await getActiveMembership()");
    const roleCheck = ROUTE_SOURCE.indexOf('member.role !== "owner" && member.role !== "accountant"');
    const client = ROUTE_SOURCE.indexOf("await createClient()");
    expect(membership).toBeGreaterThan(-1);
    expect(membership).toBeLessThan(roleCheck);
    expect(roleCheck).toBeLessThan(client);
    expect(ROUTE_SOURCE).toContain('jsonError("غير مصرّح", 401)');
    expect(ROUTE_SOURCE).toContain("403");
  });

  it("reuses the shared bounded loader and the shared CSV serializer", () => {
    expect(ROUTE_SOURCE).toContain("loadAcceptanceBatch(sb, batchId, member.orgId)");
    // One snapshot read per download, exactly as on the page.
    expect(ROUTE_SOURCE.match(/loadAcceptanceBatch\(/g)).toHaveLength(1);
    expect(ROUTE_SOURCE).toContain('from "@/lib/export-csv"');
    expect(ROUTE_SOURCE).toContain("rowsToCsv(pkg.csvRows, ACCEPTANCE_CSV_COLUMNS)");
    expect(ROUTE_SOURCE).not.toMatch(/\.from\(/);
  });

  it("emits no CSV at all on any fail-closed outcome", () => {
    const guard = ROUTE_SOURCE.indexOf("if (!load.ok)");
    const serialize = ROUTE_SOURCE.indexOf("const csv = rowsToCsv");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(serialize);
    expect(ROUTE_SOURCE).toContain("REFUSAL_STATUS[load.kind] ?? 500");
    expect(ROUTE_SOURCE).toContain("overflow: 413");
    expect(ROUTE_SOURCE).toContain("count_mismatch: 409");
    expect(ROUTE_SOURCE).toContain("empty: 409");
    expect(ROUTE_SOURCE).toContain('jsonError("الدفعة غير موجودة", 404)');
  });

  it("performs no write and no caching", () => {
    expect(ROUTE_SOURCE).not.toMatch(MUTATION);
    expect(ROUTE_SOURCE).not.toMatch(/\.rpc\(/); // it reads only through the shared loader
    expect(ROUTE_SOURCE).toContain('"Cache-Control": "no-store"');
    expect(ROUTE_SOURCE).toContain('import "server-only"');
  });
});

describe("reconciliation acceptance — batch page stays as fast as it was", () => {
  it("links to the report without loading it", () => {
    expect(BATCH_PAGE_SOURCE).toContain("}/acceptance`");
    expect(BATCH_PAGE_SOURCE).toContain("تقرير القبول");
  });

  it("adds no acceptance read to the batch page render", () => {
    expect(BATCH_PAGE_SOURCE).not.toContain("loadAcceptanceBatch");
    expect(BATCH_PAGE_SOURCE).not.toContain("buildAcceptancePackage");
    expect(BATCH_PAGE_SOURCE).not.toContain("reconciliation acceptance");
  });
});
