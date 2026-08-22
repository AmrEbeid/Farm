import { describe, expect, it } from "vitest";
import { computeEntryDebitAmount, groupLinesByEntryId } from "./accounting-recent-entries";

describe("groupLinesByEntryId", () => {
  it("keeps a line out of every entry group except the one it belongs to", () => {
    const lines = [
      { journal_entry_id: "entry-a", debit: 100 },
      { journal_entry_id: "entry-b", debit: 5000 },
    ];
    const byEntry = groupLinesByEntryId(lines);

    // The historical defect: entry-a's displayed amount came from an unrelated global sample that
    // happened to contain entry-b's line. Grouping by entry id must never let that happen.
    expect(byEntry.get("entry-a")).toEqual([{ journal_entry_id: "entry-a", debit: 100 }]);
    expect(byEntry.get("entry-b")).toEqual([{ journal_entry_id: "entry-b", debit: 5000 }]);
  });
});

describe("computeEntryDebitAmount", () => {
  it("sums the debit side of the entry's own lines", () => {
    const lines = [
      { journal_entry_id: "entry-a", debit: 212004 },
      { journal_entry_id: "entry-a", debit: 0 },
    ];
    expect(computeEntryDebitAmount(lines)).toBe(212004);
  });

  it("returns undefined instead of a fabricated zero when no lines are matched", () => {
    expect(computeEntryDebitAmount([])).toBeUndefined();
  });

  it("treats a null debit as zero without failing closed", () => {
    const lines = [{ journal_entry_id: "entry-a", debit: null }, { journal_entry_id: "entry-a", debit: 50 }];
    expect(computeEntryDebitAmount(lines)).toBe(50);
  });
});
