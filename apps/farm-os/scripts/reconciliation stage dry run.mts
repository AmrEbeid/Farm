#!/usr/bin/env node
// Bounded dry-run CLI for accounting reconciliation Slice 2 (staging parser/validator).
//
// Usage:
//   node "scripts/reconciliation stage dry run.mts" \
//     --evidence "<path to trusted 'accounting exception evidence.json'>" \
//     --workbook "<path to the pinned canonical accounting workbook .xlsx>" \
//     --snapshot "<path to the pinned protected production accounting snapshot>" \
//     --org-id <uuid> \
//     --output <path>
//
// Hashes the raw bytes of all three pinned trusted inputs and fails closed on any mismatch
// before reading a single byte of business content from the workbook/snapshot -- only their
// SHA-256 is ever computed, never their content parsed. Only the already-redacted exception
// evidence JSON (produced read-only by the external accounting reconcile.py harness) is parsed
// and runtime-validated, then used to emit Slice 1A draft rows (reconciliation_batches /
// reconciliation_evidence_items / reconciliation_batch_rows shaped). No database write, no
// network access, no financial write of any kind -- this is a dry run only. The output file must
// not already exist (no overwrite flag). See apps/farm-os/lib/reconciliation for the pure
// implementation and tests.
import { runStagingCli } from "../lib/reconciliation/cli.mts";

process.exit(runStagingCli(process.argv.slice(2)));
