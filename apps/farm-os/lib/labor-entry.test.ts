import { describe, it, expect } from "vitest";
import {
  LABOR_DATE_FUTURE_AR,
  LABOR_DATE_INVALID_AR,
  LABOR_HOURS_AR,
  LABOR_HOURS_MAX,
  LABOR_MODES,
  LABOR_MODE_AR,
  LABOR_MODE_INVALID_AR,
  LABOR_NOTE_MAX,
  LABOR_NOTE_TOO_LONG_AR,
  LABOR_PERSON_INVALID_AR,
  LABOR_PIECE_ONLY_AR,
  LABOR_QUANTITY_AR,
  LABOR_QUANTITY_MAX,
  LABOR_TEAM_NAME_MAX,
  LABOR_TEAM_TOO_LONG_AR,
  LABOR_UNASSIGNED_TEAM_WARNING_AR,
  LABOR_UNITS,
  LABOR_UNIT_AR,
  LABOR_UNIT_REQUIRED_AR,
  LABOR_UNKNOWN_LABEL_AR,
  LABOR_WHO_BOTH_AR,
  LABOR_WHO_REQUIRED_AR,
  LABOR_WRITE_MESSAGE_AR,
  classifyLaborWriteError,
  laborModeLabel,
  laborUnitLabel,
  laborWriteFailure,
  parseLaborLogInput,
} from "./labor-entry";
import { WAGE_MODE_AR, WAGE_UNIT_AR } from "./wage-modes";
import { PAYROLL_MODE_AR, PAYROLL_UNIT_AR } from "./payroll-report";

const PERSON = "11111111-2222-4333-8444-555555555555";
/** Fixed "now" so every date rule below is deterministic. Cairo is UTC+2/+3, never behind UTC. */
const NOW = new Date("2026-06-15T09:00:00.000Z");

function entry(overrides: Record<string, unknown> = {}) {
  return {
    personId: PERSON,
    teamName: null,
    mode: "hourly",
    workDate: "2026-06-10",
    hours: 8,
    quantity: null,
    unit: null,
    note: null,
    ...overrides,
  };
}

const parse = (overrides: Record<string, unknown> = {}) => parseLaborLogInput(entry(overrides), NOW);

describe("labor entry — who is being logged", () => {
  it("requires exactly one of a person or a free-text team", () => {
    expect(parse({ personId: null, teamName: null })).toEqual({
      ok: false,
      error: LABOR_WHO_REQUIRED_AR,
    });
    expect(parse({ personId: PERSON, teamName: "فريق الحصاد" })).toEqual({
      ok: false,
      error: LABOR_WHO_BOTH_AR,
    });
  });

  it("accepts a free-text team on its own", () => {
    const result = parse({ personId: null, teamName: "  فريق الحصاد  " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.teamName).toBe("فريق الحصاد");
    expect(result.value.personId).toBeNull();
  });

  it("rejects a person id that is not even id-shaped", () => {
    expect(parse({ personId: "person-1" })).toEqual({ ok: false, error: LABOR_PERSON_INVALID_AR });
    expect(parse({ personId: "'; drop table people; --" })).toEqual({
      ok: false,
      error: LABOR_PERSON_INVALID_AR,
    });
  });

  it("bounds the free-text team name and the note", () => {
    expect(parse({ personId: null, teamName: "ف".repeat(LABOR_TEAM_NAME_MAX + 1) })).toEqual({
      ok: false,
      error: LABOR_TEAM_TOO_LONG_AR,
    });
    expect(parse({ note: "م".repeat(LABOR_NOTE_MAX + 1) })).toEqual({
      ok: false,
      error: LABOR_NOTE_TOO_LONG_AR,
    });
  });

  it("rejects a non-object payload outright", () => {
    for (const bad of [null, undefined, 42, "hourly", [], [entry()]]) {
      expect(parseLaborLogInput(bad, NOW).ok, String(bad)).toBe(false);
    }
  });
});

describe("labor entry — dates are strict, real and never in the future", () => {
  it("rejects anything that is not a real YYYY-MM-DD calendar day", () => {
    for (const bad of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-6-10", "10/06/2026", "", 20260610]) {
      expect(parse({ workDate: bad }), String(bad)).toEqual({
        ok: false,
        error: LABOR_DATE_INVALID_AR,
      });
    }
    // A real leap day is accepted — the rule is "impossible dates", not "February".
    expect(parse({ workDate: "2024-02-29" }).ok).toBe(true);
  });

  it("rejects a future day and accepts today and the past", () => {
    expect(parse({ workDate: "2026-06-16" })).toEqual({ ok: false, error: LABOR_DATE_FUTURE_AR });
    expect(parse({ workDate: "2026-06-15" }).ok).toBe(true);
    expect(parse({ workDate: "2020-01-01" }).ok).toBe(true);
  });

  it("uses the CAIRO day, not the server's UTC day", () => {
    // 2026-06-15T22:30Z is already 2026-06-16 in Cairo (UTC+3 in summer), so that day is not future.
    const lateEvening = new Date("2026-06-15T22:30:00.000Z");
    expect(parseLaborLogInput(entry({ workDate: "2026-06-16" }), lateEvening).ok).toBe(true);
  });
});

describe("labor entry — hours are required attendance evidence for EVERY mode", () => {
  it("requires a positive, bounded number of hours in all four modes", () => {
    for (const mode of LABOR_MODES) {
      const piece = mode === "piece" ? { quantity: 12, unit: "box" } : {};
      expect(parse({ mode, hours: 0, ...piece }), mode).toEqual({ ok: false, error: LABOR_HOURS_AR });
      expect(parse({ mode, hours: -1, ...piece }), mode).toEqual({ ok: false, error: LABOR_HOURS_AR });
      expect(parse({ mode, hours: null, ...piece }), mode).toEqual({ ok: false, error: LABOR_HOURS_AR });
      expect(parse({ mode, hours: "", ...piece }), mode).toEqual({ ok: false, error: LABOR_HOURS_AR });
      expect(parse({ mode, hours: "abc", ...piece }), mode).toEqual({ ok: false, error: LABOR_HOURS_AR });
      expect(parse({ mode, hours: Number.NaN, ...piece }), mode).toEqual({ ok: false, error: LABOR_HOURS_AR });
      expect(parse({ mode, hours: Number.POSITIVE_INFINITY, ...piece }), mode).toEqual({
        ok: false,
        error: LABOR_HOURS_AR,
      });
      expect(parse({ mode, hours: LABOR_HOURS_MAX + 0.5, ...piece }), mode).toEqual({
        ok: false,
        error: LABOR_HOURS_AR,
      });
      // …and a valid one is accepted for that same mode.
      const ok = parse({ mode, hours: 7.5, ...piece });
      expect(ok.ok, mode).toBe(true);
      if (ok.ok) expect(ok.value.hours).toBe(7.5);
    }
  });

  it("accepts the numeric TEXT an <input type=number> produces", () => {
    const result = parse({ hours: " 6.25 " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.hours).toBe(6.25);
  });

  it("accepts exactly the 24-hour bound", () => {
    expect(parse({ hours: LABOR_HOURS_MAX }).ok).toBe(true);
  });
});

describe("labor entry — mode drives the piece shape (labor_logs_piece_shape)", () => {
  it("rejects an unsupported mode, including the empty and missing cases", () => {
    for (const bad of ["monthly", "HOURLY", "", null, undefined, 1]) {
      expect(parse({ mode: bad }), String(bad)).toEqual({ ok: false, error: LABOR_MODE_INVALID_AR });
    }
  });

  it("requires a positive quantity AND a supported unit for piece", () => {
    expect(parse({ mode: "piece", quantity: null, unit: "box" })).toEqual({
      ok: false,
      error: LABOR_QUANTITY_AR,
    });
    expect(parse({ mode: "piece", quantity: 0, unit: "box" })).toEqual({
      ok: false,
      error: LABOR_QUANTITY_AR,
    });
    expect(parse({ mode: "piece", quantity: -5, unit: "box" })).toEqual({
      ok: false,
      error: LABOR_QUANTITY_AR,
    });
    expect(parse({ mode: "piece", quantity: LABOR_QUANTITY_MAX + 1, unit: "box" })).toEqual({
      ok: false,
      error: LABOR_QUANTITY_AR,
    });
    expect(parse({ mode: "piece", quantity: 12, unit: null })).toEqual({
      ok: false,
      error: LABOR_UNIT_REQUIRED_AR,
    });
    expect(parse({ mode: "piece", quantity: 12, unit: "furlong" })).toEqual({
      ok: false,
      error: LABOR_UNIT_REQUIRED_AR,
    });
  });

  it("accepts every supported unit for piece", () => {
    for (const unit of LABOR_UNITS) {
      const result = parse({ mode: "piece", quantity: "40", unit });
      expect(result.ok, unit).toBe(true);
      if (!result.ok) continue;
      expect(result.value.unit).toBe(unit);
      expect(result.value.quantity).toBe(40);
    }
  });

  it("sends quantity and unit as NULL for every non-piece mode", () => {
    for (const mode of LABOR_MODES.filter((m) => m !== "piece")) {
      const result = parse({ mode });
      expect(result.ok, mode).toBe(true);
      if (!result.ok) continue;
      expect(result.value.quantity, mode).toBeNull();
      expect(result.value.unit, mode).toBeNull();
    }
  });

  it("refuses — never silently drops — a quantity or unit sent with a non-piece mode", () => {
    expect(parse({ mode: "hourly", quantity: 12 })).toEqual({ ok: false, error: LABOR_PIECE_ONLY_AR });
    expect(parse({ mode: "daily", unit: "box" })).toEqual({ ok: false, error: LABOR_PIECE_ONLY_AR });
    expect(parse({ mode: "seasonal", quantity: 1, unit: "tree" })).toEqual({
      ok: false,
      error: LABOR_PIECE_ONLY_AR,
    });
  });

  it("returns exactly the labor_logs columns, and no field the caller smuggled in", () => {
    const result = parseLaborLogInput(
      { ...entry({ mode: "piece", quantity: 3, unit: "crate" }), org_id: "someone-elses-org", rate: 999 },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value).sort()).toEqual(
      ["hours", "mode", "note", "personId", "quantity", "teamName", "unit", "workDate"].sort(),
    );
  });
});

describe("labor entry — the free-text-team consequence is stated at entry time", () => {
  it("warns, in words, that an unassigned row blocks the whole payroll close", () => {
    expect(LABOR_UNASSIGNED_TEAM_WARNING_AR).toContain("إقفال");
    expect(LABOR_UNASSIGNED_TEAM_WARNING_AR).toContain("يرفض");
  });
});

describe("labor entry — labels come from the ONE shared mode/unit source", () => {
  it("labels every mode and unit the database allows", () => {
    for (const mode of LABOR_MODES) expect(laborModeLabel(mode)).toBe(WAGE_MODE_AR[mode]);
    for (const unit of LABOR_UNITS) expect(laborUnitLabel(unit)).toBe(WAGE_UNIT_AR[unit]);
  });

  it("never guesses at a stored value this build does not know", () => {
    expect(laborModeLabel("monthly")).toBe(LABOR_UNKNOWN_LABEL_AR);
    expect(laborUnitLabel("furlong")).toBe(LABOR_UNKNOWN_LABEL_AR);
    expect(laborUnitLabel(null)).toBe("—");
  });

  it("uses the SAME labels the frozen payroll report prints", () => {
    for (const mode of LABOR_MODES) expect(PAYROLL_MODE_AR[mode]).toBe(LABOR_MODE_AR[mode]);
    for (const unit of LABOR_UNITS) expect(PAYROLL_UNIT_AR[unit]).toBe(LABOR_UNIT_AR[unit]);
  });
});

describe("labor write — field-safe error contract", () => {
  it("maps each SQLSTATE to its own category", () => {
    expect(classifyLaborWriteError({ code: "42501" })).toBe("forbidden");
    expect(classifyLaborWriteError({ code: "55000" })).toBe("closed_period");
    expect(classifyLaborWriteError({ code: "23514" })).toBe("shape");
    expect(classifyLaborWriteError({ code: "23503" })).toBe("missing_person");
    expect(classifyLaborWriteError({ code: "XX000" })).toBe("general");
    expect(classifyLaborWriteError(null)).toBe("general");
    expect(classifyLaborWriteError(undefined)).toBe("general");
    expect(classifyLaborWriteError({})).toBe("general");
  });

  it("tells the user a closed payroll period cannot be reopened — not the accounting-period story", () => {
    const message = LABOR_WRITE_MESSAGE_AR.closed_period;
    expect(message).toContain("أُقفلت");
    // lib/errors.ts' generic 55000 says "افتح الفترة"; a closed payroll run is immutable, so this
    // surface must NOT tell a supervisor to reopen it.
    expect(message).not.toContain("افتح الفترة");
  });

  it("returns ONLY fixed constants — never the database message", () => {
    const leaky = {
      code: "55000",
      message: "labor_logs row is covered by a closed payroll run and is frozen (org 3f2a…)",
    };
    const failure = laborWriteFailure(leaky);
    expect(failure.message).toBe(LABOR_WRITE_MESSAGE_AR.closed_period);
    expect(Object.values(LABOR_WRITE_MESSAGE_AR)).toContain(failure.message);
    expect(failure.message).not.toContain("labor_logs");
    expect(failure.message).not.toContain("3f2a");
  });

  it("has an Arabic message for every category, with no Latin identifiers in any of them", () => {
    for (const [category, message] of Object.entries(LABOR_WRITE_MESSAGE_AR)) {
      expect(message.trim().length, category).toBeGreaterThan(0);
      expect(message, category).not.toMatch(/[A-Za-z_]{4,}/);
    }
  });
});
