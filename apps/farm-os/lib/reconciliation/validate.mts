// Runtime structural validation for the trusted exception-evidence JSON. This module is the
// only legitimate way this generator turns parsed JSON into an `ExceptionEvidenceFile` -- a bare
// `JSON.parse(...) as ExceptionEvidenceFile` type cast is never used anywhere else in this
// package, so a malformed/tampered/unexpected-shape file fails closed with a fixed error instead
// of silently propagating `undefined`/wrong-typed values downstream.
import { EXPECTED_WORKBOOK_SHA256 } from "./pinned hashes.mts";
import { CLASSIFICATIONS, StagingError } from "./types.mts";
import type {
  Classification,
  Dataset,
  DatasetExceptionEvidence,
  ExceptionEvidenceFile,
  ExceptionRow,
  QualityFlagEntry,
} from "./types.mts";

const HEX64_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLASSIFICATION_SET = new Set<string>(CLASSIFICATIONS);

function fail(message: string): never {
  throw new StagingError(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail("evidence: expected a non-negative integer");
  }
  return value;
}

function asPositiveInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    fail("evidence: expected a positive integer row number");
  }
  return value;
}

function asHex64(value: unknown): string {
  if (typeof value !== "string" || !HEX64_RE.test(value)) {
    fail("evidence: expected a 64-character hex hash");
  }
  return value;
}

function asNonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    fail("evidence: expected a non-empty string");
  }
  return value;
}

function asUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    fail("evidence: expected a UUID");
  }
  return value;
}

function asIsoDateText(value: unknown): string {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) {
    fail("evidence: expected an ISO-shaped date string");
  }
  return value;
}

function asBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    fail("evidence: expected a boolean");
  }
  return value;
}

function validateLocator(value: unknown, dataset: Dataset): ExceptionRow["locator"] {
  if (!isPlainObject(value)) fail("evidence: exception locator must be an object");
  for (const key of Object.keys(value)) {
    if (key !== "source" && key !== "production") fail("evidence: unexpected locator field");
  }
  const result: ExceptionRow["locator"] = {};
  if ("source" in value) {
    const s = value.source;
    if (!isPlainObject(s)) fail("evidence: source locator must be an object");
    const workbook_sha256 = asHex64(s.workbook_sha256);
    if (workbook_sha256 !== EXPECTED_WORKBOOK_SHA256) fail("evidence: source locator workbook hash mismatch");
    const sheet = asNonEmptyString(s.sheet);
    const row = asPositiveInt(s.row);
    result.source = { workbook_sha256, sheet, row };
  }
  if ("production" in value) {
    const p = value.production;
    if (!isPlainObject(p)) fail("evidence: production locator must be an object");
    const table = p.table;
    if (table !== "expenses" && table !== "sales") fail("evidence: unknown production locator table");
    if (dataset === "expense" && table !== "expenses") fail("evidence: production locator table/dataset mismatch");
    if (dataset === "sale" && table !== "sales") fail("evidence: production locator table/dataset mismatch");
    const id = asUuid(p.id);
    result.production = { table, id };
  }
  if (!result.source && !result.production) fail("evidence: exception locator has neither source nor production");
  return result;
}

function validateExceptionRow(value: unknown, dataset: Dataset): ExceptionRow {
  if (!isPlainObject(value)) fail("evidence: exception row must be an object");
  if (value.dataset !== dataset) fail("evidence: exception row dataset mismatch");
  if (typeof value.classification !== "string" || !CLASSIFICATION_SET.has(value.classification)) {
    fail("evidence: unknown exception classification");
  }
  const identity_fingerprint = value.identity_fingerprint === null ? null : asHex64(value.identity_fingerprint);
  const locator = validateLocator(value.locator, dataset);
  const is_invalid_source_date = asBoolean(value.is_invalid_source_date);
  return {
    dataset,
    classification: value.classification as Classification,
    identity_fingerprint,
    locator,
    is_invalid_source_date,
  };
}

function validateQualityFlagEntry(value: unknown): QualityFlagEntry {
  if (!isPlainObject(value)) fail("evidence: quality flag entry must be an object");
  const locatorRaw = value.locator;
  if (!isPlainObject(locatorRaw)) fail("evidence: quality flag locator must be an object");
  const workbook_sha256 = asHex64(locatorRaw.workbook_sha256);
  if (workbook_sha256 !== EXPECTED_WORKBOOK_SHA256) fail("evidence: quality flag locator workbook hash mismatch");
  const sheet = asNonEmptyString(locatorRaw.sheet);
  const row = asPositiveInt(locatorRaw.row);
  const source_date_text = asIsoDateText(value.source_date_text);
  const legacy_import_date = asIsoDateText(value.legacy_import_date);
  return { locator: { workbook_sha256, sheet, row }, source_date_text, legacy_import_date };
}

function validateDatasetEvidence(value: unknown, dataset: Dataset): DatasetExceptionEvidence {
  if (!isPlainObject(value)) fail("evidence: dataset section must be an object");

  const summaryRaw = value.summary;
  if (!isPlainObject(summaryRaw)) fail("evidence: summary must be an object");
  const exception_row_count = asNonNegativeInt(summaryRaw.exception_row_count);
  const source_occurrence_count = asNonNegativeInt(summaryRaw.source_occurrence_count);
  const production_occurrence_count = asNonNegativeInt(summaryRaw.production_occurrence_count);
  const countsRaw = summaryRaw.counts;
  if (!isPlainObject(countsRaw)) fail("evidence: summary.counts must be an object");
  const counts: Record<string, number> = {};
  for (const [key, val] of Object.entries(countsRaw)) {
    if (!CLASSIFICATION_SET.has(key)) fail("evidence: unknown classification key in summary.counts");
    counts[key] = asNonNegativeInt(val);
  }

  const qfRaw = value.quality_flags;
  if (!isPlainObject(qfRaw)) fail("evidence: quality_flags must be an object");
  const invalid_source_calendar_date_count = asNonNegativeInt(qfRaw.invalid_source_calendar_date_count);
  const qfArrayRaw = qfRaw.invalid_source_calendar_dates;
  if (!Array.isArray(qfArrayRaw)) fail("evidence: invalid_source_calendar_dates must be an array");
  if (qfArrayRaw.length !== invalid_source_calendar_date_count) {
    fail("evidence: invalid_source_calendar_date_count does not match array length");
  }
  const invalid_source_calendar_dates = qfArrayRaw.map((entry) => validateQualityFlagEntry(entry));

  const exceptionsRaw = value.exceptions;
  if (!Array.isArray(exceptionsRaw)) fail("evidence: exceptions must be an array");
  if (exceptionsRaw.length !== exception_row_count) {
    fail("evidence: exception_row_count does not match exceptions array length");
  }
  const exceptions = exceptionsRaw.map((row) => validateExceptionRow(row, dataset));

  return {
    summary: { exception_row_count, source_occurrence_count, production_occurrence_count, counts },
    quality_flags: { invalid_source_calendar_date_count, invalid_source_calendar_dates },
    exceptions,
  };
}

/** Structurally validates raw parsed JSON before this generator will read it any further. */
export function parseExceptionEvidence(raw: unknown): ExceptionEvidenceFile {
  if (!isPlainObject(raw)) fail("evidence: root must be an object");
  const workbook_sha256 = asHex64(raw.workbook_sha256);
  const expense = validateDatasetEvidence(raw.expense, "expense");
  const sale = validateDatasetEvidence(raw.sale, "sale");
  return { workbook_sha256, expense, sale };
}
