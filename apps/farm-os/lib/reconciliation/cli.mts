import { chmodSync, closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalStringify } from "./canonical json.mts";
import { generateStagingDraft } from "./generator.mts";
import {
  EXPECTED_EXCEPTION_EVIDENCE_SHA256,
  EXPECTED_PRODUCTION_SNAPSHOT_SHA256,
  EXPECTED_WORKBOOK_SHA256,
} from "./pinned hashes.mts";
import { parseExceptionEvidence } from "./validate.mts";
import { StagingError } from "./types.mts";

const FILE_MODE = 0o600;

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

const defaultIo: CliIo = {
  stdout: (line: string) => process.stdout.write(`${line}\n`),
  stderr: (line: string) => process.stderr.write(`${line}\n`),
};

interface ParsedArgs {
  evidence: string;
  workbook: string;
  snapshot: string;
  orgId: string;
  output: string;
}

const KNOWN_FLAGS = new Set(["--evidence", "--workbook", "--snapshot", "--org-id", "--output"]);

/**
 * Bounded argument parser: exactly the five flags below, nothing else. No `--force`/overwrite
 * bypass, no arbitrary pass-through options, and no shell/network access anywhere in this
 * module. Error text is always a fixed constant -- the raw offending argument is never echoed,
 * since it is attacker-controlled input that could otherwise leak into stderr.
 */
function parseArgs(argv: string[]): ParsedArgs {
  const args: Partial<ParsedArgs> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!KNOWN_FLAGS.has(arg)) {
      throw new StagingError("unrecognized argument");
    }
    const value = argv[++i];
    if (value === undefined) {
      throw new StagingError("missing value for a required argument");
    }
    if (arg === "--evidence") args.evidence = value;
    else if (arg === "--workbook") args.workbook = value;
    else if (arg === "--snapshot") args.snapshot = value;
    else if (arg === "--org-id") args.orgId = value;
    else if (arg === "--output") args.output = value;
  }
  if (!args.evidence || !args.workbook || !args.snapshot || !args.orgId || !args.output) {
    throw new StagingError(
      "usage: --evidence <path> --workbook <path> --snapshot <path> --org-id <uuid> --output <path>",
    );
  }
  return args as ParsedArgs;
}

/** Hashes raw file bytes and fails closed (fixed message) on any mismatch against `expected`. */
export function verifyPinnedHash(bytes: Buffer, expected: string, message: string): void {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new StagingError(message);
  }
}

/** Strict JSON.parse wrapper with a fixed error message, isolated from hash verification. */
export function parseJsonBytes(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf-8"));
  } catch {
    throw new StagingError("exception evidence is not valid JSON");
  }
}

/**
 * Dry-run staging CLI: hashes the raw bytes of all three pinned trusted inputs (workbook,
 * production snapshot, exception evidence) and fails closed on any mismatch before reading
 * a single byte of business content from the workbook/snapshot -- only their SHA-256 is ever
 * computed, never their content parsed. Only the already-redacted exception-evidence JSON is
 * parsed and runtime-validated (see validate.ts), then used to generate Slice 1A draft rows,
 * written to a privacy-safe, atomically-created, owner-only (0600) output file that can never
 * overwrite an existing destination (including a pre-existing symlink). No DB write, no network
 * access, no financial write of any kind. Returns a process exit code.
 */
export function runStagingCli(argv: string[], io: CliIo = defaultIo): number {
  try {
    const args = parseArgs(argv);

    const workbookBytes = readFileOrFail(args.workbook);
    verifyPinnedHash(workbookBytes, EXPECTED_WORKBOOK_SHA256, "workbook hash mismatch against pinned value");

    const snapshotBytes = readFileOrFail(args.snapshot);
    verifyPinnedHash(
      snapshotBytes,
      EXPECTED_PRODUCTION_SNAPSHOT_SHA256,
      "production snapshot hash mismatch against pinned value",
    );

    const evidenceBytes = readFileOrFail(args.evidence);
    verifyPinnedHash(
      evidenceBytes,
      EXPECTED_EXCEPTION_EVIDENCE_SHA256,
      "exception evidence hash mismatch against pinned value",
    );

    const rawEvidence = parseJsonBytes(evidenceBytes);
    const evidence = parseExceptionEvidence(rawEvidence);
    const draft = generateStagingDraft(evidence, { orgId: args.orgId });

    writePrivateFile(args.output, canonicalStringify(draft));

    io.stdout(
      [
        `wrote ${args.output}`,
        `evidence_items=${draft.evidence_items.length}`,
        `batch_rows=${draft.batch_rows.length}`,
        `matched_invalid_calendar_quality_flags=${draft.matched_invalid_calendar_quality_flags.length}`,
        `workbook_sha256=${draft.batch.source_workbook_sha256}`,
        `production_snapshot_sha256=${draft.tool_metadata.production_snapshot_sha256}`,
      ].join(" "),
    );
    return 0;
  } catch (err) {
    if (err instanceof StagingError) {
      io.stderr(`error: ${err.message}`);
      return 1;
    }
    io.stderr("error: staging failed");
    return 1;
  }
}

function readFileOrFail(path: string): Buffer {
  try {
    return readFileSync(path);
  } catch {
    throw new StagingError("unable to read a required input file");
  }
}

/**
 * Atomic, no-clobber, owner-only write: O_CREAT | O_EXCL | O_WRONLY fails with EEXIST if the
 * destination already exists for any reason, including as a pre-existing (possibly dangling)
 * symlink -- the symlink itself is a directory entry, so open() never follows it into creating
 * or truncating whatever it points to. There is no separate existence check before the write
 * (no TOCTOU window) and no `--force`/overwrite bypass of any kind.
 */
function writePrivateFile(path: string, contents: string): void {
  let fd: number;
  try {
    fd = openSync(path, "wx", FILE_MODE);
  } catch {
    throw new StagingError("refusing to write: destination already exists or is not writable");
  }
  try {
    writeSync(fd, contents, null, "utf-8");
  } finally {
    closeSync(fd);
  }
  chmodSync(path, FILE_MODE); // belt-and-braces re-tighten against an unexpected umask
}
