/**
 * Reference resolution for the import framework (spec §6, addendum). A descriptor column
 * with a `ref` spec lets the user type a human code (e.g. a sector's code) instead of a
 * UUID; this resolves each code to its id via an injected, RLS-scoped lookup. The lookup
 * is a parameter (not a DB import) so this module stays pure and unit-testable; the route
 * supplies the real Supabase-backed lookup.
 *
 * Runs AFTER validateRows, on its okRows. A code that resolves to no row (or is ambiguous)
 * becomes a row error and the row is dropped from the commit set. Row numbers remain the
 * original 1-based data-row indexes from the spreadsheet, even after earlier validation
 * failures have filtered rows out.
 */
import { getSourceRow, setSourceRow, type ImportColumn, type ImportDescriptor, type RowError, type RefSpec } from "./types";

/** Given a ref spec and a set of distinct codes, return code→id for the ones that resolve
 * to exactly one row. Missing or ambiguous codes are simply absent from the map. */
export type ResolvedRefSpec = RefSpec & { idColumn: string };
export type RefLookup = (spec: ResolvedRefSpec, codes: string[]) => Promise<Map<string, string>>;

function refColumns(d: ImportDescriptor): { col: ImportColumn; spec: ResolvedRefSpec }[] {
  return d.columns
    .filter((c): c is ImportColumn & { ref: RefSpec } => c.ref != null)
    .map((c) => ({ col: c, spec: { idColumn: "id", ...c.ref } }));
}

export async function resolveRefs(
  descriptor: ImportDescriptor,
  rows: Record<string, unknown>[],
  lookup: RefLookup,
): Promise<{ rows: Record<string, unknown>[]; errors: RowError[] }> {
  const refs = refColumns(descriptor);
  if (refs.length === 0) return { rows, errors: [] };

  // One batched lookup per ref column over its distinct non-empty codes.
  const maps = new Map<string, Map<string, string>>();
  for (const { col, spec } of refs) {
    const codes = [...new Set(rows.map((r) => String(r[col.key] ?? "")).filter((c) => c !== ""))];
    maps.set(col.key, codes.length > 0 ? await lookup(spec, codes) : new Map());
  }

  const out: Record<string, unknown>[] = [];
  const errors: RowError[] = [];
  rows.forEach((row, i) => {
    const rowNum = getSourceRow(row, i + 1);
    const resolved = setSourceRow({ ...row }, rowNum);
    let ok = true;
    for (const { col } of refs) {
      const code = String(row[col.key] ?? "");
      if (code === "") {
        resolved[col.key] = null; // empty ref (column was optional) → null id
        continue;
      }
      const id = maps.get(col.key)?.get(code);
      if (id == null) {
        errors.push({ row: rowNum, column: col.key, reason: "لم يتم العثور على هذا الكود" });
        ok = false;
      } else {
        resolved[col.key] = id;
      }
    }
    if (ok) out.push(resolved);
  });

  return { rows: out, errors };
}
