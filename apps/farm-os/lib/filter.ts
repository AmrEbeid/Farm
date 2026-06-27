// Pure, framework-free row filter used by the list pages' search box
// (components/FilterableTable.tsx). Kept here — not inline in the client
// component — so the matching logic is unit-testable under the node vitest env
// (vitest.config include = lib/**/*.test.ts) without a DOM.

export type FilterableRow = Record<string, string | number | null | undefined>;

/**
 * Case-insensitive substring match of `query` against the named `columns` of
 * each row. An empty/whitespace query returns the rows unchanged (no filtering).
 * Numeric cells are stringified so "12" matches a quantity of 12. Matching is
 * Unicode-lowercased so it behaves for Latin text; Arabic has no case so it is
 * matched as-is (substring), which is the intended behavior for the field UI.
 */
export function filterRows<T extends FilterableRow>(
  rows: T[],
  columns: string[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    columns.some((id) => {
      const v = row[id];
      return v != null && String(v).toLowerCase().includes(needle);
    }),
  );
}
