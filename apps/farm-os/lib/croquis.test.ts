import { describe, it, expect } from "vitest";
import { attentionFor, attentionCount } from "./croquis";

describe("croquis attention (Stage 5)", () => {
  it("is healthy when nothing is flagged", () => {
    expect(attentionFor({ watch: 0, sick: 0, dead: 0 })).toBe("healthy");
    expect(attentionCount({ watch: 0, sick: 0, dead: 0 })).toBe(0);
  });

  it("is watch when only watch palms exist", () => {
    expect(attentionFor({ watch: 3, sick: 0, dead: 0 })).toBe("watch");
  });

  it("escalates to alert on any sick palm (overrides watch)", () => {
    expect(attentionFor({ watch: 5, sick: 1, dead: 0 })).toBe("alert");
  });

  it("escalates to alert on any dead palm", () => {
    expect(attentionFor({ watch: 0, sick: 0, dead: 2 })).toBe("alert");
  });

  it("counts every flagged palm for the badge", () => {
    expect(attentionCount({ watch: 2, sick: 1, dead: 1 })).toBe(4);
  });
});
