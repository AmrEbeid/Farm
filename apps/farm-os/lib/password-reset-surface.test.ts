import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP_ROOT = process.cwd();
const readAppFile = (...parts: string[]) => readFileSync(join(APP_ROOT, ...parts), "utf8");

describe("password recovery security contract", () => {
  it("offers recovery from the login page", () => {
    expect(readAppFile("app", "(auth)", "login", "page.tsx")).toContain('href="/forgot-password"');
  });

  it("requests a same-origin reset and does not reveal account existence", () => {
    const source = readAppFile("app", "(auth)", "forgot-password", "page.tsx");
    expect(source).toContain("resetPasswordForEmail");
    expect(source).toContain('`${window.location.origin}/reset-password`');
    expect(source).toContain("إذا كان البريد مسجلًا");
    expect(source).toContain("finally");
    expect(source).toContain("setSent(true)");
    expect(source).not.toContain("setFailed");
    expect(source).not.toContain("error.message");
  });

  it("consumes only recovery tokens when the user submits the new password", () => {
    const page = readAppFile("app", "(auth)", "reset-password", "page.tsx");
    const form = readAppFile("app", "(auth)", "reset-password", "reset-password-form.tsx");
    const route = readAppFile("app", "(auth)", "auth", "reset-password", "route.ts");
    expect(form).toContain('type === "recovery"');
    expect(form).toContain("window.location.hash.slice(1)");
    expect(form).toContain('fetch("/auth/reset-password"');
    expect(form).toContain("window.history.replaceState");
    expect(page).toContain('referrer: "no-referrer"');
    expect(route).toContain("export async function POST");
    expect(route).not.toContain("export async function GET");
    expect(route).toContain("verifyOtp");
    expect(route).toContain('type: "recovery"');
    expect(route).toContain("updateUser({ password })");
  });

  it("does not let an ordinary signed-in session bypass the one-time token", () => {
    const source = readAppFile("app", "(auth)", "auth", "reset-password", "route.ts");
    expect(source).toContain("verifyOtp");
    expect(source.indexOf("verifyOtp")).toBeLessThan(source.indexOf("updateUser"));
    expect(source).not.toContain("getUser");
  });

  it("requires matching strong passwords and revokes sessions on all devices", () => {
    const source = readAppFile("app", "(auth)", "reset-password", "reset-password-form.tsx");
    expect(source).toContain("MIN_PASSWORD_LENGTH = 12");
    expect(source).toContain("password !== confirmation");
    expect(source).not.toContain("error.message");
    expect(readAppFile("app", "(auth)", "auth", "reset-password", "route.ts")).toContain(
      'signOut({ scope: "global" })',
    );
    expect(readAppFile("app", "(auth)", "auth", "reset-password", "route.ts")).toContain(
      "passwordChanged: true",
    );
  });

  it("keeps every recovery surface independent from organization membership", () => {
    const source = readAppFile("proxy.ts");
    expect(source).toContain('"/forgot-password"');
    expect(source).toContain('"/reset-password"');
    expect(source).toContain('"/auth/reset-password"');
    expect(source).toContain("AUTH_SURFACE_PATHS.has(request.nextUrl.pathname)");
  });
});
