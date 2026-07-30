import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeEntryDebitAmount, groupLinesByEntryId } from "./accounting-recent-entries";

const pageSource = readFileSync(
  join(process.cwd(), "app", "(app)", "accounting", "page.tsx"),
  "utf8",
);

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

// Regression guard for the actual historical defect: the page itself grouped a global, entry-agnostic
// sample of journal_lines by entry id. groupLinesByEntryId/computeEntryDebitAmount are correct on
// whatever they're given, so they can't catch a page-level regression back to that unscoped query —
// only reading the page source can.
describe("accounting page journal_lines query stays entry-scoped", () => {
  it("reads journal_lines joined to the displayed entries, org-scoped", () => {
    const start = pageSource.indexOf('.from("journal_lines")');
    expect(start, "journal_lines query not found in page.tsx").toBeGreaterThan(-1);
    const query = pageSource.slice(start, pageSource.indexOf(": { data: [], error: null }", start));
    expect(query).toContain('.eq("org_id", m.orgId)');
    expect(query).toContain('.in("journal_entry_id", entryIds)');
  });

  it("never regresses to a second, entry-agnostic journal_lines sample", () => {
    // The historical bug: an independent `.from("journal_lines")` query ordered only by created_at
    // and capped at a fixed count, with no join back to the displayed entries at all.
    expect(pageSource.match(/\.from\("journal_lines"\)/g) ?? []).toHaveLength(1);
  });

  it("fails closed when the bounded read lands exactly at the query limit", () => {
    const start = pageSource.indexOf("const lines = linesRes.data");
    expect(start, "lines assignment not found in page.tsx").toBeGreaterThan(-1);
    const guard = pageSource.slice(start, pageSource.indexOf("const trialBalance = parseTrialBalance", start));
    expect(guard).toContain("if (lines.length >= JOURNAL_LINES_QUERY_LIMIT)");
    expect(guard).toMatch(/throw new Error\(/);
  });
});
