// Regression guard for the /accounting "latest entries" defect: a displayed entry's amount must be
// computed from lines belonging to that exact entry, never from an unrelated capped/global sample.

export interface JournalLineRow {
  journal_entry_id: string;
  debit?: number | string | null;
}

/** Groups lines by their owning entry id — the join the page must do before computing any amount. */
export function groupLinesByEntryId<T extends JournalLineRow>(lines: T[]): Map<string, T[]> {
  const byEntry = new Map<string, T[]>();
  for (const line of lines) {
    const current = byEntry.get(line.journal_entry_id) ?? [];
    current.push(line);
    byEntry.set(line.journal_entry_id, current);
  }
  return byEntry;
}

/**
 * Sums the debit side of an entry's own lines. Returns `undefined` (never `0`) when no lines are
 * matched, so a data gap renders as unknown ("—") instead of a fabricated zero amount.
 */
export function computeEntryDebitAmount(entryLines: JournalLineRow[]): number | undefined {
  if (entryLines.length === 0) return undefined;
  return entryLines.reduce((sum, line) => sum + Number(line.debit ?? 0), 0);
}
