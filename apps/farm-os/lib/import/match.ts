/**
 * Reconcile-upsert matching for the import framework (SPEC-0020). Matches uploaded rows
 * against existing DB rows by `descriptor.matchKey`, so a commit updates what changed,
 * inserts what's new, and reports what's missing (for archival) — never a silent
 * duplicate or a silent delete. Pure; the DB row set is injected by the caller (route).
 */
import { getSourceRow, type ImportDescriptor } from "./types";
import { normalizeDigits } from "./validate";

const KEY_SEP = "\u0001"; // unit separator — avoids cross-field key collisions in composite keys

export function matchKeyOf(descriptor: ImportDescriptor, row: Record<string, unknown>): string {
  return (descriptor.matchKey ?? [])
    .map((k) => normalizeDigits(String(row[k] ?? "")))
    .join(KEY_SEP);
}

/** matchKey values present anywhere in the uploaded file, computed from RAW parsed rows
 * (before validation) — a row with an unrelated error must still protect its existing
 * record from being reported as missing. */
export function seenKeysOf(descriptor: ImportDescriptor, rawRows: Record<string, unknown>[]): Set<string> {
  return new Set(rawRows.map((r) => matchKeyOf(descriptor, r)));
}

export interface ExistingRow {
  id: string;
  key: string; // matchKeyOf applied to the existing row's own (fromRow-mapped) fields
  label: string; // human-readable identifier for the archive-confirmation list
}

export interface MatchPlan {
  matchedIds: Map<number, string>; // sourceRow -> existing row id (this row is an update)
  toArchive: { id: string; label: string }[]; // existing rows absent from the uploaded file
}

export function computeMatchPlan(
  descriptor: ImportDescriptor,
  seenKeys: Set<string>,
  validRows: Record<string, unknown>[],
  existing: ExistingRow[],
): MatchPlan {
  const byKey = new Map(existing.map((e) => [e.key, e.id]));
  const matchedIds = new Map<number, string>();
  validRows.forEach((row, i) => {
    const id = byKey.get(matchKeyOf(descriptor, row));
    if (id != null) matchedIds.set(getSourceRow(row, i + 1), id);
  });

  const toArchive = existing.filter((e) => !seenKeys.has(e.key)).map((e) => ({ id: e.id, label: e.label }));
  return { matchedIds, toArchive };
}
