// R4b pass 1 — the payroll workspace / run detail parsers.
//
// These tests exist to prove the two things a component must never be trusted to do: refuse a
// payload that leaks who closed a run or a person's contact PII, and refuse a snapshot whose numbers
// do not reconcile with the frozen values behind them.

import { describe, expect, it } from "vitest";
import {
  PAYROLL_RUN_SNAPSHOT_VERSION,
  PAYROLL_WORKSPACE_SNAPSHOT_VERSION,
  parsePayrollRunSnapshot,
  parsePayrollWorkspaceSnapshot,
} from "./payroll-snapshot-reads";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const RUN_A = "22222222-2222-4222-8222-222222222221";
const RUN_B = "22222222-2222-4222-8222-222222222222";
const LINE_A = "33333333-3333-4333-8333-333333333331";
const LINE_B = "33333333-3333-4333-8333-333333333332";
const PERSON_A = "44444444-4444-4444-8444-444444444441";
const PERSON_B = "44444444-4444-4444-8444-444444444442";

type Row = Record<string, unknown>;

/** Clone a payload and replace one value at a dotted/indexed path, so a case edits ONE fact. */
function withPath(base: Row, path: string, value: unknown): Row {
  const clone = structuredClone(base) as Row;
  const keys = path.split(".");
  let node: Record<string, unknown> = clone;
  for (const key of keys.slice(0, -1)) {
    node = node[key] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
  return clone;
}

function withoutKey(base: Row, path: string): Row {
  const clone = structuredClone(base) as Row;
  const keys = path.split(".");
  let node: Record<string, unknown> = clone;
  for (const key of keys.slice(0, -1)) {
    node = node[key] as Record<string, unknown>;
  }
  delete node[keys[keys.length - 1]];
  return clone;
}

// ── workspace fixtures ────────────────────────────────────────────────────────────────────────

function workspaceSnapshot(): Row {
  return {
    version: PAYROLL_WORKSPACE_SNAPSHOT_VERSION,
    org_id: ORG,
    limit: 20,
    offset: 0,
    authority: { payroll: "partial" },
    counts: { total_runs: "2" },
    totals: { total_gross: "400" },
    rows: [
      {
        run_id: RUN_B, period_start: "2026-01-16", period_end: "2026-01-31",
        closed_at: "2026-02-01T09:00:00+00:00", total_gross: "100", line_count: "1",
      },
      {
        run_id: RUN_A, period_start: "2026-01-01", period_end: "2026-01-15",
        closed_at: "2026-01-16T09:00:00+00:00", total_gross: "300", line_count: "2",
      },
    ],
  };
}

function parseWorkspace(value: unknown) {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
  return parsePayrollWorkspaceSnapshot(value, {
    orgId: ORG,
    limit: Number.isInteger(row.limit) ? (row.limit as number) : 20,
    offset: Number.isInteger(row.offset) ? (row.offset as number) : 0,
  });
}

// ── run fixtures ──────────────────────────────────────────────────────────────────────────────

function runSnapshot(): Row {
  return {
    version: PAYROLL_RUN_SNAPSHOT_VERSION,
    org_id: ORG,
    run_id: RUN_A,
    period_start: "2026-01-01",
    period_end: "2026-01-15",
    closed_at: "2026-01-16T09:00:00+00:00",
    total_gross: "300",
    limit: 20,
    offset: 0,
    counts: { total_lines: "2" },
    rows: [
      {
        line_id: LINE_A, person_id: PERSON_A, person_name: "Person A",
        mode: "hourly", unit: null, quantity: "20", rate: "10", gross: "200",
      },
      {
        line_id: LINE_B, person_id: PERSON_B, person_name: "Person B",
        mode: "daily", unit: null, quantity: "2", rate: "50", gross: "100",
      },
    ],
  };
}

function parseRun(value: unknown) {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
  return parsePayrollRunSnapshot(value, {
    orgId: ORG,
    runId: RUN_A,
    limit: Number.isInteger(row.limit) ? (row.limit as number) : 20,
    offset: Number.isInteger(row.offset) ? (row.offset as number) : 0,
  });
}

describe("parsePayrollWorkspaceSnapshot", () => {
  it("parses a well-formed workspace snapshot", () => {
    const parsed = parseWorkspace(workspaceSnapshot());
    expect(parsed.counts.totalRuns).toBe("2");
    expect(parsed.totals.totalGross).toBe("400");
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].runId).toBe(RUN_B);
  });

  it("throws when the version is not the pinned one", () => {
    expect(() => parseWorkspace(withPath(workspaceSnapshot(), "version", "farm-os.payroll-workspace.v0")))
      .toThrow(/version mismatch/);
  });

  it("throws when the organization does not match the caller's own request", () => {
    expect(() => parseWorkspace(withPath(workspaceSnapshot(), "org_id", OTHER_ORG)))
      .toThrow(/organization mismatch/);
  });

  it("throws when the reported limit does not match what was actually requested", () => {
    const payload = withPath(workspaceSnapshot(), "limit", 5);
    expect(() => parsePayrollWorkspaceSnapshot(payload, { orgId: ORG, limit: 20, offset: 0 }))
      .toThrow(/request arguments mismatch/);
  });

  it("rejects a root with an unexpected key", () => {
    expect(() => parseWorkspace({ ...workspaceSnapshot(), extra: 1 })).toThrow(/unexpected keys/);
  });

  it("rejects closed_by anywhere in the payload, however deeply nested", () => {
    const payload = workspaceSnapshot();
    (payload.rows as Row[])[0].closed_by = "sneaky-uuid";
    expect(() => parseWorkspace(payload)).toThrow(/closed_by/);
  });

  it("rejects a duplicated run id", () => {
    const payload = workspaceSnapshot();
    const rows = payload.rows as Row[];
    rows[1] = { ...rows[0] };
    expect(() => parseWorkspace(payload)).toThrow(/must not repeat/);
  });

  it("rejects a page whose length does not match the exact total, limit and offset", () => {
    const payload = withPath(workspaceSnapshot(), "counts.total_runs", "5");
    expect(() => parseWorkspace(payload)).toThrow(/does not match its exact total/);
  });

  it("rejects rows that are not ordered most recently closed first", () => {
    const payload = workspaceSnapshot();
    const rows = payload.rows as Row[];
    [rows[0], rows[1]] = [rows[1], rows[0]];
    expect(() => parseWorkspace(payload)).toThrow(/not ordered most recently closed first/);
  });

  it("rejects a non-exact count", () => {
    expect(() => parseWorkspace(withPath(workspaceSnapshot(), "counts.total_runs", "2.0")))
      .toThrow(/exact count text/);
  });

  it("rejects a non-decimal total_gross", () => {
    expect(() => parseWorkspace(withPath(workspaceSnapshot(), "totals.total_gross", "abc")))
      .toThrow(/decimal text/);
  });

  it("rejects an unknown authority status", () => {
    expect(() => parseWorkspace(withPath(workspaceSnapshot(), "authority.payroll", "made_up")))
      .toThrow(/invalid authority status/);
  });

  it("rejects a row missing a required key", () => {
    expect(() => parseWorkspace(withoutKey(workspaceSnapshot(), "rows.0.line_count")))
      .toThrow(/line_count must be text/);
  });

  it("rejects a closed_at that is not a real parseable timestamp", () => {
    expect(() => parseWorkspace(withPath(workspaceSnapshot(), "rows.0.closed_at", "not-a-timestamp")))
      .toThrow(/closed_at must be a parseable timestamp/);
  });
});

describe("parsePayrollRunSnapshot", () => {
  it("parses a well-formed run snapshot", () => {
    const parsed = parseRun(runSnapshot());
    expect(parsed).not.toBeNull();
    expect(parsed?.totalGross).toBe("300");
    expect(parsed?.rows).toHaveLength(2);
    expect(parsed?.rows[0].personName).toBe("Person A");
  });

  it("returns null for a null payload — a cross-org or missing run reads the same", () => {
    expect(parseRun(null)).toBeNull();
  });

  it("throws when the run id does not match the caller's own request", () => {
    expect(() => parseRun(withPath(runSnapshot(), "run_id", RUN_B))).toThrow(/run mismatch/);
  });

  it("throws when the organization does not match the caller's own request", () => {
    expect(() => parseRun(withPath(runSnapshot(), "org_id", OTHER_ORG))).toThrow(/organization mismatch/);
  });

  it("rejects closed_by anywhere in the payload", () => {
    const payload = { ...runSnapshot(), closed_by: "sneaky-uuid" };
    expect(() => parseRun(payload)).toThrow(/closed_by/);
  });

  it("rejects phone or email anywhere in the payload", () => {
    const payload = runSnapshot();
    (payload.rows as Row[])[0].phone = "0100000000";
    expect(() => parseRun(payload)).toThrow(/phone/);
  });

  it("rejects an unknown wage mode", () => {
    expect(() => parseRun(withPath(runSnapshot(), "rows.0.mode", "yearly")))
      .toThrow(/unknown recorded wage mode/);
  });

  it("rejects an unknown piece unit", () => {
    expect(() => parseRun(withPath(runSnapshot(), "rows.0.unit", "sack")))
      .toThrow(/unknown recorded piece unit/);
  });

  it("rejects a piece line with no unit", () => {
    expect(() => parseRun(withPath(runSnapshot(), "rows.0.mode", "piece")))
      .toThrow(/mode and its unit disagree/);
  });

  it("rejects a non-piece line carrying a unit", () => {
    const payload = withPath(runSnapshot(), "rows.1.mode", "piece");
    (payload.rows as Row[])[1].unit = "box";
    (payload.rows as Row[])[1].mode = "hourly";
    expect(() => parseRun(payload)).toThrow(/mode and its unit disagree/);
  });

  it("rejects a line whose gross does not reconcile with quantity times rate", () => {
    expect(() => parseRun(withPath(runSnapshot(), "rows.0.gross", "999")))
      .toThrow(/gross does not reconcile/);
  });

  it("rejects a page whose length does not match its exact total, limit and offset", () => {
    expect(() => parseRun(withPath(runSnapshot(), "counts.total_lines", "5")))
      .toThrow(/does not match its exact total/);
  });

  it("rejects a duplicated line id", () => {
    const payload = runSnapshot();
    const rows = payload.rows as Row[];
    rows[1] = { ...rows[0] };
    expect(() => parseRun(payload)).toThrow(/must not repeat/);
  });

  it("rejects a run whose total_gross does not reconcile with its own lines when the whole run is in hand", () => {
    expect(() => parseRun(withPath(runSnapshot(), "total_gross", "999")))
      .toThrow(/total_gross does not reconcile/);
  });

  it("does not demand reconciliation when only a bounded page of a larger run is in hand", () => {
    // 5 recorded lines total, but only a 2-line page is in hand (matches expectedPageLength(5,2,0)).
    // total_gross is deliberately set so it would NOT reconcile with just these two lines — proving
    // the mismatch is not what's being checked, because a genuine partial page must never trip it.
    const payload = {
      ...runSnapshot(),
      total_gross: "999",
      counts: { total_lines: "5" },
      limit: 2,
      offset: 0,
    };
    expect(parsePayrollRunSnapshot(payload, { orgId: ORG, runId: RUN_A, limit: 2, offset: 0 })).not.toBeNull();
  });

  it("never demands reconciliation of a partial page even when the exact total exceeds Number.MAX_SAFE_INTEGER", () => {
    // The "is this a full page?" compare stays in BigInt space, so an exact total this large is
    // correctly read as "not a full page" (limit is always <= 50) and reconciliation is skipped —
    // proving the compare never widens the count through Number on its way there.
    const huge = "90071992547409930000000000";
    const payload = {
      ...runSnapshot(),
      total_gross: "999",
      counts: { total_lines: huge },
      limit: 2,
      offset: 0,
    };
    expect(parsePayrollRunSnapshot(payload, { orgId: ORG, runId: RUN_A, limit: 2, offset: 0 }))
      .not.toBeNull();
  });

  it("rejects a root with an unexpected key", () => {
    expect(() => parseRun({ ...runSnapshot(), extra: 1 })).toThrow(/unexpected keys/);
  });

  it("rejects an invalid period where start is after end", () => {
    const payload = withPath(runSnapshot(), "period_start", "2026-01-20");
    expect(() => parseRun(payload)).toThrow(/period_start is after period_end/);
  });

  it("rejects a non-exact total_lines count", () => {
    expect(() => parseRun(withPath(runSnapshot(), "counts.total_lines", "2.5")))
      .toThrow(/exact count text/);
  });

  it("rejects a closed_at that is not a real parseable timestamp", () => {
    expect(() => parseRun(withPath(runSnapshot(), "closed_at", "not-a-timestamp")))
      .toThrow(/closed_at must be a parseable timestamp/);
  });
});
