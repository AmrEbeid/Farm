import { describe, it, expect } from "vitest";
import {
  COMPENSATION_CONFLICT_AR,
  COMPENSATION_MESSAGE_AR,
  COMPENSATION_MODES,
  COMPENSATION_MODE_AR,
  COMPENSATION_MODE_INVALID_AR,
  COMPENSATION_MAX_SEASON_DAYS,
  COMPENSATION_PERSON_INVALID_AR,
  COMPENSATION_RATE_INVALID_AR,
  COMPENSATION_RATE_MAX,
  COMPENSATION_ROW_INVALID_AR,
  COMPENSATION_SEASONAL_EXACT_AR,
  COMPENSATION_SEASON_FORBIDDEN_AR,
  COMPENSATION_SEASON_ORDER_AR,
  COMPENSATION_SEASON_REQUIRED_AR,
  COMPENSATION_SEASON_TOO_LONG_AR,
  COMPENSATION_UNITS,
  COMPENSATION_UNIT_AR,
  COMPENSATION_UNIT_FORBIDDEN_AR,
  COMPENSATION_UNIT_REQUIRED_AR,
  classifyCompensationError,
  compensationBasisLabel,
  compensationFailure,
  parseCompensationInput,
} from "./compensation";

const PERSON = "11111111-2222-4333-8444-555555555555";
const ROW = "7c9e6b41-2d38-4f0a-9e5c-1b2a3d4e5f60";

function comp(overrides: Record<string, unknown> = {}) {
  return {
    rowId: null,
    personId: PERSON,
    mode: "hourly",
    rate: 25,
    unit: null,
    contractPeriodStart: null,
    contractPeriodEnd: null,
    ...overrides,
  };
}

const parse = (overrides: Record<string, unknown> = {}) => parseCompensationInput(comp(overrides));

describe("compensation — identity is validated as real ids", () => {
  it("requires a uuid person id", () => {
    for (const bad of [null, undefined, "", "person-1", 42, {}, "'; drop table people_compensation; --"]) {
      expect(parse({ personId: bad }), String(bad)).toEqual({
        ok: false,
        error: COMPENSATION_PERSON_INVALID_AR,
      });
    }
  });

  it("treats an absent rowId as CREATE and a present one as UPDATE", () => {
    for (const absent of [null, undefined, ""]) {
      const result = parse({ rowId: absent });
      expect(result.ok, String(absent)).toBe(true);
      if (result.ok) expect(result.value.rowId).toBeNull();
    }
    const editing = parse({ rowId: ROW });
    expect(editing.ok).toBe(true);
    if (editing.ok) expect(editing.value.rowId).toBe(ROW);
  });

  it("rejects a rowId that is present but not a uuid — a malformed UPDATE filter is never sent", () => {
    for (const bad of ["row-1", "0", 7, {}]) {
      expect(parse({ rowId: bad }), String(bad)).toEqual({
        ok: false,
        error: COMPENSATION_ROW_INVALID_AR,
      });
    }
  });

  it("rejects a non-object payload outright", () => {
    for (const bad of [null, undefined, 42, "hourly", [], [comp()]]) {
      expect(parseCompensationInput(bad).ok, String(bad)).toBe(false);
    }
  });
});

describe("compensation — the rate must be finite and strictly positive", () => {
  it("refuses to STORE the null/zero/negative rate the close treats as missing", () => {
    for (const bad of [null, undefined, "", 0, -1, "-0.01", "abc", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(parse({ rate: bad }), String(bad)).toEqual({
        ok: false,
        error: COMPENSATION_RATE_INVALID_AR,
      });
    }
  });

  it("bounds the rate against a slipped keypress", () => {
    expect(parse({ rate: COMPENSATION_RATE_MAX + 1 })).toEqual({
      ok: false,
      error: COMPENSATION_RATE_INVALID_AR,
    });
    expect(parse({ rate: COMPENSATION_RATE_MAX }).ok).toBe(true);
  });

  it("accepts the numeric TEXT an <input type=number> produces", () => {
    const result = parse({ rate: " 32.75 " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rate).toBe(32.75);
  });
});

describe("compensation — mode drives the unit shape (people_compensation_piece_shape)", () => {
  it("rejects an unsupported mode", () => {
    for (const bad of ["monthly", "PIECE", "", null, undefined, 3]) {
      expect(parse({ mode: bad }), String(bad)).toEqual({
        ok: false,
        error: COMPENSATION_MODE_INVALID_AR,
      });
    }
  });

  it("requires a supported unit for piece and accepts every one of them", () => {
    expect(parse({ mode: "piece", unit: null })).toEqual({
      ok: false,
      error: COMPENSATION_UNIT_REQUIRED_AR,
    });
    expect(parse({ mode: "piece", unit: "furlong" })).toEqual({
      ok: false,
      error: COMPENSATION_UNIT_REQUIRED_AR,
    });
    for (const unit of COMPENSATION_UNITS) {
      const result = parse({ mode: "piece", unit });
      expect(result.ok, unit).toBe(true);
      if (result.ok) expect(result.value.unit).toBe(unit);
    }
  });

  it("sends unit as NULL for every non-piece mode, and refuses one that was sent anyway", () => {
    for (const mode of COMPENSATION_MODES.filter((m) => m !== "piece")) {
      const seasonal = mode === "seasonal"
        ? { contractPeriodStart: "2026-06-01", contractPeriodEnd: "2026-08-31" }
        : {};
      const result = parse({ mode, ...seasonal });
      expect(result.ok, mode).toBe(true);
      if (result.ok) expect(result.value.unit, mode).toBeNull();

      expect(parse({ mode, unit: "box", ...seasonal }), mode).toEqual({
        ok: false,
        error: COMPENSATION_UNIT_FORBIDDEN_AR,
      });
    }
  });
});

describe("compensation — seasonal contract bounds are exact, ordered and bounded", () => {
  const seasonal = (overrides: Record<string, unknown> = {}) =>
    parse({
      mode: "seasonal",
      contractPeriodStart: "2026-06-01",
      contractPeriodEnd: "2026-08-31",
      ...overrides,
    });

  it("requires BOTH bounds, as real calendar dates", () => {
    expect(seasonal({ contractPeriodStart: null })).toEqual({
      ok: false,
      error: COMPENSATION_SEASON_REQUIRED_AR,
    });
    expect(seasonal({ contractPeriodEnd: null })).toEqual({
      ok: false,
      error: COMPENSATION_SEASON_REQUIRED_AR,
    });
    for (const bad of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-6-1", "01/06/2026", ""]) {
      expect(seasonal({ contractPeriodStart: bad }), String(bad)).toEqual({
        ok: false,
        error: COMPENSATION_SEASON_REQUIRED_AR,
      });
    }
    expect(seasonal({ contractPeriodStart: "2024-02-29", contractPeriodEnd: "2024-03-31" }).ok).toBe(true);
  });

  it("requires start <= end, and allows a single-day contract", () => {
    expect(seasonal({ contractPeriodStart: "2026-09-01", contractPeriodEnd: "2026-08-31" })).toEqual({
      ok: false,
      error: COMPENSATION_SEASON_ORDER_AR,
    });
    expect(seasonal({ contractPeriodStart: "2026-06-01", contractPeriodEnd: "2026-06-01" }).ok).toBe(true);
  });

  it("caps the span at one leap year, counting inclusively", () => {
    // 2026-01-01 .. 2026-12-31 is 365 inclusive days — allowed.
    expect(seasonal({ contractPeriodStart: "2026-01-01", contractPeriodEnd: "2026-12-31" }).ok).toBe(true);
    // 2024-01-01 .. 2024-12-31 is 366 inclusive days — exactly the bound.
    expect(seasonal({ contractPeriodStart: "2024-01-01", contractPeriodEnd: "2024-12-31" }).ok).toBe(true);
    // One day past the bound.
    expect(seasonal({ contractPeriodStart: "2024-01-01", contractPeriodEnd: "2025-01-01" })).toEqual({
      ok: false,
      error: COMPENSATION_SEASON_TOO_LONG_AR,
    });
    expect(COMPENSATION_MAX_SEASON_DAYS).toBe(366);
  });

  it("allows a FUTURE contract — a season is signed before it is worked", () => {
    expect(seasonal({ contractPeriodStart: "2099-06-01", contractPeriodEnd: "2099-08-31" }).ok).toBe(true);
  });

  it("sends both bounds as NULL for every non-seasonal mode, and refuses one that was sent", () => {
    for (const mode of COMPENSATION_MODES.filter((m) => m !== "seasonal")) {
      const piece = mode === "piece" ? { unit: "box" } : {};
      const result = parse({ mode, ...piece });
      expect(result.ok, mode).toBe(true);
      if (result.ok) {
        expect(result.value.contractPeriodStart, mode).toBeNull();
        expect(result.value.contractPeriodEnd, mode).toBeNull();
      }
      expect(parse({ mode, contractPeriodStart: "2026-06-01", ...piece }), mode).toEqual({
        ok: false,
        error: COMPENSATION_SEASON_FORBIDDEN_AR,
      });
      expect(parse({ mode, contractPeriodEnd: "2026-08-31", ...piece }), mode).toEqual({
        ok: false,
        error: COMPENSATION_SEASON_FORBIDDEN_AR,
      });
    }
  });

  it("states the exact-match rule in words — the close will not infer it", () => {
    expect(COMPENSATION_SEASONAL_EXACT_AR).toContain("مطابقة");
    expect(COMPENSATION_SEASONAL_EXACT_AR).toContain("التداخل");
  });
});

describe("compensation — normalized output", () => {
  it("returns exactly the people_compensation columns, and nothing the caller smuggled in", () => {
    const result = parseCompensationInput({
      ...comp({ mode: "piece", unit: "tree", rate: "12.5" }),
      org_id: "someone-elses-org",
      id: "another-row",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value).sort()).toEqual(
      ["contractPeriodEnd", "contractPeriodStart", "mode", "personId", "rate", "rowId", "unit"].sort(),
    );
    expect(result.value.rate).toBe(12.5);
  });

  it("labels the basis a rate is paid per", () => {
    expect(compensationBasisLabel("hourly", null)).toBe("ساعة");
    expect(compensationBasisLabel("daily", null)).toBe("يوم");
    expect(compensationBasisLabel("seasonal", null)).toBe("العقد كاملًا");
    expect(compensationBasisLabel("piece", "tree")).toBe(COMPENSATION_UNIT_AR.tree);
    expect(compensationBasisLabel("piece", null)).toBe("غير معروف");
    expect(compensationBasisLabel("piece", "furlong")).toBe("غير معروف");
    expect(compensationBasisLabel("monthly", null)).toBe("غير معروف");
  });

  it("labels every mode the database allows", () => {
    for (const mode of COMPENSATION_MODES) {
      expect(COMPENSATION_MODE_AR[mode].trim().length, mode).toBeGreaterThan(0);
    }
  });
});

describe("compensation — field-safe error contract", () => {
  it("maps each SQLSTATE to its own category", () => {
    expect(classifyCompensationError({ code: "42501" })).toBe("forbidden");
    expect(classifyCompensationError({ code: "23505" })).toBe("duplicate");
    expect(classifyCompensationError({ code: "23514" })).toBe("validation");
    expect(classifyCompensationError({ code: "22023" })).toBe("validation");
    expect(classifyCompensationError({ code: "23502" })).toBe("validation");
    expect(classifyCompensationError({ code: "22P02" })).toBe("validation");
    expect(classifyCompensationError({ code: "23503" })).toBe("missing_person");
    expect(classifyCompensationError({ code: "XX000" })).toBe("general");
    expect(classifyCompensationError(null)).toBe("general");
    expect(classifyCompensationError(undefined)).toBe("general");
  });

  it("turns the unique-index race into an instruction, not an index name", () => {
    const failure = compensationFailure({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "people_compensation_person_mode_unit_uq" Key (person_id, mode, unit)=(1111…, piece, box) already exists.',
    });
    expect(failure.category).toBe("duplicate");
    expect(failure.message).toBe(COMPENSATION_CONFLICT_AR);
    expect(failure.message).not.toContain("people_compensation");
    expect(failure.message).not.toContain("1111");
  });

  it("returns ONLY fixed constants — a wage value can never ride out on an error", () => {
    const leaky = { code: "23514", message: 'check constraint violated: rate=999999 person=1111…' };
    const failure = compensationFailure(leaky);
    expect(Object.values(COMPENSATION_MESSAGE_AR)).toContain(failure.message);
    expect(failure.message).not.toContain("999999");
    expect(failure.message).not.toContain("rate");
  });

  it("has an Arabic message for every category, with no Latin identifiers in any of them", () => {
    for (const [category, message] of Object.entries(COMPENSATION_MESSAGE_AR)) {
      expect(message.trim().length, category).toBeGreaterThan(0);
      expect(message, category).not.toMatch(/[A-Za-z_]{4,}/);
    }
  });
});
