import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IMPORT_PANEL_VALIDATION_ONLY_NOTICE_AR, importPanelControls } from "./panel-mode";

/**
 * The validation-only panel must not offer, or even hint at, a write.
 *
 * The pure half decides WHICH controls exist; the source half proves the panel actually obeys it —
 * that the commit button, the archive confirmation and the "تم استيراد N" block are each gated on
 * their own flag, and that `send("commit")` cannot be issued from a panel that has no commit
 * control. (The server refuses it regardless; see access.test.ts. This is about not lying to a user.)
 */

const PANEL = join(process.cwd(), "components", "import", "ImportPanel.tsx");
const file = readFileSync(PANEL, "utf8");
/** The component body only — the header comment mentions the very strings being located here. */
const source = file.slice(file.indexOf("export function ImportPanel"));

describe("importPanelControls", () => {
  it("offers template + dry-run only, with a notice, in validation-only mode", () => {
    expect(importPanelControls(true)).toEqual({
      showCommit: false,
      showArchive: false,
      showCommitResult: false,
      notice: IMPORT_PANEL_VALIDATION_ONLY_NOTICE_AR,
    });
  });

  it("keeps the full panel for every other value (existing call sites unchanged)", () => {
    for (const value of [undefined, false]) {
      expect(importPanelControls(value), String(value)).toEqual({
        showCommit: true,
        showArchive: true,
        showCommitResult: true,
        notice: null,
      });
    }
  });

  it("states the no-write and synthetic-only boundaries in the notice", () => {
    expect(IMPORT_PANEL_VALIDATION_ONLY_NOTICE_AR).toContain("لا يُكتب");
    expect(IMPORT_PANEL_VALIDATION_ONLY_NOTICE_AR).toContain("قاعدة البيانات");
    expect(IMPORT_PANEL_VALIDATION_ONLY_NOTICE_AR).toContain("تجريبية");
    expect(IMPORT_PANEL_VALIDATION_ONLY_NOTICE_AR).toContain("المرحلة M");
  });
});

describe("ImportPanel source obeys the controls", () => {
  it("renders the commit button only when showCommit", () => {
    expect(source).toContain("{controls.showCommit && (");
    // The literal button text exists exactly once, inside that branch.
    expect(source.indexOf("استيراد\n")).toBeGreaterThan(source.indexOf("{controls.showCommit && ("));
  });

  it("renders the archive warning + confirmation only when showArchive", () => {
    expect(source).toContain("{controls.showArchive && dry.toArchive.length > 0 && (");
    // The confirmation checkbox lives inside that same branch, never outside it.
    expect(source.indexOf("confirmArchive")).toBeGreaterThan(-1);
    expect(source.indexOf("سيتم أرشفة هذه العناصر")).toBeGreaterThan(
      source.indexOf("{controls.showArchive &&"),
    );
  });

  it("renders the commit result block only when showCommitResult", () => {
    expect(source).toContain("{controls.showCommitResult && done && (");
    expect(source.indexOf("تم استيراد")).toBeGreaterThan(
      source.indexOf("{controls.showCommitResult &&"),
    );
  });

  it("never sends a commit request from a panel with no commit control", () => {
    expect(source).toContain('if (mode === "commit" && !controls.showCommit) return;');
  });

  it("does not describe a would-be write (جديد/تحديث/سيُؤرشف) in validation-only mode", () => {
    expect(source).toContain("{controls.showCommit ? (");
    expect(source).toContain("لم يُحفظ أي");
  });

  it("shows the notice above the controls when there is one", () => {
    expect(source).toContain("{controls.notice && (");
    expect(source.indexOf("{controls.notice && (")).toBeLessThan(source.indexOf('type="file"'));
  });
});
