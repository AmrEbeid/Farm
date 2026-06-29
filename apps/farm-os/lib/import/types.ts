/** Shared types for the bulk-import framework. See spec §5. */

export type ColumnType = "string" | "int" | "decimal" | "bool" | "date" | "enum";

export interface ImportColumn {
  key: string; // canonical field name (also the data-sheet header key)
  labelAr: string; // Arabic RTL header shown in the template
  type: ColumnType;
  required: boolean;
  enumValues?: string[]; // enum → data-validation dropdown in the .xlsx
  format?: string; // date format, e.g. "YYYY-MM-DD"
  example: string; // shown in the example row
}

export interface ImportDescriptor {
  key: string; // "sales"
  titleAr: string; // "المبيعات"
  rpc: string; // gated write path, e.g. "fn_save_sale"
  role: string; // who may import (mirrors the RPC's own gate)
  columns: ImportColumn[];
  toRpcArgs: (row: Record<string, unknown>) => Record<string, unknown>;
  dedupeKey?: string[]; // business key: upsert where the RPC supports it, else skip/flag dupes
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
