// Pure, framework-free row filter used by the list pages' search box
// (components/FilterableTable.tsx). Kept here — not inline in the client
// component — so the matching logic is unit-testable under the node vitest env
// (vitest.config include = lib/**/*.test.ts) without a DOM.

export type FilterableRow = Record<string, string | number | null | undefined>;

/**
 * Lucene-style Arabic folding so search recall works for real Arabic data:
 * variant spellings and diacritics of the same word should match. Pure and
 * framework-free. Latin/ASCII text passes through unchanged — none of these
 * ranges touch ASCII, so it is a no-op for Latin matches. Applied (in order):
 *  - strip tashkeel/diacritics U+064B–U+0652 and superscript alef U+0670
 *  - remove tatweel U+0640 (ـ)
 *  - fold alef forms أإآٱ → ا
 *  - fold alef-maksura ى → ي
 *  - fold ta-marbuta ة → ه
 */
export function normalizeArabic(s: string): string {
  return s
    .replace(/[ً-ْٰ]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

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
  const needle = normalizeArabic(query.trim().toLowerCase());
  if (!needle) return rows;
  return rows.filter((row) =>
    columns.some((id) => {
      const v = row[id];
      return (
        v != null &&
        normalizeArabic(String(v).toLowerCase()).includes(needle)
      );
    }),
  );
}
