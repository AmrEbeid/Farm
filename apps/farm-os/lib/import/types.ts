/** Shared types for the bulk-import framework. See spec §5. */

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

export interface ImportDescriptor {
  key: string; // "sales"
  titleAr: string; // "المبيعات"
  rpc: string; // gated write path, e.g. "fn_save_sale"
  role: string; // who may import (mirrors the RPC's own gate)
  columns: ImportColumn[];
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
