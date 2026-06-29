/**
 * Pure commit orchestration for the import framework (spec §6 step 5). Turns validated
 * rows into an ordered list of gated-RPC calls, applies the descriptor's dedupe key, and
 * splits the calls into chunks for the background writer. No DB here — the server route
 * (`app/api/import`) executes these calls through the user-session server client per row (RLS/role gates honored; service-role would bypass them).
 */
import type { ImportDescriptor } from "./types";

export interface RpcCall {
  rpc: string;
  args: Record<string, unknown>;
  sourceRow: number; // 1-based index within the validated (okRows) set
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
  opts: { chunkSize?: number } = {},
): CommitPlan {
  const chunkSize = opts.chunkSize && opts.chunkSize > 0 ? opts.chunkSize : DEFAULT_CHUNK;
  const dedupe = descriptor.dedupeKey ?? [];

  const calls: RpcCall[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const seen = new Set<string>();

  okRows.forEach((row, i) => {
    const rowNum = i + 1;
    if (dedupe.length > 0) {
      const key = dedupe.map((k) => String(row[k] ?? "")).join(KEY_SEP);
      if (seen.has(key)) {
        skipped.push({ row: rowNum, reason: "صف مكرر" });
        return;
      }
      seen.add(key);
    }
    calls.push({ rpc: descriptor.rpc, args: descriptor.toRpcArgs(row), sourceRow: rowNum });
  });

  const chunks: RpcCall[][] = [];
  for (let i = 0; i < calls.length; i += chunkSize) {
    chunks.push(calls.slice(i, i + chunkSize));
  }

  return { calls, skipped, chunks };
}
