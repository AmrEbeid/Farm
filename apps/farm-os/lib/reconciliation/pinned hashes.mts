// Pinned provenance for accounting reconciliation Slice 2 (staging parser/validator).
//
// These constants pin the exact trusted inputs this generator is allowed to consume and the
// exact classification/quality-flag facts the trusted evidence must report before this
// generator will proceed. Fail closed: any mismatch against these constants must abort before
// any draft is produced. Source: "controlled accounting reconciliation design.md" §9 item 2,
// §10 row "2. Staging parser", plus the trusted "accounting exception evidence.json" totals.
import type { Classification, Dataset } from "./types.mts";

export const EXPECTED_WORKBOOK_SHA256 =
  "9728167b7860b18ff802dda85fe01897a2c645c4fc21677c22dfeaead2f71dc3";

export const EXPECTED_PRODUCTION_SNAPSHOT_SHA256 =
  "32ff3abe1a586627066301396427c31e4ff9242eb4254f482c585e112dbec058";

export const EXPECTED_EXCEPTION_EVIDENCE_SHA256 =
  "997a2794426c571ff8777083c3c9fc65cda44f352d9723585734ad11ef71695e";

export interface OccurrenceCounts {
  expense: { source: number; production: number };
  sale: { source: number; production: number };
}

// Exact occurrence counts the trusted classification evidence must report before this
// generator will proceed. These are the only "amount-shaped" numbers this module ever
// handles -- they are occurrence counts, not money amounts.
export const EXPECTED_OCCURRENCE_COUNTS: OccurrenceCounts = {
  expense: { source: 676, production: 16 },
  sale: { source: 20, production: 1 },
};

// Exact per-classification occurrence totals, recomputed from the exception rows themselves
// (never trusted from the evidence file's own summary.counts) and compared key-by-key,
// including classes pinned at zero.
export const EXPECTED_CLASSIFICATION_COUNTS: Record<Dataset, Record<Classification, number>> = {
  expense: {
    ambiguous_identity_group: 409,
    amount_correction_candidate: 14,
    production_orphan_candidate: 2,
    source_addition_candidate: 252,
    zero_value_source_placeholder: 1,
  },
  sale: {
    ambiguous_identity_group: 7,
    amount_correction_candidate: 1,
    production_orphan_candidate: 0,
    source_addition_candidate: 11,
    zero_value_source_placeholder: 1,
  },
};

export interface PinnedQualityFlag {
  sheet: string;
  row: number;
  source_date_text: string;
  legacy_import_date: string;
}

// The two impossible source calendar dates (2024-02-30, sale rows 129/130) that are already
// financially matched in production -- preserved verbatim here as approved quality metadata,
// never treated as exceptions. Expense is pinned to none.
export const EXPECTED_QUALITY_FLAGS: Record<Dataset, PinnedQualityFlag[]> = {
  expense: [],
  sale: [
    { sheet: "المبيعات", row: 129, source_date_text: "2024-02-30", legacy_import_date: "2024-02-28" },
    { sheet: "المبيعات", row: 130, source_date_text: "2024-02-30", legacy_import_date: "2024-02-28" },
  ],
};
