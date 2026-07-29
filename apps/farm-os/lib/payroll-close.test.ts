import { describe, it, expect } from "vitest";
import {
  PAYROLL_CLOSE_MESSAGE_AR,
  PAYROLL_MAX_PERIOD_DAYS,
  PAYROLL_PERIOD_FORMAT_AR,
  PAYROLL_PERIOD_FUTURE_AR,
  PAYROLL_PERIOD_ORDER_AR,
  PAYROLL_PERIOD_TOO_LONG_AR,
  cairoTodayIso,
  classifyPayrollCloseError,
  isCalendarDate,
  parsePayrollPeriod,
  payrollCloseFailure,
} from "./payroll-close";

const TODAY = new Date("2026-07-29T09:00:00.000Z");

describe("payroll period validation (strict calendar)", () => {
  it("derives today from Cairo at the UTC day boundary", () => {
    expect(cairoTodayIso(new Date("2026-07-01T20:59:59.000Z"))).toBe("2026-07-01");
    expect(cairoTodayIso(new Date("2026-07-01T21:00:00.000Z"))).toBe("2026-07-02");
    expect(
      parsePayrollPeriod(
        "2026-07-02",
        "2026-07-02",
        new Date("2026-07-01T21:00:00.000Z"),
      ).ok,
    ).toBe(true);
  });

  it("accepts a real period and reports its inclusive day count", () => {
    expect(parsePayrollPeriod("2026-06-01", "2026-06-30", TODAY)).toEqual({
      ok: true,
      start: "2026-06-01",
      end: "2026-06-30",
      days: 30,
    });
  });

  it("counts a single-day period as one day, not zero", () => {
    const parsed = parsePayrollPeriod("2026-06-15", "2026-06-15", TODAY);
    expect(parsed).toEqual({ ok: true, start: "2026-06-15", end: "2026-06-15", days: 1 });
  });

  it("rejects anything that is not exactly YYYY-MM-DD", () => {
    for (const bad of [
      "",
      "2026-6-1",
      "26-06-01",
      "2026/06/01",
      "2026-06-01T00:00:00Z",
      " 2026-06-01",
      "2026-06-01 ",
      "today",
      null,
      undefined,
      20260601,
      new Date("2026-06-01"),
    ]) {
      expect(parsePayrollPeriod(bad, "2026-06-30", TODAY), String(bad)).toEqual({
        ok: false,
        error: PAYROLL_PERIOD_FORMAT_AR,
      });
    }
  });

  it("rejects impossible calendar days instead of rolling them over", () => {
    // Date.UTC would silently roll each of these forward; the round-trip check refuses them.
    for (const bad of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-00-10", "2026-06-31", "2026-06-00"]) {
      expect(isCalendarDate(bad), bad).toBe(false);
      expect(parsePayrollPeriod("2026-06-01", bad, TODAY), bad).toEqual({
        ok: false,
        error: PAYROLL_PERIOD_FORMAT_AR,
      });
    }
    // …while the real leap day is accepted.
    expect(isCalendarDate("2024-02-29")).toBe(true);
  });

  it("rejects a two-digit-year coercion that Date.UTC would otherwise accept", () => {
    expect(isCalendarDate("0050-01-01")).toBe(false);
  });

  it("rejects start after end", () => {
    expect(parsePayrollPeriod("2026-06-30", "2026-06-01", TODAY)).toEqual({
      ok: false,
      error: PAYROLL_PERIOD_ORDER_AR,
    });
  });

  it("allows exactly the maximum span and rejects one day more", () => {
    // 2025-07-30 → 2026-07-29 inclusive is 366 days (2026-02 is not a leap February, but the span
    // crosses no leap day here — the assertion is on the inclusive arithmetic itself).
    const atLimit = parsePayrollPeriod("2025-07-29", "2026-07-28", TODAY);
    expect(atLimit.ok).toBe(true);
    expect(atLimit.ok && atLimit.days).toBe(PAYROLL_MAX_PERIOD_DAYS - 1);

    const exact = parsePayrollPeriod("2025-07-28", "2026-07-28", TODAY);
    expect(exact.ok && exact.days).toBe(PAYROLL_MAX_PERIOD_DAYS);

    expect(parsePayrollPeriod("2025-07-27", "2026-07-28", TODAY)).toEqual({
      ok: false,
      error: PAYROLL_PERIOD_TOO_LONG_AR,
    });
  });

  it("rejects any period reaching into the future, but allows one ending today", () => {
    expect(parsePayrollPeriod("2026-07-01", "2026-07-30", TODAY)).toEqual({
      ok: false,
      error: PAYROLL_PERIOD_FUTURE_AR,
    });
    expect(parsePayrollPeriod("2026-07-01", "2026-07-29", TODAY).ok).toBe(true);
  });

  it("checks the order and length rules before the future rule", () => {
    // A reversed pair in the future must still read as "start after end" — the more actionable of
    // the two, and the one the user actually typed wrong.
    expect(parsePayrollPeriod("2030-01-10", "2030-01-01", TODAY).ok).toBe(false);
    expect(parsePayrollPeriod("2030-01-10", "2030-01-01", TODAY)).toEqual({
      ok: false,
      error: PAYROLL_PERIOD_ORDER_AR,
    });
  });
});

// ── Field-safe error mapping (non-negotiable #2) ──────────────────────────────────────────────────
// The real raises from fn_close_payroll_run, verbatim from migration 20260729090000. Each embeds
// identifiers that must never reach a user.
const ORG_UUID = "3f2a1c5e-9b7d-4e21-8a64-0c1d2e3f4a5b";
const PERSON_UUID = "7c9e6b41-2d38-4f0a-9e5c-1b2a3d4e5f60";

const RAISES = {
  noLabor: {
    code: "22023",
    message: `no labor logs found for org ${ORG_UUID} in period 2026-06-01 .. 2026-06-30`,
  },
  crew: {
    code: "22023",
    message: "free-text crew labor logs exist in this period — assign a person before closing payroll",
  },
  missingRate: {
    code: "22023",
    message: `missing or invalid rate for (person:mode/unit): ${PERSON_UUID}:piece/box, ${PERSON_UUID}:seasonal`,
  },
  invalidPeriod: {
    code: "22023",
    message: "invalid period: period_start (2026-07-30) is after period_end (2026-07-01)",
  },
  overlap: {
    code: "23505",
    message: "period 2026-06-10 .. 2026-06-20 overlaps an existing closed payroll run",
  },
  forbiddenRole: {
    code: "42501",
    message: "forbidden: payroll.read (owner/accountant) is required",
  },
  forbiddenOrg: { code: "42501", message: "forbidden: cross-org payroll close" },
  crossOrgPerson: { code: "23514", message: "cross-org person reference in labor_logs for this period" },
} as const;

describe("payroll close error mapping", () => {
  it("classifies each raise into its own category", () => {
    expect(classifyPayrollCloseError(RAISES.noLabor)).toBe("no_labor");
    expect(classifyPayrollCloseError(RAISES.crew)).toBe("unassigned_crew");
    expect(classifyPayrollCloseError(RAISES.missingRate)).toBe("missing_rate");
    expect(classifyPayrollCloseError(RAISES.invalidPeriod)).toBe("validation");
    expect(classifyPayrollCloseError(RAISES.overlap)).toBe("overlap");
    expect(classifyPayrollCloseError(RAISES.forbiddenRole)).toBe("forbidden");
    expect(classifyPayrollCloseError(RAISES.forbiddenOrg)).toBe("forbidden");
    expect(classifyPayrollCloseError(RAISES.crossOrgPerson)).toBe("general");
  });

  it("treats an unrecognised 22023 as a validation problem, not a silent success", () => {
    expect(classifyPayrollCloseError({ code: "22023", message: "something new" })).toBe("validation");
  });

  it("falls back to the generic category for unknown, empty and missing errors", () => {
    expect(classifyPayrollCloseError({ code: "P0001", message: "boom" })).toBe("general");
    expect(classifyPayrollCloseError({})).toBe("general");
    expect(classifyPayrollCloseError(null)).toBe("general");
    expect(classifyPayrollCloseError(undefined)).toBe("general");
  });

  it("returns ONLY fixed Arabic messages, never the DB text", () => {
    const fixed = new Set(Object.values(PAYROLL_CLOSE_MESSAGE_AR));
    for (const raise of Object.values(RAISES)) {
      const failure = payrollCloseFailure(raise);
      expect(fixed.has(failure.message), failure.message).toBe(true);
      expect(failure.message).toBe(PAYROLL_CLOSE_MESSAGE_AR[failure.category]);
    }
  });

  it("leaks no uuid, no raw English, no rate and no date from the DB message", () => {
    const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const LATIN = /[A-Za-z]/;
    const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
    for (const raise of Object.values(RAISES)) {
      const { message } = payrollCloseFailure(raise);
      expect(UUID_ANYWHERE.test(message), message).toBe(false);
      expect(LATIN.test(message), message).toBe(false);
      expect(ISO_DATE.test(message), message).toBe(false);
      expect(message.includes(raise.message)).toBe(false);
    }
  });

  it("every category has a non-empty message and every message is distinct", () => {
    const messages = Object.values(PAYROLL_CLOSE_MESSAGE_AR);
    for (const message of messages) expect(message.trim().length).toBeGreaterThan(0);
    expect(new Set(messages).size).toBe(messages.length);
  });
});
