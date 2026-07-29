/** Shared types for the bulk-import framework. See spec §5. */

import type { Role } from "@/lib/auth";

export type ColumnType = "string" | "int" | "decimal" | "bool" | "date" | "enum";

/** A reference column: the user types a human code; the engine resolves it to an id by
 * looking it up in `table` where `codeColumn = value` (RLS-scoped). See resolve.ts. */
export interface RefSpec {
  table: string; // e.g. "sectors"
  codeColumn: string; // e.g. "code"
  idColumn?: string; // default "id"
  activeColumn?: string; // e.g. "archived"; when set, lookup filters it to activeValue
  activeValue?: boolean | string | number; // default false
}

export interface ImportColumn {
  key: string; // canonical field name (also the data-sheet header key)
  labelAr: string; // Arabic RTL header shown in the template
  type: ColumnType;
  required: boolean;
  enumValues?: string[]; // enum → data-validation dropdown in the .xlsx
  format?: string; // date format, e.g. "YYYY-MM-DD"
  example: string; // shown in the example row
  ref?: RefSpec; // if set, the cell holds a code resolved to an id before commit
}

/** One extra, descriptor-specific error against an already-coerced row. */
export interface CrossFieldError {
  column: string; // column key the error belongs to
  reason: string; // Arabic message
}

/**
 * A NARROW, PURE per-row cross-field hook (SPEC-0006 readiness). Runs in `validateRows` AFTER the
 * generic per-column coercion, and only for rows that survived it, so it never has to re-implement
 * type coercion — it only answers questions the column list cannot express, e.g. "a piece rate needs
 * a unit and every other mode must not carry one". `now` is injected so a Cairo-day rule stays
 * deterministic under test; the hook must do no I/O and must not mutate `row`.
 * Descriptors that omit it keep exactly today's behavior.
 */
export type CrossFieldCheck = (row: Record<string, unknown>, now: Date) => CrossFieldError[];

interface ImportDescriptorBase {
  key: string; // "sales"
  titleAr: string; // "المبيعات"
  role: string; // who may import (mirrors the RPC's own gate, or the permission gating the data)
  columns: ImportColumn[];
  /**
   * App roles allowed to download the template AND to run a dry-run, enforced in the route right
   * after membership + descriptor resolution — before ANY template data read or upload parsing.
   * Unset = no descriptor-level app gate (today's behavior: the DB RPC's own gate is the boundary).
   * Setting it never widens access; it only narrows before the request touches data.
   */
  allowedRoles?: Role[];
  crossFieldCheck?: CrossFieldCheck;
}

/** A descriptor with a real write path: template → dry-run → commit through its gated `fn_*` RPC. */
export interface WriteImportDescriptor extends ImportDescriptorBase {
  /** Absent/false = this descriptor commits. Present as `false` only for symmetry. */
  validationOnly?: false;
  rpc: string; // gated write path, e.g. "fn_save_sale"
  toRpcArgs: (row: Record<string, unknown>, matchedId?: string | null) => Record<string, unknown>;
  dedupeKey?: string[]; // business key: upsert where the RPC supports it, else skip/flag dupes
  /** DB table this descriptor reads from for prefill + reconcile-upsert. Unset = today's
   * blank-template, insert-only behavior (no prefill, no matching). */
  table?: string;
  /** The `fn_archive_structure` p_type value for this table (e.g. "sector", "hawsha",
   * "line") — required alongside `table` to support archive-by-omission. */
  archiveType?: string;
  /** Business key used to match an uploaded row to an existing DB row (update) vs. treat
   * it as new (insert), and to detect rows missing from the file (archive candidates). */
  matchKey?: string[];
  /** Reverse of `toRpcArgs`: maps a queried DB row to column-key-shaped values for the
   * template. Ref columns should be left holding the raw id — `reverseResolveRefs`
   * converts them to their human code before rendering. */
  fromRow?: (dbRow: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * TEMPLATE + DRY-RUN ONLY. A descriptor that has NO commit path at all: no RPC to call, no arguments
 * to build, no table to prefill from, no rows to archive. The `?: never` members are not decoration —
 * they make "a validation-only descriptor that quietly grew a write path" a TYPE error, so the ban
 * is checked by tsc on every build and not only by a runtime branch someone can forget.
 *
 * The route rejects a `commit` POST for one of these BEFORE the upload is parsed and before any write
 * planning, and `planCommit` throws if it is ever handed one. UI hiding is never the control.
 */
export interface ValidationOnlyImportDescriptor extends ImportDescriptorBase {
  validationOnly: true;
  rpc?: never;
  toRpcArgs?: never;
  dedupeKey?: never;
  table?: never;
  archiveType?: never;
  matchKey?: never;
  fromRow?: never;
}

export type ImportDescriptor = WriteImportDescriptor | ValidationOnlyImportDescriptor;

/** True when the descriptor has no commit path. Narrows the union for callers. */
export function isValidationOnly(d: ImportDescriptor): d is ValidationOnlyImportDescriptor {
  return d.validationOnly === true;
}

export interface RowError {
  row: number; // 1-based data-row index
  column: string; // column key, or "" for a row-level error
  reason: string; // Arabic message
}

export interface DryRunResult {
  okRows: Record<string, unknown>[]; // coerced rows ready for the RPC
  errors: RowError[];
  okCount: number;
  errorCount: number; // count of ROWS with >=1 error (not total errors)
}

const SOURCE_ROW = Symbol.for("farm.import.sourceRow");

type RowWithSource = Record<string, unknown> & { [SOURCE_ROW]?: number };

export function setSourceRow<T extends Record<string, unknown>>(row: T, sourceRow: number): T {
  Object.defineProperty(row, SOURCE_ROW, {
    value: sourceRow,
    enumerable: false,
    configurable: true,
  });
  return row;
}

export function getSourceRow(row: Record<string, unknown>, fallback: number): number {
  return (row as RowWithSource)[SOURCE_ROW] ?? fallback;
}
