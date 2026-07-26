import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseJsonBytes, runStagingCli, verifyPinnedHash } from "../cli.mts";
import {
  assertCanonicalFilesPresentWhenGated,
  CANONICAL_EVIDENCE_PATH,
  CANONICAL_SNAPSHOT_PATH,
  CANONICAL_WORKBOOK_PATH,
  canonicalGateEnabled,
} from "../canonical fixtures.ts";
import { StagingError } from "../types.mts";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

// Throws (failing this test file loudly) if RUN_RECONCILIATION_CANONICAL=1 but a required
// canonical file is missing -- the controlled gate is never a silent skip.
assertCanonicalFilesPresentWhenGated();
const canonicalGate = canonicalGateEnabled();

function collectIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { stdout: (l: string) => out.push(l), stderr: (l: string) => err.push(l) },
    out,
    err,
  };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "reconciliation-cli-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function baseArgs(overrides: Partial<Record<"evidence" | "workbook" | "snapshot" | "output", string>> = {}) {
  return [
    "--evidence",
    overrides.evidence ?? CANONICAL_EVIDENCE_PATH,
    "--workbook",
    overrides.workbook ?? CANONICAL_WORKBOOK_PATH,
    "--snapshot",
    overrides.snapshot ?? CANONICAL_SNAPSHOT_PATH,
    "--org-id",
    ORG_ID,
    "--output",
    overrides.output ?? join(dir, "draft.json"),
  ];
}

describe("runStagingCli argument handling", () => {
  it("rejects an unrecognized flag with a fixed message that does not echo the argument", () => {
    const secret = "SECRET_UNRECOGNIZED_ARG_TEXT";
    const { io, err } = collectIo();
    const code = runStagingCli([`--${secret}`, "x"], io);
    expect(code).toBe(1);
    expect(err[0]).toBe("error: unrecognized argument");
    expect(err.join("\n")).not.toContain(secret);
  });

  it("requires all five mandatory flags", () => {
    const { io, err } = collectIo();
    const code = runStagingCli(["--evidence", "x"], io);
    expect(code).toBe(1);
    expect(err[0]).toContain("usage:");
  });

  it("has no --force flag at all", () => {
    const { io, err } = collectIo();
    const code = runStagingCli([...baseArgs(), "--force"], io);
    expect(code).toBe(1);
    expect(err[0]).toBe("error: unrecognized argument");
  });
});

describe("verifyPinnedHash / parseJsonBytes (unit)", () => {
  it("accepts matching bytes and rejects mismatched bytes", () => {
    const bytes = Buffer.from("hello");
    const hash = createHash("sha256").update(bytes).digest("hex");
    expect(() => verifyPinnedHash(bytes, hash, "mismatch")).not.toThrow();
    expect(() => verifyPinnedHash(bytes, "0".repeat(64), "mismatch")).toThrow(StagingError);
  });

  it("parses valid JSON and fails closed on malformed JSON, independent of hash verification", () => {
    const validBytes = Buffer.from('{"a":1}');
    expect(parseJsonBytes(validBytes)).toEqual({ a: 1 });

    const malformedBytes = Buffer.from("not json");
    // The bytes' own hash is used here so this exercises the JSON.parse failure path in
    // isolation from the (separately tested) hash-mismatch path, without weakening the CLI's
    // real pinned-hash default anywhere.
    const ownHash = createHash("sha256").update(malformedBytes).digest("hex");
    expect(() => verifyPinnedHash(malformedBytes, ownHash, "unused")).not.toThrow();
    expect(() => parseJsonBytes(malformedBytes)).toThrow(StagingError);
  });
});

describe("runStagingCli hash verification (fail closed per input)", () => {
  it("rejects a tampered evidence file without leaking its content", () => {
    const evidencePath = join(dir, "tampered-evidence.json");
    const secret = "SECRET_LABEL_SHOULD_NEVER_APPEAR";
    writeFileSync(evidencePath, JSON.stringify({ workbook_sha256: "x", note: secret }));
    const outputPath = join(dir, "out.json");
    const { io, err } = collectIo();
    const code = runStagingCli(baseArgs({ evidence: evidencePath, output: outputPath }), io);
    expect(code).toBe(1);
    expect(err[0]).toBe("error: exception evidence hash mismatch against pinned value");
    expect(err.join("\n")).not.toContain(secret);
    expect(existsSync(outputPath)).toBe(false);
  });

  it.runIf(canonicalGate)("rejects a tampered workbook file independently of the evidence/snapshot hash", () => {
    const workbookPath = join(dir, "tampered-workbook.xlsx");
    writeFileSync(workbookPath, "not the pinned workbook bytes");
    const outputPath = join(dir, "out.json");
    const { io, err } = collectIo();
    const code = runStagingCli(baseArgs({ workbook: workbookPath, output: outputPath }), io);
    expect(code).toBe(1);
    expect(err[0]).toBe("error: workbook hash mismatch against pinned value");
    expect(existsSync(outputPath)).toBe(false);
  });

  it.runIf(canonicalGate)("rejects a tampered production snapshot file independently of the workbook/evidence hash", () => {
    const snapshotPath = join(dir, "tampered-snapshot.jsonl");
    writeFileSync(snapshotPath, "not the pinned snapshot bytes");
    const outputPath = join(dir, "out.json");
    const { io, err } = collectIo();
    const code = runStagingCli(baseArgs({ snapshot: snapshotPath, output: outputPath }), io);
    expect(code).toBe(1);
    expect(err[0]).toBe("error: production snapshot hash mismatch against pinned value");
    expect(existsSync(outputPath)).toBe(false);
  });

  it("rejects a missing input file with a fixed message", () => {
    const outputPath = join(dir, "out.json");
    const { io, err } = collectIo();
    const code = runStagingCli(baseArgs({ workbook: join(dir, "does-not-exist.xlsx"), output: outputPath }), io);
    expect(code).toBe(1);
    expect(err[0]).toBe("error: unable to read a required input file");
    expect(existsSync(outputPath)).toBe(false);
  });
});

describe.runIf(canonicalGate)("runStagingCli against the canonical three pinned inputs", () => {
  it("hashes all three real files and writes an owner-only (0600) output file", () => {
    for (const p of [CANONICAL_EVIDENCE_PATH, CANONICAL_WORKBOOK_PATH, CANONICAL_SNAPSHOT_PATH]) {
      expect(existsSync(p)).toBe(true);
    }
    const outputPath = join(dir, "draft.json");
    const { io, out } = collectIo();
    const code = runStagingCli(baseArgs({ output: outputPath }), io);
    expect(code).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
    const mode = statSync(outputPath).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(out[0]).toContain("evidence_items=698");
    expect(out[0]).toContain("batch_rows=698");
    expect(out[0]).toContain("matched_invalid_calendar_quality_flags=2");
    expect(out[0]).toContain("workbook_sha256=");
    expect(out[0]).toContain("production_snapshot_sha256=");
  });

  it("refuses to write to an existing destination file (no overwrite, no --force)", () => {
    const outputPath = join(dir, "draft.json");
    writeFileSync(outputPath, "pre-existing");
    const { io, err } = collectIo();
    const code = runStagingCli(baseArgs({ output: outputPath }), io);
    expect(code).toBe(1);
    expect(err[0]).toBe("error: refusing to write: destination already exists or is not writable");
    expect(readFileSync(outputPath, "utf-8")).toBe("pre-existing");
  });

  it("refuses to write through a pre-existing symlink at the destination path", () => {
    const realTarget = join(dir, "elsewhere.json");
    writeFileSync(realTarget, "should never be touched");
    const symlinkPath = join(dir, "draft-link.json");
    symlinkSync(realTarget, symlinkPath);
    const { io, err } = collectIo();
    const code = runStagingCli(baseArgs({ output: symlinkPath }), io);
    expect(code).toBe(1);
    expect(err[0]).toBe("error: refusing to write: destination already exists or is not writable");
    expect(readFileSync(realTarget, "utf-8")).toBe("should never be touched");
  });

  it("refuses to write through a dangling symlink at the destination path", () => {
    const symlinkPath = join(dir, "dangling-link.json");
    symlinkSync(join(dir, "does-not-exist-target.json"), symlinkPath);
    const { io, err } = collectIo();
    const code = runStagingCli(baseArgs({ output: symlinkPath }), io);
    expect(code).toBe(1);
    expect(err[0]).toBe("error: refusing to write: destination already exists or is not writable");
    expect(existsSync(join(dir, "does-not-exist-target.json"))).toBe(false);
  });

  it("produces byte-identical output across two separate invocations", () => {
    const outputPathA = join(dir, "a.json");
    const outputPathB = join(dir, "b.json");
    const { io: ioA } = collectIo();
    const { io: ioB } = collectIo();
    expect(runStagingCli(baseArgs({ output: outputPathA }), ioA)).toBe(0);
    expect(runStagingCli(baseArgs({ output: outputPathB }), ioB)).toBe(0);
    expect(readFileSync(outputPathA, "utf-8")).toBe(readFileSync(outputPathB, "utf-8"));
  });

  it("never writes a private-shaped amount value into the output file", () => {
    const outputPath = join(dir, "draft.json");
    const { io } = collectIo();
    runStagingCli(baseArgs({ output: outputPath }), io);
    const contents = readFileSync(outputPath, "utf-8");
    expect(contents).not.toMatch(/\b\d+\.\d{2}\b/);
  });

  it("preserves the two 2024-02-30 date texts verbatim in the output file", () => {
    const outputPath = join(dir, "draft.json");
    const { io } = collectIo();
    runStagingCli(baseArgs({ output: outputPath }), io);
    const contents = readFileSync(outputPath, "utf-8");
    expect((contents.match(/2024-02-30/g) ?? []).length).toBe(2);
    expect((contents.match(/2024-02-28/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
