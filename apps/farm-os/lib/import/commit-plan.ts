/**
 * Pure commit orchestration for the import framework (spec §6 step 5). Turns validated
 * rows into an ordered list of gated-RPC calls, applies the descriptor's dedupe key, and
 * splits the calls into chunks for the background writer. No DB here — the server route
 * (`app/api/import`) executes these calls through the signed-in user's gated RPC path per row.
 */
import { getSourceRow, isValidationOnly, type ImportDescriptor } from "./types";

export interface RpcCall {
  rpc: string;
  args: Record<string, unknown>;
  sourceRow: number; // original 1-based spreadsheet data-row index
}

export interface CommitPlan {
  calls: RpcCall[]; // ordered, deduped
  skipped: { row: number; reason: string }[]; // duplicate rows dropped by dedupeKey
  chunks: RpcCall[][]; // `calls` split into chunkSize-sized batches
}

const DEFAULT_CHUNK = 500;
const KEY_SEP = "\u0001"; // unit separator — avoids cross-field key collisions

export function planCommit(
  descriptor: ImportDescriptor,
  okRows: Record<string, unknown>[],
  opts: { chunkSize?: number; matchedIds?: Map<number, string> } = {},
): CommitPlan {
  // LAST-DITCH GUARD. The route already refuses a commit for a validation-only descriptor before it
  // reads the upload, and the union type makes an rpc/toRpcArgs on one a compile error. This throws
  // anyway: a commit plan is the point of no return, so it must not be constructible from a
  // descriptor that has no write path — a future caller that skips the route gate gets an exception,
  // not a silently empty (or worse, half-built) plan.
  if (isValidationOnly(descriptor) || !descriptor.rpc || !descriptor.toRpcArgs) {
    throw new Error(`import descriptor "${descriptor.key}" has no commit path`);
  }
  const toRpcArgs = descriptor.toRpcArgs;
  const rpcName = descriptor.rpc;

  const chunkSize = opts.chunkSize && opts.chunkSize > 0 ? opts.chunkSize : DEFAULT_CHUNK;
  const dedupe = descriptor.dedupeKey ?? [];
  const matchedIds = opts.matchedIds ?? new Map<number, string>();

  const calls: RpcCall[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const seen = new Set<string>();

  okRows.forEach((row, i) => {
    const rowNum = getSourceRow(row, i + 1);
    if (dedupe.length > 0) {
      const key = dedupe.map((k) => String(row[k] ?? "")).join(KEY_SEP);
      if (seen.has(key)) {
        skipped.push({ row: rowNum, reason: "صف مكرر" });
        return;
      }
      seen.add(key);
    }
    calls.push({
      rpc: rpcName,
      args: toRpcArgs(row, matchedIds.get(rowNum) ?? null),
      sourceRow: rowNum,
    });
  });

  const chunks: RpcCall[][] = [];
  for (let i = 0; i < calls.length; i += chunkSize) {
    chunks.push(calls.slice(i, i + chunkSize));
  }

  return { calls, skipped, chunks };
}
