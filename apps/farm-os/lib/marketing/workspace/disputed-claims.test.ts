import { describe, expect, it } from "vitest";
import { containsDisputedClaim, splitDisputedClaims } from "./disputed-claims";

// Exact phrases transcribed from the owner-supplied 2026 marketing HTML (reviewed excerpts, not raw
// markup) — every place the source repeats the disputed approximate palm count (CLAUDE.md #5).
const SOURCE_EXCERPTS = [
  "نحو 5,000 نخلة برحي · 7 قطاعات · تربة طينية وري نيلي",
  "المساحة: 120 فدانًا · نحو 5,000 نخلة برحي · 7 قطاعات إنتاجية.",
  "مزرعتنا 120 فداناً وحوالي 5,000 نخلة برحي، حاصلة على اعتماد GLOBALG.A.P",
  "We farm 120 feddan (~5,000 Barhi palms), certified GLOBALG.A.P",
  "نحو 5,000 نخلة",
];

describe("disputed palm-count claim flagging (CLAUDE.md #5)", () => {
  it("detects the claim in every known source phrasing", () => {
    for (const text of SOURCE_EXCERPTS) {
      expect(containsDisputedClaim(text)).toBe(true);
    }
  });

  it("splits the claim out as its own segment while preserving every character", () => {
    const text = "المساحة: 120 فدانًا · نحو 5,000 نخلة برحي · 7 قطاعات إنتاجية.";
    const segments = splitDisputedClaims(text);
    expect(segments.map((s) => s.text).join("")).toBe(text);
    expect(segments.some((s) => s.disputed && s.text === "نحو 5,000 نخلة برحي")).toBe(true);
    expect(segments.filter((s) => s.disputed)).toHaveLength(1);
  });

  it("matches the English phrasing too", () => {
    const text = "We farm 120 feddan (~5,000 Barhi palms), certified GLOBALG.A.P (IFA v6)";
    const segments = splitDisputedClaims(text);
    expect(segments.map((s) => s.text).join("")).toBe(text);
    expect(segments.some((s) => s.disputed && s.text === "~5,000 Barhi palms")).toBe(true);
  });

  it("does not flag unrelated text", () => {
    expect(containsDisputedClaim("طاقة اعتماد GLOBALG.A.P للموسم")).toBe(false);
    const segments = splitDisputedClaims("لا يوجد رقم هنا");
    expect(segments).toEqual([{ text: "لا يوجد رقم هنا", disputed: false }]);
  });
});
