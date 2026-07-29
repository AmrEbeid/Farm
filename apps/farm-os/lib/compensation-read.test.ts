import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ext";
import {
  COMPENSATION_OVERFLOW_AR,
  COMPENSATION_PEOPLE_FETCH,
  COMPENSATION_PEOPLE_MAX,
  COMPENSATION_PERSON_COLUMNS,
  COMPENSATION_READ_FAILED_AR,
  COMPENSATION_ROWS_FETCH,
  COMPENSATION_ROWS_MAX,
  COMPENSATION_ROW_COLUMNS,
  COMPENSATION_UNKNOWN_PERSON_AR,
  loadCompensationEditor,
} from "./compensation-read";

const ORG = "3f2a1c5e-9b7d-4e21-8a64-0c1d2e3f4a5b";
const PERSON_A = "11111111-2222-4333-8444-555555555555";
const PERSON_B = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const RETIRED = "99999999-8888-4777-8666-555555555555";

// ── A recording fake of the PostgREST builder chain (same shape as lib/payroll-report.test.ts), so
//    the tests can assert the exact contract each read honours: org filter, projection, bound.
interface Call {
  table: string;
  select?: string;
  eq: [string, unknown][];
  order: string[];
  limit?: number;
}

type Scripted = Record<string, { data: unknown; error: unknown }>;

function fakeClient(script: Scripted): { sb: SupabaseClient<Database>; calls: Call[] } {
  const calls: Call[] = [];

  const from = (table: string) => {
    const call: Call = { table, eq: [], order: [] };
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
      order(column: string) {
        call.order.push(column);
        return builder;
      },
      limit(count: number) {
        call.limit = count;
        return builder;
      },
      then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
        return Promise.resolve(result).then(resolve);
      },
    };
    return builder;
  };

  return { sb: { from } as unknown as SupabaseClient<Database>, calls };
}

const PEOPLE_ROWS = [
  { id: PERSON_A, name: "عامل أ", active: true },
  { id: PERSON_B, name: "  عامل ب  ", active: true },
];

const COMP_ROWS = [
  {
    id: "aaaaaaaa-1111-4222-8333-444444444444",
    person_id: PERSON_A,
    mode: "hourly",
    unit: null,
    rate: 25,
    contract_period_start: null,
    contract_period_end: null,
  },
  {
    id: "bbbbbbbb-1111-4222-8333-444444444444",
    person_id: PERSON_B,
    mode: "piece",
    unit: "box",
    rate: "5.50",
    contract_period_start: null,
    contract_period_end: null,
  },
];

const ok = (data: unknown) => ({ data, error: null });
const failed = { data: null, error: { code: "PGRST301", message: "boom" } };

const script = (overrides: Partial<Scripted> = {}): Scripted => ({
  people: ok(PEOPLE_ROWS),
  people_compensation: ok(COMP_ROWS),
  ...overrides,
});

function rowsOf(n: number, personId: string) {
  return Array.from({ length: n }, (_, i) => ({
    id: `cccccccc-1111-4222-8333-${String(i).padStart(12, "0")}`,
    person_id: personId,
    mode: "hourly",
    unit: null,
    rate: 10,
    contract_period_start: null,
    contract_period_end: null,
  }));
}

describe("compensation editor read — bounded, org-scoped contract", () => {
  it("scopes BOTH reads to the session org and bounds each at max + 1", async () => {
    const { sb, calls } = fakeClient(script());
    const load = await loadCompensationEditor(sb, ORG);
    expect(load.ok).toBe(true);

    const people = calls.find((c) => c.table === "people");
    const comp = calls.find((c) => c.table === "people_compensation");
    expect(people?.eq).toContainEqual(["org_id", ORG]);
    expect(people?.eq).not.toContainEqual(["active", true]);
    expect(people?.limit).toBe(COMPENSATION_PEOPLE_FETCH);
    expect(comp?.eq).toContainEqual(["org_id", ORG]);
    expect(comp?.limit).toBe(COMPENSATION_ROWS_FETCH);

    // The fetch bound is max + 1 precisely so an overflow is OBSERVABLE, not silently truncated.
    expect(COMPENSATION_PEOPLE_FETCH).toBe(COMPENSATION_PEOPLE_MAX + 1);
    expect(COMPENSATION_ROWS_FETCH).toBe(COMPENSATION_ROWS_MAX + 1);
  });

  it("issues exactly TWO queries regardless of how many rows come back — never N+1", async () => {
    const { sb, calls } = fakeClient(
      script({ people_compensation: ok(rowsOf(50, PERSON_A)) }),
    );
    const load = await loadCompensationEditor(sb, ORG);
    expect(load.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.table).sort()).toEqual(["people", "people_compensation"]);
  });

  it("selects identity and status only — no phone or email in either projection", async () => {
    const { sb, calls } = fakeClient(script());
    await loadCompensationEditor(sb, ORG);
    expect(COMPENSATION_PERSON_COLUMNS).toBe("id, name, active");
    for (const call of calls) {
      expect(call.select, call.table).not.toMatch(/phone|email/i);
    }
    expect(COMPENSATION_ROW_COLUMNS).not.toMatch(/phone|email/i);
  });

  it("reads the wage columns the editor needs, and no more", async () => {
    const { sb, calls } = fakeClient(script());
    await loadCompensationEditor(sb, ORG);
    const comp = calls.find((c) => c.table === "people_compensation");
    expect(comp?.select).toBe(COMPENSATION_ROW_COLUMNS);
    for (const column of [
      "mode",
      "unit",
      "rate",
      "contract_period_start",
      "contract_period_end",
    ]) {
      expect(COMPENSATION_ROW_COLUMNS, column).toContain(column);
    }
  });
});

describe("compensation editor read — fail closed", () => {
  it("refuses on a malformed org id, before any query is issued", async () => {
    for (const bad of ["", "org-1", "not-a-uuid"]) {
      const { sb, calls } = fakeClient(script());
      const load = await loadCompensationEditor(sb, bad);
      expect(load, bad).toEqual({ ok: false, error: COMPENSATION_READ_FAILED_AR });
      expect(calls, bad).toHaveLength(0);
    }
  });

  it("refuses the WHOLE editor when either read fails — never a half list", async () => {
    for (const table of ["people", "people_compensation"]) {
      const { sb } = fakeClient(script({ [table]: failed }));
      const load = await loadCompensationEditor(sb, ORG);
      expect(load, table).toEqual({ ok: false, error: COMPENSATION_READ_FAILED_AR });
    }
  });

  it("refuses on overflow rather than truncating — a dropped rate reads as 'no rate'", async () => {
    const overPeople = Array.from({ length: COMPENSATION_PEOPLE_FETCH }, (_, i) => ({
      id: `dddddddd-1111-4222-8333-${String(i).padStart(12, "0")}`,
      name: `عامل ${i}`,
      active: true,
    }));
    const { sb } = fakeClient(script({ people: ok(overPeople) }));
    expect(await loadCompensationEditor(sb, ORG)).toEqual({
      ok: false,
      error: COMPENSATION_OVERFLOW_AR,
    });

    const { sb: sb2 } = fakeClient(
      script({ people_compensation: ok(rowsOf(COMPENSATION_ROWS_FETCH, PERSON_A)) }),
    );
    expect(await loadCompensationEditor(sb2, ORG)).toEqual({
      ok: false,
      error: COMPENSATION_OVERFLOW_AR,
    });
  });

  it("accepts exactly the maximum", async () => {
    const { sb } = fakeClient(
      script({ people_compensation: ok(rowsOf(COMPENSATION_ROWS_MAX, PERSON_A)) }),
    );
    const load = await loadCompensationEditor(sb, ORG);
    expect(load.ok).toBe(true);
    if (load.ok) expect(load.rows).toHaveLength(COMPENSATION_ROWS_MAX);
  });

  it("treats an empty org as a legitimately empty editor, not a failure", async () => {
    const { sb } = fakeClient(script({ people: ok([]), people_compensation: ok([]) }));
    const load = await loadCompensationEditor(sb, ORG);
    expect(load).toEqual({ ok: true, people: [], rows: [] });
  });
});

describe("compensation editor read — the joined view", () => {
  it("resolves names in memory from the list already fetched", async () => {
    const { sb } = fakeClient(script());
    const load = await loadCompensationEditor(sb, ORG);
    expect(load.ok).toBe(true);
    if (!load.ok) return;
    expect(load.rows.map((row) => row.personName)).toEqual(["عامل أ", "عامل ب"]);
    expect(load.people.map((person) => person.name)).toEqual(["عامل أ", "عامل ب"]);
  });

  it("coerces the numeric rate and keeps the piece unit", async () => {
    const { sb } = fakeClient(script());
    const load = await loadCompensationEditor(sb, ORG);
    expect(load.ok).toBe(true);
    if (!load.ok) return;
    expect(load.rows[0]).toMatchObject({ mode: "hourly", unit: null, rate: 25 });
    expect(load.rows[1]).toMatchObject({ mode: "piece", unit: "box", rate: 5.5 });
  });

  it("names an inactive person's saved rate but excludes that person from new-rate options", async () => {
    const { sb } = fakeClient(
      script({
        people: ok([{ id: RETIRED, name: "عامل سابق", active: false }]),
        people_compensation: ok([{ ...COMP_ROWS[0], person_id: RETIRED }]),
      }),
    );
    const load = await loadCompensationEditor(sb, ORG);
    expect(load.ok).toBe(true);
    if (!load.ok) return;
    expect(load.rows).toHaveLength(1);
    expect(load.rows[0].personName).toBe("عامل سابق");
    expect(load.rows[0].personName).not.toContain(RETIRED);
    expect(load.people).toEqual([]);
  });

  it("uses the unknown label only for an orphaned compensation reference", async () => {
    const { sb } = fakeClient(
      script({
        people_compensation: ok([{ ...COMP_ROWS[0], person_id: RETIRED }]),
      }),
    );
    const load = await loadCompensationEditor(sb, ORG);
    expect(load.ok).toBe(true);
    if (!load.ok) return;
    expect(load.rows[0].personName).toBe(COMPENSATION_UNKNOWN_PERSON_AR);
  });
});
