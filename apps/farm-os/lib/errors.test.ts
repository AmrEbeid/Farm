import { describe, it, expect } from "vitest";
import { toArabicError, GENERIC_AR_ERROR, type DbError } from "./errors";

// Non-negotiable #2 (Arabic-RTL-first): a DB-raised error must NEVER leak a raw
// English Postgres/PostgREST message to a field user. These assert the helper
// always returns Arabic — never `error.message`.

const hasLatinLetters = (s: string) => /[A-Za-z]/.test(s);

describe("toArabicError", () => {
  it("maps each known SQLSTATE to a non-English Arabic message", () => {
    const codes = ["42501", "23514", "22023", "23505", "23503", "23502", "55000", "P0002", "40001", "40P01", "57014"];
    for (const code of codes) {
      const msg = toArabicError({ code, message: "some raw English postgres detail" });
      expect(msg).not.toBe("some raw English postgres detail");
      expect(hasLatinLetters(msg)).toBe(false);
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  it("returns the generic Arabic fallback for an unknown code — never the raw message", () => {
    const err: DbError = { code: "99999", message: "null value in column violates not-null constraint" };
    expect(toArabicError(err)).toBe(GENERIC_AR_ERROR);
    expect(hasLatinLetters(GENERIC_AR_ERROR)).toBe(false);
  });

  it("returns the fallback for an error with no code", () => {
    expect(toArabicError({ message: "boom" })).toBe(GENERIC_AR_ERROR);
  });

  it("returns the fallback for null / undefined (callers may map unconditionally)", () => {
    expect(toArabicError(null)).toBe(GENERIC_AR_ERROR);
    expect(toArabicError(undefined)).toBe(GENERIC_AR_ERROR);
  });

  it("prefers caller overrides over the default mapping", () => {
    const err: DbError = { code: "42501", message: "permission denied" };
    expect(toArabicError(err)).toBe("ليس لديك صلاحية لتنفيذ هذه العملية");
    expect(toArabicError(err, { "42501": "ليس لديك صلاحية حجز المخزون" })).toBe(
      "ليس لديك صلاحية حجز المخزون",
    );
  });

  it("honors a custom Arabic fallback for unmapped codes", () => {
    const msg = toArabicError({ code: "99999", message: "x" }, {}, "تعذّر إنشاء طلب الشراء");
    expect(msg).toBe("تعذّر إنشاء طلب الشراء");
  });

  it("explains period-lock SQLSTATEs before falling back to action-specific messages", () => {
    expect(toArabicError({ code: "55000", message: "period is locked" })).toBe(
      "الفترة المحاسبية مقفلة؛ افتحها أو اختر تاريخًا خارج الفترة المقفلة.",
    );
  });

  it("override for an unrelated code does not shadow the matched default", () => {
    // code matches a DEFAULT_AR entry; an override for a *different* code is ignored.
    expect(toArabicError({ code: "23514" }, { "42501": "x" })).toBe(
      "المخزون غير كافٍ لتنفيذ هذه الكمية",
    );
  });
});
