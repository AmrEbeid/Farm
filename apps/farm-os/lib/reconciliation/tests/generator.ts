import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateStagingDraft } from "../generator.mts";
import { canonicalStringify } from "../canonical json.mts";
import { parseExceptionEvidence } from "../validate.mts";
import { assertCanonicalFilesPresentWhenGated, CANONICAL_EVIDENCE_PATH, canonicalGateEnabled } from "../canonical fixtures.ts";
import {
  EXPECTED_CLASSIFICATION_COUNTS,
  EXPECTED_EXCEPTION_EVIDENCE_SHA256,
  EXPECTED_PRODUCTION_SNAPSHOT_SHA256,
  EXPECTED_QUALITY_FLAGS,
  EXPECTED_WORKBOOK_SHA256,
} from "../pinned hashes.mts";
import type { Classification, Dataset, ExceptionEvidenceFile } from "../types.mts";
import { StagingError } from "../types.mts";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_WORKBOOK_SHA = "0".repeat(64);

// Throws (failing this test file loudly) if RUN_RECONCILIATION_CANONICAL=1 but a required
// canonical file is missing -- the controlled gate is never a silent skip.
assertCanonicalFilesPresentWhenGated();

function sourceLocator(row: number, sheet = "الشيت") {
  return { source: { workbook_sha256: EXPECTED_WORKBOOK_SHA256, sheet, row } };
}

function productionLocator(id: string, table: "expenses" | "sales" = "expenses") {
  return { production: { table, id } };
}

function zeroCounts(): Record<Classification, number> {
  return {
    source_addition_candidate: 0,
    amount_correction_candidate: 0,
    production_orphan_candidate: 0,
    zero_value_source_placeholder: 0,
    ambiguous_identity_group: 0,
  };
}

/** Minimal synthetic evidence fixture; expected counts/flags are overridden per test. */
function makeEvidence(): ExceptionEvidenceFile {
  return {
    workbook_sha256: EXPECTED_WORKBOOK_SHA256,
    expense: {
      summary: {
        exception_row_count: 2,
        source_occurrence_count: 1,
        production_occurrence_count: 1,
        counts: { ...zeroCounts(), production_orphan_candidate: 1, source_addition_candidate: 1 },
      },
      quality_flags: { invalid_source_calendar_date_count: 0, invalid_source_calendar_dates: [] },
      exceptions: [
        {
          dataset: "expense",
          classification: "production_orphan_candidate",
          identity_fingerprint: null,
          locator: productionLocator("22222222-2222-2222-2222-222222222222", "expenses"),
          is_invalid_source_date: false,
        },
        {
          dataset: "expense",
          classification: "source_addition_candidate",
          identity_fingerprint: null,
          locator: sourceLocator(10, "المصروفات"),
          is_invalid_source_date: false,
        },
      ],
    },
    sale: {
      summary: {
        exception_row_count: 4,
        source_occurrence_count: 4,
        production_occurrence_count: 1,
        counts: {
          ...zeroCounts(),
          ambiguous_identity_group: 1,
          amount_correction_candidate: 1,
          source_addition_candidate: 1,
          zero_value_source_placeholder: 1,
        },
      },
      quality_flags: {
        invalid_source_calendar_date_count: 2,
        invalid_source_calendar_dates: [
          {
            locator: { sheet: "المبيعات", row: 129, workbook_sha256: EXPECTED_WORKBOOK_SHA256 },
            source_date_text: "2024-02-30",
            legacy_import_date: "2024-02-28",
          },
          {
            locator: { sheet: "المبيعات", row: 130, workbook_sha256: EXPECTED_WORKBOOK_SHA256 },
            source_date_text: "2024-02-30",
            legacy_import_date: "2024-02-28",
          },
        ],
      },
      exceptions: [
        {
          dataset: "sale",
          classification: "ambiguous_identity_group",
          identity_fingerprint: null,
          locator: sourceLocator(1, "المبيعات"),
          is_invalid_source_date: false,
        },
        {
          dataset: "sale",
          classification: "amount_correction_candidate",
          identity_fingerprint: null,
          locator: {
            ...sourceLocator(2, "المبيعات"),
            ...productionLocator("33333333-3333-3333-3333-333333333333", "sales"),
          },
          is_invalid_source_date: false,
        },
        {
          dataset: "sale",
          classification: "source_addition_candidate",
          identity_fingerprint: null,
          locator: sourceLocator(3, "المبيعات"),
          is_invalid_source_date: false,
        },
        {
          dataset: "sale",
          classification: "zero_value_source_placeholder",
          identity_fingerprint: null,
          locator: sourceLocator(4, "المبيعات"),
          is_invalid_source_date: false,
        },
      ],
    },
  };
}

const EXPECTED_OCCURRENCES = { expense: { source: 1, production: 1 }, sale: { source: 4, production: 1 } };
const EXPECTED_CLASSES: Record<Dataset, Record<Classification, number>> = {
  expense: { ...zeroCounts(), production_orphan_candidate: 1, source_addition_candidate: 1 },
  sale: {
    ...zeroCounts(),
    ambiguous_identity_group: 1,
    amount_correction_candidate: 1,
    source_addition_candidate: 1,
    zero_value_source_placeholder: 1,
  },
};
const EXPECTED_FLAGS = {
  expense: [],
  sale: [
    { sheet: "المبيعات", row: 129, source_date_text: "2024-02-30", legacy_import_date: "2024-02-28" },
    { sheet: "المبيعات", row: 130, source_date_text: "2024-02-30", legacy_import_date: "2024-02-28" },
  ],
};

function generate(evidence: ExceptionEvidenceFile) {
  return generateStagingDraft(evidence, {
    orgId: ORG_ID,
    expectedOccurrenceCounts: EXPECTED_OCCURRENCES,
    expectedClassificationCounts: EXPECTED_CLASSES,
    expectedQualityFlags: EXPECTED_FLAGS,
  });
}

describe("generateStagingDraft", () => {
  it("produces one evidence item and one batch row per exception occurrence", () => {
    const draft = generate(makeEvidence());
    expect(draft.evidence_items).toHaveLength(6);
    expect(draft.batch_rows).toHaveLength(6);
    expect(draft.batch.result_summary.evidence_item_count).toBe(6);
    expect(draft.batch.result_summary.batch_row_count).toBe(6);
  });

  it("maps ordinary source exceptions to source_workbook_row", () => {
    const draft = generate(makeEvidence());
    const addition = draft.evidence_items.find((e) => e.classification === "source_addition_candidate" && e.dataset === "expense");
    expect(addition?.origin_kind).toBe("source_workbook_row");
    expect(addition?.source_workbook_sha256).toBe(EXPECTED_WORKBOOK_SHA256);
    expect(addition?.production_snapshot_sha256).toBeNull();
  });

  it("maps production orphans to production_snapshot_row", () => {
    const draft = generate(makeEvidence());
    const orphan = draft.evidence_items.find((e) => e.classification === "production_orphan_candidate");
    expect(orphan?.origin_kind).toBe("production_snapshot_row");
    expect(orphan?.production_snapshot_sha256).toBe(EXPECTED_PRODUCTION_SNAPSHOT_SHA256);
    expect(orphan?.snapshot_target_table).toBe("expenses");
    expect(orphan?.snapshot_target_id).toBe("22222222-2222-2222-2222-222222222222");
    expect(orphan?.source_workbook_sha256).toBeNull();
  });

  it("maps an amount_correction_candidate to a single source_workbook_row evidence item", () => {
    const draft = generate(makeEvidence());
    const corrections = draft.evidence_items.filter((e) => e.classification === "amount_correction_candidate");
    expect(corrections).toHaveLength(1);
    expect(corrections[0].origin_kind).toBe("source_workbook_row");
  });

  it("sets first_staged_batch_id to the batch's own id on every evidence item", () => {
    const draft = generate(makeEvidence());
    for (const item of draft.evidence_items) {
      expect(item.first_staged_batch_id).toBe(draft.batch.id);
    }
  });

  it("does not put a production_snapshot_sha256 column on the batch row (not a real DB column)", () => {
    const draft = generate(makeEvidence());
    expect("production_snapshot_sha256" in draft.batch).toBe(false);
    expect(draft.tool_metadata.production_snapshot_sha256).toBe(EXPECTED_PRODUCTION_SNAPSHOT_SHA256);
    expect(draft.tool_metadata.exception_evidence_sha256).toBe(EXPECTED_EXCEPTION_EVIDENCE_SHA256);
  });

  it("defaults every batch row to hold + unreviewed regardless of classification", () => {
    const draft = generate(makeEvidence());
    for (const row of draft.batch_rows) {
      expect(row.disposition).toBe("hold");
      expect(row.review_state).toBe("unreviewed");
      expect(row.target_table).toBeNull();
    }
  });

  it("preserves matched invalid-calendar quality flags verbatim, without staging them as exceptions", () => {
    const draft = generate(makeEvidence());
    expect(draft.matched_invalid_calendar_quality_flags).toHaveLength(2);
    const sorted = [...draft.matched_invalid_calendar_quality_flags].sort((a, b) => a.row_locator.localeCompare(b.row_locator));
    expect(sorted.map((f) => f.row_locator)).toEqual(["129", "130"]);
    for (const flag of sorted) {
      expect(flag.source_date_text).toBe("2024-02-30");
      expect(flag.legacy_import_date).toBe("2024-02-28");
      expect(flag.dataset).toBe("sale");
    }
    // Rows 129/130 were matched in production, not exceptions -- they must not appear as
    // staged evidence items/batch rows.
    expect(draft.evidence_items.some((e) => e.row_locator === "129" || e.row_locator === "130")).toBe(false);
  });

  it("propagates the invalid-calendar flag onto an evidence item that is itself an exception", () => {
    const evidence = makeEvidence();
    evidence.sale.exceptions[2].is_invalid_source_date = true;
    const draft = generate(evidence);
    const flagged = draft.evidence_items.find((e) => e.row_locator === "3" && e.dataset === "sale");
    expect(flagged?.invalid_calendar_quality_flag).toBe(true);
  });

  it("is deterministic across repeat runs (byte-identical canonical output)", () => {
    const first = canonicalStringify(generate(makeEvidence()));
    const second = canonicalStringify(generate(makeEvidence()));
    expect(first).toBe(second);
  });

  it("orders evidence items and batch rows deterministically (sorted by id)", () => {
    const draft = generate(makeEvidence());
    const ids = draft.evidence_items.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
    const rowIds = draft.batch_rows.map((r) => r.id);
    expect(rowIds).toEqual([...rowIds].sort((a, b) => a.localeCompare(b)));
  });

  it("rejects a workbook hash mismatch (fail closed)", () => {
    const evidence = makeEvidence();
    evidence.workbook_sha256 = OTHER_WORKBOOK_SHA;
    expect(() => generate(evidence)).toThrow(StagingError);
  });

  it("rejects an invalid org id", () => {
    expect(() =>
      generateStagingDraft(makeEvidence(), {
        orgId: "not-a-uuid",
        expectedOccurrenceCounts: EXPECTED_OCCURRENCES,
        expectedClassificationCounts: EXPECTED_CLASSES,
        expectedQualityFlags: EXPECTED_FLAGS,
      }),
    ).toThrow(StagingError);
  });

  it("rejects a source/production occurrence count mismatch against the expected counts", () => {
    expect(() =>
      generateStagingDraft(makeEvidence(), {
        orgId: ORG_ID,
        expectedOccurrenceCounts: { expense: { source: 999, production: 1 }, sale: { source: 4, production: 1 } },
        expectedClassificationCounts: EXPECTED_CLASSES,
        expectedQualityFlags: EXPECTED_FLAGS,
      }),
    ).toThrow(StagingError);
  });

  it("rejects an exception_row_count that does not match the exceptions array length", () => {
    const evidence = makeEvidence();
    evidence.expense.summary.exception_row_count = 5;
    expect(() => generate(evidence)).toThrow(StagingError);
  });

  it("rejects a per-classification count mismatch against the pinned expected totals", () => {
    const badClasses: Record<Dataset, Record<Classification, number>> = {
      ...EXPECTED_CLASSES,
      expense: { ...EXPECTED_CLASSES.expense, source_addition_candidate: 999 },
    };
    expect(() =>
      generateStagingDraft(makeEvidence(), {
        orgId: ORG_ID,
        expectedOccurrenceCounts: EXPECTED_OCCURRENCES,
        expectedClassificationCounts: badClasses,
        expectedQualityFlags: EXPECTED_FLAGS,
      }),
    ).toThrow(StagingError);
  });

  it("rejects a classification total pinned at zero that the evidence actually has occurrences for", () => {
    // amount_correction_candidate is genuinely present (1) but pinned expected is 0.
    const badClasses: Record<Dataset, Record<Classification, number>> = {
      ...EXPECTED_CLASSES,
      sale: { ...EXPECTED_CLASSES.sale, amount_correction_candidate: 0 },
    };
    expect(() =>
      generateStagingDraft(makeEvidence(), {
        orgId: ORG_ID,
        expectedOccurrenceCounts: EXPECTED_OCCURRENCES,
        expectedClassificationCounts: badClasses,
        expectedQualityFlags: EXPECTED_FLAGS,
      }),
    ).toThrow(StagingError);
  });

  it("rejects an exception row with neither a source nor a production locator", () => {
    const evidence = makeEvidence();
    evidence.expense.exceptions[1].locator = {};
    expect(() => generate(evidence)).toThrow(StagingError);
  });

  describe("summary-field tampering (exception rows unchanged)", () => {
    // Each of these tampers ONLY a summary/quality_flags field while the exception rows array
    // (and hence the recomputed pinned-matching counts) stays exactly as in the healthy fixture,
    // to prove the generator cross-checks the evidence file's own summary against what it
    // independently recomputed -- not just the recomputed value against the pinned constant.

    it("rejects a tampered summary.source_occurrence_count", () => {
      const evidence = makeEvidence();
      evidence.sale.summary.source_occurrence_count = 999;
      expect(() => generate(evidence)).toThrow(StagingError);
    });

    it("rejects a tampered summary.production_occurrence_count", () => {
      const evidence = makeEvidence();
      evidence.sale.summary.production_occurrence_count = 999;
      expect(() => generate(evidence)).toThrow(StagingError);
    });

    it("rejects a tampered summary.counts value for one classification", () => {
      const evidence = makeEvidence();
      evidence.sale.summary.counts.ambiguous_identity_group = 999;
      expect(() => generate(evidence)).toThrow(StagingError);
    });

    it("rejects a summary.counts missing a classification key", () => {
      const evidence = makeEvidence();
      delete (evidence.sale.summary.counts as Record<string, number>).zero_value_source_placeholder;
      expect(() => generate(evidence)).toThrow(StagingError);
    });

    it("rejects a summary.counts with an extra/unknown classification key", () => {
      const evidence = makeEvidence();
      // Complete the map to all five correct keys first, then add one bogus extra key, so the
      // rejection is specifically the "too many keys" branch and not a still-missing key.
      evidence.sale.summary.counts.production_orphan_candidate = 0;
      evidence.sale.summary.counts.unexpected_extra_classification = 0;
      expect(() => generate(evidence)).toThrow(StagingError);
    });

    it("rejects an invalid_source_calendar_date_count that does not match the flag array length", () => {
      const evidence = makeEvidence();
      evidence.sale.quality_flags.invalid_source_calendar_date_count = 999;
      expect(() => generate(evidence)).toThrow(StagingError);
    });

    it("accepts a summary.counts that omits a classification key whose true recomputed count is zero", () => {
      // Matches the real trusted evidence's own shape: the upstream harness's Counter-based
      // summary omits a classification entirely when its count is genuinely 0 (e.g. the real
      // evidence's sale summary.counts has no production_orphan_candidate key at all).
      const evidence = makeEvidence();
      delete evidence.expense.summary.counts.zero_value_source_placeholder;
      expect(() => generate(evidence)).not.toThrow();
    });
  });

  it("rejects a wrong quality-flag count", () => {
    const evidence = makeEvidence();
    evidence.sale.quality_flags.invalid_source_calendar_dates.pop();
    evidence.sale.quality_flags.invalid_source_calendar_date_count = 1;
    expect(() => generate(evidence)).toThrow(StagingError);
  });

  it("rejects a quality-flag entry whose date text does not match the pinned expected value", () => {
    const evidence = makeEvidence();
    evidence.sale.quality_flags.invalid_source_calendar_dates[0].source_date_text = "2024-02-29";
    expect(() => generate(evidence)).toThrow(StagingError);
  });

  it("never emits a private-shaped value (amount/description) anywhere in the output", () => {
    const draft = generate(makeEvidence());
    const serialized = canonicalStringify(draft);
    // Amounts in the trusted evidence are formatted like "123.45" -- none of this generator's
    // own emitted values (hashes, uuids, integers, enum strings, approved date text) can ever
    // match that shape.
    expect(serialized).not.toMatch(/\b\d+\.\d{2}\b/);
    const allowedKeys = new Set([
      "batch",
      "evidence_items",
      "batch_rows",
      "matched_invalid_calendar_quality_flags",
      "tool_metadata",
      "id",
      "org_id",
      "source_workbook_sha256",
      "production_snapshot_sha256",
      "exception_evidence_sha256",
      "status",
      "result_summary",
      "evidence_item_count",
      "batch_row_count",
      "by_dataset",
      "expense",
      "sale",
      "exception_row_count",
      "source_occurrence_count",
      "production_occurrence_count",
      "classification_counts",
      "matched_invalid_calendar_quality_flag_count",
      "origin_kind",
      "dataset",
      "classification",
      "sheet_name",
      "row_locator",
      "snapshot_target_table",
      "snapshot_target_id",
      "source_identity_fingerprint",
      "invalid_calendar_quality_flag",
      "first_staged_batch_id",
      "batch_id",
      "evidence_item_id",
      "review_state",
      "target_table",
      "disposition",
      "source_date_text",
      "legacy_import_date",
      "source_addition_candidate",
      "amount_correction_candidate",
      "production_orphan_candidate",
      "zero_value_source_placeholder",
      "ambiguous_identity_group",
    ]);
    assertOnlyAllowedKeys(draft, allowedKeys);
  });
});

function assertOnlyAllowedKeys(value: unknown, allowed: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) assertOnlyAllowedKeys(item, allowed);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      expect(allowed.has(key)).toBe(true);
      assertOnlyAllowedKeys(nested, allowed);
    }
  }
}

describe.runIf(canonicalGateEnabled())("canonical real-file dry run", () => {

  it("matches the pinned exception-evidence hash", () => {
    const bytes = readFileSync(CANONICAL_EVIDENCE_PATH);
    const actual = createHash("sha256").update(bytes).digest("hex");
    expect(actual).toBe(EXPECTED_EXCEPTION_EVIDENCE_SHA256);
  });

  it(
    "validates exact occurrence counts, exact per-classification totals, and exact date texts against the real evidence",
    () => {
      const raw = JSON.parse(readFileSync(CANONICAL_EVIDENCE_PATH, "utf-8"));
      const evidence = parseExceptionEvidence(raw);
      // No overrides here: this exercises the real pinned defaults end-to-end.
      const draft = generateStagingDraft(evidence, { orgId: ORG_ID });

      expect(draft.batch.result_summary.by_dataset.expense.source_occurrence_count).toBe(676);
      expect(draft.batch.result_summary.by_dataset.expense.production_occurrence_count).toBe(16);
      expect(draft.batch.result_summary.by_dataset.sale.source_occurrence_count).toBe(20);
      expect(draft.batch.result_summary.by_dataset.sale.production_occurrence_count).toBe(1);

      for (const [dataset, expected] of Object.entries(EXPECTED_CLASSIFICATION_COUNTS) as [Dataset, Record<Classification, number>][]) {
        const actual: Record<string, number> = {};
        for (const row of evidence[dataset].exceptions) actual[row.classification] = (actual[row.classification] ?? 0) + 1;
        for (const [classification, count] of Object.entries(expected)) {
          expect(actual[classification] ?? 0).toBe(count);
        }
      }

      expect(draft.matched_invalid_calendar_quality_flags).toHaveLength(2);
      const sorted = [...draft.matched_invalid_calendar_quality_flags].sort((a, b) => a.row_locator.localeCompare(b.row_locator));
      expect(sorted.map((f) => f.row_locator)).toEqual(
        [...EXPECTED_QUALITY_FLAGS.sale].sort((a, b) => a.row - b.row).map((f) => String(f.row)),
      );
      for (let i = 0; i < sorted.length; i++) {
        expect(sorted[i].source_date_text).toBe(EXPECTED_QUALITY_FLAGS.sale[i].source_date_text);
        expect(sorted[i].legacy_import_date).toBe(EXPECTED_QUALITY_FLAGS.sale[i].legacy_import_date);
        expect(sorted[i].dataset).toBe("sale");
      }
      expect(EXPECTED_QUALITY_FLAGS.expense).toHaveLength(0);

      const totalExceptionRows =
        evidence.expense.summary.exception_row_count + evidence.sale.summary.exception_row_count;
      expect(totalExceptionRows).toBe(698);
      expect(draft.evidence_items.length).toBe(698);
      expect(draft.batch_rows.length).toBe(698);
    },
  );

  it("is byte-identical across two runs against the real evidence", () => {
    const evidenceA = parseExceptionEvidence(JSON.parse(readFileSync(CANONICAL_EVIDENCE_PATH, "utf-8")));
    const evidenceB = parseExceptionEvidence(JSON.parse(readFileSync(CANONICAL_EVIDENCE_PATH, "utf-8")));
    const first = canonicalStringify(generateStagingDraft(evidenceA, { orgId: ORG_ID }));
    const second = canonicalStringify(generateStagingDraft(evidenceB, { orgId: ORG_ID }));
    expect(first).toBe(second);
  });

  it("never leaks a private value from the real evidence into the draft output", () => {
    const raw = JSON.parse(readFileSync(CANONICAL_EVIDENCE_PATH, "utf-8"));
    const evidence = parseExceptionEvidence(raw);
    const draft = generateStagingDraft(evidence, { orgId: ORG_ID });
    const serialized = canonicalStringify(draft);
    for (const dataset of ["expense", "sale"] as const) {
      for (const row of (raw as Record<string, { exceptions: Record<string, unknown>[] }>)[dataset].exceptions) {
        if (typeof row.label === "string") expect(serialized).not.toContain(row.label);
        if (typeof row.source_amount === "string") expect(serialized).not.toContain(`"${row.source_amount}"`);
        if (typeof row.production_amount === "string") expect(serialized).not.toContain(`"${row.production_amount}"`);
      }
    }
  });
});
