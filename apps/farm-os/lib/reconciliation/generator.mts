import { stableUuid } from "./stable id.mts";
import {
  EXPECTED_CLASSIFICATION_COUNTS,
  EXPECTED_EXCEPTION_EVIDENCE_SHA256,
  EXPECTED_OCCURRENCE_COUNTS,
  EXPECTED_PRODUCTION_SNAPSHOT_SHA256,
  EXPECTED_QUALITY_FLAGS,
  EXPECTED_WORKBOOK_SHA256,
} from "./pinned hashes.mts";
import type { OccurrenceCounts, PinnedQualityFlag } from "./pinned hashes.mts";
import { CLASSIFICATIONS, StagingError } from "./types.mts";
import type {
  BatchDraft,
  BatchRowDraft,
  Classification,
  Dataset,
  DatasetExceptionEvidence,
  DatasetSummary,
  EvidenceItemDraft,
  ExceptionEvidenceFile,
  ExceptionRow,
  MatchedQualityFlag,
  QualityFlagEntry,
  StagingDraft,
} from "./types.mts";

const DATASETS: Dataset[] = ["expense", "sale"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GenerateOptions {
  /** Real Farm OS org id these drafts would be staged under. Never fabricated by this module. */
  orgId: string;
  /**
   * Exact occurrence counts the trusted evidence must report before this generator will
   * proceed. Defaults to the pinned production counts (676/16 expense, 20/1 sale). The CLI never
   * overrides this; tests may, to exercise the mismatch failure path against small synthetic
   * fixtures without weakening the real default.
   */
  expectedOccurrenceCounts?: OccurrenceCounts;
  /**
   * Exact per-classification occurrence totals, recomputed from the exception rows themselves.
   * Defaults to the pinned production totals. The CLI never overrides this.
   */
  expectedClassificationCounts?: Record<Dataset, Record<Classification, number>>;
  /**
   * Exact matched invalid-calendar-date quality-flag rows. Defaults to the pinned production
   * rows (the two 2024-02-30 sale rows). The CLI never overrides this.
   */
  expectedQualityFlags?: Record<Dataset, PinnedQualityFlag[]>;
}

/** Reuses trusted classification evidence; never re-derives matching/classification itself. */
export function generateStagingDraft(
  evidence: ExceptionEvidenceFile,
  options: GenerateOptions,
): StagingDraft {
  if (!UUID_RE.test(options.orgId)) {
    throw new StagingError("invalid org id: expected a UUID");
  }
  if (evidence.workbook_sha256 !== EXPECTED_WORKBOOK_SHA256) {
    throw new StagingError("workbook hash mismatch against pinned evidence source");
  }
  const orgId = options.orgId.toLowerCase();

  const expectedOccurrenceCounts = options.expectedOccurrenceCounts ?? EXPECTED_OCCURRENCE_COUNTS;
  const expectedClassificationCounts = options.expectedClassificationCounts ?? EXPECTED_CLASSIFICATION_COUNTS;
  const expectedQualityFlags = options.expectedQualityFlags ?? EXPECTED_QUALITY_FLAGS;

  for (const dataset of DATASETS) {
    validateDatasetEvidence(
      dataset,
      evidence[dataset],
      expectedOccurrenceCounts[dataset],
      expectedClassificationCounts[dataset],
      expectedQualityFlags[dataset],
    );
  }

  const evidenceItemsById = new Map<string, EvidenceItemDraft>();
  const batchRowsByEvidenceId = new Map<string, BatchRowDraft>();
  const matchedQualityFlags: MatchedQualityFlag[] = [];
  const bySummary: Record<Dataset, DatasetSummary> = {} as Record<Dataset, DatasetSummary>;

  const batchId = stableUuid(
    "reconciliation_batch",
    evidence.workbook_sha256,
    EXPECTED_PRODUCTION_SNAPSHOT_SHA256,
    orgId,
  );

  for (const dataset of DATASETS) {
    const datasetEvidence = evidence[dataset];

    for (const row of datasetEvidence.exceptions) {
      const evidenceItem = buildEvidenceItem(dataset, row, orgId, batchId);
      const existing = evidenceItemsById.get(evidenceItem.id);
      if (existing) {
        assertSameEvidencePosition(existing, evidenceItem);
      } else {
        evidenceItemsById.set(evidenceItem.id, evidenceItem);
      }

      if (!batchRowsByEvidenceId.has(evidenceItem.id)) {
        const batchRow: BatchRowDraft = {
          id: stableUuid("reconciliation_batch_row", batchId, evidenceItem.id),
          org_id: orgId,
          batch_id: batchId,
          evidence_item_id: evidenceItem.id,
          review_state: "unreviewed",
          target_table: null,
          disposition: "hold",
        };
        batchRowsByEvidenceId.set(evidenceItem.id, batchRow);
      }
    }

    for (const flag of datasetEvidence.quality_flags.invalid_source_calendar_dates) {
      matchedQualityFlags.push({
        dataset,
        source_workbook_sha256: flag.locator.workbook_sha256,
        sheet_name: flag.locator.sheet,
        row_locator: String(flag.locator.row),
        source_date_text: flag.source_date_text,
        legacy_import_date: flag.legacy_import_date,
      });
    }

    bySummary[dataset] = {
      exception_row_count: datasetEvidence.summary.exception_row_count,
      source_occurrence_count: datasetEvidence.summary.source_occurrence_count,
      production_occurrence_count: datasetEvidence.summary.production_occurrence_count,
      classification_counts: { ...datasetEvidence.summary.counts },
      matched_invalid_calendar_quality_flag_count:
        datasetEvidence.quality_flags.invalid_source_calendar_date_count,
    };
  }

  const evidenceItems = [...evidenceItemsById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const batchRows = [...batchRowsByEvidenceId.values()].sort((a, b) => a.id.localeCompare(b.id));
  matchedQualityFlags.sort(
    (a, b) =>
      a.dataset.localeCompare(b.dataset) ||
      a.sheet_name.localeCompare(b.sheet_name) ||
      a.row_locator.localeCompare(b.row_locator),
  );

  const batch: BatchDraft = {
    id: batchId,
    org_id: orgId,
    source_workbook_sha256: evidence.workbook_sha256,
    status: "staged",
    result_summary: {
      evidence_item_count: evidenceItems.length,
      batch_row_count: batchRows.length,
      by_dataset: bySummary,
    },
  };

  return {
    batch,
    evidence_items: evidenceItems,
    batch_rows: batchRows,
    matched_invalid_calendar_quality_flags: matchedQualityFlags,
    tool_metadata: {
      production_snapshot_sha256: EXPECTED_PRODUCTION_SNAPSHOT_SHA256,
      exception_evidence_sha256: EXPECTED_EXCEPTION_EVIDENCE_SHA256,
    },
  };
}

function validateDatasetEvidence(
  dataset: Dataset,
  datasetEvidence: DatasetExceptionEvidence,
  expectedOccurrenceCounts: OccurrenceCounts[Dataset],
  expectedClassificationCounts: Record<Classification, number>,
  expectedQualityFlags: PinnedQualityFlag[],
): void {
  const { summary, exceptions, quality_flags } = datasetEvidence;

  if (exceptions.length !== summary.exception_row_count) {
    throw new StagingError(`${dataset}: exception row count does not match exceptions array length`);
  }

  // Exact per-classification totals, recomputed from the exception rows themselves -- never
  // trusted from the evidence file's own (attacker/author-controllable) summary.counts.
  const recomputedClassificationCounts: Record<Classification, number> = {
    source_addition_candidate: 0,
    amount_correction_candidate: 0,
    production_orphan_candidate: 0,
    zero_value_source_placeholder: 0,
    ambiguous_identity_group: 0,
  };
  for (const row of exceptions) {
    recomputedClassificationCounts[row.classification] += 1;
  }
  for (const classification of CLASSIFICATIONS) {
    if (recomputedClassificationCounts[classification] !== expectedClassificationCounts[classification]) {
      throw new StagingError(`${dataset}: classification count mismatch against pinned expected totals`);
    }
  }

  // summary.counts must agree exactly with the recomputed/pinned per-classification counts --
  // no extra/unknown key, and no missing key whose true (recomputed) count is nonzero. A key
  // that is simply absent for a genuinely zero count is accepted (the trusted upstream harness's
  // own Counter-based summary omits zero-count classifications -- e.g. the real evidence's sale
  // `summary.counts` has no `production_orphan_candidate` key because that count is truly 0 --
  // so requiring every key to be literally present would reject the real trusted data itself).
  // The evidence file's own summary is otherwise never trusted as a source of truth; this only
  // checks that it agrees with what was just independently verified.
  const knownClassificationSet = new Set<string>(CLASSIFICATIONS);
  for (const key of Object.keys(summary.counts)) {
    if (!knownClassificationSet.has(key)) {
      throw new StagingError(`${dataset}: summary.counts has an unknown classification key`);
    }
  }
  for (const classification of CLASSIFICATIONS) {
    const providedValue = classification in summary.counts ? summary.counts[classification] : 0;
    if (providedValue !== recomputedClassificationCounts[classification]) {
      throw new StagingError(`${dataset}: summary.counts value does not match the recomputed/pinned count`);
    }
  }

  const computedSource = exceptions.filter((r) => r.locator.source).length;
  const computedProduction = exceptions.filter((r) => r.locator.production).length;
  if (computedSource !== expectedOccurrenceCounts.source) {
    throw new StagingError(`${dataset}: unexpected source occurrence count`);
  }
  if (computedProduction !== expectedOccurrenceCounts.production) {
    throw new StagingError(`${dataset}: unexpected production occurrence count`);
  }
  if (summary.source_occurrence_count !== computedSource) {
    throw new StagingError(`${dataset}: summary.source_occurrence_count does not match the recomputed/pinned count`);
  }
  if (summary.production_occurrence_count !== computedProduction) {
    throw new StagingError(
      `${dataset}: summary.production_occurrence_count does not match the recomputed/pinned count`,
    );
  }

  if (quality_flags.invalid_source_calendar_date_count !== quality_flags.invalid_source_calendar_dates.length) {
    throw new StagingError(`${dataset}: invalid_source_calendar_date_count does not match the flag array length`);
  }
  if (quality_flags.invalid_source_calendar_dates.length !== expectedQualityFlags.length) {
    throw new StagingError(`${dataset}: unexpected invalid-calendar quality flag count against pinned expected value`);
  }

  assertExactQualityFlags(dataset, quality_flags.invalid_source_calendar_dates, expectedQualityFlags);
}

function assertExactQualityFlags(
  dataset: Dataset,
  actual: QualityFlagEntry[],
  expected: PinnedQualityFlag[],
): void {
  if (actual.length !== expected.length) {
    throw new StagingError(`${dataset}: unexpected invalid-calendar quality flag count`);
  }
  const sortedActual = [...actual].sort((a, b) => a.locator.row - b.locator.row);
  const sortedExpected = [...expected].sort((a, b) => a.row - b.row);
  for (let i = 0; i < sortedExpected.length; i++) {
    const a = sortedActual[i];
    const e = sortedExpected[i];
    if (
      a.locator.sheet !== e.sheet ||
      a.locator.row !== e.row ||
      a.source_date_text !== e.source_date_text ||
      a.legacy_import_date !== e.legacy_import_date
    ) {
      throw new StagingError(`${dataset}: invalid-calendar quality flag does not match pinned expected value`);
    }
  }
}

function buildEvidenceItem(
  dataset: Dataset,
  row: ExceptionRow,
  orgId: string,
  batchId: string,
): EvidenceItemDraft {
  // Ordinary source exceptions -> source_workbook_row; production-only orphans ->
  // production_snapshot_row. An amount_correction_candidate carries both a source and a
  // production locator -- its evidence position is the source cell; the production side is
  // resolved later, during human review, via a direct correction-target reference (out of
  // scope for this dry-run draft).
  if (row.locator.source) {
    const { workbook_sha256, sheet, row: rowNumber } = row.locator.source;
    if (workbook_sha256 !== EXPECTED_WORKBOOK_SHA256) {
      throw new StagingError(`${dataset}: source locator workbook hash mismatch`);
    }
    const rowLocator = String(rowNumber);
    return {
      id: stableUuid("evidence_item", "source_workbook_row", workbook_sha256, sheet, rowLocator),
      org_id: orgId,
      origin_kind: "source_workbook_row",
      dataset,
      classification: row.classification,
      source_workbook_sha256: workbook_sha256,
      sheet_name: sheet,
      row_locator: rowLocator,
      production_snapshot_sha256: null,
      snapshot_target_table: null,
      snapshot_target_id: null,
      source_identity_fingerprint: row.identity_fingerprint,
      invalid_calendar_quality_flag: row.is_invalid_source_date,
      first_staged_batch_id: batchId,
    };
  }

  if (row.locator.production) {
    const { table, id } = row.locator.production;
    return {
      id: stableUuid(
        "evidence_item",
        "production_snapshot_row",
        EXPECTED_PRODUCTION_SNAPSHOT_SHA256,
        table,
        id,
      ),
      org_id: orgId,
      origin_kind: "production_snapshot_row",
      dataset,
      classification: row.classification,
      source_workbook_sha256: null,
      sheet_name: null,
      row_locator: null,
      production_snapshot_sha256: EXPECTED_PRODUCTION_SNAPSHOT_SHA256,
      snapshot_target_table: table,
      snapshot_target_id: id,
      source_identity_fingerprint: row.identity_fingerprint,
      invalid_calendar_quality_flag: row.is_invalid_source_date,
      first_staged_batch_id: batchId,
    };
  }

  throw new StagingError(`${dataset}: exception row has neither a source nor a production locator`);
}

function assertSameEvidencePosition(existing: EvidenceItemDraft, incoming: EvidenceItemDraft): void {
  if (
    existing.classification !== incoming.classification ||
    existing.origin_kind !== incoming.origin_kind ||
    existing.source_identity_fingerprint !== incoming.source_identity_fingerprint
  ) {
    throw new StagingError("evidence position collision with mismatched classification");
  }
}
