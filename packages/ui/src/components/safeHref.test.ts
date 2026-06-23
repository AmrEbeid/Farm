import { it, expect, describe } from "vitest";
import { safeHref, safeImgSrc } from "./safeHref";

describe("safeHref", () => {
  it("passes through safe schemes and relative/anchor URLs unchanged", () => {
    for (const ok of ["https://x.test/a", "http://x.test", "/plans/1", "#section",
                      "mailto:a@b.test", "tel:+201000000000", "palms/12", "../up"]) {
      expect(safeHref(ok)).toBe(ok);
    }
  });

  it("blocks javascript: and other dangerous schemes (returns undefined)", () => {
    for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)",
                       "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)",
                       "file:///etc/passwd"]) {
      expect(safeHref(bad)).toBeUndefined();
    }
  });

  it("catches whitespace/newline-obfuscated javascript: URLs", () => {
    expect(safeHref("java\nscript:alert(1)")).toBeUndefined();
    expect(safeHref("  javascript:alert(1)")).toBeUndefined();
    expect(safeHref("ja\tva\tscript:alert(1)")).toBeUndefined();
  });

  it("returns undefined for empty/nullish input", () => {
    expect(safeHref(undefined)).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
  });
});

describe("safeImgSrc", () => {
  it("allows http(s), data:image, and relative URLs", () => {
    for (const ok of ["https://x.test/a.png", "http://x.test/a.jpg",
                      "data:image/png;base64,AAAA", "/avatars/1.png", "a.png"]) {
      expect(safeImgSrc(ok)).toBe(ok);
    }
  });
  it("blocks javascript:, data:text/html, and nullish", () => {
    expect(safeImgSrc("javascript:alert(1)")).toBeUndefined();
    expect(safeImgSrc("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeImgSrc(undefined)).toBeUndefined();
    expect(safeImgSrc("")).toBeUndefined();
  });
});
