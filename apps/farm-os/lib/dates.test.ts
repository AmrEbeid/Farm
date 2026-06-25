import { describe, it, expect } from "vitest";
import { fmtDate } from "./dates";

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
