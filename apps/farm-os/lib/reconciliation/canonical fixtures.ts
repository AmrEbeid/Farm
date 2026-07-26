// Shared canonical (real, non-repo, machine-local) trusted-fixture paths and the explicit
// opt-in gate for the tests that exercise them. Not itself a test file -- imported by
// generator.test.ts and cli.test.ts.
import { existsSync } from "node:fs";

export const CANONICAL_EVIDENCE_PATH =
  "/Users/amrebeid/Documents/Farm Records Knowledge System/accounting exception evidence.json";
export const CANONICAL_WORKBOOK_PATH =
  "/Users/amrebeid/Documents/Farm Records/Expanded Archives/Requested files/مطلوب الاستاذ عمرو/شيت محاسبي للمزارع.xlsx";
export const CANONICAL_SNAPSHOT_PATH =
  "/Users/amrebeid/Documents/Farm Records Knowledge System/.private_tmp/production accounting snapshot.jsonl";

const CANONICAL_PATHS = [CANONICAL_EVIDENCE_PATH, CANONICAL_WORKBOOK_PATH, CANONICAL_SNAPSHOT_PATH];

/**
 * Explicit opt-in env gate for the controlled canonical (real-file) test suites.
 *
 * - Unset (normal/portable CI): canonical tests are skipped gracefully -- the three files are
 *   private, non-repo, machine-local fixtures that will not exist on most machines.
 * - `RUN_RECONCILIATION_CANONICAL=1` (this controlled worktree): canonical tests MUST run, and
 *   the test file fails loudly (not a silent skip) if any of the three pinned files is missing.
 */
export const CANONICAL_GATE_ENV = "RUN_RECONCILIATION_CANONICAL";

export function canonicalGateEnabled(): boolean {
  return process.env[CANONICAL_GATE_ENV] === "1";
}

/** Throws if the gate is enabled and any required canonical file is missing. */
export function assertCanonicalFilesPresentWhenGated(): void {
  if (!canonicalGateEnabled()) return;
  const missing = CANONICAL_PATHS.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    throw new Error(
      `${CANONICAL_GATE_ENV}=1 but required canonical file(s) are missing: ${missing.join(", ")}`,
    );
  }
}
