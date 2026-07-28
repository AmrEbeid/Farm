// The complete read used independently by the reconciliation acceptance page and CSV endpoint:
// whole-batch, bounded, org-scoped, single-snapshot and fail-closed. Each request computes a content
// digest; matching digests prove that separately requested artifacts describe the same rows.
//
// ONE CALL, ONE SNAPSHOT. The batch identity, its rows, each row's evidence, the readable dimension
// labels and BOTH row counts come back from a single SECURITY INVOKER read RPC
// (migration "20260728120000 accounting reconciliation acceptance snapshot.sql"). The earlier
// implementation issued three separate PostgREST statements at three snapshots, so a concurrent
// review or freeze could produce a hybrid report — figures from one instant filed against provenance
// from another. It cannot now: the function is declared STABLE, so PostgreSQL gives every statement
// in its body the snapshot of the CALLING QUERY. The body is several statements, not one, but they
// all observe one state of the database.
//
// The guarantee is per CALL. The page and the CSV annex are two separate requests at two instants —
// which is exactly what the SHA-256 content digest exists to expose.
//
// EXACT DECIMALS. PostgREST serialises `numeric` as a JSON NUMBER, so an accounting amount was already
// a binary double by the time `JSON.parse` handed it over — before lib/decimal.ts could read a digit.
// The RPC serialises every numeric accounting field with ::text instead, and the parser below REFUSES
// the whole read if any of those fields arrives as a number. Exactness is therefore end-to-end and
// enforced, not merely intended.
//
// READ-ONLY. One `.rpc()` call to a function that contains SELECTs only — no insert/update/upsert/
// delete anywhere, and no staging/review/freeze/approve/execute/rollback call. Opening or downloading
// the acceptance report cannot change anything. The USER-SESSION client is used (never service-role),
// and the RPC is SECURITY INVOKER, so RLS applies exactly as it does to the caller's own SELECTs.
//
// FAIL-CLOSED. Authentication, tenancy and role are enforced in the DB (the RPC raises 42501); every
// other refusal comes back as an explicit status, and ANY payload this module does not fully recognise
// — wrong contract version, wrong bound, a count that disagrees with the rows, a malformed row — is a
// refusal, never a partial report.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types.ext";
import { isDecimalText } from "./decimal";
import {
  ACCEPTANCE_COUNT_MISMATCH_AR,
  ACCEPTANCE_EMPTY_AR,
  ACCEPTANCE_INCOMPLETE_AR,
  ACCEPTANCE_MAX_ROWS,
  ACCEPTANCE_OVERFLOW_AR,
  ACCEPTANCE_READ_FAILED_AR,
  acceptanceStagedCounts,
  type AcceptanceBatchIdentity,
  type AcceptanceRow,
} from "./reconciliation acceptance";
import { isUuid } from "./reconciliation review";

export type AcceptanceBatch = AcceptanceBatchIdentity;

export type AcceptanceLoad =
  | { ok: true; batch: AcceptanceBatch; rows: AcceptanceRow[] }
  | { ok: false; kind: "not_found" }
  | {
      ok: false;
      kind: "overflow" | "read_failed" | "incomplete" | "count_mismatch" | "empty";
      error: string;
    };

/** The read RPC. Named once so the page, the endpoint and the tests all pin the same function. */
export const ACCEPTANCE_SNAPSHOT_RPC = "fn_reconciliation_acceptance_snapshot" as const;

/**
 * The snapshot contract this reader understands, byte-for-byte as the migration declares it. A payload
 * announcing any other version is refused rather than guessed at, so a deployed app can never read a
 * newer (or older) snapshot shape as if it were this one.
 */
export const ACCEPTANCE_SNAPSHOT_VERSION = "farm-os.reconciliation-acceptance-snapshot.v1";

// ── Strict readers. Each returns `undefined` for "not the shape the contract promises", which the
//    callers turn into a refusal. Nothing here coerces, defaults, or rounds.

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A required non-empty string (review_state, classification, …). */
function asText(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function asEnum<const T extends string>(value: unknown, allowed: ReadonlySet<T>): T | undefined {
  return typeof value === "string" && allowed.has(value as T) ? (value as T) : undefined;
}

const BATCH_STATUSES = new Set([
  "staged",
  "reviewed",
  "approved",
  "executing",
  "executed",
  "failed",
  "rolled_back",
] as const);
const REVIEW_STATES = new Set(["unreviewed", "reviewed", "frozen", "executed", "rejected"] as const);
const DISPOSITIONS = new Set(["include", "hold"] as const);
const EXECUTION_RESULTS = new Set(["pending", "posted", "reversed", "skipped", "failed"] as const);

/**
 * An optional string, read from a REQUIRED key. The key must be present: explicitly null is the
 * contract's "not recorded", but a MISSING key means the payload does not implement this contract and
 * is refused — otherwise a field the server silently stopped sending would read as "not recorded".
 */
function readNullableText(
  source: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!Object.hasOwn(source, key)) return undefined;
  const value = source[key];
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function asUuid(value: unknown): string | undefined {
  return isUuid(value) ? value : undefined;
}

/**
 * The rule every parser below shares: a strict reader returns `undefined` for "not the shape the
 * contract promises", and ONE such field refuses the whole object. Named once so the three parsers
 * cannot drift apart on it.
 */
function everyFieldRead(parsed: Record<string, unknown>): boolean {
  return !Object.values(parsed).some((field) => field === undefined);
}

/**
 * A `numeric` accounting field, from a REQUIRED key. It must be null, or TEXT that lib/decimal.ts can
 * read exactly — the canonical decimal grammar AND its scale/magnitude bounds.
 *
 * Two refusals hide in here, and both matter to a signature:
 *   • a JSON NUMBER means the value already passed through a binary double, which is precisely the
 *     defect the RPC's ::text serialisation exists to prevent;
 *   • text outside `isDecimalText` is not a smaller number, it is an unreadable one. Accepting it
 *     would put it in the CSV verbatim while every total silently omitted it as "unknown".
 */
function readDecimalText(
  source: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const text = readNullableText(source, key);
  if (text === undefined || text === null) return text;
  return isDecimalText(text) ? text : undefined;
}

/**
 * A joined label object, from a REQUIRED key: explicitly null when nothing was readable, otherwise an
 * object carrying EVERY key the contract names, each a string or null. A missing key — on the ref or
 * inside it — is refused, never defaulted to "no label".
 */
function readLabelRef(
  source: Record<string, unknown>,
  key: string,
  keys: readonly string[],
): Record<string, string | null> | null | undefined {
  if (!Object.hasOwn(source, key)) return undefined;
  const value = source[key];
  if (value === null) return null;
  const ref = asObject(value);
  if (!ref) return undefined;
  const parsed: Record<string, string | null> = {};
  for (const field of keys) {
    const text = readNullableText(ref, field);
    if (text === undefined) return undefined;
    parsed[field] = text;
  }
  return parsed;
}

const CODE_NAME_AR = ["code", "name_ar"] as const;
const CODE_NAME = ["code", "name"] as const;
const NAME_ONLY = ["name"] as const;

/** Every row field that must be a plain optional string. */
const ROW_TEXT_FIELDS = [
  "reviewer_id",
  "reviewed_at",
  "review_reason",
  "target_table",
  "expense_category",
  "expense_description",
  "expense_kind",
  "expense_account_id",
  "expense_cost_center_id",
  "expense_supplier_id",
  "expense_payment_decision",
  "sale_crop",
  "sale_unit",
  "sale_buyer_id",
  "sale_cost_center_id",
  "sale_farm_id",
  "sale_sector_id",
  "sale_hawsha_id",
  "sale_season",
  "sale_delivery_date",
  "sale_notes",
  "sale_historical_date_decision",
  "sale_effective_date",
  "corrects_expense_id",
  "corrects_sale_id",
  "payload_hash",
  "frozen_at",
  "execution_error",
] as const;

/** The row fields that carry a `numeric` and must therefore arrive as canonical decimal TEXT. */
const ROW_DECIMAL_FIELDS = ["sale_quantity", "sale_unit_price", "sale_recorded_total"] as const;

const EVIDENCE_TEXT_FIELDS = [
  "sheet_name",
  "row_locator",
  "snapshot_target_table",
  "snapshot_target_id",
  "source_workbook_sha256",
  "production_snapshot_sha256",
  "source_identity_fingerprint",
  "source_date_text",
  "source_date_parsed",
  "evidence_label",
] as const;

const ROW_LABEL_FIELDS = [
  ["expense_account", CODE_NAME_AR],
  ["expense_cost_center", CODE_NAME_AR],
  ["expense_supplier", NAME_ONLY],
  ["sale_buyer", NAME_ONLY],
  ["sale_cost_center", CODE_NAME_AR],
  ["sale_farm", NAME_ONLY],
  ["sale_sector", NAME_ONLY],
  ["sale_hawsha", CODE_NAME],
] as const;

/**
 * Evidence is REQUIRED and NON-NULL on every row. The RPC already refuses a batch containing a row
 * whose evidence it could not read; refusing here too means a payload that lost evidence in transit
 * can never reach the report as a row that merely "has no evidence label".
 */
function parseEvidence(row: Record<string, unknown>): AcceptanceRow["evidence"] | undefined {
  if (!Object.hasOwn(row, "evidence")) return undefined;
  const source = asObject(row.evidence);
  if (!source) return undefined;

  const parsed: Record<string, unknown> = {
    id: asUuid(source.id),
    origin_kind: asText(source.origin_kind),
    classification: asText(source.classification),
    invalid_calendar_quality_flag: asBoolean(source.invalid_calendar_quality_flag),
    source_amount: readDecimalText(source, "source_amount"),
  };
  for (const field of EVIDENCE_TEXT_FIELDS) parsed[field] = readNullableText(source, field);
  if (!everyFieldRead(parsed)) return undefined;
  return parsed as unknown as AcceptanceRow["evidence"];
}

function parseRow(value: unknown): AcceptanceRow | undefined {
  const source = asObject(value);
  if (!source) return undefined;

  const evidence = parseEvidence(source);
  if (evidence === undefined || evidence === null) return undefined;

  const parsed: Record<string, unknown> = {
    id: asUuid(source.id),
    evidence_item_id: asUuid(source.evidence_item_id),
    review_state: asEnum(source.review_state, REVIEW_STATES),
    disposition: asEnum(source.disposition, DISPOSITIONS),
    execution_result: asEnum(source.execution_result, EXECUTION_RESULTS),
    frozen: asBoolean(source.frozen),
  };
  for (const field of ROW_TEXT_FIELDS) parsed[field] = readNullableText(source, field);
  for (const field of ROW_DECIMAL_FIELDS) parsed[field] = readDecimalText(source, field);
  for (const [field, keys] of ROW_LABEL_FIELDS) parsed[field] = readLabelRef(source, field, keys);
  if (!everyFieldRead(parsed)) return undefined;

  // The row and its evidence must actually be the same evidence item.
  if (parsed.evidence_item_id !== evidence.id) return undefined;

  return { ...parsed, evidence } as unknown as AcceptanceRow;
}

function parseBatch(value: unknown): AcceptanceBatch | undefined {
  const source = asObject(value);
  if (!source) return undefined;
  const batch: Record<string, unknown> = {
    id: asUuid(source.id),
    status: asEnum(source.status, BATCH_STATUSES),
    created_at: asText(source.created_at),
    source_label: readNullableText(source, "source_label"),
    source_workbook_sha256: readNullableText(source, "source_workbook_sha256"),
    created_by: readNullableText(source, "created_by"),
    approved_at: readNullableText(source, "approved_at"),
    approved_by: readNullableText(source, "approved_by"),
  };
  if (!everyFieldRead(batch)) return undefined;
  // `result_summary` must be PRESENT (null is its "replaced/never recorded" value) but its contents
  // stay unconstrained here: acceptanceHashLines/acceptanceStagedCounts/acceptanceOutcome each treat
  // every value in it as untrusted, and the whole structure is bound into the digest canonically.
  if (!Object.hasOwn(source, "result_summary")) return undefined;
  return { ...batch, result_summary: source.result_summary ?? null } as unknown as AcceptanceBatch;
}

const REFUSALS: Record<string, AcceptanceLoad> = {
  not_found: { ok: false, kind: "not_found" },
  overflow: { ok: false, kind: "overflow", error: ACCEPTANCE_OVERFLOW_AR },
  incomplete: { ok: false, kind: "incomplete", error: ACCEPTANCE_INCOMPLETE_AR },
  count_mismatch: { ok: false, kind: "count_mismatch", error: ACCEPTANCE_COUNT_MISMATCH_AR },
  empty: { ok: false, kind: "empty", error: ACCEPTANCE_EMPTY_AR },
};

const READ_FAILED: AcceptanceLoad = {
  ok: false,
  kind: "read_failed",
  error: ACCEPTANCE_READ_FAILED_AR,
};

/**
 * Turn one RPC payload into a load result, refusing anything unrecognised.
 *
 * Exported so the contract can be exercised directly: every branch here is a refusal an accountant
 * would otherwise have signed against.
 */
export function parseAcceptanceSnapshot(
  payload: unknown,
  expectedBatchId?: string,
): AcceptanceLoad {
  const snapshot = asObject(payload);
  if (!snapshot) return READ_FAILED;
  // An unrecognised contract version is refused BEFORE the status is read: a newer snapshot may mean
  // something different by the same words.
  if (snapshot.version !== ACCEPTANCE_SNAPSHOT_VERSION) return READ_FAILED;

  const status = asText(snapshot.status);
  if (status === undefined) return READ_FAILED;
  if (status !== "ok") return REFUSALS[status] ?? READ_FAILED;

  // The DB's bound and this app's bound must be the same number, or one of them is stale and the
  // "complete batch" guarantee no longer means what the report says it means.
  if (snapshot.max_rows !== ACCEPTANCE_MAX_ROWS) return READ_FAILED;

  const batch = parseBatch(snapshot.batch);
  if (!batch) return READ_FAILED;
  if (expectedBatchId !== undefined && batch.id !== expectedBatchId) return READ_FAILED;

  if (!Array.isArray(snapshot.rows)) return READ_FAILED;
  const declared = asCount(snapshot.row_count);
  // The rows actually present must match the count the server declared, and stay inside the bound —
  // a truncated body can never be read as a complete batch.
  if (declared === undefined || declared !== snapshot.rows.length) return READ_FAILED;
  if (snapshot.rows.length > ACCEPTANCE_MAX_ROWS) return REFUSALS.overflow;
  // A batch with no rows is not a zero-total report; there is nothing to accept. The RPC already
  // refuses it — this is the second lock, so no code path can produce a signable page of zeros.
  if (snapshot.rows.length === 0) return REFUSALS.empty;

  const rows: AcceptanceRow[] = [];
  for (const value of snapshot.rows) {
    const row = parseRow(value);
    if (!row) return READ_FAILED;
    rows.push(row);
  }

  // Evidence is 1:1 with rows inside a batch (reconciliation_batch_rows_batch_evidence_uq), so a
  // repeated evidence item means the read is not the batch it claims to be.
  const evidenceIds = new Set(rows.map((row) => row.evidence_item_id));
  if (evidenceIds.size !== rows.length) return REFUSALS.incomplete;
  const declaredEvidence = asCount(snapshot.evidence_item_count);
  if (declaredEvidence === undefined || declaredEvidence !== evidenceIds.size) return READ_FAILED;

  // The batch's own staging record, re-checked here as well as in the RPC. `malformed` is a refusal,
  // NOT a skipped check: absent is only legitimate because execution/rollback replaces result_summary.
  const staged = acceptanceStagedCounts(batch.status, batch.result_summary);
  if (staged.kind === "malformed") return REFUSALS.count_mismatch;
  if (
    staged.kind === "recorded" &&
    (staged.counts.batchRowCount !== rows.length ||
      staged.counts.evidenceItemCount !== evidenceIds.size)
  ) {
    return REFUSALS.count_mismatch;
  }
  if (batch.status === "executed") {
    const summary = asObject(batch.result_summary);
    if (!summary) return REFUSALS.count_mismatch;
    const included = rows.filter((row) => row.disposition === "include");
    const executed = included.filter(
      (row) => row.execution_result === "posted" || row.execution_result === "reversed",
    ).length;
    const skipped = included.filter((row) => row.execution_result === "skipped").length;
    if (
      asCount(summary.executed_rows) !== executed ||
      asCount(summary.skipped_rows) !== skipped ||
      executed + skipped !== included.length
    ) {
      return REFUSALS.count_mismatch;
    }
  }

  return { ok: true, batch, rows };
}

/**
 * Load a whole batch for the acceptance report.
 *
 * Bounds and checks, in order:
 *   1. A malformed batch id (or org id) never reaches the database.
 *   2. The RPC enforces authentication, the ACTIVE org, and the owner/accountant role, then reads the
 *      batch, its rows, their evidence and the readable dimension labels in ONE snapshot. It refuses —
 *      it does not truncate — a batch beyond ACCEPTANCE_MAX_ROWS, a read whose rows do not match the
 *      batch's own row count, a row whose evidence is unreadable, and a batch whose stored row count
 *      disagrees with what the staging tool recorded on it.
 *   3. This module re-checks the contract version, the bound, the declared count and every row's
 *      shape — including that no accounting amount arrived as a JSON number.
 *   4. Any error, or any payload not fully recognised, refuses the report. No partial rows, no partial
 *      numbers, ever.
 */
export async function loadAcceptanceBatch(
  sb: SupabaseClient<Database>,
  batchId: string,
  orgId: string,
): Promise<AcceptanceLoad> {
  if (!isUuid(batchId)) return { ok: false, kind: "not_found" };
  // A malformed org id is a caller bug, not a missing batch — it must not read as "no such batch".
  if (!isUuid(orgId)) return READ_FAILED;

  const { data, error } = await sb.rpc(ACCEPTANCE_SNAPSHOT_RPC, {
    p_org: orgId,
    p_batch_id: batchId,
  });
  if (error) return READ_FAILED;

  return parseAcceptanceSnapshot(data, batchId);
}
