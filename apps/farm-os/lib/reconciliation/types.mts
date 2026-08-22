// Types for the accounting reconciliation Slice 2 staging parser/validator.
//
// `batch`, `evidence_items`, and `batch_rows` in the generator's output closely mirror the
// Slice 1A row shapes (`reconciliation_batches`, `reconciliation_evidence_items`,
// `reconciliation_batch_rows` in
// apps/farm-os/supabase/migrations/20260725201546_accounting_reconciliation_provenance.sql) so
// they are a faithful DRAFT of what a real staging insert would look like -- but this module
// never touches a database, and `tool_metadata` on the output is explicitly NOT a database row;
// it is this dry-run generator's own provenance record (which pinned snapshot/evidence hash this
// run was scoped to). This module never carries private row content (no description, no
// counterparty, no amount, no free-text label). Only paths, hashes, counts, stable opaque ids,
// classifications, and the two approved invalid-calendar quality-flag date values are ever
// modeled or emitted.

export type Dataset = "expense" | "sale";

export type OriginKind = "source_workbook_row" | "production_snapshot_row";

export type Classification =
  | "source_addition_candidate"
  | "amount_correction_candidate"
  | "production_orphan_candidate"
  | "zero_value_source_placeholder"
  | "ambiguous_identity_group";

export const CLASSIFICATIONS: readonly Classification[] = [
  "source_addition_candidate",
  "amount_correction_candidate",
  "production_orphan_candidate",
  "zero_value_source_placeholder",
  "ambiguous_identity_group",
];

export type SnapshotTargetTable = "expenses" | "sales";

// --- trusted input contract -------------------------------------------------------------
//
// The shape this module reads from the trusted `accounting reconcile.py exceptions` output,
// after runtime validation (see validate.ts -- this module never trusts a bare `as` cast of
// parsed JSON). Deliberately narrow: fields such as `source_amount`, `production_amount`,
// `amount_delta`, and `label` exist in the real file but are never modeled here, so they can
// never be read, copied, or logged by this generator -- not even by accident. The two exceptions
// are `source_date_text`/`legacy_import_date` on a quality-flag entry: these are the approved
// invalid-calendar-date metadata (e.g. "2024-02-30"), not a description/party/amount.

export interface ExceptionLocator {
  source?: {
    workbook_sha256: string;
    sheet: string;
    row: number;
  };
  production?: {
    table: SnapshotTargetTable;
    id: string;
  };
}

export interface ExceptionRow {
  dataset: Dataset;
  classification: Classification;
  identity_fingerprint: string | null;
  locator: ExceptionLocator;
  is_invalid_source_date: boolean;
  // Slice 4A evidence contract: a human-readable label for every row, and — for source rows — the
  // exact source amount/date text preserved verbatim. `legacy_comparison_date` exists in the real
  // file but is deliberately NOT modeled: it must never be treated as a source parsed date.
  label: string;
  source_amount: string | null;
  source_date_text: string | null;
}

export interface QualityFlagLocator {
  sheet: string;
  row: number;
  workbook_sha256: string;
}

export interface QualityFlagEntry {
  locator: QualityFlagLocator;
  source_date_text: string;
  legacy_import_date: string;
}

export interface DatasetExceptionEvidence {
  summary: {
    exception_row_count: number;
    source_occurrence_count: number;
    production_occurrence_count: number;
    counts: Record<string, number>;
  };
  quality_flags: {
    invalid_source_calendar_date_count: number;
    invalid_source_calendar_dates: QualityFlagEntry[];
  };
  exceptions: ExceptionRow[];
}

export interface ExceptionEvidenceFile {
  workbook_sha256: string;
  expense: DatasetExceptionEvidence;
  sale: DatasetExceptionEvidence;
}

// --- generator output (Slice 1A draft rows + non-row tool metadata) --------------------

export interface EvidenceItemDraft {
  id: string;
  org_id: string;
  origin_kind: OriginKind;
  dataset: Dataset;
  classification: Classification;
  source_workbook_sha256: string | null;
  sheet_name: string | null;
  row_locator: string | null;
  production_snapshot_sha256: string | null;
  snapshot_target_table: SnapshotTargetTable | null;
  snapshot_target_id: string | null;
  source_identity_fingerprint: string | null;
  invalid_calendar_quality_flag: boolean;
  // Slice 4A evidence contract (persisted for the review UI to display). `evidence_label` is set for
  // every row; the source-only fields are preserved verbatim for a source row and are ALWAYS null for
  // a production-snapshot row (which has no source cell). `source_date_parsed` equals the source date
  // text only when that text is a real calendar date AND the invalid-calendar flag is false.
  evidence_label: string;
  source_amount: string | null;
  source_date_text: string | null;
  source_date_parsed: string | null;
  /** Informational-only FK per the Slice 1A schema; this dry run always sets it to `batch.id`. */
  first_staged_batch_id: string;
}

export interface BatchRowDraft {
  id: string;
  org_id: string;
  batch_id: string;
  evidence_item_id: string;
  review_state: "unreviewed";
  target_table: null;
  disposition: "hold";
}

export interface MatchedQualityFlag {
  dataset: Dataset;
  source_workbook_sha256: string;
  sheet_name: string;
  row_locator: string;
  source_date_text: string;
  legacy_import_date: string;
}

export interface DatasetSummary {
  exception_row_count: number;
  source_occurrence_count: number;
  production_occurrence_count: number;
  classification_counts: Record<string, number>;
  matched_invalid_calendar_quality_flag_count: number;
}

export interface ResultSummary {
  evidence_item_count: number;
  batch_row_count: number;
  by_dataset: Record<Dataset, DatasetSummary>;
}

/** Mirrors `reconciliation_batches` columns exactly -- no column that table does not have. */
export interface BatchDraft {
  id: string;
  org_id: string;
  source_workbook_sha256: string;
  status: "staged";
  result_summary: ResultSummary;
}

/**
 * NOT a database row. This is the dry-run generator's own provenance record: which pinned
 * production-snapshot and exception-evidence inputs this run was scoped to and verified against.
 */
export interface ToolMetadata {
  production_snapshot_sha256: string;
  exception_evidence_sha256: string;
}

export interface StagingDraft {
  batch: BatchDraft;
  evidence_items: EvidenceItemDraft[];
  batch_rows: BatchRowDraft[];
  matched_invalid_calendar_quality_flags: MatchedQualityFlag[];
  tool_metadata: ToolMetadata;
}

export class StagingError extends Error {}
