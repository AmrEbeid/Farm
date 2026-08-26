import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Source-contract guard for the production sign-in surface.
 *
 * Production carries real farm financial data. The login page ships to the client
 * bundle, so it must never again carry a shared credential, a demo account
 * address, a demo-activation control, or a prefilled field — and the route that
 * provisioned those accounts must stay deleted. See docs/SECURITY-NOTES.md §5.
 *
 * The forbidden strings are assembled from fragments so this test file does not
 * itself reintroduce the literals it bans.
 */

const APP_ROOT = process.cwd();
const LOGIN_PAGE = join(APP_ROOT, "app", "(auth)", "login", "page.tsx");

/** The retired shared demo password. */
const KNOWN_DEMO_PASSWORD = ["farm", "os", "pilot"].join("-");
/** The retired demo account email domain (owner@…, manager@…, storekeeper@…). */
const DEMO_EMAIL_DOMAIN = "@ebeid" + ".test";
/** The retired provisioning endpoint. */
const DEMO_SEED_ENDPOINT = "/api/dev/" + "seed-auth";
/** The retired Arabic demo-activation copy ("حسابات" + "العرض"). */
const DEMO_ACTIVATION_COPY = ["حسابات", "العرض"].join(" ");

const SCANNED_EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx"];

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext)) ? [path] : [];
  });
}

function loginSource(): string {
  return readFileSync(LOGIN_PAGE, "utf8");
}

describe("login page has no demo-credential surface", () => {
  it("does not contain the retired shared password", () => {
    expect(loginSource()).not.toContain(KNOWN_DEMO_PASSWORD);
  });

  it("does not contain demo account addresses", () => {
    expect(loginSource()).not.toContain(DEMO_EMAIL_DOMAIN);
  });

  it("does not reference the demo provisioning endpoint", () => {
    expect(loginSource()).not.toContain(DEMO_SEED_ENDPOINT);
    expect(loginSource()).not.toContain("seed-auth");
  });

  it("does not contain demo-activation copy or a chooser", () => {
    const src = loginSource();
    expect(src).not.toContain(DEMO_ACTIVATION_COPY);
    expect(src).not.toMatch(/DEMO_ACCOUNTS|DEMO_PASSWORD|enableDemo/);
  });

  it("starts with blank email and password fields", () => {
    const src = loginSource();
    for (const field of ["email", "password"]) {
      const initialiser = new RegExp(
        `\\[${field},\\s*set[A-Za-z]+\\]\\s*=\\s*useState(?:<[^>]*>)?\\((.*?)\\)\\s*;`,
      ).exec(src);
      expect(initialiser, `no useState declaration found for "${field}"`).not.toBeNull();
      expect(initialiser![1].trim()).toBe('""');
    }
  });
});

describe("login page keeps the authentication contract", () => {
  it("still signs in with Supabase email+password and redirects to the dashboard", () => {
    const src = loginSource();
    expect(src).toContain("signInWithPassword");
    expect(src).toContain('window.location.assign("/dashboard")');
  });

  it("keeps the Arabic RTL structure (Arabic heading, LTR credential inputs)", () => {
    const src = loginSource();
    expect(src).toContain("تسجيل الدخول");
    expect(src).toContain("البريد الإلكتروني");
    expect(src).toContain("كلمة المرور");
    // email/password stay left-to-right inside the RTL page
    expect(src.match(/dir="ltr"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe("active organization session recovery", () => {
  it("repairs a legacy signed-in session through the guarded RPC before protected pages render", () => {
    const proxy = readFileSync(join(APP_ROOT, "proxy.ts"), "utf8");
    expect(proxy).toContain("activeOrgIdFromAccessToken");
    expect(proxy).toContain('.from("organization_member")');
    expect(proxy).toContain('.eq("user_id", user.id)');
    expect(proxy).toContain('.rpc("fn_set_active_org"');
    expect(proxy).toContain("refreshSession()");
    expect(proxy).toContain("activeOrgRepairTarget");
    expect(proxy).toContain("headersToSet");
    expect(proxy).toContain("private, no-cache, no-store");
    expect(proxy).toContain("REPAIR_COOKIE");
    expect(proxy).toContain("refreshedOrgId !== repairTarget");
    expect(proxy).not.toContain("SERVICE_ROLE");
  });
});

describe("demo provisioning surface stays deleted", () => {
  it("has no dev seed-auth API route", () => {
    expect(existsSync(join(APP_ROOT, "app", "api", "dev", "seed-auth"))).toBe(false);
  });

  it("has no seed-auth helper module", () => {
    const helperExists = readdirSync(join(APP_ROOT, "lib")).some(
      (entry) => entry.replace(/\.[^.]+$/, "") === "seed-auth",
    );
    expect(helperExists).toBe(false);
  });

  it("has no proxy special case for the removed route", () => {
    const proxy = readFileSync(join(APP_ROOT, "proxy.ts"), "utf8");
    expect(proxy).not.toContain("seed-auth");
  });
});

describe("no shipped source carries the retired demo credentials", () => {
  const files = [
    ...sourceFiles(join(APP_ROOT, "app")),
    ...sourceFiles(join(APP_ROOT, "lib")),
  ];

  const forbidden = [
    { label: "the shared demo password", needle: KNOWN_DEMO_PASSWORD },
    { label: "a demo account address", needle: DEMO_EMAIL_DOMAIN },
    { label: "the demo provisioning endpoint", needle: DEMO_SEED_ENDPOINT },
    { label: "demo-activation copy", needle: DEMO_ACTIVATION_COPY },
  ];

  it("scans a non-empty set of app/lib sources", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("contains none of the retired demo strings", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const { label, needle } of forbidden) {
        if (source.includes(needle)) {
          offenders.push(`${relative(APP_ROOT, file)} contains ${label}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
