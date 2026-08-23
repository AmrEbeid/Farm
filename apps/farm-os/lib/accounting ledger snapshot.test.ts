import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAccountingLedgerSnapshot } from "./accounting ledger snapshot";

const valid = {
  version: "farm-os.accounting-ledger.v1",
  org_id: "org-a",
  entry_limit: 20,
  line_limit: 500,
  line_count: 1,
  account_mismatch_count: 0,
  trial_balance: [
    {
      account_id: "account-a",
      org_id: "org-a",
      code: "1000",
      name_ar: "نقدية",
      account_type: "asset",
      normal_balance: "debit",
      parent_id: null,
      active: true,
      has_postings: true,
      debit: "100000000000000.01",
      credit: "0",
      net: "100000000000000.01",
    },
  ],
  recent_entries: [
    {
      id: "entry-a",
      entry_date: "2026-08-08",
      source_type: "expense_payment",
      source_id: "source-a",
      description: null,
      status: "posted",
      posted_at: "2026-08-08T12:00:00Z",
      amount: "100000000000000.01",
    },
  ],
  recent_lines: [
    {
      id: "line-a",
      journal_entry_id: "entry-a",
      account_id: "account-a",
      account_code: "1000",
      account_name_ar: "نقدية",
      debit: "100000000000000.01",
      credit: "0",
      description: null,
      payment_request_id: null,
      expense_id: null,
    },
  ],
};

describe("accounting ledger snapshot", () => {
  it("preserves exact money beyond binary floating-point precision", () => {
    const snapshot = parseAccountingLedgerSnapshot(valid, "org-a");
    expect(snapshot.trialBalance[0].debit).toBe("100000000000000.01");
    expect(snapshot.recentEntries[0].amount).toBe("100000000000000.01");
    expect(snapshot.recentLines[0].debit).toBe("100000000000000.01");
  });

  it.each([
    null,
    {},
    { ...valid, version: "wrong" },
    { ...valid, trial_balance: null },
    { ...valid, trial_balance: [{ ...valid.trial_balance[0], debit: 10 }] },
    { ...valid, trial_balance: [{ ...valid.trial_balance[0], active: "yes" }] },
    { ...valid, recent_entries: [{ ...valid.recent_entries[0], amount: 10 }] },
    { ...valid, recent_entries: [{ ...valid.recent_entries[0], status: "draft" }] },
    { ...valid, recent_lines: [{ ...valid.recent_lines[0], debit: "bad" }] },
    { ...valid, entry_limit: 0 },
  ])("rejects an invalid or inexact payload %#", (payload) => {
    expect(() => parseAccountingLedgerSnapshot(payload, "org-a")).toThrow("accounting ledger snapshot:");
  });

  it("fails closed when recent-line detail is truncated", () => {
    expect(() => parseAccountingLedgerSnapshot({ ...valid, line_count: 2 }, "org-a")).toThrow(
      "recent line detail is incomplete",
    );
    expect(() => parseAccountingLedgerSnapshot({ ...valid, line_limit: 0 }, "org-a")).toThrow(
      "outside its safe range",
    );
  });

  it("rejects duplicate rows and cross-entry line leakage", () => {
    expect(() => parseAccountingLedgerSnapshot({
      ...valid,
      trial_balance: [valid.trial_balance[0], valid.trial_balance[0]],
    }, "org-a")).toThrow("duplicate account account-a");
    expect(() => parseAccountingLedgerSnapshot({
      ...valid,
      recent_lines: [{ ...valid.recent_lines[0], journal_entry_id: "entry-b" }],
    }, "org-a")).toThrow("line does not belong to a returned entry");
    expect(() => parseAccountingLedgerSnapshot({
      ...valid,
      line_count: 0,
      recent_lines: [],
    }, "org-a")).toThrow("entry has no line detail");
  });

  it("rejects tenant drift and account-link integrity failures", () => {
    expect(() => parseAccountingLedgerSnapshot(valid, "org-b")).toThrow("active organization");
    expect(() => parseAccountingLedgerSnapshot({ ...valid, account_mismatch_count: 1 }, "org-a"))
      .toThrow("account organization is invalid");
    expect(() => parseAccountingLedgerSnapshot({
      ...valid,
      trial_balance: [{ ...valid.trial_balance[0], org_id: "org-b" }],
    }, "org-a")).toThrow("trial balance contains another organization");
  });

  it("binds the accounting page to one exact snapshot and no direct ledger reads", () => {
    const source = readFileSync(join(process.cwd(), "app/(app)/accounting/page.tsx"), "utf8");
    const view = readFileSync(join(process.cwd(), "app/(app)/accounting/accounting-ledger-view.tsx"), "utf8");
    expect(source.match(/sb\.rpc\("fn_accounting_ledger_snapshot"/g) ?? []).toHaveLength(1);
    expect(source).toContain("parseAccountingLedgerSnapshot(snapshotRes.data, member.orgId)");
    expect(source).not.toMatch(/\.from\("(?:accounts|journal_entries|journal_lines)"\)/);
    expect(source).not.toContain("fn_accounting_trial_balance");
    expect(view).not.toMatch(/Number\((?:row\.)?(?:debit|credit|net|amount)/);
    expect(view.match(/kind: "money-preserve-exact"/g) ?? []).toHaveLength(3);
    expect(view).not.toContain('exportFilename="accounting-journal-entries.csv"');
    expect(view).not.toContain('exportFilename="accounting-journal-lines.csv"');
    expect(view).toContain('exportFilename="accounting-trial-balance.csv"');
    expect(view).toContain("linesByEntry.get(entry.id) ?? []");
    expect(view).toContain("أحدث {num(snapshot.entryLimit)} قيدًا كحد أقصى");
    expect(view).toContain('entry.status === "posted"');
    expect(view).toContain('expense: "إثبات مصروف"');
    expect(view).toContain('opening_balance: "رصيد افتتاحي"');
    expect(view).toContain('`قيد محاسبي (${sourceType})`');
    expect(view).toContain('<section className="print-only" aria-label="دفتر الأستاذ الكامل للطباعة">');
    expect(view).toContain("وليست سجل القيود التاريخي الكامل");
    expect(view.match(/<JournalEntry/g) ?? []).toHaveLength(2);
    expect(view).toContain("<SimpleTable columns={trialCols} rows={trialRows}");
  });
});
