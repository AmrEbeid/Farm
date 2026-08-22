import { describe, expect, it } from "vitest";
import { whatsappDigits, whatsappHref } from "./outbound-links";

describe("WhatsApp outbound links", () => {
  it.each([
    ["01001234567", "201001234567"],
    ["1001234567", "201001234567"],
    ["+20 100 123 4567", "201001234567"],
    ["0020 100 123 4567", "201001234567"],
  ])("normalizes %s to E.164 digits", (input, expected) => {
    expect(whatsappDigits(input)).toBe(expected);
  });

  it("rejects missing and implausible phone values", () => {
    expect(whatsappDigits(null)).toBeNull();
    expect(whatsappDigits("عبر الموقع")).toBeNull();
    expect(whatsappDigits("123")).toBeNull();
  });

  it("encodes the message body", () => {
    expect(whatsappHref("01001234567", "أهلاً وسهلاً")).toBe(
      `https://wa.me/201001234567?text=${encodeURIComponent("أهلاً وسهلاً")}`,
    );
  });
});
