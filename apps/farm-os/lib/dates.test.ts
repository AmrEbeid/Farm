import { describe, it, expect } from "vitest";
import { fmtDate, daysSince } from "./dates";

// Anchor valid-date assertions to the module's own formatter so they stay stable
// across ICU/Node versions; assert the dash sentinel exactly for invalid input.
const FMT = new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" });

describe("fmtDate", () => {
  it("returns the em-dash sentinel for null/undefined/empty string", () => {
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate(undefined)).toBe("—");
    expect(fmtDate("")).toBe("—");
  });

  it("returns the em-dash sentinel for unparseable strings (NaN time)", () => {
    expect(fmtDate("not-a-date")).toBe("—");
    expect(fmtDate("2024-13-45")).toBe("—");
  });

  it("returns the em-dash sentinel for an Invalid Date object", () => {
    expect(fmtDate(new Date("nope"))).toBe("—");
    expect(fmtDate(new Date(NaN))).toBe("—");
  });

  it("formats a valid ISO date string", () => {
    const iso = "2024-03-15T00:00:00Z";
    expect(fmtDate(iso)).toBe(FMT.format(new Date(iso)));
    expect(fmtDate(iso)).not.toBe("—");
  });

  it("formats a date-only string", () => {
    const d = "2024-03-15";
    expect(fmtDate(d)).toBe(FMT.format(new Date(d)));
  });

  it("formats a Date object and matches the equivalent string input", () => {
    const iso = "2024-03-15T00:00:00Z";
    const date = new Date(iso);
    expect(fmtDate(date)).toBe(FMT.format(date));
    // Date vs string for the same instant render identically.
    expect(fmtDate(date)).toBe(fmtDate(iso));
  });

  it("handles the unix epoch (a falsy-looking but valid instant)", () => {
    const epoch = new Date(0);
    expect(fmtDate(epoch)).toBe(FMT.format(epoch));
    expect(fmtDate(epoch)).not.toBe("—");
  });
});

describe("daysSince", () => {
  const now = new Date("2026-04-01T00:00:00Z");

  it("returns null (never 0) for null/undefined/empty/unparseable — no fabricated 'today'", () => {
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince(undefined, now)).toBeNull();
    expect(daysSince("", now)).toBeNull();
    expect(daysSince("not-a-date", now)).toBeNull();
  });

  it("computes whole days between a past date and now", () => {
    expect(daysSince("2026-03-01T00:00:00Z", now)).toBe(31);
    expect(daysSince("2026-03-31T00:00:00Z", now)).toBe(1);
  });

  it("returns 0 for the same instant", () => {
    expect(daysSince("2026-04-01T00:00:00Z", now)).toBe(0);
  });

  it("accepts a Date object equivalently to the same ISO string", () => {
    const d = new Date("2026-03-15T00:00:00Z");
    expect(daysSince(d, now)).toBe(daysSince("2026-03-15T00:00:00Z", now));
  });

  it("defaults `now` to the current moment when omitted", () => {
    const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(daysSince(past)).toBe(5);
  });
});
