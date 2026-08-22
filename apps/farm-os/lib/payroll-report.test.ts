import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ext";
import {
  PAYROLL_HISTORY_LINE_FETCH,
  PAYROLL_HISTORY_LINE_MAX,
  PAYROLL_LINE_COLUMNS,
  PAYROLL_PERSON_COLUMNS,
  PAYROLL_RUN_COLUMNS,
  PAYROLL_RUN_HISTORY_LIMIT,
  PAYROLL_RUN_LINES_FETCH,
  PAYROLL_RUN_LINES_MAX,
  PAYROLL_UNKNOWN_LABEL_AR,
  loadPayrollRunDetail,
  loadPayrollRunHistory,
  payrollModeLabel,
  payrollQuantityUnitLabel,
} from "./payroll-report";

const ORG = "3f2a1c5e-9b7d-4e21-8a64-0c1d2e3f4a5b";
const OTHER_ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const RUN = "7c9e6b41-2d38-4f0a-9e5c-1b2a3d4e5f60";
const PERSON_A = "11111111-2222-4333-8444-555555555555";
const PERSON_B = "66666666-7777-4888-8999-aaaaaaaaaaaa";

// ── A recording fake of the PostgREST builder chain. Every call is captured so the tests can assert
//    the exact contract each read is supposed to honour (org filter, projection, bound), and each
//    table is scripted with its own { data, error }. Synthetic values only.
interface Call {
  table: string;
  select?: string;
  eq: [string, unknown][];
  in: [string, unknown[]][];
  order: string[];
  limit?: number;
  terminal: "maybeSingle" | "await";
}

type Scripted = Record<string, { data: unknown; error: unknown }>;

function fakeClient(script: Scripted): { sb: SupabaseClient<Database>; calls: Call[] } {
  const calls: Call[] = [];

  const from = (table: string) => {
    const call: Call = { table, eq: [], in: [], order: [], terminal: "await" };
    calls.push(call);
    const result = script[table] ?? { data: null, error: { code: "PGRST000" } };

    const builder = {
      select(columns: string) {
        call.select = columns;
        return builder;
      },
      eq(column: string, value: unknown) {
        call.eq.push([column, value]);
        return builder;
      },
      in(column: string, values: unknown[]) {
        call.in.push([column, values]);
        return builder;
      },
      order(column: string) {
        call.order.push(column);
        return builder;
      },
      limit(count: number) {
        call.limit = count;
        return builder;
      },
      maybeSingle() {
        call.terminal = "maybeSingle";
        const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
        return Promise.resolve({ data, error: result.error });
      },
      then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
        return Promise.resolve(result).then(resolve);
      },
    };
    return builder;
  };

  return { sb: { from } as unknown as SupabaseClient<Database>, calls };
}

const RUN_ROW = {
  id: RUN,
  period_start: "2026-06-01",
  period_end: "2026-06-30",
  closed_at: "2026-07-01T06:00:00.000Z",
  total_gross: 1250.5,
};

const LINE_ROWS = [
  { person_id: PERSON_A, mode: "hourly", unit: null, quantity: 40, rate: 25, gross: 1000 },
  { person_id: PERSON_B, mode: "piece", unit: "box", quantity: 50.5, rate: 5, gross: 252.5 },
];

const PERSON_ROWS = [
  { id: PERSON_A, name: "عامل أ" },
  { id: PERSON_B, name: "عامل ب" },
];

const ok = (data: unknown) => ({ data, error: null });
const failed = { data: null, error: { code: "PGRST301", message: "boom" } };

function detailScript(overrides: Partial<Scripted> = {}): Scripted {
  return {
    payroll_runs: ok([RUN_ROW]),
    payroll_run_lines: ok(LINE_ROWS),
    people: ok(PERSON_ROWS),
    ...overrides,
  };
}

describe("payroll run detail — bounded, org-scoped read contract", () => {
  it("scopes every query to the session org and bounds the two list reads", async () => {
    const { sb, calls } = fakeClient(detailScript());
    const load = await loadPayrollRunDetail(sb, RUN, ORG);
    expect(load.ok).toBe(true);

    expect(calls.map((c) => c.table)).toEqual(["payroll_runs", "payroll_run_lines", "people"]);
    for (const call of calls) {
      expect(call.eq.some(([column, value]) => column === "org_id" && value === ORG), call.table).toBe(true);
    }

    const [run, lines, people] = calls;
    expect(run.select).toBe(PAYROLL_RUN_COLUMNS);
    expect(run.eq).toContainEqual(["id", RUN]);
    expect(run.terminal).toBe("maybeSingle");

    expect(lines.select).toBe(PAYROLL_LINE_COLUMNS);
    expect(lines.eq).toContainEqual(["run_id", RUN]);
    // LIMIT = max + 1 is what makes an overflow observable rather than a silent truncation.
    expect(lines.limit).toBe(PAYROLL_RUN_LINES_FETCH);
    expect(PAYROLL_RUN_LINES_FETCH).toBe(PAYROLL_RUN_LINES_MAX + 1);

    expect(people.select).toBe(PAYROLL_PERSON_COLUMNS);
    expect(people.limit).toBe(PAYROLL_RUN_LINES_FETCH);
  });

  it("resolves names in ONE query keyed on the distinct ids, never one per line", async () => {
    const repeated = [
      ...LINE_ROWS,
      { person_id: PERSON_A, mode: "daily", unit: null, quantity: 3, rate: 200, gross: 600 },
    ];
    const { sb, calls } = fakeClient(detailScript({ payroll_run_lines: ok(repeated) }));
    await loadPayrollRunDetail(sb, RUN, ORG);

    expect(calls.filter((c) => c.table === "people")).toHaveLength(1);
    expect(calls.find((c) => c.table === "people")?.in).toEqual([["id", [PERSON_A, PERSON_B]]]);
  });

  it("never selects contact PII", async () => {
    const { sb, calls } = fakeClient(detailScript());
    await loadPayrollRunDetail(sb, RUN, ORG);
    for (const call of calls) {
      expect(call.select ?? "").not.toMatch(/phone|email/i);
    }
  });

  it("returns the frozen snapshot values as stored", async () => {
    const { sb } = fakeClient(detailScript());
    const load = await loadPayrollRunDetail(sb, RUN, ORG);
    expect(load.ok).toBe(true);
    if (!load.ok) return;

    expect(load.run).toEqual({
      id: RUN,
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      closedAt: "2026-07-01T06:00:00.000Z",
      totalGross: 1250.5,
    });
    expect(load.lines).toEqual([
      {
        personId: PERSON_A,
        personName: "عامل أ",
        mode: "hourly",
        unit: null,
        quantity: 40,
        rate: 25,
        gross: 1000,
      },
      {
        personId: PERSON_B,
        personName: "عامل ب",
        mode: "piece",
        unit: "box",
        quantity: 50.5,
        rate: 5,
        gross: 252.5,
      },
    ]);
  });

  it("labels an unresolved name rather than printing a raw id", async () => {
    const { sb } = fakeClient(detailScript({ people: ok([{ id: PERSON_A, name: "عامل أ" }]) }));
    const load = await loadPayrollRunDetail(sb, RUN, ORG);
    expect(load.ok && load.lines[1].personName).toBe(PAYROLL_UNKNOWN_LABEL_AR);
    expect(load.ok && load.lines[1].personName).not.toContain(PERSON_B);
  });
});

describe("payroll run detail — fail-closed", () => {
  it("never reaches the database with a malformed run id", async () => {
    const { sb, calls } = fakeClient(detailScript());
    for (const bad of ["", "not-a-uuid", `${RUN}/../x`, "1234"]) {
      expect(await loadPayrollRunDetail(sb, bad, ORG)).toEqual({ ok: false, kind: "not_found" });
    }
    expect(calls).toHaveLength(0);
  });

  it("treats a malformed org id as a read failure, not as a missing run", async () => {
    const { sb, calls } = fakeClient(detailScript());
    const load = await loadPayrollRunDetail(sb, RUN, "nope");
    expect(load.ok).toBe(false);
    expect(!load.ok && load.kind).toBe("read_failed");
    expect(calls).toHaveLength(0);
  });

  it("404s a run that is missing or belongs to another org", async () => {
    const { sb } = fakeClient(detailScript({ payroll_runs: ok([]) }));
    expect(await loadPayrollRunDetail(sb, RUN, OTHER_ORG)).toEqual({ ok: false, kind: "not_found" });
  });

  it("refuses — with no figures — when any of the three reads fails", async () => {
    for (const table of ["payroll_runs", "payroll_run_lines", "people"]) {
      const { sb } = fakeClient(detailScript({ [table]: failed }));
      const load = await loadPayrollRunDetail(sb, RUN, ORG);
      expect(load.ok, table).toBe(false);
      expect(!load.ok && load.kind, table).toBe("read_failed");
      expect(load).not.toHaveProperty("lines");
    }
  });

  it("refuses an over-large run instead of rendering a truncated wage bill", async () => {
    const many = Array.from({ length: PAYROLL_RUN_LINES_FETCH }, (_, index) => ({
      person_id: PERSON_A,
      mode: "hourly",
      unit: null,
      quantity: index + 1,
      rate: 1,
      gross: index + 1,
    }));
    const { sb } = fakeClient(detailScript({ payroll_run_lines: ok(many) }));
    const load = await loadPayrollRunDetail(sb, RUN, ORG);
    expect(load.ok).toBe(false);
    expect(!load.ok && load.kind).toBe("overflow");
    expect(load).not.toHaveProperty("lines");
  });

  it("accepts a run sitting exactly on the bound", async () => {
    const many = Array.from({ length: PAYROLL_RUN_LINES_MAX }, (_, index) => ({
      person_id: PERSON_A,
      mode: "hourly",
      unit: null,
      quantity: index + 1,
      rate: 1,
      gross: index + 1,
    }));
    const { sb } = fakeClient(detailScript({ payroll_run_lines: ok(many) }));
    const load = await loadPayrollRunDetail(sb, RUN, ORG);
    expect(load.ok && load.lines).toHaveLength(PAYROLL_RUN_LINES_MAX);
  });

  it("refuses a run whose lines read back empty (the RPC never writes one)", async () => {
    const { sb } = fakeClient(detailScript({ payroll_run_lines: ok([]) }));
    const load = await loadPayrollRunDetail(sb, RUN, ORG);
    expect(load.ok).toBe(false);
    expect(!load.ok && load.kind).toBe("empty");
  });
});

describe("payroll history — bounded, org-scoped, no N+1", () => {
  const RUNS = [
    RUN_ROW,
    { ...RUN_ROW, id: PERSON_A, period_start: "2026-05-01", period_end: "2026-05-31" },
  ];

  it("bounds the run list and counts lines in ONE extra query", async () => {
    const { sb, calls } = fakeClient({
      payroll_runs: ok(RUNS),
      payroll_run_lines: ok([{ run_id: RUN }, { run_id: RUN }, { run_id: PERSON_A }]),
    });
    const load = await loadPayrollRunHistory(sb, ORG);
    expect(load.ok).toBe(true);
    expect(load.ok && load.runs.map((run) => run.lineCount)).toEqual([2, 1]);

    expect(calls).toHaveLength(2);
    expect(calls[0].select).toBe(PAYROLL_RUN_COLUMNS);
    expect(calls[0].eq).toContainEqual(["org_id", ORG]);
    expect(calls[0].limit).toBe(PAYROLL_RUN_HISTORY_LIMIT);
    expect(PAYROLL_RUN_HISTORY_LIMIT).toBe(20);

    expect(calls[1].table).toBe("payroll_run_lines");
    expect(calls[1].select).toBe("run_id");
    expect(calls[1].eq).toContainEqual(["org_id", ORG]);
    expect(calls[1].in).toEqual([["run_id", [RUN, PERSON_A]]]);
    expect(calls[1].limit).toBe(PAYROLL_HISTORY_LINE_FETCH);
  });

  it("skips the counting query entirely when there are no runs", async () => {
    const { sb, calls } = fakeClient({ payroll_runs: ok([]) });
    expect(await loadPayrollRunHistory(sb, ORG)).toEqual({ ok: true, runs: [] });
    expect(calls).toHaveLength(1);
  });

  it("reports an unknown count rather than a wrong one when the count query overflows", async () => {
    const overflowing = Array.from({ length: PAYROLL_HISTORY_LINE_FETCH }, () => ({ run_id: RUN }));
    const { sb } = fakeClient({ payroll_runs: ok(RUNS), payroll_run_lines: ok(overflowing) });
    const load = await loadPayrollRunHistory(sb, ORG);
    expect(load.ok && load.runs.map((run) => run.lineCount)).toEqual([null, null]);
    expect(PAYROLL_HISTORY_LINE_FETCH).toBe(PAYROLL_HISTORY_LINE_MAX + 1);
  });

  it("keeps the runs but drops the counts when the count query fails", async () => {
    const { sb } = fakeClient({ payroll_runs: ok(RUNS), payroll_run_lines: failed });
    const load = await loadPayrollRunHistory(sb, ORG);
    expect(load.ok).toBe(true);
    expect(load.ok && load.runs.map((run) => run.lineCount)).toEqual([null, null]);
    expect(load.ok && load.runs[0].totalGross).toBe(1250.5);
  });

  it("refuses the whole history when the run read fails or the org id is malformed", async () => {
    const { sb } = fakeClient({ payroll_runs: failed });
    expect((await loadPayrollRunHistory(sb, ORG)).ok).toBe(false);

    const { sb: sb2, calls } = fakeClient({ payroll_runs: ok(RUNS) });
    expect((await loadPayrollRunHistory(sb2, "nope")).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("payroll labels", () => {
  it("names every stored mode in Arabic", () => {
    expect(payrollModeLabel("hourly")).toBe("بالساعة");
    expect(payrollModeLabel("daily")).toBe("باليوم");
    expect(payrollModeLabel("piece")).toBe("بالقطعة");
    expect(payrollModeLabel("seasonal")).toBe("موسمي");
    expect(payrollModeLabel("something-new")).toBe(PAYROLL_UNKNOWN_LABEL_AR);
  });

  it("names the unit a line's quantity is measured in", () => {
    expect(payrollQuantityUnitLabel("hourly", null)).toBe("ساعة");
    expect(payrollQuantityUnitLabel("daily", null)).toBe("يوم");
    expect(payrollQuantityUnitLabel("seasonal", null)).toBe("فترة");
    expect(payrollQuantityUnitLabel("piece", "tree")).toBe("نخلة");
    expect(payrollQuantityUnitLabel("piece", "kg")).toBe("كيلوجرام");
    // A piece line with no unit is impossible in the schema; it still must not render blank.
    expect(payrollQuantityUnitLabel("piece", null)).toBe(PAYROLL_UNKNOWN_LABEL_AR);
    expect(payrollQuantityUnitLabel("piece", "furlong")).toBe(PAYROLL_UNKNOWN_LABEL_AR);
  });
});
